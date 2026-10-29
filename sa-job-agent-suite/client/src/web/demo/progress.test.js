import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEMO_PROGRESS_KEY, DEMO_STEPS,
  loadDemoProgress, markStepDone, dismissDemoStrip
} from './progress.js';

function fakeSession() {
  const map = new Map();
  return {
    get length() { return map.size; },
    key(index) { return [...map.keys()][index] ?? null; },
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(String(key), String(value)); },
    removeItem(key) { map.delete(key); },
    clear() { map.clear(); }
  };
}

test.beforeEach(() => { globalThis.sessionStorage = fakeSession(); });
test.afterEach(() => { delete globalThis.sessionStorage; });

test('steps cover the five suggested surfaces', () => {
  assert.deepEqual(DEMO_STEPS.map((step) => step.tab), ['feeds', 'tailor', 'ask', 'hunter', 'copilot']);
});

test('a step is recorded once and survives a reload', () => {
  assert.deepEqual(loadDemoProgress(), { done: [], dismissed: false });
  markStepDone('feeds');
  markStepDone('feeds');
  markStepDone('tailor');
  assert.deepEqual(loadDemoProgress().done, ['feeds', 'tailor']);
  assert.equal(globalThis.sessionStorage.length, 1);
  assert.equal(globalThis.sessionStorage.key(0), DEMO_PROGRESS_KEY);
});

test('dismissal is remembered and only the demo progress key is written', () => {
  dismissDemoStrip();
  assert.equal(loadDemoProgress().dismissed, true);
  const keys = [];
  for (let index = 0; index < globalThis.sessionStorage.length; index += 1) {
    keys.push(globalThis.sessionStorage.key(index));
  }
  assert.deepEqual(keys, [DEMO_PROGRESS_KEY]);
  assert.equal(DEMO_PROGRESS_KEY.startsWith('sajas:demo:'), true);
});
