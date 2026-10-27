import test from 'node:test';
import assert from 'node:assert/strict';
import { RAG_SCHEMA, CHECK_SCHEMA, parseRagAnswer, parseCheckAnswer } from './answer.js';
import { REFUSAL_SENTENCE } from './prompt.js';

const CHUNKS = [
  {
    id: 'base-cv::v1::0', docId: 'base-cv', docKind: 'base-cv', docTitle: 'Base CV', section: 'Experience',
    index: 0, version: 'v1', text: 'Kone has ten years of experience.', tag: '[Doc: Base CV | Chunk: 0]'
  },
  {
    id: 'base-cv::v1::1', docId: 'base-cv', docKind: 'base-cv', docTitle: 'Base CV', section: 'Skills',
    index: 1, version: 'v1', text: 'React and Node.', tag: '[Doc: Base CV | Chunk: 1]'
  }
];

const ask = (body) => JSON.stringify(body);
const check = (body) => JSON.stringify(body);

test('the schemas require the verification fields and forbid extras', () => {
  assert.deepEqual(RAG_SCHEMA.required, ['is_supported_by_context', 'answer', 'cited_sources']);
  assert.deepEqual(CHECK_SCHEMA.required, ['supported', 'unsupported_claims', 'cited_sources']);
  assert.equal(RAG_SCHEMA.additionalProperties, false);
  assert.equal(CHECK_SCHEMA.additionalProperties, false);
});

test('a supported answer keeps only retrieved citations', () => {
  const result = parseRagAnswer(ask({
    is_supported_by_context: true,
    answer: 'Kone has ten years of experience [Doc: Base CV | Chunk: 0].',
    cited_sources: ['[Doc: Base CV | Chunk: 0]']
  }), CHUNKS);
  assert.equal(result.supported, true);
  assert.equal(result.refused, false);
  assert.equal(result.citations.length, 1);
  assert.equal(result.citations[0].docTitle, 'Base CV');
  assert.equal(result.citations[0].index, 0);
});

test('an unsupported answer returns the fixed refusal and no citations', () => {
  const result = parseRagAnswer(ask({
    is_supported_by_context: false, answer: 'Probably something.', cited_sources: []
  }), CHUNKS);
  assert.equal(result.supported, false);
  assert.equal(result.refused, true);
  assert.equal(result.answer, REFUSAL_SENTENCE);
  assert.deepEqual(result.citations, []);
});

test('a supported answer without an inline citation is refused', () => {
  const result = parseRagAnswer(ask({
    is_supported_by_context: true, answer: 'Kone has ten years.', cited_sources: ['[Doc: Base CV | Chunk: 0]']
  }), CHUNKS);
  assert.equal(result.supported, false);
  assert.equal(result.answer, REFUSAL_SENTENCE);
});

test('unknown or malformed citations are rejected, not shown', () => {
  for (const body of [
    { is_supported_by_context: true, answer: 'Claim [Doc: Other CV | Chunk: 0].', cited_sources: [] },
    { is_supported_by_context: true, answer: 'Claim [Doc: Base CV | Chunk: 9].', cited_sources: [] },
    { is_supported_by_context: true, answer: 'Claim [Doc: Base CV | Chunk: 0].', cited_sources: ['Base CV'] }
  ]) {
    assert.throws(() => parseRagAnswer(ask(body), CHUNKS), (err) => err.code === 'GROUNDING_FAILED');
  }
});

test('malformed or wrong-typed output is a validation error', () => {
  for (const text of [
    'not json',
    ask({ is_supported_by_context: 'yes', answer: 'x', cited_sources: [] }),
    ask({ is_supported_by_context: true, answer: 4, cited_sources: [] }),
    ask({ is_supported_by_context: true, answer: 'x', cited_sources: [1] })
  ]) {
    assert.throws(() => parseRagAnswer(text, CHUNKS), (err) => err.code === 'VALIDATION');
  }
});

test('a check lists unsupported claims and requires a citation when supported', () => {
  const gaps = parseCheckAnswer(check({
    supported: false,
    unsupported_claims: ['Led a team of forty engineers.'],
    cited_sources: ['[Doc: Base CV | Chunk: 0]']
  }), CHUNKS);
  assert.equal(gaps.supported, false);
  assert.deepEqual(gaps.unsupportedClaims, ['Led a team of forty engineers.']);
  assert.equal(gaps.citations.length, 1);

  assert.throws(() => parseCheckAnswer(check({
    supported: true, unsupported_claims: ['Something.'], cited_sources: ['[Doc: Base CV | Chunk: 0]']
  }), CHUNKS), (err) => err.code === 'GROUNDING_FAILED');

  assert.throws(() => parseCheckAnswer(check({
    supported: true, unsupported_claims: [], cited_sources: []
  }), CHUNKS), (err) => err.code === 'GROUNDING_FAILED');
});
