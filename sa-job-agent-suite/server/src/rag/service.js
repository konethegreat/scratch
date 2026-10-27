import {
  buildCorpus, chunkDocuments, corpusSignature, describeCorpus,
  prepareAsk, prepareCheck, parseRagAnswer, parseCheckAnswer,
  RAG_SCHEMA, CHECK_SCHEMA, REFUSAL_SENTENCE
} from '@sajas/core/rag';
import { AppError, ERROR_CODES } from '@sajas/core/errors';
import { getProfile, readDb, addLog } from '../db/helper.js';
import { hasAnthropicKey, callLlmFull } from '../agents/llm.js';

const STRUCTURED_OFF = 'Turn on Structured outputs in Profile & Settings to use Ask your documents. It keeps every answer verifiable.';
const TRUNCATED = 'The answer was cut off before it finished, so nothing was shown. Try again.';

function sources() {
  const profile = getProfile();
  const db = readDb();
  return { profile, jobs: db.jobs || [], memory: db.candidateMemory || {}, answers: db.answerBank || [] };
}

function assertReady(profile) {
  if (!hasAnthropicKey(profile)) {
    throw new AppError(ERROR_CODES.KEY_INVALID, 'No Anthropic API key is set. Add one in Profile & Settings.');
  }
  if (profile.useStructuredOutputs === false) {
    throw new AppError(ERROR_CODES.VALIDATION, STRUCTURED_OFF);
  }
}

export function ragStatus() {
  const { profile, jobs, memory, answers } = sources();
  const docs = buildCorpus({ profile, jobs, memory, answers });
  return {
    documents: docs.length,
    chunks: chunkDocuments(docs).length,
    signature: corpusSignature(docs),
    ...describeCorpus(docs),
    hasKey: hasAnthropicKey(profile),
    structuredOutputs: profile.useStructuredOutputs !== false
  };
}

export async function askDocuments({ question, purpose = 'general' } = {}) {
  const { profile, jobs, memory, answers } = sources();
  assertReady(profile);

  const prepared = prepareAsk({ profile, jobs, memory, answers, question, purpose });
  if (prepared.refused) {
    addLog('Ask documents: no matching passages for this question.', 'system');
    return {
      kind: 'answer',
      question: String(question || '').trim(),
      purpose,
      supported: false,
      refused: true,
      answer: REFUSAL_SENTENCE,
      citations: [],
      searched: prepared.searched,
      missing: prepared.missing
    };
  }

  const result = await callLlmFull(profile, {
    task: 'rag',
    prompt: prepared.prompt,
    system: prepared.system,
    cacheSystem: true,
    schema: RAG_SCHEMA
  });
  if (result.truncated) throw new AppError(ERROR_CODES.UNKNOWN, TRUNCATED);

  const parsed = parseRagAnswer(result.text, prepared.chunks);
  addLog(parsed.supported ? 'Ask documents: grounded answer returned.' : 'Ask documents: model refused to answer.', 'system');
  return {
    kind: 'answer',
    question: prepared.question,
    purpose: prepared.purpose,
    ...parsed,
    searched: prepared.searched,
    missing: prepared.missing
  };
}

export async function checkDocument({ jobId, documentKind = 'cv' } = {}) {
  const { profile, jobs, memory, answers } = sources();
  assertReady(profile);

  const prepared = prepareCheck({ profile, jobs, memory, answers, jobId, documentKind });
  const base = {
    kind: 'check',
    jobId,
    documentKind: prepared.documentKind,
    documentTitle: prepared.documentTitle,
    searched: prepared.searched,
    missing: prepared.missing
  };
  if (prepared.refused) {
    return { ...base, supported: false, refused: true, answer: REFUSAL_SENTENCE, unsupportedClaims: [], citations: [] };
  }

  const result = await callLlmFull(profile, {
    task: 'ground',
    prompt: prepared.prompt,
    system: prepared.system,
    cacheSystem: true,
    schema: CHECK_SCHEMA
  });
  if (result.truncated) throw new AppError(ERROR_CODES.UNKNOWN, TRUNCATED);

  const parsed = parseCheckAnswer(result.text, prepared.chunks);
  addLog(parsed.supported ? 'Document check: all claims supported.' : 'Document check: unsupported claims found.', 'system');
  return { ...base, ...parsed };
}
