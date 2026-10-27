import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseHeadersFile, headersFor } from './headers.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const headersText = await readFile(path.join(root, 'client/public/_headers'), 'utf8');
const redirectsText = await readFile(path.join(root, 'client/public/_redirects'), 'utf8');

test('the CSP allows only self scripts and the four API origins', () => {
  const rules = parseHeadersFile(headersText);
  const headers = headersFor(rules, '/');
  const csp = headers['content-security-policy'];
  assert.ok(csp, 'CSP header missing');
  for (const directive of [
    "default-src 'self'",
    "script-src 'self'",
    "connect-src 'self' https://api.anthropic.com https://remotive.com https://www.arbeitnow.com https://jobicy.com",
    "img-src 'self' data: blob:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
    'upgrade-insecure-requests'
  ]) {
    assert.ok(csp.includes(directive), `missing ${directive}`);
  }
  assert.equal(csp.includes('unsafe-eval'), false);
  const connect = csp.split(';').map((s) => s.trim()).find((s) => s.startsWith('connect-src'));
  assert.equal(connect.includes('*'), false);
});

test('the security headers are present', () => {
  const headers = headersFor(parseHeadersFile(headersText), '/');
  assert.equal(headers['x-content-type-options'], 'nosniff');
  assert.equal(headers['referrer-policy'], 'no-referrer');
  assert.equal(headers['cross-origin-opener-policy'], 'same-origin');
  assert.match(headers['strict-transport-security'], /max-age=\d+/);
  assert.match(headers['permissions-policy'], /camera=\(\)/);
});

test('the SPA fallback is configured', () => {
  assert.match(redirectsText, /^\/\*\s+\/index\.html\s+200$/m);
});

test('the parser merges wildcard and exact rules', () => {
  const rules = parseHeadersFile('/*\n  A: one\n/x\n  B: two\n');
  assert.deepEqual(headersFor(rules, '/x'), { a: 'one', b: 'two' });
  assert.deepEqual(headersFor(rules, '/y'), { a: 'one' });
});

test('the parser rejects a header line before any path rule', () => {
  assert.throws(
    () => parseHeadersFile('  X-Test: one\n'),
    { message: 'Header before any path rule:   X-Test: one' }
  );
});

test('the parser rejects a malformed header line with no colon', () => {
  assert.throws(
    () => parseHeadersFile('/*\n  NoColon\n'),
    { message: 'Malformed header line: NoColon' }
  );
});
