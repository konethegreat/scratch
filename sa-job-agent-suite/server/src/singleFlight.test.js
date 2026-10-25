import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSingleFlight } from './singleFlight.js';

test('singleFlight: a second call while one is running is busy and never starts its task', async () => {
  const run = createSingleFlight();
  let started = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const first = run(async () => { started += 1; await gate; return 'a'; });
  const second = await run(async () => { started += 1; return 'b'; });
  assert.deepEqual(second, { busy: true });
  assert.equal(started, 1);
  release();
  assert.deepEqual(await first, { busy: false, value: 'a' });
});

test('singleFlight: runs again after completion and after a failure', async () => {
  const run = createSingleFlight();
  assert.deepEqual(await run(async () => 1), { busy: false, value: 1 });
  await assert.rejects(run(async () => { throw new Error('boom'); }), /boom/);
  assert.deepEqual(await run(async () => 2), { busy: false, value: 2 });
});
