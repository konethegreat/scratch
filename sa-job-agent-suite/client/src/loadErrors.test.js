import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setSourceError, clearSourceError, firstSourceError } from './loadErrors.js';

test('setting a source stores its error', () => {
  const info = { code: 'NETWORK_OFFLINE', message: 'Could not reach the service.' };
  const state = setSourceError({}, 'profile', info);
  assert.deepEqual(state, { profile: info });
  assert.equal(firstSourceError(state), info);
});

test('a successful source clears only its own key', () => {
  const profile = { code: 'NETWORK_OFFLINE', message: 'profile down' };
  const jobs = { code: 'NETWORK_OFFLINE', message: 'jobs down' };
  const state = setSourceError(setSourceError({}, 'profile', profile), 'jobs', jobs);
  const next = clearSourceError(state, 'profile');
  assert.deepEqual(next, { jobs });
  assert.equal(firstSourceError(next), jobs);
  assert.equal(clearSourceError(next, 'profile'), next);
});

test('a failed retry keeps the source error visible', () => {
  const first = { code: 'NETWORK_OFFLINE', message: 'first failure' };
  const retry = { code: 'NETWORK_OFFLINE', message: 'second failure' };
  const state = setSourceError(setSourceError({}, 'profile', first), 'logs', { code: 'UNKNOWN', message: 'logs down' });
  const afterRetry = setSourceError(state, 'profile', retry);
  assert.equal(firstSourceError(afterRetry), retry);
  assert.equal(Object.keys(afterRetry).length, 2);
});
