import test from 'node:test';
import assert from 'node:assert/strict';
import { SUPPORT, FAQ, supportMailto } from './support.js';

const KEY = ['sk', 'ant', 'api03', 'C'.repeat(40)].join('-');

test('the support details are the approved public ones', () => {
  assert.equal(SUPPORT.email, 'erictshivhinda@gmail.com');
  assert.equal(SUPPORT.phone, '+27 81 302 5435');
  assert.equal(SUPPORT.phoneHref, 'tel:+27813025435');
  assert.equal(SUPPORT.github, 'https://github.com/konethegreat');
  assert.ok(SUPPORT.linkedin.includes('kone-tshivhinda'));
  assert.equal(SUPPORT.location, 'Johannesburg, South Africa');
  assert.ok(FAQ.length >= 4);
});

test('the report link carries diagnostics but never a key or personal content', () => {
  const info = {
    code: 'BUDGET_EXCEEDED',
    message: 'The daily AI budget has been reached.',
    hint: 'Raise the daily budget in Settings, or wait until tomorrow.',
    requestId: 'local-abc123',
    at: '2026-10-27T10:00:00.000Z',
    where: 'tailor job',
    details: 'CV text that must not be emailed'
  };
  const href = supportMailto(info);
  assert.match(href, /^mailto:erictshivhinda@gmail\.com\?/);
  const decoded = decodeURIComponent(href.split('?')[1]);
  assert.match(decoded, /BUDGET_EXCEEDED/);
  assert.match(decoded, /local-abc123/);
  assert.match(decoded, /tailor job/);
  assert.equal(decoded.includes('CV text that must not be emailed'), false);
  assert.equal(decoded.includes(KEY), false);
});
