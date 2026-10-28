import test from 'node:test';
import assert from 'node:assert/strict';
import { createPacer, parseRetryAfter, retryPlan, isTransientError, PACING_DEFAULTS } from './pacing.js';

test('parseRetryAfter reads seconds, HTTP dates and caps the wait', () => {
  const now = Date.parse('2026-10-28T10:00:00.000Z');
  assert.equal(parseRetryAfter('3', now), 3000);
  assert.equal(parseRetryAfter('0', now), 0);
  assert.equal(parseRetryAfter('999', now), 60000);
  assert.equal(parseRetryAfter('Wed, 28 Oct 2026 10:00:10 GMT', now), 10000);
  assert.equal(parseRetryAfter('Wed, 28 Oct 2026 09:59:00 GMT', now), 0);
  assert.equal(parseRetryAfter('not a date', now), 0);
  assert.equal(parseRetryAfter(null, now), 0);
});

test('only 408, 429, 503 and transient network errors are retryable', () => {
  assert.equal(retryPlan({ status: 429, attempt: 0 }).retry, true);
  assert.equal(retryPlan({ status: 503, attempt: 0 }).retry, true);
  assert.equal(retryPlan({ status: 408, attempt: 0 }).retry, true);
  for (const status of [401, 403, 404, 500]) {
    assert.equal(retryPlan({ status, attempt: 0 }).retry, false, String(status));
  }
  assert.equal(retryPlan({ status: 429, attempt: 2 }).retry, false);
  assert.equal(retryPlan({ error: new Error('net::ERR_CONNECTION_RESET'), attempt: 0 }).retry, true);
  assert.equal(retryPlan({ error: new Error('strict mode violation'), attempt: 0 }).retry, false);
  assert.equal(retryPlan({ status: 429, attempt: 0, blocked: true }).retry, false);
  assert.equal(isTransientError(new Error('socket hang up')), true);
  assert.equal(isTransientError(new Error('Timeout 300ms exceeded')), true);
});

test('retry delays use Retry-After first, then 5s and 15s', () => {
  assert.equal(retryPlan({ status: 429, attempt: 0, retryAfter: '2' }).delayMs, 2000);
  assert.equal(retryPlan({ status: 429, attempt: 0 }).delayMs, 5000);
  assert.equal(retryPlan({ status: 429, attempt: 1 }).delayMs, 15000);
  assert.equal(retryPlan({ status: 429, attempt: 0, maxRetries: 0 }).retry, false);
  assert.equal(PACING_DEFAULTS.minIntervalMs, 2000);
});

test('a pacer waits between pages on the same host only', async () => {
  let now = 0;
  const sleeps = [];
  const pacer = createPacer({
    now: () => now,
    sleep: async (ms) => { sleeps.push(ms); now += ms; },
    random: () => 0.5
  });
  await pacer.wait('jobs.test');
  assert.deepEqual(sleeps, []);
  now += 500;
  await pacer.wait('jobs.test');
  assert.deepEqual(sleeps, [1750]);
  now += 5000;
  await pacer.wait('jobs.test');
  assert.deepEqual(sleeps, [1750]);
  await pacer.wait('other.test');
  assert.deepEqual(sleeps, [1750]);
});
