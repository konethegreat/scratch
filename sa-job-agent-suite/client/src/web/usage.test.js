import test from 'node:test';
import assert from 'node:assert/strict';
import { createVault } from './vault.js';
import { createMemoryAdapter } from './memoryAdapter.js';
import { createUsageLedger } from './usage.js';
import { MODEL_IDS } from '@sajas/core/models';

function harness(profile = {}) {
  const vault = createVault(createMemoryAdapter({ profile: { current: profile } }));
  let clock = Date.parse('2026-10-27T10:00:00Z');
  const usage = createUsageLedger({ vault, now: () => new Date(clock) });
  const advance = (days) => { clock += days * 86_400_000; };
  return { vault, usage, advance };
}

test('records a call and summarises it in the server shape', async () => {
  const { usage } = harness({ dailyBudgetUSD: 5 });
  const cost = await usage.record({ model: MODEL_IDS.sonnet, bucket: 'tailor', inputTokens: 1_000_000, outputTokens: 0 });
  assert.equal(cost, 2);
  const summary = await usage.summary({ dailyBudgetUSD: 5 });
  assert.equal(summary.today.date, '2026-10-27');
  assert.equal(summary.today.calls, 1);
  assert.equal(summary.today.inputTokens, 1_000_000);
  assert.equal(summary.today.byBucket.tailor.calls, 1);
  assert.equal(summary.today.estCostUSD, 2);
  assert.equal(summary.history.length, 1);
  assert.equal(summary.last7CostUSD, 2);
  assert.deepEqual(summary.budget, { capUSD: 5, spentUSD: 2, exceeded: false });
});

test('the budget is exceeded at the cap and 0 means no cap', async () => {
  const capped = harness({ dailyBudgetUSD: 2 });
  await capped.usage.record({ model: MODEL_IDS.sonnet, inputTokens: 1_000_000 });
  assert.equal((await capped.usage.budget({ dailyBudgetUSD: 2 })).exceeded, true);

  const uncapped = harness({ dailyBudgetUSD: 0 });
  await uncapped.usage.record({ model: MODEL_IDS.sonnet, inputTokens: 1_000_000 });
  assert.equal((await uncapped.usage.budget({ dailyBudgetUSD: 0 })).exceeded, false);
});

test('keeps 14 days and clears back to zero', async () => {
  const { usage, advance } = harness();
  for (let i = 0; i < 20; i += 1) {
    await usage.record({ model: MODEL_IDS.sonnet, inputTokens: 1000 });
    advance(1);
  }
  const summary = await usage.summary({});
  assert.equal(summary.history.length, 14);
  assert.equal(summary.history.at(-1).date, '2026-11-15');
  await usage.clear();
  const cleared = await usage.summary({});
  assert.deepEqual(cleared.history, []);
  assert.equal(cleared.today.calls, 0);
});
