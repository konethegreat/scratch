import test, { before, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fakeClient } from '@sajas/core/testing';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sajas-rag-'));
process.env.DB_PATH = path.join(dir, 'db.json');
process.env.KEYS_PATH = path.join(dir, 'keys.json');
delete process.env.SAJAS_DEMO_ORIGIN;

const KEY = 'sk-' + 'ant-api03-' + 'R'.repeat(40);
const BASE_CV = 'Kone Tshivhinda. Software developer with ten years of experience building web systems in South Africa.';

let helper, llm, rag;

before(async () => {
  helper = await import('../db/helper.js');
  llm = await import('../agents/llm.js');
  rag = await import('./service.js');
});

beforeEach(() => {
  helper.clearUsage();
  helper.saveProfile({
    anthropicApiKey: KEY,
    fullName: 'Kone Tshivhinda',
    baseCv: BASE_CV,
    applicationProfile: { noticePeriod: '30 days', rightToWorkSA: 'Yes' },
    useResearchFanout: false,
    useMemoryReflection: false,
    useStructuredOutputs: true
  });
  const db = helper.readDb();
  db.jobs = [{
    id: 'job-1', title: 'Platform Engineer', company: 'Acme', location: 'Cape Town',
    description: 'Build reliable platform services with Node and React.',
    tailoredCvText: 'Kone Tshivhinda. Tailored for Acme. Led a team of forty engineers at a payments company.',
    tailoredCoverLetterText: 'Dear Acme, I build reliable platform services and would welcome the conversation.',
    status: 'tailored'
  }];
  helper.writeDb(db);
  helper.upsertAnswer({ question: 'Notice period?', answer: '30 days.' });
});

afterEach(() => llm.setClaudeClientForTests(null));
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const reply = (text, extra = {}) => ({
  id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5',
  content: [{ type: 'text', text }], stop_reason: 'end_turn',
  usage: { input_tokens: 100, output_tokens: 50 }, ...extra
});

test('status reports counts without a key or a model call', async () => {
  helper.clearKey('anthropic');
  const status = rag.ragStatus();
  assert.ok(status.documents >= 3);
  assert.ok(status.chunks >= 3);
  assert.equal(status.hasKey, false);
  assert.ok(status.missing.includes('candidate insight'));
});

test('ask returns a grounded answer and records a rag usage bucket', async () => {
  const f = fakeClient([reply(JSON.stringify({
    is_supported_by_context: true,
    answer: 'Kone has ten years of experience [Doc: Base CV | Chunk: 0].',
    cited_sources: ['[Doc: Base CV | Chunk: 0]']
  }))]);
  llm.setClaudeClientForTests(f.client);

  const result = await rag.askDocuments({ question: 'How many years of experience does Kone have?' });
  assert.equal(result.supported, true);
  assert.match(result.answer, /ten years/);
  assert.equal(result.citations[0].docTitle, 'Base CV');
  assert.match(result.searched, /^I searched /);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].model, 'claude-sonnet-5-5');
  assert.equal(f.calls[0].output_config.format.type, 'json_schema');
  assert.equal('temperature' in f.calls[0], false);
  const usage = helper.getUsageSummary();
  assert.equal(usage.today.byBucket.rag.calls, 1);
});

test('no matching passage refuses without calling the model', async () => {
  const f = fakeClient([reply('{}')]);
  llm.setClaudeClientForTests(f.client);
  const result = await rag.askDocuments({ question: 'zzzx qqqw' });
  assert.equal(result.refused, true);
  assert.equal(result.supported, false);
  assert.equal(f.calls.length, 0);
});

test('missing key, structured outputs off and a short question fail before the call', async () => {
  const f = fakeClient([reply('{}')]);
  llm.setClaudeClientForTests(f.client);
  const profile = helper.getProfile();

  helper.clearKey('anthropic');
  await assert.rejects(() => rag.askDocuments({ question: 'What is my notice period?' }), (err) => err.code === 'KEY_INVALID');

  helper.saveProfile({ ...profile, useStructuredOutputs: false });
  await assert.rejects(() => rag.askDocuments({ question: 'What is my notice period?' }), (err) => err.code === 'VALIDATION');

  helper.saveProfile({ ...profile, useStructuredOutputs: true });
  await assert.rejects(() => rag.askDocuments({ question: 'a' }), (err) => err.code === 'VALIDATION');
  assert.equal(f.calls.length, 0);
});

test('a check lists unsupported claims and records a ground usage bucket', async () => {
  const f = fakeClient([reply(JSON.stringify({
    supported: false,
    unsupported_claims: ['Led a team of forty engineers at a payments company.'],
    cited_sources: ['[Doc: Base CV | Chunk: 0]']
  }))]);
  llm.setClaudeClientForTests(f.client);

  const result = await rag.checkDocument({ jobId: 'job-1', documentKind: 'cv' });
  assert.equal(result.supported, false);
  assert.deepEqual(result.unsupportedClaims, ['Led a team of forty engineers at a payments company.']);
  assert.equal(f.calls[0].model, 'claude-haiku-5-5');
  const usage = helper.getUsageSummary();
  assert.equal(usage.today.byBucket.ground.calls, 1);
});

test('an invented citation is rejected before display', async () => {
  const f = fakeClient([reply(JSON.stringify({
    is_supported_by_context: true,
    answer: 'Kone led forty engineers [Doc: Invented CV | Chunk: 0].',
    cited_sources: []
  }))]);
  llm.setClaudeClientForTests(f.client);
  await assert.rejects(
    () => rag.askDocuments({ question: 'What leadership experience does Kone have?' }),
    (err) => err.code === 'GROUNDING_FAILED'
  );
});
