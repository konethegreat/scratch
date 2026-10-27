import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCorpus, corpusSignature, describeCorpus } from './corpus.js';

const profile = {
  anthropicApiKey: 'sk-' + 'ant-api03-' + 'Z'.repeat(40),
  baseCv: 'Kone Tshivhinda. Software developer with ten years of experience building web systems in South Africa.',
  applicationProfile: { rightToWorkSA: 'Yes', nationality: 'South African', expectedSalary: 'R650 000 p/a' },
  applicationDefaultsText: 'Reason for leaving: seeking growth.'
};
const jobs = [{
  id: 'j1', title: 'Platform Engineer', company: 'Acme',
  description: 'Build reliable platform services with Node and React for South African clients.',
  tailoredCvText: 'Kone Tshivhinda. Tailored for the Acme platform role with ten years of delivery experience.',
  tailoredCoverLetterText: 'Dear Acme, I build reliable platform services and would welcome the conversation.'
}];
const memory = {
  insights: [{ id: 'i1', category: 'preference', text: 'Prefers remote-first roles with clear ownership.' }],
  employers: [{ id: 'e1', company: 'Acme', notes: ['Friendly engineering team.'] }],
  applications: [{ id: 'a1', jobId: 'j1', title: 'Platform Engineer', company: 'Acme', outcome: 'interview', appliedAt: '2026-10-20' }]
};
const answers = [{ id: 'ans1', question: 'Notice period?', answer: '30 days.' }];

test('builds every document kind in deterministic id order without key material', () => {
  const docs = buildCorpus({ profile, jobs, memory, answers });
  const ids = docs.map((doc) => doc.id);
  assert.deepEqual(ids, [...ids].sort());
  for (const expected of ['base-cv', 'profile', 'tailored-cv:j1', 'cover-letter:j1', 'job-description:j1', 'answer:ans1', 'insight:preference', 'employer:e1', 'application']) {
    assert.ok(ids.includes(expected), expected);
  }
  const all = JSON.stringify(docs);
  assert.equal(all.includes(profile.anthropicApiKey), false);
  assert.match(docs.find((doc) => doc.id === 'profile').text, /Right to work in SA: Yes/);
  assert.match(docs.find((doc) => doc.id === 'answer:ans1').text, /Question: Notice period\?/);
});

test('skips short sources and reports what is missing', () => {
  const docs = buildCorpus({ profile: {}, jobs: [], memory: {}, answers: [] });
  assert.deepEqual(docs, []);
  const summary = describeCorpus(docs);
  assert.equal(summary.searched, 'There were no saved documents to search.');
  assert.ok(summary.missing.includes('base CV'));
  assert.ok(summary.missing.includes('application profile'));
});

test('describeCorpus counts documents in plain language', () => {
  const docs = buildCorpus({ profile, jobs, memory, answers });
  const summary = describeCorpus(docs);
  assert.match(summary.searched, /^I searched /);
  assert.match(summary.searched, /1 base CV/);
  assert.match(summary.searched, /1 tailored CV/);
  assert.match(summary.searched, /1 saved answer/);
  assert.equal(summary.missing.includes('base CV'), false);
});

test('corpusSignature changes when a document changes', () => {
  const first = buildCorpus({ profile, jobs, memory, answers });
  const second = buildCorpus({ profile: { ...profile, baseCv: `${profile.baseCv} Extra.` }, jobs, memory, answers });
  assert.notEqual(corpusSignature(first), corpusSignature(second));
  assert.equal(corpusSignature(first), corpusSignature(buildCorpus({ profile, jobs, memory, answers })));
});
