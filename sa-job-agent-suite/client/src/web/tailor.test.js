import test from 'node:test';
import assert from 'node:assert/strict';
import { createVault, STORES } from './vault.js';
import { createMemoryAdapter } from './memoryAdapter.js';
import { createKeyStore } from './keyStore.js';
import { createUsageLedger } from './usage.js';
import { createWebTailor } from './tailor.js';
import { fakeClient } from '@sajas/core/testing';
import { callClaude } from '@sajas/core/ai';
import { MODEL_IDS } from '@sajas/core/models';

const KEY = ['sk', 'ant', 'api03', 'B'.repeat(40)].join('-');
const PROFILE = {
  baseCv: 'Kone Tshivhinda. Software developer with ten years of experience building web systems in South Africa.',
  dailyBudgetUSD: 0,
  usePromptCaching: true
};
const JOB = {
  id: 'job-1', title: 'Developer', company: 'Acme', location: 'Cape Town',
  description: 'Build web apps with React and Node.', status: 'found',
  tailoredCvText: '', tailoredCoverLetterText: ''
};
const reply = (text, extra = {}) => ({
  id: 'msg_1', type: 'message', role: 'assistant', model: MODEL_IDS.sonnet,
  content: [{ type: 'text', text }], stop_reason: 'end_turn',
  usage: { input_tokens: 100, output_tokens: 50 }, ...extra
});

function harness(responses, profile = PROFILE, job = JOB) {
  const vault = createVault(createMemoryAdapter({
    profile: { current: profile },
    jobs: { [job.id]: job }
  }));
  const keyStore = createKeyStore({ vault });
  keyStore.setKey(KEY);
  const usage = createUsageLedger({ vault });
  const activity = { entries: [], add(text, type) { this.entries.push({ text, type }); } };
  const fake = fakeClient(responses);
  const tailor = createWebTailor({
    vault, keyStore, usage, activity,
    loadAi: async () => ({ callClaude, makeClient: () => fake.client })
  });
  return { vault, keyStore, usage, activity, fake, tailor };
}

test('tailors a CV and cover letter, saves both, and records usage', async () => {
  const { tailor, vault, usage, fake } = harness([
    reply('```markdown\n# Curated CV\nBuilt web systems.\n```'),
    reply('# Cover Letter\nDear Acme')
  ]);
  const { job, warning } = await tailor.tailorJob('job-1', PROFILE);
  assert.equal(warning, '');
  assert.equal(job.status, 'tailored');
  assert.equal(job.tailoredCvText, '# Curated CV\nBuilt web systems.');
  assert.equal(job.tailoredCoverLetterText, '# Cover Letter\nDear Acme');
  assert.equal((await vault.get(STORES.jobs, 'job-1')).tailoredCvText, job.tailoredCvText);
  assert.equal(fake.calls.length, 2);
  for (const call of fake.calls) {
    assert.equal(call.model, MODEL_IDS.sonnet);
    assert.equal('temperature' in call, false);
    assert.deepEqual(call.system[0].cache_control, { type: 'ephemeral' });
  }
  const summary = await usage.summary(PROFILE);
  assert.equal(summary.today.calls, 2);
  assert.ok(summary.today.estCostUSD > 0);
});

test('keeps the CV when only the cover letter fails', async () => {
  const { tailor, vault } = harness([
    reply('# Curated CV'),
    { __throw: new Error('the connection dropped') }
  ]);
  const { job, warning } = await tailor.tailorJob('job-1', PROFILE);
  assert.match(warning, /connection dropped/);
  assert.equal(job.status, 'tailored');
  assert.equal(job.tailoredCvText, '# Curated CV');
  assert.equal(job.tailoredCoverLetterText, '');
  assert.equal((await vault.get(STORES.jobs, 'job-1')).status, 'tailored');
});

test('restores the previous status and saves nothing when the CV fails', async () => {
  const { tailor, vault } = harness([{ __throw: new Error('overloaded') }]);
  await assert.rejects(() => tailor.tailorJob('job-1', PROFILE), /overloaded/);
  const job = await vault.get(STORES.jobs, 'job-1');
  assert.equal(job.status, 'found');
  assert.equal(job.tailoredCvText, '');
});

test('re-tailoring keeps the old documents when the new CV fails', async () => {
  const existing = { ...JOB, status: 'tailored', tailoredCvText: '# Old CV', tailoredCoverLetterText: '# Old Letter' };
  const { tailor, vault } = harness([{ __throw: new Error('overloaded') }], PROFILE, existing);
  await assert.rejects(() => tailor.tailorJob('job-1', PROFILE), /overloaded/);
  const job = await vault.get(STORES.jobs, 'job-1');
  assert.equal(job.status, 'tailored');
  assert.equal(job.tailoredCvText, '# Old CV');
  assert.equal(job.tailoredCoverLetterText, '# Old Letter');
});

test('a truncated or empty document is never saved', async () => {
  const truncated = harness([reply('# Half a CV', { stop_reason: 'max_tokens' })]);
  await assert.rejects(() => truncated.tailor.tailorJob('job-1', PROFILE), /cut off/);
  assert.equal((await truncated.vault.get(STORES.jobs, 'job-1')).status, 'found');

  const empty = harness([reply('   ')]);
  await assert.rejects(() => empty.tailor.tailorJob('job-1', PROFILE), /came back empty/);
  assert.equal((await empty.vault.get(STORES.jobs, 'job-1')).status, 'found');
});

test('refuses before any request without a key or with a short CV', async () => {
  const noKey = harness([reply('# CV')]);
  await noKey.keyStore.forget();
  await assert.rejects(() => noKey.tailor.tailorJob('job-1', PROFILE), (err) => err.code === 'KEY_INVALID');
  assert.equal(noKey.fake.calls.length, 0);

  const shortCv = harness([reply('# CV')]);
  await assert.rejects(
    () => shortCv.tailor.tailorJob('job-1', { ...PROFILE, baseCv: 'too short' }),
    (err) => err.code === 'VALIDATION'
  );
  assert.equal(shortCv.fake.calls.length, 0);
});

test('the daily cap stops the run before the request', async () => {
  const { tailor, usage, fake, vault } = harness([reply('# CV')], { ...PROFILE, dailyBudgetUSD: 1 });
  await usage.record({ model: MODEL_IDS.sonnet, bucket: 'tailor', inputTokens: 2_000_000 });
  await assert.rejects(
    () => tailor.tailorJob('job-1', { ...PROFILE, dailyBudgetUSD: 1 }),
    (err) => err.code === 'BUDGET_EXCEEDED'
  );
  assert.equal(fake.calls.length, 0);
  assert.equal((await vault.get(STORES.jobs, 'job-1')).status, 'found');
});

test('the key never reaches the vault or a backup', async () => {
  const { tailor, vault } = harness([reply('# CV'), reply('# Letter')]);
  await tailor.tailorJob('job-1', PROFILE);
  assert.equal(JSON.stringify(await vault.exportAll()).includes(KEY), false);
});
