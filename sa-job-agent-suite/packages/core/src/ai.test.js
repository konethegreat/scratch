import test from 'node:test';
import assert from 'node:assert/strict';
import {
  callClaude, makeClient, ANTHROPIC_BASE_URL, REFUSAL_FALLBACK_DEFAULT,
  getLearnedCapabilities, resetLearnedCapabilities, degradeStepFor
} from './ai.js';
import { webSearchTool } from './tools.js';
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
  // the first request as sent: one user-last message, not the later mutated conversation
  assert.equal(calls[0].messages.length, 1);
  assert.equal(calls[0].messages.at(-1).role, 'user');
  assert.notEqual(calls[0].messages, calls[1].messages);
  assert.equal(calls[1].messages.length, 2);
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

test('makeClient pins the API host even when ANTHROPIC_BASE_URL points elsewhere', () => {
  const before = process.env.ANTHROPIC_BASE_URL;
  process.env.ANTHROPIC_BASE_URL = 'https://gateway.example.test';
  try {
    assert.equal(ANTHROPIC_BASE_URL, 'https://api.anthropic.com');
    assert.equal(makeClient({ apiKey: KEY }).baseURL, ANTHROPIC_BASE_URL);
  } finally {
    if (before === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = before;
  }
});

test('a test-injected hooks.client bypasses makeClient entirely', async () => {
  const before = process.env.ANTHROPIC_BASE_URL;
  process.env.ANTHROPIC_BASE_URL = 'https://gateway.example.test';
  try {
    const f = fakeClient([reply([text('ok')])]);
    const r = await callClaude({ apiKey: KEY, task: 'core', prompt: 'hi' }, { client: f.client });
    assert.equal(r.text, 'ok');
    assert.equal(f.calls.length, 1);
  } finally {
    if (before === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = before;
  }
});

// ---- Self-degrading: optional API features rejected with a 400 -------------------------------

const bad400 = (message) => ({ __throw: Object.assign(new Error(message), { status: 400 }) });
const plain400 = (message) => ({ __throw: { status: 400, message } });
const schema1 = { type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false };
const ALL_ALLOWED = { refusalFallback: true, schemaWithTools: true, haikuSearch: true };

test('a 400 about the fallback beta is retried on the plain stream and remembered', async () => {
  resetLearnedCapabilities();
  try {
    const f = fakeClient([plain400('fallbacks: Extra inputs are not permitted'), reply([text('ok')]), reply([text('again')])]);
    const first = await callClaude({ apiKey: KEY, task: 'core', prompt: 'hi' }, { client: f.client });
    assert.equal(f.calls.length, 2);
    assert.equal(f.calls[0].beta, true);
    assert.ok(!f.calls[1].beta);
    assert.equal('fallbacks' in f.calls[1], false);
    assert.equal('betas' in f.calls[1], false);
    assert.equal(first.text, 'ok');
    assert.deepEqual(first.degraded, ['refusal-fallback']);
    assert.equal(getLearnedCapabilities().refusalFallback, false);

    const second = await callClaude({ apiKey: KEY, task: 'core', prompt: 'hi' }, { client: f.client });
    assert.equal(f.calls.length, 3);
    assert.ok(!f.calls[2].beta, 'a learned lesson is applied before the first request');
    assert.deepEqual(second.degraded, []);
  } finally {
    resetLearnedCapabilities();
  }
});

test('a 400 about structured output with server tools drops the schema and keeps effort', async () => {
  resetLearnedCapabilities();
  try {
    const f = fakeClient([plain400('output_config.format is not supported with this tool'), reply([text('ok')])]);
    const r = await callClaude(
      { apiKey: KEY, task: 'ai-search', prompt: 'hi', schema: schema1, tools: [webSearchTool({ maxUses: 1 })] },
      { client: f.client }
    );
    assert.equal(f.calls.length, 2);
    assert.deepEqual(f.calls[0].output_config.format, { type: 'json_schema', schema: schema1 });
    assert.deepEqual(f.calls[1].output_config, { effort: 'medium' });
    assert.equal(f.calls[1].tools.length, 1, 'tools are kept');
    assert.deepEqual(r.degraded, ['schema-with-tools']);
    assert.equal(getLearnedCapabilities().schemaWithTools, false);

    // learned: the next call drops the format up front, but only when tools are present
    const g = fakeClient([reply([text('ok')])]);
    await callClaude({ apiKey: KEY, task: 'ai-search', prompt: 'hi', schema: schema1, tools: [webSearchTool()] }, { client: g.client });
    assert.deepEqual(g.calls[0].output_config, { effort: 'medium' });
    const h = fakeClient([reply([text('ok')])]);
    await callClaude({ apiKey: KEY, task: 'tailor', prompt: 'hi', schema: schema1 }, { client: h.client });
    assert.deepEqual(h.calls[0].output_config.format, { type: 'json_schema', schema: schema1 });
  } finally {
    resetLearnedCapabilities();
  }
});

test('a 400 about web search on Haiku retries on Sonnet', async () => {
  resetLearnedCapabilities();
  try {
    const f = fakeClient([plain400('web_search tool is not supported for this model'), reply([text('ok')])]);
    const r = await callClaude(
      { apiKey: KEY, task: 'planner', prompt: 'hi', tools: [webSearchTool({ maxUses: 1 })] },
      { client: f.client }
    );
    assert.equal(f.calls.length, 2);
    assert.equal(f.calls[0].model, MODEL_IDS.haiku);
    assert.equal(f.calls[1].model, MODEL_IDS.sonnet);
    assert.deepEqual(r.degraded, ['haiku-search']);
    assert.equal(getLearnedCapabilities().haikuSearch, false);

    const g = fakeClient([reply([text('ok')])]);
    await callClaude({ apiKey: KEY, task: 'planner', prompt: 'hi', tools: [webSearchTool()] }, { client: g.client });
    assert.equal(g.calls[0].model, MODEL_IDS.sonnet);
    const h = fakeClient([reply([text('ok')])]);
    await callClaude({ apiKey: KEY, task: 'planner', prompt: 'hi' }, { client: h.client });
    assert.equal(h.calls[0].model, MODEL_IDS.haiku, 'Haiku without a search tool is untouched');
  } finally {
    resetLearnedCapabilities();
  }
});

test('an unrelated 400 is not retried', async () => {
  resetLearnedCapabilities();
  const f = fakeClient([bad400('model: not found')]);
  await assert.rejects(callClaude({ apiKey: KEY, task: 'core', prompt: 'hi' }, { client: f.client }), (e) => e.message === 'model: not found');
  assert.equal(f.calls.length, 1);
  assert.deepEqual(getLearnedCapabilities(), ALL_ALLOWED);
});

test('a 400 only triggers the step the request actually used', async () => {
  resetLearnedCapabilities();
  // fallback-looking message on a request that never used the beta path
  const a = fakeClient([plain400('fallbacks: Extra inputs are not permitted')]);
  await assert.rejects(callClaude({ apiKey: KEY, task: 'core', prompt: 'hi', refusalFallback: false }, { client: a.client }));
  assert.equal(a.calls.length, 1);
  // schema-looking message without tools
  const b = fakeClient([plain400('output_config.format is invalid')]);
  await assert.rejects(callClaude({ apiKey: KEY, task: 'core', prompt: 'hi', schema: schema1, refusalFallback: false }, { client: b.client }));
  assert.equal(b.calls.length, 1);
  // haiku-looking message on Sonnet
  const c = fakeClient([plain400('web_search tool is not supported')]);
  await assert.rejects(callClaude({ apiKey: KEY, task: 'core', prompt: 'hi', refusalFallback: false, tools: [webSearchTool()] }, { client: c.client }));
  assert.equal(c.calls.length, 1);
  assert.deepEqual(getLearnedCapabilities(), ALL_ALLOWED);
});

test('a 401 is never retried', async () => {
  resetLearnedCapabilities();
  const f = fakeClient([{ __throw: Object.assign(new Error('401 invalid x-api-key'), { status: 401 }) }]);
  await assert.rejects(callClaude({ apiKey: KEY, task: 'core', prompt: 'hi' }, { client: f.client }), ClaudeAuthError);
  assert.equal(f.calls.length, 1);
  // even when the message looks like a fallback problem
  const g = fakeClient([{ __throw: Object.assign(new Error('fallbacks betas'), { status: 401 }) }]);
  await assert.rejects(callClaude({ apiKey: KEY, task: 'core', prompt: 'hi' }, { client: g.client }), ClaudeAuthError);
  assert.equal(g.calls.length, 1);
});

test('a failing retry surfaces the second error and learns nothing', async () => {
  resetLearnedCapabilities();
  const f = fakeClient([plain400('fallbacks: Extra inputs are not permitted'), plain400('something else')]);
  await assert.rejects(callClaude({ apiKey: KEY, task: 'core', prompt: 'hi' }, { client: f.client }), (e) => e.message === 'something else');
  assert.equal(f.calls.length, 2);
  assert.equal(getLearnedCapabilities().refusalFallback, true);
});

test('each degrade step is used at most once per call', async () => {
  resetLearnedCapabilities();
  const m = 'fallbacks: Extra inputs are not permitted';
  const f = fakeClient([plain400(m), plain400(m), plain400(m)]);
  await assert.rejects(callClaude({ apiKey: KEY, task: 'core', prompt: 'hi' }, { client: f.client }), (e) => e.message === m);
  assert.equal(f.calls.length, 2, 'no third request');
  assert.equal(getLearnedCapabilities().refusalFallback, true);
});

test('the budget hook runs before every retry and usage is reported only for the successful response', async () => {
  resetLearnedCapabilities();
  try {
    const ctxs = [];
    const usage = [];
    const f = fakeClient([plain400('fallbacks: Extra inputs are not permitted'), reply([text('ok')])]);
    await callClaude({ apiKey: KEY, task: 'core', prompt: 'hi' }, {
      client: f.client,
      beforeCall: (c) => ctxs.push(c),
      onUsage: (u) => usage.push(u)
    });
    assert.equal(ctxs.length, f.calls.length);
    assert.equal(ctxs.length, 2);
    assert.deepEqual(ctxs.map((c) => c.attempt), [0, 0], 'a retry reuses the attempt index');
    assert.equal(usage.length, 1);

    // and a budget refusal on the retry stops it
    resetLearnedCapabilities();
    let n = 0;
    const g = fakeClient([plain400('fallbacks: Extra inputs are not permitted'), reply([text('never')])]);
    await assert.rejects(
      callClaude({ apiKey: KEY, task: 'core', prompt: 'hi' }, {
        client: g.client,
        beforeCall: () => { n += 1; if (n === 2) throw new Error('BUDGET_EXCEEDED'); }
      }),
      /BUDGET_EXCEEDED/
    );
    assert.equal(g.calls.length, 1, 'the retry request is not sent');
    assert.equal(getLearnedCapabilities().refusalFallback, true);
  } finally {
    resetLearnedCapabilities();
  }
});

test('two steps can combine in one call', async () => {
  resetLearnedCapabilities();
  try {
    const f = fakeClient([
      plain400('fallbacks: Extra inputs are not permitted'),
      plain400('output_config.format is not supported with this tool'),
      reply([text('ok')])
    ]);
    const r = await callClaude(
      { apiKey: KEY, task: 'ai-search', prompt: 'hi', schema: schema1, tools: [webSearchTool({ maxUses: 1 })] },
      { client: f.client }
    );
    assert.equal(f.calls.length, 3);
    assert.deepEqual(r.degraded, ['refusal-fallback', 'schema-with-tools']);
    assert.deepEqual(f.calls[2].output_config, { effort: 'medium' });
    assert.ok(!f.calls[2].beta);
    assert.deepEqual(getLearnedCapabilities(), { refusalFallback: false, schemaWithTools: false, haikuSearch: true });
  } finally {
    resetLearnedCapabilities();
  }
});

test('a degraded variant carries over into pause_turn continuations', async () => {
  resetLearnedCapabilities();
  try {
    const paused = reply([{ type: 'server_tool_use', id: 's1', name: 'web_search', input: {} }], { stop_reason: 'pause_turn' });
    const f = fakeClient([plain400('fallbacks: Extra inputs are not permitted'), paused, reply([text('done')])]);
    const r = await callClaude({ apiKey: KEY, task: 'core', prompt: 'hi' }, { client: f.client });
    assert.equal(f.calls.length, 3);
    assert.ok(!f.calls[1].beta && !f.calls[2].beta);
    assert.equal(r.text, 'done');
    assert.deepEqual(r.degraded, ['refusal-fallback']);
  } finally {
    resetLearnedCapabilities();
  }
});

test('degrade notices are logged once per step and never contain the key', async () => {
  resetLearnedCapabilities();
  try {
    const logs = [];
    const f = fakeClient([plain400('fallbacks: Extra inputs are not permitted for ' + KEY), reply([text('ok')])]);
    await callClaude({ apiKey: KEY, task: 'tailor', prompt: 'hi' }, { client: f.client, onLog: (m, t) => logs.push({ m, t }) });
    const notices = logs.filter((l) => l.m.includes('not accepted by the API'));
    assert.equal(notices.length, 1);
    assert.ok(
      notices[0].m.startsWith('tailor: refusal-fallback not accepted by the API (fallbacks: Extra inputs are not permitted for ')
        && notices[0].m.endsWith('); retried without it'),
      notices[0].m
    );
    assert.ok(notices[0].m.includes('redacted'), 'the planted key is scrubbed in the excerpt');
    assert.equal(notices[0].t, 'system');
    assert.ok(logs.every((l) => !l.m.includes(KEY)));
  } finally {
    resetLearnedCapabilities();
  }
});

test('degradeStepFor is pure and keyed on the request shape', () => {
  const beta = { beta: true, hasTools: false, hasFormat: false, hasWebSearch: false, model: MODEL_IDS.sonnet };
  assert.equal(degradeStepFor({ status: 400, message: 'Unknown beta: betas not allowed' }, beta), 'refusal-fallback');
  assert.equal(degradeStepFor({ status: 400, message: 'Unknown beta' }, beta), null);
  assert.equal(degradeStepFor({ status: 500, message: 'fallbacks' }, beta), null);
  assert.equal(degradeStepFor(null, beta), null);
  assert.equal(degradeStepFor({ status: 400 }, beta), null);
});

test('the degrade notice carries a short whitespace-collapsed excerpt of the error (at most ~120 chars)', async () => {
  resetLearnedCapabilities();
  try {
    const logs = [];
    const long = 'fallbacks:\n   Extra inputs   are not permitted ' + 'x'.repeat(300);
    const f = fakeClient([plain400(long), reply([text('ok')])]);
    await callClaude({ apiKey: KEY, task: 'core', prompt: 'hi' }, { client: f.client, onLog: (m) => logs.push(m) });
    const n = logs.find((m) => m.includes('not accepted'));
    const excerpt = n.slice(n.indexOf('(') + 1, n.lastIndexOf(')'));
    assert.ok(excerpt.startsWith('fallbacks: Extra inputs are not permitted x'));
    assert.ok(excerpt.length <= 120);
  } finally {
    resetLearnedCapabilities();
  }
});

test('a learned lesson applied up front is announced once per process, not listed in degraded', async () => {
  resetLearnedCapabilities();
  try {
    const learn = fakeClient([plain400('fallbacks: Extra inputs are not permitted'), reply([text('ok')])]);
    await callClaude({ apiKey: KEY, task: 'core', prompt: 'hi' }, { client: learn.client });

    const logs = [];
    const onLog = (m, t) => logs.push({ m, t });
    const f = fakeClient([reply([text('ok')])]);
    const second = await callClaude({ apiKey: KEY, task: 'tailor', prompt: 'hi' }, { client: f.client, onLog });
    assert.deepEqual(second.degraded, []);
    assert.deepEqual(logs, [{ m: 'tailor: refusal-fallback was rejected earlier; running without it', t: 'system' }]);

    const third = await callClaude({ apiKey: KEY, task: 'tailor', prompt: 'hi' }, { client: f.client, onLog });
    assert.deepEqual(third.degraded, []);
    assert.equal(logs.length, 1, 'no further notice for the same lesson');
  } finally {
    resetLearnedCapabilities();
  }
});

test('a learned Haiku to Sonnet swap is announced and priced as Sonnet', async () => {
  resetLearnedCapabilities();
  try {
    const learn = fakeClient([plain400('web_search tool is not supported for this model'), reply([text('ok')])]);
    await callClaude({ apiKey: KEY, task: 'planner', prompt: 'hi', tools: [webSearchTool()] }, { client: learn.client });
    const logs = [];
    // the (fake) response carries no model, so reporting must use the swapped model
    const f = fakeClient([{ ...reply([text('ok')]), model: undefined }]);
    const r = await callClaude({ apiKey: KEY, task: 'planner', prompt: 'hi', tools: [webSearchTool()] }, { client: f.client, onLog: (m) => logs.push(m) });
    assert.ok(logs.includes('planner: haiku-search was rejected earlier; running without it'));
    assert.equal(r.model, MODEL_IDS.sonnet);
    assert.equal(r.usage.model, MODEL_IDS.sonnet);
  } finally {
    resetLearnedCapabilities();
  }
});

test('the schema and Haiku steps are not taken on a pause_turn continuation', async () => {
  resetLearnedCapabilities();
  const paused = reply([{ type: 'server_tool_use', id: 's1', name: 'web_search', input: {} }], { stop_reason: 'pause_turn' });
  const a = fakeClient([paused, plain400('output_config.format is not supported with this tool')]);
  await assert.rejects(
    callClaude({ apiKey: KEY, task: 'ai-search', prompt: 'hi', schema: schema1, tools: [webSearchTool()] }, { client: a.client }),
    (e) => e.message.includes('output_config.format')
  );
  assert.equal(a.calls.length, 2, 'no retry');
  const b = fakeClient([paused, plain400('web_search tool is not supported for this model')]);
  await assert.rejects(
    callClaude({ apiKey: KEY, task: 'planner', prompt: 'hi', tools: [webSearchTool()] }, { client: b.client }),
    (e) => e.message.includes('web_search')
  );
  assert.equal(b.calls.length, 2, 'no retry');
  assert.deepEqual(getLearnedCapabilities(), ALL_ALLOWED);
});

test('the fallback step is still allowed on a continuation', async () => {
  resetLearnedCapabilities();
  try {
    const paused = reply([{ type: 'server_tool_use', id: 's1', name: 'web_search', input: {} }], { stop_reason: 'pause_turn' });
    const f = fakeClient([paused, plain400('fallbacks: Extra inputs are not permitted'), reply([text('done')])]);
    const r = await callClaude({ apiKey: KEY, task: 'core', prompt: 'hi' }, { client: f.client });
    assert.equal(f.calls.length, 3);
    assert.deepEqual(r.degraded, ['refusal-fallback']);
  } finally {
    resetLearnedCapabilities();
  }
});
