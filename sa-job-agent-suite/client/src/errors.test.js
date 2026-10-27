import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  contractFromBody,
  describeUserError,
  recordError,
  getRecentErrors,
  clearRecentErrors,
  subscribeErrors,
  diagnosticsText
} from './errors.js';

const fakeKey = () => 'sk-' + 'ant-api03-' + 'C'.repeat(40);

test('contractFromBody trusts a server contract payload', () => {
  const info = contractFromBody({
    code: 'KEY_INVALID',
    message: 'The API key is not valid.',
    hint: 'Paste a standard key.',
    retryable: false,
    requestId: 'local-server123'
  }, 400, 'fallback');
  assert.equal(info.code, 'KEY_INVALID');
  assert.equal(info.message, 'The API key is not valid.');
  assert.equal(info.hint, 'Paste a standard key.');
  assert.equal(info.retryable, false);
  assert.equal(info.requestId, 'local-server123');
});

test('contractFromBody derives the family from a legacy status', () => {
  const info = contractFromBody({ error: 'Job not found.' }, 404, 'Could not load.');
  assert.equal(info.code, 'NOT_FOUND');
  assert.equal(info.message, 'Job not found.');
  assert.equal(info.retryable, false);
});

test('contractFromBody uses the caller fallback for an empty body', () => {
  const info = contractFromBody(null, 500, 'Could not save profile.');
  assert.equal(info.code, 'UNKNOWN');
  assert.equal(info.message, 'Could not save profile.');
  assert.equal(info.retryable, true);
});

test('contractFromBody ignores an inherited property name as a code', () => {
  const info = contractFromBody({ code: 'constructor', error: 'Job not found.' }, 404, 'fallback');
  assert.equal(info.code, 'NOT_FOUND');
  assert.equal(info.message, 'Job not found.');
});

test('contractFromBody maps a legacy 401 body to AUTH_REJECTED', () => {
  const info = contractFromBody({ error: 'Unauthorized.' }, 401, 'fallback');
  assert.equal(info.code, 'AUTH_REJECTED');
  assert.equal(info.retryable, false);
});

test('describeUserError adds the hint once', () => {
  assert.equal(describeUserError({ message: 'Nope.', hint: 'Fix it.' }), 'Nope. Fix it.');
  assert.equal(describeUserError({ message: 'Nope.', hint: '' }), 'Nope.');
});

test('recordError keeps the newest 20 entries, newest first', () => {
  clearRecentErrors();
  for (let i = 0; i < 25; i += 1) recordError(new Error(`failure ${i}`), { where: 'test' });
  const entries = getRecentErrors();
  assert.equal(entries.length, 20);
  assert.equal(entries[0].message, 'failure 24');
  assert.equal(entries[19].message, 'failure 5');
  assert.equal(entries[0].where, 'test');
  assert.match(entries[0].at, /^\d{4}-\d{2}-\d{2}T/);
});

test('subscribers see new entries and stop after unsubscribing', () => {
  clearRecentErrors();
  const seen = [];
  const unsubscribe = subscribeErrors((entries) => seen.push(entries.length));
  recordError(new Error('one'));
  unsubscribe();
  recordError(new Error('two'));
  assert.deepEqual(seen, [1]);
});

test('recording the same failure twice bumps one entry instead of duplicating it', () => {
  clearRecentErrors();
  const body = { code: 'FEED_FAILED', message: 'A job feed did not respond.' };
  recordError(body, { where: 'jobs' });
  const second = recordError(body, { where: 'jobs' });
  const entries = getRecentErrors();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].count, 2);
  assert.equal(second.count, 2);
});

test('the same failure from a different source stays a separate entry', () => {
  clearRecentErrors();
  const body = { code: 'FEED_FAILED', message: 'A job feed did not respond.' };
  recordError(body, { where: 'jobs' });
  recordError(body, { where: 'logs' });
  const entries = getRecentErrors();
  assert.equal(entries.length, 2);
  assert.equal(entries[0].where, 'logs');
  assert.equal(entries[1].where, 'jobs');
});

test('diagnosticsText contains the contract fields and no raw key', () => {
  clearRecentErrors();
  const key = fakeKey();
  const entry = recordError(new Error(`bad key ${key}`), { where: 'save profile' });
  const text = diagnosticsText(entry);
  assert.match(text, /code: UNKNOWN/);
  assert.match(text, new RegExp(`requestId: ${entry.requestId}`));
  assert.match(text, /where: save profile/);
  assert.ok(!text.includes(key));
});
