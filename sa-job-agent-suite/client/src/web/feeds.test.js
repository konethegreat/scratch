import test from 'node:test';
import assert from 'node:assert/strict';
import { createFeedClient } from './feeds.js';

const fixture = (jobs) => ({ jobs });

function response(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function makeClient(handler, over = {}) {
  let clock = 0;
  const client = createFeedClient({
    fetchImpl: handler,
    now: () => clock,
    sleep: async () => {},
    timeoutMs: 50,
    retryDelayMs: 0,
    cacheTtlMs: 1000,
    ...over
  });
  return { client, tick: (ms) => { clock += ms; } };
}

const okBody = () => fixture([{
  id: 1, url: 'https://remotive.com/jobs/1', title: 'React Engineer', company_name: 'Acme',
  candidate_required_location: 'Remote', publication_date: '2026-10-20', description: '<p>React</p>'
}]);

function bodyFor(url) {
  if (String(url).includes('arbeitnow')) return { data: [{ slug: '1', title: 'Dev', company_name: 'Acme', url: 'https://a.test/1' }] };
  if (String(url).includes('jobicy')) return { jobs: [{ id: 1, jobTitle: 'Dev', companyName: 'Acme', url: 'https://j.test/1' }] };
  return okBody();
}

test('a successful load returns normalized jobs', async () => {
  const { client } = makeClient(async () => response(200, okBody()));
  const result = await client.load('remotive');
  assert.equal(result.cached, false);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].company, 'Acme');
});

test('a 500 is retried once and can succeed', async () => {
  let calls = 0;
  const { client } = makeClient(async () => {
    calls += 1;
    return calls === 1 ? response(500, {}) : response(200, okBody());
  });
  const result = await client.load('remotive');
  assert.equal(calls, 2);
  assert.equal(result.jobs.length, 1);
});

test('a persistent 500 is FEED_FAILED and retryable', async () => {
  const { client } = makeClient(async () => response(500, {}));
  await assert.rejects(() => client.load('remotive'), (err) => err.code === 'FEED_FAILED' && err.retryable === true);
});

test('a 404 is not retried', async () => {
  let calls = 0;
  const { client } = makeClient(async () => { calls += 1; return response(404, {}); });
  await assert.rejects(() => client.load('remotive'), (err) => err.code === 'FEED_FAILED' && err.retryable === false);
  assert.equal(calls, 1);
});

test('a network TypeError maps to CORS_BLOCKED', async () => {
  const { client } = makeClient(async () => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(() => client.load('remotive'), (err) => err.code === 'CORS_BLOCKED');
});

test('a timeout is FEED_FAILED', async () => {
  const { client } = makeClient((_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  }));
  await assert.rejects(() => client.load('remotive'), (err) => err.code === 'FEED_FAILED' && err.retryable === true);
});

test('a timeout while reading the body is retryable', async () => {
  let calls = 0;
  const { client } = makeClient((_url, init) => {
    calls += 1;
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      })
    });
  });
  await assert.rejects(() => client.load('remotive'), (err) => (
    err.code === 'FEED_FAILED'
    && err.retryable === true
    && /did not respond in time/.test(err.message)
  ));
  assert.equal(calls, 2);
});

test('a malformed payload is not retried', async () => {
  let calls = 0;
  const { client } = makeClient(async () => { calls += 1; return response(200, { nope: true }); });
  await assert.rejects(() => client.load('remotive'), (err) => err.code === 'FEED_FAILED' && err.retryable === false);
  assert.equal(calls, 1);
});

test('a fresh cache entry skips the network and force bypasses it', async () => {
  let calls = 0;
  const { client, tick } = makeClient(async () => { calls += 1; return response(200, okBody()); });
  await client.load('remotive');
  await client.load('remotive');
  assert.equal(calls, 1);
  const cached = await client.load('remotive');
  assert.equal(cached.cached, true);
  tick(1001);
  await client.load('remotive');
  assert.equal(calls, 2);
  await client.load('remotive', { force: true });
  assert.equal(calls, 3);
});

test('loadAll isolates a failing source', async () => {
  const { client } = makeClient(async (url) => (
    String(url).includes('remotive') ? response(500, {}) : response(200, bodyFor(url))
  ));
  const outcome = await client.loadAll();
  assert.equal(outcome.results.length, 2);
  assert.equal(outcome.errors.length, 1);
  assert.equal(outcome.errors[0].source, 'remotive');
  assert.equal(outcome.errors[0].error.code, 'FEED_FAILED');
});

test('clear empties the cache', async () => {
  let calls = 0;
  const { client } = makeClient(async () => { calls += 1; return response(200, okBody()); });
  await client.load('remotive');
  client.clear();
  await client.load('remotive');
  assert.equal(calls, 2);
});

test('clear during an in-flight load does not repopulate the cache', async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { client } = makeClient(async () => {
    calls += 1;
    await gate;
    return response(200, okBody());
  });
  const pending = client.load('remotive');
  client.clear();
  release();
  await pending;
  await client.load('remotive');
  assert.equal(calls, 2);
});
