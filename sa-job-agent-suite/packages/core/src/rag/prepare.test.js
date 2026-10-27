import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareAsk, prepareCheck } from './prepare.js';
import { REFUSAL_SENTENCE } from './prompt.js';

const SOURCES = {
  profile: {
    baseCv: 'Kone Tshivhinda. Software developer with ten years of experience building web systems in South Africa.',
    applicationProfile: { noticePeriod: '30 days' }
  },
  jobs: [{
    id: 'j1', title: 'Platform Engineer', company: 'Acme',
    description: 'Build reliable platform services with Node and React.',
    tailoredCvText: 'Kone Tshivhinda. Tailored for Acme. Led a team of forty engineers at a payments company.',
    tailoredCoverLetterText: 'Dear Acme, I build reliable platform services.'
  }],
  memory: {},
  answers: []
};

test('a short question is rejected before any retrieval', () => {
  assert.throws(() => prepareAsk({ ...SOURCES, question: 'a' }), (err) => err.code === 'VALIDATION');
});

test('an answerable question returns ranked chunks and a grounded prompt', () => {
  const prepared = prepareAsk({ ...SOURCES, question: 'How many years of experience does Kone have?' });
  assert.equal(prepared.refused, false);
  assert.ok(prepared.chunks.length > 0);
  assert.equal(prepared.chunks[0].docTitle, 'Base CV');
  assert.match(prepared.prompt, /How many years of experience/);
  assert.match(prepared.prompt, /\[Doc: Base CV \| Section: /);
});

test('an unanswerable question refuses without a model call', () => {
  const prepared = prepareAsk({ ...SOURCES, question: 'zzzx qqqw' });
  assert.equal(prepared.refused, true);
  assert.match(prepared.searched, /^I searched /);
  assert.ok(Array.isArray(prepared.missing));
});

test('an empty corpus refuses and names the missing base CV', () => {
  const prepared = prepareAsk({ profile: {}, jobs: [], memory: {}, answers: [], question: 'What is my notice period?' });
  assert.equal(prepared.refused, true);
  assert.equal(prepared.searched, 'There were no saved documents to search.');
  assert.ok(prepared.missing.includes('base CV'));
});

test('a check requires a tailored document and excludes it from the evidence', () => {
  assert.throws(() => prepareCheck({ ...SOURCES, jobId: 'missing', documentKind: 'cv' }), (err) => err.code === 'NOT_FOUND');
  assert.throws(() => prepareCheck({
    ...SOURCES, jobId: 'j1', documentKind: 'cv',
    jobs: [{ ...SOURCES.jobs[0], tailoredCvText: '' }]
  }), (err) => err.code === 'VALIDATION');

  const prepared = prepareCheck({ ...SOURCES, jobId: 'j1', documentKind: 'cv' });
  assert.equal(prepared.refused, false);
  assert.equal(prepared.documentTitle, 'Tailored CV: Platform Engineer at Acme');
  assert.equal(prepared.chunks.some((chunk) => chunk.docId === 'tailored-cv:j1'), false);
  assert.match(prepared.prompt, /\[DOCUMENT UNDER REVIEW\]/);
  assert.match(prepared.prompt, /Led a team of forty engineers/);
});

test('the refusal path is a normal result with the fixed sentence source', () => {
  assert.equal(typeof REFUSAL_SENTENCE, 'string');
});
