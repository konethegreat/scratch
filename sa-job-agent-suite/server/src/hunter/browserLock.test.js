import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tryAcquireBrowser, browserOwner } from './browserLock.js';

// Each test releases in t.after so a failing assertion cannot leave the lock
// held for the next test. Release is idempotent, so double release is safe.
function acquire(t, kind) {
  const release = tryAcquireBrowser(kind);
  t.after(() => { if (release) release(); });
  return release;
}

test('browserLock: second acquire is refused until release', (t) => {
  const release = acquire(t, 'hunt');
  assert.equal(typeof release, 'function');
  assert.equal(tryAcquireBrowser('canary'), null);
  assert.equal(tryAcquireBrowser('apply'), null);
  release();
  const again = acquire(t, 'canary');
  assert.equal(typeof again, 'function');
});

test('browserLock: release is idempotent and a stale release cannot free a newer holder', (t) => {
  const first = acquire(t, 'hunt');
  first();
  first();
  const second = acquire(t, 'login-check');
  assert.equal(typeof second, 'function');
  first(); // stale: must not release the second holder
  assert.equal(tryAcquireBrowser('apply'), null);
  second();
  assert.equal(browserOwner(), null);
});

test('browserLock: browserOwner reports the holder', (t) => {
  assert.equal(browserOwner(), null);
  const release = acquire(t, 'apply');
  assert.equal(browserOwner(), 'apply');
  release();
  assert.equal(browserOwner(), null);
});

test('browserLock: an unknown kind is rejected', () => {
  assert.throws(() => tryAcquireBrowser('bogus'), TypeError);
  assert.equal(browserOwner(), null);
});
