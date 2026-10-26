// Tests for the canary routine type (T10). DB_PATH/KEYS_PATH must point at
// throwaway files BEFORE helper.js / routineRunner.js load. No browser launches:
// the canary session is injected through __setCanarySessionForTests.
import test, { before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sajas-routine-'));
process.env.DB_PATH = path.join(dir, 'db.json');
process.env.KEYS_PATH = path.join(dir, 'keys.json');
delete process.env.SAJAS_DEMO_ORIGIN;

let helper;
let browserLock;
let runner;

before(async () => {
  helper = await import('../db/helper.js');
  browserLock = await import('../hunter/browserLock.js');
  runner = await import('./routineRunner.js');
});

beforeEach(() => {
  runner.__setCanarySessionForTests?.(null);
  helper.writeDb({ ...helper.readDb(), routines: [] });
  helper.setHunterState({ isRunning: false, startedAt: null, finishedAt: null, stopRequested: false });
  helper.setApplyState({ isRunning: false, jobId: null, startedAt: null });
});

afterEach(() => {
  runner.__setCanarySessionForTests?.(null);
  helper.setHunterState({ isRunning: false, startedAt: null, finishedAt: null, stopRequested: false });
  helper.setApplyState({ isRunning: false, jobId: null, startedAt: null });
});

after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const canaryRoutine = (over = {}) => helper.addRoutine({ name: 'Source health check', type: 'canary', ...over });

test('ROUTINE_TYPES includes canary', () => {
  assert.ok(helper.ROUTINE_TYPES.includes('canary'));
});

test('a canary routine stores autoTailorCount 0', () => {
  const routine = canaryRoutine({ autoTailorCount: 9 });
  assert.equal(routine.type, 'canary');
  assert.equal(routine.autoTailorCount, 0);
  assert.equal(helper.getRoutine(routine.id).autoTailorCount, 0);
});

test('a canary routine run records tested/passed and never starts a hunt', async () => {
  let calls = 0;
  runner.__setCanarySessionForTests(async () => {
    calls += 1;
    return { pnet: { pass: true }, indeed: { pass: false } };
  });
  const routine = canaryRoutine();

  const result = await runner.runRoutine(routine, { trigger: 'manual' });

  assert.equal(calls, 1);
  assert.ok(result, 'a successful canary returns its summary');
  assert.equal(result.tested, 2);
  assert.equal(result.passed, 1);
  assert.deepEqual(result.canary, { pnet: { pass: true }, indeed: { pass: false } });
  assert.match(result.note, /1\/2/);

  const stored = helper.getRoutine(routine.id);
  assert.equal(stored.lastStatus, 'ok');
  assert.equal(stored.lastResult.tested, 2);
  assert.equal(stored.lastResult.passed, 1);
  assert.deepEqual(stored.lastResult.canary, { pnet: { pass: true }, indeed: { pass: false } });
  assert.equal(helper.getHunterState().isRunning, false);
  assert.equal(browserLock.browserOwner(), null, 'the canary lock is released');
});

test('a canary routine skips when another browser job holds the lock', async () => {
  let calls = 0;
  runner.__setCanarySessionForTests(async () => {
    calls += 1;
    return {};
  });
  const routine = canaryRoutine();
  const release = browserLock.tryAcquireBrowser('hunt');
  assert.equal(typeof release, 'function');

  try {
    const out = await runner.runRoutine(routine);
    assert.equal(out, null);
    assert.equal(calls, 0, 'the canary session is not started');
    assert.equal(helper.getRoutine(routine.id).lastStatus, 'skipped');
    assert.equal(browserLock.browserOwner(), 'hunt', 'the foreign lock is left alone');
  } finally {
    release();
  }
  assert.equal(browserLock.browserOwner(), null);
});

test('a canary session failure is recorded as error and releases the lock', async () => {
  runner.__setCanarySessionForTests(async () => { throw new Error('canary exploded'); });
  const routine = canaryRoutine();

  const result = await runner.runRoutine(routine);

  assert.equal(result.error, 'canary exploded');
  assert.equal(helper.getRoutine(routine.id).lastStatus, 'error');
  assert.equal(browserLock.browserOwner(), null);
  assert.equal(helper.getHunterState().isRunning, false);
});
