import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectBlock } from './blockDetect.js';

const LONG = 'Software Developer Johannesburg Acme Pty Ltd full time permanent '.repeat(8);

test('blockDetect: HTTP 429 is a rate-limit', () => {
  assert.deepEqual(detectBlock({ status: 429, title: 'Too Many Requests', text: LONG }), { blocked: true, kind: 'rate-limit' });
});

test('blockDetect: 403 with an empty body is denied', () => {
  assert.deepEqual(detectBlock({ status: 403, title: '', text: '' }), { blocked: true, kind: 'denied' });
});

test('blockDetect: 401 with a short body is denied', () => {
  assert.deepEqual(detectBlock({ status: 401, title: 'Unauthorized', text: 'Unauthorized' }), { blocked: true, kind: 'denied' });
});

test('blockDetect: 403 with a substantial ordinary body is not flagged as denied', () => {
  assert.deepEqual(detectBlock({ status: 403, title: 'Jobs', text: LONG }), { blocked: false, kind: null });
});

test('blockDetect: a challenge title is a challenge', () => {
  assert.deepEqual(detectBlock({ status: 200, title: 'Just a moment...', text: LONG }), { blocked: true, kind: 'challenge' });
});

test('blockDetect: challenge wording in the first 2000 chars of text is a challenge', () => {
  const text = 'Please verify you are human to continue. ' + LONG;
  assert.deepEqual(detectBlock({ status: 200, title: 'PNet', text }), { blocked: true, kind: 'challenge' });
  assert.equal(detectBlock({ status: 200, title: 'x', text: 'Checking... Cloudflare Ray ID' }).kind, 'challenge');
  assert.equal(detectBlock({ status: 200, title: 'Attention Required! | Cloudflare', text: LONG }).kind, 'challenge');
});

test('blockDetect: challenge wording after the first 2000 chars is ignored', () => {
  const text = 'x'.repeat(2100) + ' captcha';
  assert.equal(detectBlock({ status: 200, title: 'Jobs', text }).blocked, false);
});

test('blockDetect: a login title with a password hint is a login wall', () => {
  assert.deepEqual(
    detectBlock({ status: 200, title: 'Sign in to continue', text: 'Email\nPassword\nForgot your password?' }),
    { blocked: true, kind: 'login' },
  );
});

test('blockDetect: a login URL path with a password hint is a login wall', () => {
  assert.equal(
    detectBlock({ status: 200, title: 'Welcome', url: 'https://example.test/account/login?next=/jobs', text: 'Password' }).kind,
    'login',
  );
});

test('blockDetect: a 200 login page without a password hint is not flagged', () => {
  assert.deepEqual(detectBlock({ status: 200, title: 'Log in', text: 'Welcome back. ' + LONG }), { blocked: false, kind: null });
});

test('blockDetect: a normal results page is not blocked', () => {
  assert.deepEqual(
    detectBlock({ status: 200, title: 'Developer jobs in Johannesburg | PNet', text: LONG, url: 'https://www.pnet.co.za/jobs/?k=developer' }),
    { blocked: false, kind: null },
  );
});

test('blockDetect: missing fields never throw and are not blocked', () => {
  assert.deepEqual(detectBlock({}), { blocked: false, kind: null });
  assert.deepEqual(detectBlock({ status: null, title: undefined, text: undefined }), { blocked: false, kind: null });
});
