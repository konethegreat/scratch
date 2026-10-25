// Tests for the thin server adapter over @sajas/core's callClaude.
// DB_PATH must point at a throwaway file BEFORE helper.js / llm.js load.
import test, { before, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fakeClient } from '@sajas/core/testing';
import { resetLearnedCapabilities, getLearnedCapabilities } from '@sajas/core';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sajas-llm-'));
process.env.DB_PATH = path.join(dir, 'db.json');
delete process.env.SAJAS_DEMO_ORIGIN;

// Assembled at runtime: no key-shaped literals in the repo.
const KEY = 'sk-' + 'ant-api03-' + 'A'.repeat(40);

let llm;
let helper;

before(async () => {
  helper = await import('../db/helper.js');
  llm = await import('./llm.js');
});

beforeEach(() => {
  helper.clearUsage();
  const db = helper.readDb();
  db.profile.dailyBudgetUSD = 0;
  helper.writeDb(db);
});

afterEach(() => {
  llm.setClaudeClientForTests(null);
  resetLearnedCapabilities();
  delete process.env.SAJAS_DEMO_ORIGIN;
});

after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const text = (t) => ({ type: 'text', text: t });
const reply = (content, extra = {}) => ({
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-sonnet-5-5',
  content,
  stop_reason: 'end_turn',
  usage: { input_tokens: 10, output_tokens: 5 },
  ...extra
});
const profile = (extra = {}) => ({ anthropicApiKey: KEY, ...extra });

test('callLlm records usage into the ledger under its bucket', async () => {
  const f = fakeClient([reply([text('hello')])]);
  llm.setClaudeClientForTests(f.client);
  const out = await llm.callLlm(profile(), 'hi', { bucket: 'tailor' });
  assert.equal(out, 'hello');
  assert.equal(helper.getUsageSummary().today.byBucket.tailor.calls, 1);
});

test('callLlm refuses with BUDGET_EXCEEDED when the cap is reached and makes no request', async () => {
  const db = helper.readDb();
  db.profile.dailyBudgetUSD = 0.01;
  helper.writeDb(db);
  helper.addUsage({ model: 'claude-sonnet-5-5', inputTokens: 5_000_000, outputTokens: 0, bucket: 'core' });
  const f = fakeClient([reply([text('never')])]);
  llm.setClaudeClientForTests(f.client);
  await assert.rejects(
    llm.callLlm(profile(), 'hi', { bucket: 'tailor' }),
    (err) => err.code === 'BUDGET_EXCEEDED'
  );
  assert.equal(f.calls.length, 0);
});

test('callLlm throws MISSING_KEY_MESSAGE without a key', async () => {
  const f = fakeClient([reply([text('never')])]);
  llm.setClaudeClientForTests(f.client);
  await assert.rejects(llm.callLlm({}, 'hi'), (err) => err.message === llm.MISSING_KEY_MESSAGE);
  await assert.rejects(llm.callLlm({ anthropicApiKey: 'your_key_here' }, 'hi'), (err) => err.message === llm.MISSING_KEY_MESSAGE);
  assert.equal(f.calls.length, 0);
  assert.equal(llm.hasAnthropicKey({}), false);
  assert.equal(llm.hasAnthropicKey({ anthropicApiKey: 'your_key_here' }), false);
  assert.equal(llm.hasAnthropicKey(profile()), true);
});

test('hasAnthropicKey requires a key-shaped value, so a stored non-key string no longer passes the gate', () => {
  assert.equal(llm.hasAnthropicKey({ anthropicApiKey: 'hello' }), false);
  assert.equal(llm.hasAnthropicKey({ anthropicApiKey: 'sk-ant-nope' }), false);
  assert.equal(llm.hasAnthropicKey({ anthropicApiKey: 'sk-' + 'ant-admin01-' + 'B'.repeat(40) }), false);
  assert.equal(llm.hasAnthropicKey({ anthropicApiKey: 12345 }), false);
  assert.equal(llm.hasAnthropicKey({ anthropicApiKey: `  "${KEY}"
` }), true, 'a pasted key is normalised first');
  assert.throws(() => llm.assertAnthropicKey({ anthropicApiKey: 'hello' }), (e) => e.message === llm.MISSING_KEY_MESSAGE);
});

test('the daily budget stops the next pause_turn continuation but keeps usage already spent', async () => {
  const db = helper.readDb();
  db.profile.dailyBudgetUSD = 0.01;
  helper.writeDb(db);
  // First response alone costs far more than the cap ($10 of Sonnet output).
  const paused = reply([{ type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'q' } }], {
    stop_reason: 'pause_turn',
    usage: { input_tokens: 100, output_tokens: 1_000_000 }
  });
  const f = fakeClient([paused, reply([text('final')])]);
  llm.setClaudeClientForTests(f.client);
  await assert.rejects(
    llm.callLlmFull(profile(), { task: 'ai-search', prompt: 'find jobs' }),
    (err) => err.code === 'BUDGET_EXCEEDED'
  );
  assert.equal(f.calls.length, 1, 'the continuation request must not be sent');
  const s = helper.getUsageSummary();
  assert.equal(s.today.byBucket['ai-search'].calls, 1, 'usage so far was recorded');
  assert.ok(s.today.estCostUSD >= 10);
});

test('with SAJAS_DEMO_ORIGIN set, calls reject with /AI calls are disabled/', async () => {
  process.env.SAJAS_DEMO_ORIGIN = 'http://127.0.0.1:5999';
  const f = fakeClient([reply([text('never')])]);
  llm.setClaudeClientForTests(f.client);
  // Demo gate fires before the missing-key check, so an empty profile still hits it.
  await assert.rejects(llm.callLlm({}, 'hi'), /AI calls are disabled/);
  await assert.rejects(llm.callLlmVision({}, 'hi', ['AAAA']), /AI calls are disabled/);
  await assert.rejects(llm.callLlm(profile(), 'hi'), /AI calls are disabled/);
  assert.equal(f.calls.length, 0);
});

test('callLlm honours the structured-output and prompt-caching toggles and resolves the task model', async () => {
  const schema = { type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false };
  const f = fakeClient([reply([text('{"a":"x"}')])]);
  llm.setClaudeClientForTests(f.client);
  await llm.callLlm(profile(), 'p', { schema, system: 'sys', cacheSystem: true, bucket: 'smart-fill' });
  const c = f.calls[0];
  assert.deepEqual(c.output_config.format.schema, schema);
  assert.equal(c.system[0].cache_control.type, 'ephemeral');
  assert.equal(c.model, 'claude-sonnet-5-5');

  const g = fakeClient([reply([text('{"a":"x"}')])]);
  llm.setClaudeClientForTests(g.client);
  await llm.callLlm(profile({ useStructuredOutputs: false, usePromptCaching: false }), 'p', { schema, system: 'sys', cacheSystem: true });
  assert.equal(g.calls[0].output_config.format, undefined);
  assert.equal(g.calls[0].system, 'sys');
});

test('callLlmVision sends the images and records usage under the vision bucket', async () => {
  const f = fakeClient([reply([text('seen')])]);
  llm.setClaudeClientForTests(f.client);
  const out = await llm.callLlmVision(profile(), 'what is this', ['AAAA']);
  assert.equal(out, 'seen');
  const content = f.calls[0].messages.at(-1).content;
  assert.ok(content.some((b) => b.type === 'image'));
  assert.equal(helper.getUsageSummary().today.byBucket.vision.calls, 1);
});

test('a rejected optional API feature degrades, logs a notice to the activity log and still returns text', async () => {
  helper.clearLogs();
  const f = fakeClient([
    { __throw: { status: 400, message: 'fallbacks: Extra inputs are not permitted' } },
    reply([text('degraded ok')])
  ]);
  llm.setClaudeClientForTests(f.client);
  const out = await llm.callLlm(profile(), 'hi', { bucket: 'tailor' });
  assert.equal(out, 'degraded ok');
  assert.equal(f.calls.length, 2);
  assert.equal(getLearnedCapabilities().refusalFallback, false);
  const notice = helper.getLogs().find((l) => l.message.includes('not accepted by the API'));
  assert.ok(notice, 'the degrade notice reached the activity log');
  assert.equal(notice.message, 'tailor: refusal-fallback not accepted by the API; retried without it');
  assert.equal(notice.type, 'system');
  assert.ok(!JSON.stringify(helper.getLogs()).includes(KEY));
  assert.equal(helper.getUsageSummary().today.byBucket.tailor.calls, 1, 'only the response that came back is metered');
});
