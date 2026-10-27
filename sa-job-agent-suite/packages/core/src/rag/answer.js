import { extractJson } from '../json.js';
import { AppError, ERROR_CODES } from '../errors.js';
import { REFUSAL_SENTENCE } from './prompt.js';

export const RAG_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    is_supported_by_context: { type: 'boolean' },
    answer: { type: 'string' },
    cited_sources: { type: 'array', items: { type: 'string' } }
  },
  required: ['is_supported_by_context', 'answer', 'cited_sources'],
  additionalProperties: false
});

export const CHECK_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    supported: { type: 'boolean' },
    unsupported_claims: { type: 'array', items: { type: 'string' } },
    cited_sources: { type: 'array', items: { type: 'string' } }
  },
  required: ['supported', 'unsupported_claims', 'cited_sources'],
  additionalProperties: false
});

const FULL_TAG = /^\[Doc:\s*(.+?)\s*\|\s*Chunk:\s*(\d+)\]$/;

function malformed() {
  return new AppError(ERROR_CODES.VALIDATION, 'The answer could not be verified, so nothing was shown. Try again.');
}

function ungrounded() {
  return new AppError(ERROR_CODES.GROUNDING_FAILED, 'The answer cited a source that was not retrieved, so it was not shown. Try again.');
}

function tagOf(title, index) {
  return `[Doc: ${String(title).trim()} | Chunk: ${Number(index)}]`;
}

function chunkTags(chunks) {
  return new Set((chunks || []).map((chunk) => tagOf(chunk.docTitle, chunk.index)));
}

function inlineTags(text) {
  const pattern = /\[Doc:\s*([^|\]]+?)\s*\|\s*Chunk:\s*(\d+)\]/g;
  return [...String(text || '').matchAll(pattern)].map((match) => tagOf(match[1], match[2]));
}

function sourceTags(sources) {
  return (sources || []).map((source) => {
    const match = FULL_TAG.exec(String(source || '').trim());
    if (!match) throw ungrounded();
    return tagOf(match[1], match[2]);
  });
}

function assertKnown(tags, valid) {
  for (const tag of tags) if (!valid.has(tag)) throw ungrounded();
}

function citationsFor(tags, chunks) {
  const wanted = new Set(tags);
  const seen = new Set();
  const citations = [];
  for (const chunk of chunks || []) {
    const tag = tagOf(chunk.docTitle, chunk.index);
    if (!wanted.has(tag) || seen.has(tag)) continue;
    seen.add(tag);
    citations.push({
      id: chunk.id, docId: chunk.docId, docKind: chunk.docKind, docTitle: chunk.docTitle,
      section: chunk.section, index: chunk.index, tag
    });
  }
  return citations;
}

function record(text) {
  const parsed = extractJson(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw malformed();
  return parsed;
}

function booleanField(value) {
  if (typeof value !== 'boolean') throw malformed();
  return value;
}

function stringArray(value) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) throw malformed();
  return value;
}

export function parseRagAnswer(text, chunks = []) {
  const parsed = record(text);
  const supported = booleanField(parsed.is_supported_by_context);
  if (typeof parsed.answer !== 'string') throw malformed();
  const sources = stringArray(parsed.cited_sources);
  const valid = chunkTags(chunks);
  const inAnswer = inlineTags(parsed.answer);
  const declared = sourceTags(sources);
  assertKnown([...inAnswer, ...declared], valid);

  if (!supported || !inAnswer.length) {
    return { supported: false, refused: true, answer: REFUSAL_SENTENCE, citations: [] };
  }
  return {
    supported: true,
    refused: false,
    answer: parsed.answer.trim(),
    citations: citationsFor([...inAnswer, ...declared], chunks)
  };
}

export function parseCheckAnswer(text, chunks = []) {
  const parsed = record(text);
  const supported = booleanField(parsed.supported);
  const claims = stringArray(parsed.unsupported_claims);
  const sources = stringArray(parsed.cited_sources);
  const valid = chunkTags(chunks);
  const declared = sourceTags(sources);
  const claimTags = claims.flatMap((claim) => inlineTags(claim));
  assertKnown([...declared, ...claimTags], valid);

  if (supported && claims.length) throw ungrounded();
  if (supported && !declared.length) throw ungrounded();

  return {
    supported,
    refused: false,
    unsupportedClaims: supported ? [] : claims.map((claim) => claim.trim()).filter(Boolean),
    citations: citationsFor([...declared, ...claimTags], chunks)
  };
}
