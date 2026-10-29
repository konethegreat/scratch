import test from 'node:test';
import assert from 'node:assert/strict';
import { FEED_SOURCES } from '@sajas/core/feeds';
import { createDemoFeedClient } from './feed.js';

test('load returns the real client result shape', async () => {
  const client = createDemoFeedClient({ now: () => new Date('2026-10-28T10:00:00Z') });
  const result = await client.load('remotive');
  assert.equal(result.source, 'remotive');
  assert.equal(result.label, 'Remotive');
  assert.ok(result.jobs.length > 0);
  assert.equal(result.fetchedAt, '2026-10-28T10:00:00.000Z');
  assert.equal(result.cached, false);
});

test('loadAll covers every shipped feed with no errors', async () => {
  const outcome = await createDemoFeedClient().loadAll();
  assert.deepEqual(outcome.errors, []);
  assert.deepEqual(outcome.results.map((result) => result.source), FEED_SOURCES.map((source) => source.id));
});

test('the demo client never calls fetch', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('fetch must not run'); };
  try {
    await createDemoFeedClient().loadAll();
  } finally {
    globalThis.fetch = original;
  }
});

test('an unknown feed is refused with a typed error', async () => {
  await assert.rejects(() => createDemoFeedClient().load('nope'), (error) => error.code === 'FEED_FAILED');
});
