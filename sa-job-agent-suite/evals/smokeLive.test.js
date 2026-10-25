// The live smoke probes must exercise what production sends. This drives every
// probe against a fakeClient (no network, no key, no spend) and inspects the
// requests it would have made.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeClient } from '@sajas/core/testing';
import { MODEL_IDS, REFUSAL_FALLBACK_DEFAULT, getLearnedCapabilities, resetLearnedCapabilities } from '@sajas/core';
import { probes, probeContext, runProbe } from '../scripts/smoke-live.mjs';

const apiKey = 'sk-' + 'ant-api03-' + 'A'.repeat(40);
const reply = {
  model: MODEL_IDS.sonnet, stop_reason: 'end_turn',
  content: [{ type: 'text', text: '{"jobs":[],"answer":"ok"}' }],
  usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 50 }
};
const byNumber = (n) => probes.find((p) => p.name.startsWith(`${n}.`));

async function callsFor(n, fallback) {
  const f = fakeClient([reply]);
  const r = await byNumber(n).run({ apiKey, client: f.client, fallback });
  return { calls: f.calls, r };
}

test('probes 1-4 and 6 send the production transport by default (REFUSAL_FALLBACK_DEFAULT)', async () => {
  const ctx = probeContext([]);
  assert.equal(ctx.fallback, REFUSAL_FALLBACK_DEFAULT);
  for (const n of [1, 2, 3, 4, 6]) {
    const { calls } = await callsFor(n, ctx.fallback);
    assert.ok(calls.length >= 1, `probe ${n} made a request`);
    for (const c of calls) assert.equal(Boolean(c.beta), REFUSAL_FALLBACK_DEFAULT, `probe ${n} transport`);
  }
});

test('--no-fallback turns the beta transport off for every probe', async () => {
  const ctx = probeContext(['--no-fallback']);
  assert.equal(ctx.fallback, false);
  for (const n of [1, 2, 3, 4, 6]) {
    const { calls } = await callsFor(n, ctx.fallback);
    for (const c of calls) assert.ok(!c.beta, `probe ${n} must not use the beta transport`);
  }
});

test('probe 5 runs the fallback request on Sonnet; 5b is the Haiku (documented no-op) variant', async () => {
  const five = await callsFor(5, true);
  assert.equal(five.calls[0].model, MODEL_IDS.sonnet);
  assert.ok(five.calls[0].beta);
  assert.equal(five.calls[0].fallbacks, 'default');
  const b = probes.find((p) => p.name.startsWith('5b.'));
  assert.ok(b, 'probe 5b exists');
  const f = fakeClient([reply]);
  await b.run({ apiKey, client: f.client, fallback: true });
  assert.equal(f.calls[0].model, MODEL_IDS.haiku);
});

// ---- Self-degrading must not turn the probes into false passes ----------------------------------

const rejected = (message) => ({ __throw: { status: 400, message } });
const FEATURE_400 = [
  [3, 'output_config.format is not supported with this tool', 'schema-with-tools'],
  [4, 'web_search tool is not supported for this model', 'haiku-search'],
  [5, 'fallbacks: Extra inputs are not permitted', 'refusal-fallback']
];

test('a probe whose feature the API rejects FAILs and names the degraded step', async () => {
  for (const [n, message, step] of FEATURE_400) {
    const f = fakeClient([rejected(message), reply]);
    const r = await runProbe(byNumber(n), { apiKey, client: f.client, fallback: true });
    assert.equal(f.calls.length, 2, `probe ${n} was retried by callClaude`);
    assert.equal(r.ok, false, `probe ${n} must FAIL`);
    assert.equal(r.reason, `API rejected ${step}; callClaude retried without it`);
  }
  resetLearnedCapabilities();
});

test('learned state is reset before each probe, so one probe cannot change the next probe\'s first request', async () => {
  resetLearnedCapabilities();
  const a = fakeClient([rejected('fallbacks: Extra inputs are not permitted'), reply]);
  const one = await runProbe(byNumber(1), { apiKey, client: a.client, fallback: true });
  assert.equal(one.ok, false);
  assert.equal(getLearnedCapabilities().refusalFallback, false, 'probe 1 did learn the lesson');

  const b = fakeClient([reply]);
  const two = await runProbe(byNumber(2), { apiKey, client: b.client, fallback: true });
  assert.equal(b.calls[0].beta, true, 'probe 2 still starts on the production beta transport');
  assert.equal(two.ok, true);
  resetLearnedCapabilities();
});

test('a clean run still PASSes every API probe', async () => {
  resetLearnedCapabilities();
  for (const n of [1, 2, 3, 4, 5, 6]) {
    const f = fakeClient([reply]);
    const r = await runProbe(byNumber(n), { apiKey, client: f.client, fallback: true });
    assert.equal(r.ok, true, `probe ${n}: ${r.reason}`);
    assert.deepEqual(r.degraded, [], `probe ${n} degraded nothing`);
  }
});
