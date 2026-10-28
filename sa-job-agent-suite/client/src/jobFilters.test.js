import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_VIEW_FILTERS } from '@sajas/core/jobs';
import { JOB_FILTERS_KEY, loadJobFilters, saveJobFilters } from './jobFilters.js';

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); }
  };
}

function withStorage(storage, run) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'localStorage');
  const previous = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
  try {
    run();
  } finally {
    if (had) {
      Object.defineProperty(globalThis, 'localStorage', { value: previous, configurable: true, writable: true });
    } else {
      delete globalThis.localStorage;
    }
  }
}

test('missing or malformed storage falls back to the defaults', () => {
  withStorage(fakeStorage(), () => {
    assert.deepEqual(loadJobFilters(), DEFAULT_VIEW_FILTERS);
  });
  withStorage(fakeStorage({ [JOB_FILTERS_KEY]: 'not json' }), () => {
    assert.deepEqual(loadJobFilters(), DEFAULT_VIEW_FILTERS);
  });
  withStorage(fakeStorage({ [JOB_FILTERS_KEY]: '{"saOnly":null,"status":"bogus","minScore":-5}' }), () => {
    assert.deepEqual(loadJobFilters(), DEFAULT_VIEW_FILTERS);
  });
});

test('saving the defaults removes the stored key instead of writing one', () => {
  const storage = fakeStorage({ [JOB_FILTERS_KEY]: '{"saOnly":false}' });
  withStorage(storage, () => saveJobFilters(DEFAULT_VIEW_FILTERS));
  assert.equal(storage.map.size, 0);
});

test('a real filter change round-trips through storage', () => {
  const storage = fakeStorage();
  withStorage(storage, () => {
    saveJobFilters({ ...DEFAULT_VIEW_FILTERS, province: 'Gauteng', minScore: 80 });
    const saved = JSON.parse(storage.map.get(JOB_FILTERS_KEY));
    assert.equal(saved.province, 'Gauteng');
    assert.equal(saved.minScore, 80);
    assert.equal(loadJobFilters().province, 'Gauteng');
    saveJobFilters(DEFAULT_VIEW_FILTERS);
  });
  assert.equal(storage.map.size, 0);
});
