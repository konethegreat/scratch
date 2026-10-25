import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tryAcquireBrowser, browserOwner } from './browserLock.js';

test('browserLock: second acquire is refused until release', () => {
  const release = tryAcquireBrowser('hunt');
  assert.equal(typeof release, 'function');
  assert.equal(tryAcquireBrowser('canary'), null);
  assert.equal(tryAcquireBrowser('apply'), null);
  release();
  const again = tryAcquireBrowser('canary');
  assert.equal(typeof again, 'function');
  again();
});

test('browserLock: release is idempotent and a stale release cannot free a newer holder', () => {
  const first = tryAcquireBrowser('hunt');
  first();
  first();
  const second = tryAcquireBrowser('login-check');
  assert.equal(typeof second, 'function');
  first(); // stale: must not release the second holder
  assert.equal(tryAcquireBrowser('apply'), null);
  second();
  assert.equal(browserOwner(), null);
});

test('browserLock: browserOwner reports the holder', () => {
  assert.equal(browserOwner(), null);
  const release = tryAcquireBrowser('apply');
  assert.equal(browserOwner(), 'apply');
  release();
  assert.equal(browserOwner(), null);
});

test('browserLock: an unknown kind is rejected', () => {
  assert.throws(() => tryAcquireBrowser('bogus'), TypeError);
  assert.equal(browserOwner(), null);
});
