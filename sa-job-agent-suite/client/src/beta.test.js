import test from 'node:test';
import assert from 'node:assert/strict';
import { BETA_KEY, BETA_NOTICE, loadBetaDismissed, saveBetaDismissed } from './beta.js';

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
    map
  };
}

const broken = {
  getItem() { throw new Error('blocked'); },
  setItem() { throw new Error('blocked'); }
};

test('a fresh visitor sees the notice', () => {
  assert.equal(loadBetaDismissed(fakeStorage()), false);
});

test('dismissing stores the current notice version', () => {
  const storage = fakeStorage();
  saveBetaDismissed(storage);
  assert.equal(storage.map.get(BETA_KEY), BETA_NOTICE.version);
  assert.equal(loadBetaDismissed(storage), true);
});

test('a new notice version is shown again', () => {
  assert.equal(loadBetaDismissed(fakeStorage({ [BETA_KEY]: '2026-01-01' })), false);
});

test('blocked storage never throws and never hides the notice for good', () => {
  assert.equal(loadBetaDismissed(broken), false);
  assert.doesNotThrow(() => saveBetaDismissed(broken));
  assert.equal(loadBetaDismissed(undefined), false);
});

test('the notice reads as beta wording without promises', () => {
  assert.match(BETA_NOTICE.body, /beta/);
  assert.equal(/\bguarantee\b|\bpromise\b/i.test(BETA_NOTICE.body), false);
  assert.match(BETA_NOTICE.body, /Anthropic/, 'the banner must not imply that nothing leaves the browser');
});

test('a blocked localStorage getter is treated as blocked storage', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() { throw new Error('blocked'); }
  });
  try {
    assert.equal(loadBetaDismissed(), false);
    assert.doesNotThrow(() => saveBetaDismissed());
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  }
});
