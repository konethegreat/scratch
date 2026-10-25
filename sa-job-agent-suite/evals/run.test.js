import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeClient } from '@sajas/core/testing';
import { MODEL_IDS } from '@sajas/core';
import { runCases } from './run.mjs';

const apiKey = 'sk-' + 'ant-api03-' + 'A'.repeat(40);
const page = { name: 'p', expected: { pageType: 'form', action: 'fill' }, job: { title: 't', company: 'c' }, snapshot: {} };
const planCase = { cls: 'planner', kind: 'plan', page, task: 'planner', prompt: 'x' };
const reply = (obj) => ({
  model: MODEL_IDS.haiku, stop_reason: 'end_turn',
  content: [{ type: 'text', text: JSON.stringify(obj) }],
  usage: { input_tokens: 1000, output_tokens: 100 }
});
const good = reply({ pageType: 'form', action: 'fill', buttonText: '', confidence: 'high', reason: '' });
const bad = reply({ pageType: 'listing', action: 'click', buttonText: 'Apply', confidence: 'high', reason: '' });

test('cost per completed task divides total spend by PASSING tasks; avg per call is separate', async () => {
  const { client } = fakeClient([good, bad]);
  const { classes } = await runCases({ cases: [planCase, planCase], baseCv: '', apiKey, client });
  const p = classes.planner;
  assert.equal(p.passRate, 0.5);
  assert.ok(Math.abs(p.costPerCompletedTaskUSD - 2 * p.avgCostPerCallUSD) < 1e-12);
});

test('cost per completed task is null when nothing passed', async () => {
  const { client } = fakeClient([bad]);
  const { classes } = await runCases({ cases: [planCase], baseCv: '', apiKey, client });
  assert.equal(classes.planner.costPerCompletedTaskUSD, null);
  assert.ok(classes.planner.avgCostPerCallUSD > 0);
});

test('a call that throws flags spendUnderReported', async () => {
  const { client } = fakeClient([{ __throw: new Error('boom') }]);
  const r = await runCases({ cases: [planCase], baseCv: '', apiKey, client });
  assert.equal(r.spendUnderReported, true);
  assert.equal(r.classes.planner.passRate, 0);
});
