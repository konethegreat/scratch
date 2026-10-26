import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectBlock } from './blockDetect.js';

const LONG = 'Software Developer Johannesburg Acme Pty Ltd full time permanent '.repeat(8);
const OK = { blocked: false, kind: null, signal: null };

test('blockDetect: HTTP 429 is a rate-limit (strong, status signal)', () => {
  assert.deepEqual(detectBlock({ status: 429, title: 'Too Many Requests', text: LONG }), { blocked: true, kind: 'rate-limit', signal: 'status' });
});

test('blockDetect: 403 with an empty body is denied', () => {
  assert.deepEqual(detectBlock({ status: 403, title: '', text: '' }), { blocked: true, kind: 'denied', signal: 'status' });
});

test('blockDetect: 401 with a short body is denied', () => {
  assert.deepEqual(detectBlock({ status: 401, title: 'Unauthorized', text: 'Unauthorized' }), { blocked: true, kind: 'denied', signal: 'status' });
});

test('blockDetect: 403 with a substantial ordinary body is not flagged as denied', () => {
  assert.deepEqual(detectBlock({ status: 403, title: 'Jobs', text: LONG }), OK);
});

test('blockDetect: a challenge TITLE is a strong challenge (full word list)', () => {
  assert.deepEqual(detectBlock({ status: 200, title: 'Just a moment...', text: LONG }), { blocked: true, kind: 'challenge', signal: 'title' });
  assert.equal(detectBlock({ status: 200, title: 'Attention Required! | Cloudflare', text: LONG }).signal, 'title');
  assert.equal(detectBlock({ status: 200, title: 'CAPTCHA check', text: LONG }).signal, 'title');
  assert.equal(detectBlock({ status: 200, title: 'Cloudflare', text: LONG }).signal, 'title');
});

test('blockDetect: interstitial wording in the body text is a SOFT challenge (text signal)', () => {
  for (const phrase of [
    'Please verify you are human to continue.',
    'Checking your browser before accessing the site.',
    'Error 1020 Ray ID: 8a1b2c3d4e5f',
    'Performance & security by Cloudflare',
    'Performance and security by Cloudflare',
    'Are you a robot?',
    'We detected unusual traffic from your network.',
    'Access denied',
  ]) {
    assert.deepEqual(
      detectBlock({ status: 200, title: 'PNet', text: `${phrase} ${LONG}` }),
      { blocked: true, kind: 'challenge', signal: 'text' },
      phrase,
    );
  }
});

test('blockDetect: the bare words captcha / cloudflare in body text are NOT a block', () => {
  assert.deepEqual(detectBlock({ status: 200, title: 'Jobs', text: 'We run on Cloudflare and AWS. ' + LONG }), OK);
  assert.deepEqual(detectBlock({ status: 200, title: 'Jobs', text: 'This site is protected by reCAPTCHA. ' + LONG }), OK);
});

test('blockDetect: challenge wording after the first 2000 chars is ignored', () => {
  const text = 'x'.repeat(2100) + ' verify you are human';
  assert.deepEqual(detectBlock({ status: 200, title: 'Jobs', text }), OK);
});

test('blockDetect: a login title with a password hint is a strong login wall', () => {
  assert.deepEqual(
    detectBlock({ status: 200, title: 'Sign in | PNet', text: 'Email\nPassword\nForgot your password?' }),
    { blocked: true, kind: 'login', signal: 'title' },
  );
});

test('blockDetect: a login URL path with a password hint is a login wall (url signal)', () => {
  assert.deepEqual(
    detectBlock({ status: 200, title: 'Welcome', url: 'https://example.test/account/login?next=/jobs', text: 'Password' }),
    { blocked: true, kind: 'login', signal: 'url' },
  );
});

test('blockDetect: login wording needs word boundaries ("Design Internship" is not "sign in")', () => {
  assert.deepEqual(
    detectBlock({ status: 200, title: 'Graphic Design Internship jobs in Johannesburg', text: 'Password policy for applicants. ' + LONG }),
    OK,
  );
  assert.deepEqual(detectBlock({ status: 200, title: 'Career blog insights', url: 'https://x.test/blog-insights', text: 'password' }), OK);
  assert.equal(detectBlock({ status: 200, title: 'Log-in', text: 'Password' }).kind, 'login');
  assert.equal(detectBlock({ status: 200, title: 'Please log in', text: 'Password' }).kind, 'login');
});

test('blockDetect: a 200 login page without a password hint is not flagged', () => {
  assert.deepEqual(detectBlock({ status: 200, title: 'Log in', text: 'Welcome back. ' + LONG }), OK);
});

test('blockDetect: a normal results page is not blocked', () => {
  assert.deepEqual(
    detectBlock({ status: 200, title: 'Developer jobs in Johannesburg | PNet', text: LONG, url: 'https://www.pnet.co.za/jobs/?k=developer' }),
    OK,
  );
});

test('blockDetect: missing fields, null and undefined never throw and are not blocked', () => {
  assert.deepEqual(detectBlock({}), OK);
  assert.deepEqual(detectBlock({ status: null, title: undefined, text: undefined }), OK);
  assert.deepEqual(detectBlock(), OK);
  assert.deepEqual(detectBlock(null), OK);
});
