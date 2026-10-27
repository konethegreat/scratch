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

test('tier is a strict escalation ladder; Opus and Fable are both frontier', () => {
  const ladder = [MODEL_IDS.haiku, MODEL_IDS.sonnet, MODEL_IDS.opus, MODEL_IDS.fable];
  assert.deepEqual(ladder.map((id) => MODELS[id].tier), [0, 1, 2, 3]);
  assert.equal(MODELS[MODEL_IDS.haiku].frontier, false);
  assert.equal(MODELS[MODEL_IDS.sonnet].frontier, false);
  assert.equal(MODELS[MODEL_IDS.opus].frontier, true);
  assert.equal(MODELS[MODEL_IDS.fable].frontier, true);
});

test('every TASKS entry names a registry model and a valid effort', () => {
  const efforts = ['low', 'medium', 'high', 'xhigh', 'max'];
  for (const [name, t] of Object.entries(TASKS)) {
    assert.ok(MODELS[t.model], `${name} model`);
    assert.ok(efforts.includes(t.effort), `${name} effort`);
    assert.ok(t.maxTokens > 0, `${name} maxTokens`);
  }
  assert.equal(Object.keys(TASKS).length, 15);
  // Agent 2 documents are long; adaptive thinking shares the budget (a cut-off CV is never saved).
  assert.equal(TASKS.tailor.maxTokens, 16000);
});

test('TASKS.extract is Haiku, low effort, floor 6000', () => {
  assert.deepEqual(TASKS.extract, { model: MODEL_IDS.haiku, effort: 'low', maxTokens: 6000 });
});

test('TASKS.rag writes, TASKS.ground classifies', () => {
  assert.deepEqual(TASKS.rag, { model: MODEL_IDS.sonnet, effort: 'medium', maxTokens: 12000 });
  assert.deepEqual(TASKS.ground, { model: MODEL_IDS.haiku, effort: 'medium', maxTokens: 4000 });
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
