import test from 'node:test';
import assert from 'node:assert/strict';
import { syncExtensionResults } from './extensionSync.js';

const result = (id) => ({ id, jobId: `job-${id}` });

test('synced and gone results are acknowledged, failed ones stay queued', async () => {
  const acked = [];
  const bridge = {
    pullResults: async () => [result('a'), result('b'), result('c')],
    ackResults: async (ids) => { acked.push(...ids); return true; }
  };
  const outcome = await syncExtensionResults({
    bridge,
    record: async (entry) => ({ a: 'synced', b: 'gone', c: 'failed' }[entry.id])
  });
  assert.deepEqual(outcome, { synced: 1, dropped: 1, left: 1 });
  assert.deepEqual(acked, ['a', 'b']);
});

test('a record that throws leaves the result queued', async () => {
  const bridge = { pullResults: async () => [result('a')], ackResults: async () => true };
  const outcome = await syncExtensionResults({ bridge, record: async () => { throw new Error('offline'); } });
  assert.deepEqual(outcome, { synced: 0, dropped: 0, left: 1 });
});

test('no extension means no ack and no work', async () => {
  const bridge = { pullResults: async () => [], ackResults: async () => { throw new Error('should not ack'); } };
  assert.deepEqual(await syncExtensionResults({ bridge, record: async () => 'synced' }), { synced: 0, dropped: 0, left: 0 });
});

test('a failed ack still reports the count and never throws', async () => {
  const bridge = {
    pullResults: async () => [result('a')],
    ackResults: async () => { throw new Error('worker asleep'); }
  };
  assert.deepEqual(await syncExtensionResults({ bridge, record: async () => 'synced' }), { synced: 1, dropped: 0, left: 0 });
});

test('results without an id are left alone', async () => {
  const acked = [];
  const bridge = {
    pullResults: async () => [{ id: '' }, result('a')],
    ackResults: async (ids) => { acked.push(...ids); return true; }
  };
  const outcome = await syncExtensionResults({ bridge, record: async (entry) => (entry.id ? 'synced' : 'failed') });
  assert.deepEqual(outcome, { synced: 1, dropped: 0, left: 1 });
  assert.deepEqual(acked, ['a']);
});
