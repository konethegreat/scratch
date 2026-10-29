import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REAL, DEMO, MODE_STORAGE_KEY,
  getMode, setMode, subscribeMode, enterDemo, exitDemo, storageAvailable
} from './mode.js';

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

test('real is the default and exit removes the flag', () => {
  assert.equal(getMode(), REAL);
  enterDemo();
  assert.equal(getMode(), DEMO);
  assert.equal(globalThis.sessionStorage.getItem(MODE_STORAGE_KEY), DEMO);
  exitDemo();
  assert.equal(getMode(), REAL);
  assert.equal(globalThis.sessionStorage.getItem(MODE_STORAGE_KEY), null);
});

test('the flag is per tab and survives a reload in the same tab', () => {
  const tab = globalThis.sessionStorage;
  enterDemo();
  globalThis.sessionStorage = fakeSession();
  assert.equal(getMode(), REAL);
  globalThis.sessionStorage = tab;
  assert.equal(getMode(), DEMO);
});

test('subscribers hear every change and can unsubscribe', () => {
  const seen = [];
  const off = subscribeMode((mode) => seen.push(mode));
  enterDemo();
  exitDemo();
  off();
  enterDemo();
  assert.deepEqual(seen, [DEMO, REAL]);
});

test('a denied sessionStorage falls back to the in-memory flag', () => {
  globalThis.sessionStorage = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
    removeItem() { throw new Error('denied'); }
  };
  assert.equal(setMode(DEMO), DEMO);
  assert.equal(getMode(), DEMO);
  assert.equal(setMode(REAL), REAL);
  assert.equal(storageAvailable(), false);
});
