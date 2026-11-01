import test from 'node:test';
import assert from 'node:assert/strict';
import { webLink } from './links.js';

test('a full http or https link is kept as a normalised URL', () => {
  assert.equal(webLink('https://example.test/jobs/1'), 'https://example.test/jobs/1');
  assert.equal(webLink('http://example.test'), 'http://example.test/');
});

test('a bare host is upgraded to https', () => {
  assert.equal(webLink('linkedin.com/in/thandi'), 'https://linkedin.com/in/thandi');
  assert.equal(webLink('www.example.co.za/jobs?q=dev'), 'https://www.example.co.za/jobs?q=dev');
});

test('anything that is not a web link becomes no link', () => {
  for (const value of [
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    '/jobs/relative',
    'not a link',
    'example.com:8080/jobs',
    'localhost:3000',
    '@example.test',
    '',
    null,
    undefined,
    42
  ]) {
    assert.equal(webLink(value), '', `${String(value)} was accepted`);
  }
});
