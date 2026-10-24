import test from 'node:test';
import assert from 'node:assert/strict';
import { MODELS, MODEL_IDS, DEFAULT_MODEL_ID, modelSpec, TASKS, taskConfig, resolveModel } from './models.js';

test('registry holds exactly the four current models with their prices', () => {
  assert.equal(Object.keys(MODELS).length, 4);
  const p = (id) => [MODELS[id].inputPerMTok, MODELS[id].outputPerMTok];
  assert.deepEqual(p(MODEL_IDS.sonnet), [2, 10]);
  assert.deepEqual(p(MODEL_IDS.haiku), [0.1, 0.5]);
  assert.deepEqual(p(MODEL_IDS.opus), [4, 20]);
  assert.deepEqual(p(MODEL_IDS.fable), [10, 50]);
  assert.equal(DEFAULT_MODEL_ID, MODEL_IDS.sonnet);
  assert.equal(modelSpec(MODEL_IDS.opus).id, MODEL_IDS.opus);
  assert.equal(modelSpec('claude-opus'), null);
});

test('every TASKS entry names a registry model and a valid effort', () => {
  const efforts = ['low', 'medium', 'high', 'xhigh', 'max'];
  for (const [name, t] of Object.entries(TASKS)) {
    assert.ok(MODELS[t.model], `${name} model`);
    assert.ok(efforts.includes(t.effort), `${name} effort`);
    assert.ok(t.maxTokens > 0, `${name} maxTokens`);
  }
  assert.equal(Object.keys(TASKS).length, 12);
});

test('taskConfig falls back to core for unknown tasks', () => {
  assert.deepEqual(taskConfig('does-not-exist'), TASKS.core);
  assert.deepEqual(taskConfig('planner'), TASKS.planner);
});

test('resolveModel honours valid overrides and ignores foreign or legacy ids', () => {
  assert.equal(resolveModel({ selectedModel: 'gemini-1.5-flash' }, 'tailor'), 'claude-sonnet-5-5');
  assert.equal(resolveModel({ selectedModel: 'claude-opus-5-5' }, 'tailor'), 'claude-opus-5-5');
  assert.equal(resolveModel({ aiSearchModel: 'claude-haiku-5-5' }, 'ai-search'), 'claude-haiku-5-5');
  assert.equal(resolveModel({ selectedModel: 'claude-opus-5-5' }, 'ai-search'), 'claude-sonnet-5-5');
  assert.equal(resolveModel({ computerUseModel: 'claude-opus-5-5' }, 'computer-use'), 'claude-opus-5-5');
  assert.equal(resolveModel({ selectedModel: 'claude-sonnet-4-6' }, 'tailor'), 'claude-sonnet-5-5');
  assert.equal(resolveModel(null, 'tailor'), 'claude-sonnet-5-5');
});
