import test from 'node:test';
import assert from 'node:assert/strict';
import { callClaude, REFUSAL_FALLBACK_DEFAULT } from './ai.js';
import { ClaudeAuthError, ClaudeRefusalError, ClaudeKeyError } from './errors.js';
import { fakeClient } from './testing.js';
import { MODEL_IDS } from './models.js';

// Assembled at runtime: no key-shaped literals in the repo.
const KEY = 'sk-' + 'ant-api03-' + 'A'.repeat(40);

const text = (t) => ({ type: 'text', text: t });
const reply = (content, extra = {}) => ({
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: MODEL_IDS.sonnet,
  content,
  stop_reason: 'end_turn',
  usage: { input_tokens: 10, output_tokens: 5 },
  ...extra
});
const run = (req, responses, hooks = {}) => {
  const f = fakeClient(responses);
  const p = callClaude({ apiKey: KEY, task: 'core', prompt: 'hi', ...req }, { client: f.client, ...hooks });
  return { ...f, p };
};

test('reads text from text blocks even when a thinking block comes first', async () => {
  const { p } = run({}, [reply([{ type: 'thinking', thinking: 'hmm', signature: 'sig' }, text('hello')])]);
  const r = await p;
  assert.equal(r.text, 'hello');
  assert.equal(r.content.length, 2);
  assert.equal(r.stopReason, 'end_turn');
});

test('never sends sampling parameters, prefill, forced tool_choice or disabled thinking', async () => {
  const { p, calls } = run({ tools: [{ type: 'web_search_20260209', name: 'web_search' }] }, [reply([text('ok')])]);
  await p;
  const c = calls[0];
  for (const k of ['temperature', 'top_p', 'top_k', 'tool_choice', 'thinking']) {
    assert.equal(k in c, false, `${k} must be absent`);
  }
  assert.equal(c.messages.at(-1).role, 'user');
  assert.equal(JSON.stringify(c).includes('budget_tokens'), false);
});

test('uses the task class model, effort and max_tokens floor', async () => {
  const a = run({ task: 'planner', maxTokens: 10 }, [reply([text('x')])]);
  await a.p;
  assert.equal(a.calls[0].model, MODEL_IDS.haiku);
  assert.equal(a.calls[0].output_config.effort, 'low');
  assert.equal(a.calls[0].max_tokens, 2000);

  const b = run({ task: 'planner', maxTokens: 50000 }, [reply([text('x')])]);
  await b.p;
  assert.equal(b.calls[0].max_tokens, 50000);

  const c = run({ task: 'planner', model: MODEL_IDS.opus, effort: 'high' }, [reply([text('x')])]);
  await c.p;
  assert.equal(c.calls[0].model, MODEL_IDS.opus);
  assert.equal(c.calls[0].output_config.effort, 'high');
});

test('merges effort and json_schema format into one output_config', async () => {
  const schema = { type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false };
  const { p, calls } = run({ schema, effort: 'high' }, [reply([text('{"a":"b"}')])]);
  await p;
  assert.deepEqual(calls[0].output_config, { effort: 'high', format: { type: 'json_schema', schema } });
});

test('marks the system block for caching only when asked', async () => {
  const on = run({ system: 'be brief', cacheSystem: true }, [reply([text('x')])]);
  await on.p;
  assert.deepEqual(on.calls[0].system, [{ type: 'text', text: 'be brief', cache_control: { type: 'ephemeral' } }]);

  const off = run({ system: 'be brief' }, [reply([text('x')])]);
  await off.p;
  assert.equal(JSON.stringify(off.calls[0].system).includes('cache_control'), false);
});

test('passes block arrays through untouched', async () => {
  const blocks = [{ type: 'text', text: 'a', cache_control: { type: 'ephemeral' } }, { type: 'text', text: 'b' }];
  const { p, calls } = run({ system: blocks, cacheSystem: true }, [reply([text('x')])]);
  await p;
  assert.deepEqual(calls[0].system, blocks);
});

test('continues through pause_turn, sums usage and calls onUsage per response', async () => {
  const paused = reply([{ type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'q' } }], {
    stop_reason: 'pause_turn',
    usage: { input_tokens: 100, output_tokens: 20, server_tool_use: { web_search_requests: 1 } }
  });
  const done = reply([text('final')], { usage: { input_tokens: 50, output_tokens: 10 } });
  const seen = [];
  const { p, calls } = run({}, [paused, done], { onUsage: (u, ctx) => seen.push({ u, ctx }) });
  const r = await p;
  assert.equal(calls.length, 2);
  const last = calls[1].messages.at(-1);
  assert.equal(last.role, 'assistant');
  assert.deepEqual(last.content, paused.content);
  assert.equal(r.text, 'final');
  assert.equal(r.stopReason, 'end_turn');
  assert.equal(r.usage.inputTokens, 150);
  assert.equal(r.usage.outputTokens, 30);
  assert.equal(r.usage.webSearches, 1);
  assert.equal(seen.length, 2);
  assert.equal(seen[0].u.inputTokens, 100);
  assert.equal(seen[1].u.inputTokens, 50);
});

test('stops continuing at maxContinuations', async () => {
  const paused = reply([{ type: 'server_tool_use', id: 's1', name: 'web_search', input: {} }], { stop_reason: 'pause_turn' });
  const { p, calls } = run({ maxContinuations: 2 }, [paused]);
  const r = await p;
  assert.equal(calls.length, 3); // initial + 2 continuations
  assert.equal(r.stopReason, 'pause_turn');
});

test('beforeCall can abort between continuations', async () => {
  const paused = reply([{ type: 'server_tool_use', id: 's1', name: 'web_search', input: {} }], { stop_reason: 'pause_turn' });
  let n = 0;
  const usage = [];
  const beforeCall = () => {
    n += 1;
    if (n === 2) throw new Error('BUDGET_EXCEEDED');
  };
  const { p, calls } = run({}, [paused, reply([text('x')])], { beforeCall, onUsage: (u) => usage.push(u) });
  await assert.rejects(p, /BUDGET_EXCEEDED/);
  assert.equal(calls.length, 1, 'second request must not be sent');
  assert.equal(usage.length, 1, 'usage so far was recorded');
});

test('beforeCall receives task, model and attempt', async () => {
  const ctxs = [];
  const { p } = run({ task: 'planner' }, [reply([text('x')])], { beforeCall: (c) => ctxs.push(c) });
  await p;
  assert.deepEqual(ctxs, [{ task: 'planner', model: MODEL_IDS.haiku, attempt: 0 }]);
});

test('max_tokens stop sets truncated and still returns partial text', async () => {
  const { p } = run({}, [reply([text('[{"a":1},')], { stop_reason: 'max_tokens' })]);
  const r = await p;
  assert.equal(r.truncated, true);
  assert.equal(r.text, '[{"a":1},');
  assert.equal(r.stopReason, 'max_tokens');
});

test('refusal stop throws ClaudeRefusalError', async () => {
  const usage = [];
  const { p } = run({}, [reply([], { stop_reason: 'refusal' })], { onUsage: (u) => usage.push(u) });
  await assert.rejects(p, ClaudeRefusalError);
  assert.equal(usage.length, 1, 'refused call is still metered');
});

test('fallback path uses the beta stream with the fallback header and fallbacks:default', async () => {
  assert.equal(REFUSAL_FALLBACK_DEFAULT, true);
  const { p, calls } = run({}, [reply([text('x')])]);
  await p;
  assert.equal(calls[0].beta, true);
  assert.deepEqual(calls[0].betas, ['server-side-fallback-2026-07-01']);
  assert.equal(calls[0].fallbacks, 'default');
});

test('refusalFallback:false uses the plain stream', async () => {
  const { p, calls } = run({ refusalFallback: false }, [reply([text('x')])]);
  await p;
  assert.equal('beta' in calls[0], false);
  assert.equal('betas' in calls[0], false);
  assert.equal('fallbacks' in calls[0], false);
});

test('401 becomes ClaudeAuthError with the user-facing message', async () => {
  const { p } = run({}, [{ __throw: Object.assign(new Error('401 invalid x-api-key'), { status: 401 }) }]);
  await assert.rejects(p, (e) => e instanceof ClaudeAuthError && e.message === 'Anthropic rejected the API key. Check it in Settings.');
  const q = run({}, [{ __throw: Object.assign(new Error('forbidden'), { status: 403 }) }]);
  await assert.rejects(q.p, ClaudeAuthError);
});

test('other SDK errors propagate with key-shaped text scrubbed', async () => {
  const leaky = Object.assign(new Error('bad request for ' + KEY), { status: 400 });
  const { p } = run({}, [{ __throw: leaky }]);
  await assert.rejects(p, (e) => e.status === 400 && !e.message.includes(KEY) && e.message.includes('redacted'));
});

test('rejects a malformed or admin key before any request', async () => {
  const f = fakeClient([reply([text('x')])]);
  const admin = 'sk-' + 'ant-admin01-' + 'B'.repeat(40);
  for (const apiKey of ['', 'not-a-key', admin, 'sk-' + 'ant-api03-short']) {
    await assert.rejects(callClaude({ apiKey, task: 'core', prompt: 'hi' }, { client: f.client }), ClaudeKeyError);
  }
  assert.equal(f.calls.length, 0);
  // pasted whitespace/newlines/quotes are normalised, not rejected
  const pasted = '  "' + KEY.slice(0, 20) + '\n' + KEY.slice(20) + '"\n';
  const ok = await callClaude({ apiKey: pasted, task: 'core', prompt: 'hi' }, { client: f.client });
  assert.equal(ok.text, 'x');
  assert.equal(f.calls.length, 1);
});

test('key errors never echo the key', async () => {
  const f = fakeClient([reply([text('x')])]);
  const bad = 'sk-' + 'ant-api03-short';
  await assert.rejects(callClaude({ apiKey: bad, task: 'core', prompt: 'hi' }, { client: f.client }), (e) => !e.message.includes(bad));
});

test('images are sent as base64 image blocks before the prompt', async () => {
  const { p, calls } = run(
    { prompt: 'what is this?', images: [{ data: 'AAAA', mediaType: 'image/jpeg' }, { data: 'iVBORw0KGgo=' }] },
    [reply([text('x')])]
  );
  await p;
  const content = calls[0].messages.at(-1).content;
  assert.deepEqual(content[0], { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } });
  assert.equal(content[1].source.media_type, 'image/png');
  assert.deepEqual(content.at(-1), { type: 'text', text: 'what is this?' });
});

test('explicit messages are used as the conversation and returned with the final reply', async () => {
  const messages = [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }];
  const { p, calls } = run({ prompt: undefined, messages }, [reply([text('d')])]);
  const r = await p;
  assert.deepEqual(calls[0].messages, messages);
  assert.equal(r.messages.length, 4);
  assert.equal(r.messages.at(-1).role, 'assistant');
});

test('requires a prompt or messages', async () => {
  const f = fakeClient([reply([text('x')])]);
  await assert.rejects(callClaude({ apiKey: KEY, task: 'core' }, { client: f.client }), /prompt or messages/);
  assert.equal(f.calls.length, 0);
});

test('collects request ids when the SDK provides them', async () => {
  const { p } = run({}, [reply([text('x')], { _request_id: 'req_1' })]);
  const r = await p;
  assert.deepEqual(r.requestIds, ['req_1']);
});
