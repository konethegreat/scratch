// Task attribution: AI usage is attributed to the task (hunt/tailor/apply/...) that
// made the call. helper.js reads DB_PATH at import time, so env is set BEFORE the
// dynamic imports.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sajas-telemetry-'));
process.env.DB_PATH = path.join(dir, 'db.json');
process.env.KEYS_PATH = path.join(dir, 'keys.json');

const helper = await import('./db/helper.js');
const { withTask } = await import('./telemetry.js');
const { currentTask } = await import('./db/taskContext.js');

const MODEL = 'claude-sonnet-5-5';
const tick = () => new Promise((r) => setImmediate(r));

beforeEach(() => helper.clearUsage());

test('calls inside withTask are attributed to the task and runs are counted', async () => {
  await withTask('hunt', async () => {
    assert.equal(currentTask().type, 'hunt');
    helper.addUsage({ model: MODEL, inputTokens: 1000, outputTokens: 100, bucket: 'ai-search' });
    await tick();
    helper.addUsage({ model: MODEL, inputTokens: 500, bucket: 'ai-search' });
  });
  assert.equal(currentTask(), null);

  const t = helper.getUsageSummary().today;
  assert.equal(t.byTask.hunt.runs, 1);
  assert.equal(t.byTask.hunt.failures, 0);
  assert.equal(t.byTask.hunt.calls, 2);
  assert.equal(t.byTask.hunt.inputTokens, 1500);
  assert.ok(t.byTask.hunt.estCostUSD > 0);
  // Existing shape intact: the day total and the bucket still count the calls.
  assert.equal(t.calls, 2);
  assert.equal(t.byBucket['ai-search'].calls, 2);
});

test('two concurrent withTask calls of the same type do not mix attribution', async () => {
  const seen = [];
  const work = (n) => withTask('tailor', async () => {
    const id = currentTask().id;
    helper.addUsage({ model: MODEL, inputTokens: n, bucket: 'tailor' });
    await tick();
    helper.addUsage({ model: MODEL, inputTokens: n, bucket: 'tailor' });
    await tick();
    seen.push([id, currentTask().id]);
  });
  await Promise.all([work(100), work(1000)]);

  assert.notEqual(seen[0][0], seen[1][0], 'each run has its own task id');
  for (const [a, b] of seen) assert.equal(a, b, 'task id stable across awaits');
  const t = helper.getUsageSummary().today.byTask.tailor;
  assert.equal(t.runs, 2);
  assert.equal(t.calls, 4);
  assert.equal(t.inputTokens, 2200);
});

test('a throwing task counts a failure and rethrows', async () => {
  await assert.rejects(
    withTask('apply', async () => {
      helper.addUsage({ model: MODEL, inputTokens: 10, bucket: 'planner' });
      throw new Error('boom');
    }),
    /boom/
  );
  const t = helper.getUsageSummary().today.byTask.apply;
  assert.equal(t.runs, 1);
  assert.equal(t.failures, 1);
  assert.equal(t.calls, 1);
});

test('cacheHitRatio and avgCostUSD are computed from the tallies', async () => {
  await withTask('memory-reflect', async () => {
    helper.addUsage({ model: MODEL, inputTokens: 100, cacheReadTokens: 300, cacheWriteTokens: 0, bucket: 'memory' });
  });
  await withTask('memory-reflect', async () => {});
  const t = helper.getUsageSummary().today.byTask['memory-reflect'];
  assert.equal(t.runs, 2);
  assert.equal(t.cacheHitRatio, 0.75);
  assert.ok(Math.abs(t.avgCostUSD - t.estCostUSD / 2) < 1e-12);

  // Zero denominators / zero runs yield 0, never NaN.
  helper.recordTaskRun('hunt', true);
  helper.addUsage({ model: MODEL, bucket: 'core' });
  const h = helper.getUsageSummary().today.byTask.hunt;
  assert.equal(h.cacheHitRatio, 0);
  assert.equal(h.avgCostUSD, 0);
});

test('usage outside any task is not attributed', () => {
  helper.addUsage({ model: MODEL, inputTokens: 123, bucket: 'core' });
  const t = helper.getUsageSummary().today;
  assert.equal(t.calls, 1);
  assert.deepEqual(t.byTask, {});
});

test('old day entries without byTask still summarise and prune', () => {
  const db = helper.readDb();
  db.usage = { days: { '2000-01-01': { calls: 1, estCostUSD: 0.5, byBucket: {} } } };
  helper.writeDb(db);
  const t = helper.getUsageSummary();
  assert.deepEqual(t.today.byTask, {});
  assert.equal(t.history[0].calls, 1);
  helper.clearUsage();
  assert.deepEqual(helper.getUsageSummary().today.byTask, {});
});
