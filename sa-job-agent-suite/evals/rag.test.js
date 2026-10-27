import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCorpus, chunkDocuments, prepareAsk, parseRagAnswer } from '@sajas/core/rag';

const PROFILE = {
  baseCv: 'Kone Tshivhinda. Software developer with ten years of experience building web systems in South Africa.',
  applicationProfile: { noticePeriod: '30 days' }
};
const JOB = {
  id: 'j1', title: 'Platform Engineer', company: 'Acme',
  description: 'Build reliable platform services with Node and React.',
  tailoredCvText: '', tailoredCoverLetterText: ''
};

function ask(question, profile = PROFILE) {
  const docs = buildCorpus({ profile, jobs: [JOB], memory: {}, answers: [] });
  const chunks = chunkDocuments(docs);
  const prepared = prepareAsk({ profile, jobs: [JOB], memory: {}, answers: [], question });
  return { prepared, chunks };
}

test('an answerable question cites the base CV', () => {
  const { prepared } = ask('How many years of experience does Kone have?');
  assert.equal(prepared.refused, false);
  const result = parseRagAnswer(JSON.stringify({
    is_supported_by_context: true,
    answer: 'Kone has ten years of experience [Doc: Base CV | Chunk: 0].',
    cited_sources: ['[Doc: Base CV | Chunk: 0]']
  }), prepared.chunks);
  assert.equal(result.supported, true);
  assert.equal(result.citations[0].docTitle, 'Base CV');
});

test('an unanswerable question refuses', () => {
  // Keep the question free of the candidate's name, which appears in the CV;
  // this eval proves the no-match refusal, not the model's own refusal.
  const { prepared } = ask('What is the candidate\'s favourite colour?');
  assert.equal(prepared.refused, true);
});

test('removing the supporting document flips an answer to a refusal', () => {
  const withoutCv = { ...PROFILE, baseCv: '' };
  const { prepared } = ask('How many years of experience does Kone have?', withoutCv);
  assert.equal(prepared.refused, true);
});

test('a corpus with only a job description refuses a personal question', () => {
  const docs = buildCorpus({ profile: {}, jobs: [JOB], memory: {}, answers: [] });
  const chunks = chunkDocuments(docs);
  const prepared = prepareAsk({ profile: {}, jobs: [JOB], memory: {}, answers: [], question: 'What is Kone\'s notice period?' });
  assert.equal(prepared.refused, true);
  assert.ok(chunks.length > 0);
});

test('an invalid citation is rejected', () => {
  const { prepared } = ask('How many years of experience does Kone have?');
  assert.throws(() => parseRagAnswer(JSON.stringify({
    is_supported_by_context: true,
    answer: 'Kone has ten years [Doc: Invented | Chunk: 0].',
    cited_sources: []
  }), prepared.chunks), (err) => err.code === 'GROUNDING_FAILED');
});
