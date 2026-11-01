import test from 'node:test';
import assert from 'node:assert/strict';
import { STORES, createVault } from '../vault.js';
import { createMemoryAdapter } from '../memoryAdapter.js';
import { createActivity } from '../activity.js';
import { createWebApi } from '../api.js';
import { REFUSAL_SENTENCE } from '@sajas/core/rag';
import { createSimulationRouter } from './simulationApi.js';
import { buildDemoSeed } from './fixtures.js';
import { DEMO_JOBS } from './jobs.js';

const API_BASE = 'http://localhost:5000/api';
const NOW = () => new Date('2026-10-28T10:00:00Z');

function harness() {
  const vault = createVault(createMemoryAdapter(buildDemoSeed(NOW())));
  const activity = createActivity();
  const keyStore = { hasKey: () => true, getKey: () => null };
  const base = createWebApi({ apiBase: API_BASE, vault, keyStore, activity, now: NOW });
  const waits = [];
  const router = createSimulationRouter({
    base, apiBase: API_BASE, vault, keyStore, activity, now: NOW,
    wait: (ms) => { waits.push(ms); return Promise.resolve(); }
  });
  return { vault, router, waits };
}

const post = (body) => ({ method: 'POST', body: JSON.stringify(body) });
const get = () => ({ method: 'GET' });

test('tailor moves through tailoring, waits, writes documents and records usage', async () => {
  const { vault, router, waits } = harness();
  const response = await router.handle(`${API_BASE}/jobs/demo-job-14/tailor`, post({}));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(waits, [900]);
  assert.equal(body.job.status, 'tailored');
  assert.match(body.job.tailoredCvText, /Highveld Haulage/);
  assert.match(body.job.tailoredCoverLetterText, /Data Engineer/);
  const days = await vault.get(STORES.usage, 'days');
  assert.ok(days.days['2026-10-28'].calls > 6, 'simulated usage was not recorded');
});

test('a supported question answers with real citations and a simulated label', async () => {
  const { router } = harness();
  const response = await router.handle(`${API_BASE}/rag/ask`, post({ question: 'Which accessibility dashboard project did Alex build?' }));
  const body = await response.json();
  assert.equal(body.supported, true);
  assert.equal(body.refused, false);
  assert.match(body.answer, /\[Doc:/);
  assert.match(body.answer, /Simulated/);
  assert.ok(body.citations.length > 0);
  assert.ok(body.citations.every((citation) => citation.tag.startsWith('[Doc:')));
  assert.equal(typeof body.searched, 'string');
  assert.ok(body.searched.length > 0);
});

test('an unsupported question refuses with the fixed sentence', async () => {
  const { router } = harness();
  const response = await router.handle(`${API_BASE}/rag/ask`, post({ question: 'Do you have a commercial pilot licence?' }));
  const body = await response.json();
  assert.equal(body.refused, true);
  assert.equal(body.supported, false);
  assert.equal(body.answer, REFUSAL_SENTENCE);
  assert.deepEqual(body.citations, []);
  assert.ok(body.searched.length > 0, 'the refusal must name what was searched');
});

test('check reports one flagged claim with a citation', async () => {
  const { router } = harness();
  const response = await router.handle(`${API_BASE}/rag/check`, post({ jobId: 'demo-job-1', documentKind: 'cv' }));
  const body = await response.json();
  assert.equal(body.supported, false);
  assert.equal(body.refused, false);
  assert.equal(body.unsupportedClaims.length, 1);
  assert.match(body.unsupportedClaims[0], /\[Doc:/);
  assert.ok(body.citations.length > 0);
});

test('the simulated portal records a validated web-guided submission', async () => {
  const { vault, router } = harness();
  const response = await router.handle(`${API_BASE}/demo/apply/demo-job-1`, post({
    fields: [
      { key: 'phone', label: 'Phone number', value: '011 555 0100' },
      { key: 'bank:criminal record check', label: 'Are you willing to undergo a criminal record check?', value: 'No' }
    ],
    answer: 'The accessibility dashboard project.',
    documents: [
      { key: 'demo-doc-cv', label: 'Base CV', fileName: 'Naledi-Mokoena-CV.txt' },
      { key: 'tailored-cv', label: 'Tailored CV', fileName: 'senior-frontend-engineer-cv.pdf' }
    ]
  }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.application.delivery, 'web-guided');
  assert.equal(body.application.submittedBy, 'copilot-confirmed');
  assert.equal(body.application.confirmation.text, 'Send application');
  assert.equal(body.application.site, 'bokamosobank.test');
  assert.equal(body.job.status, 'applied');
  const phone = body.application.fields.find((field) => field.label === 'Phone number');
  assert.equal(phone.value, '011 555 0100');
  const criminal = body.application.fields.find((field) => /criminal record/.test(field.label));
  assert.equal(criminal.value, 'No');
  assert.deepEqual(body.application.documents.map((doc) => doc.key).sort(), ['demo-doc-cv', 'tailored-cv']);
  const memory = await vault.get(STORES.memory, 'dossier');
  assert.equal(memory.applications.find((entry) => entry.jobId === 'demo-job-1').delivery, 'web-guided');
  const answer = await vault.get(STORES.answers, 'demo-visitor-answer');
  assert.equal(answer.answer, 'The accessibility dashboard project.');
  assert.equal(answer.category, 'other');
  assert.equal(answer.timesUsed, 0);
});

test('an edit that looks like a credential is refused and nothing is recorded', async () => {
  const { vault, router } = harness();
  const response = await router.handle(`${API_BASE}/demo/apply/demo-job-1`, post({
    fields: [{ key: 'password', label: 'Password', value: 'hunter2' }],
    answer: 'The accessibility dashboard project.'
  }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, 'VALIDATION');
  assert.equal((await vault.get(STORES.jobs, 'demo-job-1')).status, 'tailored');
  assert.equal((await vault.get(STORES.answers, 'demo-visitor-answer')), undefined);
});

test('an answer that reads like a credential is refused before anything is written', async () => {
  const { vault, router } = harness();
  const response = await router.handle(`${API_BASE}/demo/apply/demo-job-1`, post({
    fields: [{ key: 'phone', label: 'Phone number', value: '011 555 0100' }],
    answer: 'The password: hunter2 is in the brief.'
  }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, 'VALIDATION');
  assert.equal((await vault.get(STORES.jobs, 'demo-job-1')).status, 'tailored');
  assert.equal((await vault.get(STORES.answers, 'demo-visitor-answer')), undefined);
});

test('a cleared edit replaces the old value instead of keeping it', async () => {
  const { router } = harness();
  const response = await router.handle(`${API_BASE}/demo/apply/demo-job-1`, post({
    fields: [{ key: 'phone', label: 'Phone number', value: '   ' }],
    answer: 'The accessibility dashboard project.'
  }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.application.fields.some((field) => field.label === 'Phone number'), false);
});

test('documents falling back to the tailored copies when none are posted', async () => {
  const { router } = harness();
  const response = await router.handle(`${API_BASE}/demo/apply/demo-job-1`, post({
    fields: [{ key: 'phone', label: 'Phone number', value: '011 555 0100' }],
    answer: 'The accessibility dashboard project.'
  }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body.application.documents.map((doc) => doc.key).sort(), ['tailored-cv', 'tailored-letter']);
  const cv = body.application.documents.find((doc) => doc.key === 'tailored-cv');
  assert.equal(cv.label, 'Tailored CV');
  assert.match(cv.fileName, /-cv\.pdf$/);
});

test('ordinary routes delegate to the demo API', async () => {
  const { router } = harness();
  const jobs = await (await router.handle(`${API_BASE}/jobs`, get())).json();
  assert.ok(Array.isArray(jobs) && jobs.length === DEMO_JOBS.length);
  const missing = await router.handle(`${API_BASE}/nothing-here`, get());
  assert.equal(missing.status, 404);
  const dream = await router.handle(`${API_BASE}/memory/dream`, post({}));
  assert.equal(dream.status, 501);
  assert.equal((await dream.json()).code, 'NOT_SUPPORTED_IN_WEB');
});

test('an unknown job is a typed 404', async () => {
  const { router } = harness();
  const response = await router.handle(`${API_BASE}/jobs/missing/tailor`, post({}));
  assert.equal(response.status, 404);
  assert.equal((await response.json()).code, 'NOT_FOUND');
});
