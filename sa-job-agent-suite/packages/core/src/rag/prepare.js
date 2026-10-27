import { AppError, ERROR_CODES } from '../errors.js';
import { buildCorpus, describeCorpus } from './corpus.js';
import { chunkDocuments } from './chunk.js';
import { createSearchIndex } from './bm25.js';
import { RAG_SYSTEM, CHECK_SYSTEM, buildAskPrompt, buildCheckPrompt } from './prompt.js';

const MIN_QUESTION = 3;
const ASK_TOP_K = 8;
const CHECK_TOP_K = 12;

function sourcesOf({ profile = {}, jobs = [], memory = {}, answers = [] } = {}) {
  return {
    profile: profile || {},
    jobs: Array.isArray(jobs) ? jobs : [],
    memory: memory || {},
    answers: Array.isArray(answers) ? answers : []
  };
}

function documentTitle(job, kind) {
  const base = kind === 'cover-letter' ? 'Cover letter' : 'Tailored CV';
  const role = String(job.title || 'Untitled role').trim();
  const company = String(job.company || '').trim();
  return `${base}: ${role}${company ? ` at ${company}` : ''}`;
}

export function summariseSearched(docs) {
  return describeCorpus(docs);
}

export function prepareAsk({ question, purpose = 'general', topK = ASK_TOP_K, ...rest } = {}) {
  const clean = String(question || '').trim();
  if (clean.length < MIN_QUESTION) {
    throw new AppError(ERROR_CODES.VALIDATION, 'Type a question with at least a few words.');
  }

  const sources = sourcesOf(rest);
  const docs = buildCorpus(sources);
  const summary = describeCorpus(docs);
  if (!docs.length) return { refused: true, ...summary };

  const chunks = chunkDocuments(docs);
  const results = createSearchIndex(chunks).search(clean, { topK });
  if (!results.length) return { refused: true, ...summary };

  const safePurpose = purpose === 'application-answer' ? 'application-answer' : 'general';
  return {
    refused: false,
    chunks: results,
    system: RAG_SYSTEM,
    prompt: buildAskPrompt({ question: clean, purpose: safePurpose, chunks: results }),
    searched: summary.searched,
    missing: summary.missing,
    question: clean,
    purpose: safePurpose
  };
}

export function prepareCheck({ jobId, documentKind = 'cv', topK = CHECK_TOP_K, ...rest } = {}) {
  const sources = sourcesOf(rest);
  const job = sources.jobs.find((entry) => entry && entry.id === jobId);
  if (!job) throw new AppError(ERROR_CODES.NOT_FOUND, 'That job could not be found. Refresh the tracker and try again.');

  const kind = documentKind === 'cover-letter' ? 'cover-letter' : 'cv';
  const text = String(kind === 'cv' ? job.tailoredCvText || '' : job.tailoredCoverLetterText || '').trim();
  if (text.length < 40) {
    throw new AppError(ERROR_CODES.VALIDATION, kind === 'cv'
      ? 'That job has no tailored CV yet. Run the Document Tailor first.'
      : 'That job has no tailored cover letter yet. Run the Document Tailor first.');
  }

  const title = documentTitle(job, kind);
  const reviewId = `${kind === 'cv' ? 'tailored-cv' : 'cover-letter'}:${job.id}`;
  const docs = buildCorpus(sources).filter((doc) => doc.id !== reviewId);
  const summary = describeCorpus(docs);
  const base = { documentKind: kind, documentTitle: title, documentText: text, job };

  if (!docs.length) return { refused: true, ...summary, ...base };

  const chunks = chunkDocuments(docs);
  const results = createSearchIndex(chunks).search(text.slice(0, 4000), { topK });
  if (!results.length) return { refused: true, ...summary, ...base };

  return {
    refused: false,
    chunks: results,
    system: CHECK_SYSTEM,
    prompt: buildCheckPrompt({ documentTitle: title, documentText: text, chunks: results }),
    searched: summary.searched,
    missing: summary.missing,
    ...base
  };
}
