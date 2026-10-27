import test from 'node:test';
import assert from 'node:assert/strict';
import { createVault, STORES } from './vault.js';
import { createMemoryAdapter } from './memoryAdapter.js';
import { createKeyStore } from './keyStore.js';
import { createUsageLedger } from './usage.js';
import { createWebRag } from './rag.js';
import { fakeClient } from '@sajas/core/testing';
import { callClaude } from '@sajas/core/ai';
import { MODEL_IDS } from '@sajas/core/models';

const KEY = ['sk', 'ant', 'api03', 'W'.repeat(40)].join('-');
const BASE_CV = 'Kone Tshivhinda. Software developer with ten years of experience building web systems in South Africa.';
const PROFILE = {
  baseCv: BASE_CV,
  applicationProfile: { noticePeriod: '30 days' },
  dailyBudgetUSD: 0,
  usePromptCaching: true
};
const JOB = {
  id: 'job-1', title: 'Platform Engineer', company: 'Acme', location: 'Cape Town',
  description: 'Build reliable platform services with Node and React.',
  tailoredCvText: 'Kone Tshivhinda. Tailored for Acme. Led a team of forty engineers at a payments company.',
  tailoredCoverLetterText: 'Dear Acme, I build reliable platform services and would welcome the conversation.',
  status: 'tailored'
};
const MEMORY = {
  insights: [{ id: 'i1', category: 'preference', text: 'Prefers remote-first roles with clear ownership.' }],
  employers: [], applications: []
};
const ANSWERS = { ans1: { id: 'ans1', question: 'Notice period?', answer: '30 days.' } };

const reply = (text, extra = {}) => ({
  id: 'msg_1', type: 'message', role: 'assistant', model: MODEL_IDS.sonnet,
  content: [{ type: 'text', text }], stop_reason: 'end_turn',
  usage: { input_tokens: 100, output_tokens: 50 }, ...extra
});

function harness(responses, { profile = PROFILE, jobs = { [JOB.id]: JOB }, answers = ANSWERS } = {}) {
  const vault = createVault(createMemoryAdapter({
    profile: { current: profile },
    jobs,
    answers,
    memory: { dossier: MEMORY }
  }));
  const keyStore = createKeyStore({ vault });
  keyStore.setKey(KEY);
  const usage = createUsageLedger({ vault });
  const activity = { entries: [], add(text, type) { this.entries.push({ text, type }); } };
  const fake = fakeClient(responses);
  const rag = createWebRag({
    vault, keyStore, usage, activity,
    loadAi: async () => ({ callClaude, makeClient: () => fake.client })
  });
  return { vault, keyStore, usage, activity, fake, rag };
}

test('status counts documents and reports missing sources', async () => {
  const { rag } = harness([]);
  const status = await rag.status();
  assert.ok(status.documents >= 3);
  assert.ok(status.chunks >= 3);
  assert.equal(status.hasKey, true);
  assert.ok(status.missing.includes('candidate insight') === false);
});

test('ask returns a grounded answer and records rag usage', async () => {
  const { rag, fake, usage } = harness([reply(JSON.stringify({
    is_supported_by_context: true,
    answer: 'Kone has ten years of experience [Doc: Base CV | Chunk: 0].',
    cited_sources: ['[Doc: Base CV | Chunk: 0]']
  }))]);
  const result = await rag.ask({ question: 'How many years of experience does Kone have?' });
  assert.equal(result.supported, true);
  assert.equal(result.citations[0].docTitle, 'Base CV');
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].model, MODEL_IDS.sonnet);
  assert.equal(fake.calls[0].output_config.format.type, 'json_schema');
  assert.deepEqual(fake.calls[0].system[0].cache_control, { type: 'ephemeral' });
  assert.equal('temperature' in fake.calls[0], false);
  const summary = await usage.summary(PROFILE);
  assert.equal(summary.today.byBucket.rag.calls, 1);
});

test('no matching passage refuses without a call', async () => {
  const { rag, fake } = harness([reply('{}')]);
  const result = await rag.ask({ question: 'zzzx qqqw' });
  assert.equal(result.refused, true);
  assert.equal(result.answer, 'The retrieved context does not contain sufficient information to answer this query.');
  assert.equal(fake.calls.length, 0);
});

test('no key, structured outputs off and a short question fail before the call', async () => {
  const { rag, keyStore, fake, vault } = harness([reply('{}')]);
  await keyStore.forget();
  await assert.rejects(() => rag.ask({ question: 'What is my notice period?' }), (err) => err.code === 'KEY_INVALID');

  keyStore.setKey(KEY);
  await vault.put(STORES.profile, 'current', { ...PROFILE, useStructuredOutputs: false });
  await assert.rejects(() => rag.ask({ question: 'What is my notice period?' }), (err) => err.code === 'VALIDATION');

  await vault.put(STORES.profile, 'current', PROFILE);
  await assert.rejects(() => rag.ask({ question: 'a' }), (err) => err.code === 'VALIDATION');
  assert.equal(fake.calls.length, 0);
});

test('check lists unsupported claims and records ground usage', async () => {
  const { rag, fake, usage } = harness([reply(JSON.stringify({
    supported: false,
    unsupported_claims: ['Led a team of forty engineers at a payments company.'],
    cited_sources: ['[Doc: Base CV | Chunk: 0]']
  }))]);
  const result = await rag.check({ jobId: 'job-1', documentKind: 'cv' });
  assert.equal(result.supported, false);
  assert.deepEqual(result.unsupportedClaims, ['Led a team of forty engineers at a payments company.']);
  assert.equal(fake.calls[0].model, MODEL_IDS.haiku);
  const summary = await usage.summary(PROFILE);
  assert.equal(summary.today.byBucket.ground.calls, 1);
});

test('the daily cap stops the request and the key never reaches a backup', async () => {
  const { rag, usage, fake, vault } = harness([reply('{}')], { profile: { ...PROFILE, dailyBudgetUSD: 1 } });
  await usage.record({ model: MODEL_IDS.sonnet, bucket: 'rag', inputTokens: 2_000_000 });
  await assert.rejects(
    () => rag.ask({ question: 'How many years of experience does Kone have?' }),
    (err) => err.code === 'BUDGET_EXCEEDED'
  );
  assert.equal(fake.calls.length, 0);
  assert.equal(JSON.stringify(await vault.exportAll()).includes(KEY), false);
});
