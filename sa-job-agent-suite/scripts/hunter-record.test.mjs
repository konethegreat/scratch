// Pure tests for the record tool's sanitiser. Importing the script must not
// launch a browser or visit a site, so these tests only touch sanitizeHtml.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeHtml } from './hunter-record.mjs';

test('sanitizeHtml strips scripts, styles, iframes, inline handlers, emails and phone numbers and keeps the visible text/structure', () => {
  const html = [
    '<!doctype html><html><head><title>Jobs</title>',
    '<style>.card{color:red}</style>',
    '<script>window.steal = true;</script>',
    '<noscript>Enable JavaScript</noscript>',
    '</head><body>',
    '<h1 class="title">Senior Developer</h1>',
    '<iframe src="https://evil.example/ad"></iframe>',
    '<iframe src="https://evil.example/two" />',
    '<div onclick="steal()" onerror=\'boom\' onmouseover=hover()>Apply now</div>',
    '<p>Mail jobs@example.co.za or call +27 71 234 5678.</p>',
    '<span>Ref 0712345678</span><span>Code 42</span>',
    '</body></html>'
  ].join('\n');

  const out = sanitizeHtml(html);

  assert.doesNotMatch(out, /<script/i);
  assert.doesNotMatch(out, /<style/i);
  assert.doesNotMatch(out, /<noscript/i);
  assert.doesNotMatch(out, /<iframe/i);
  assert.doesNotMatch(out, /onclick|onerror|onmouseover/i);
  assert.doesNotMatch(out, /steal\(\)|hover\(\)/);
  assert.doesNotMatch(out, /jobs@example\.co\.za/);
  assert.doesNotMatch(out, /\+27 71 234 5678/);
  assert.doesNotMatch(out, /0712345678/);

  assert.match(out, /\[email\]/);
  assert.equal((out.match(/\[phone\]/g) || []).length, 2);

  assert.match(out, /<title>Jobs<\/title>/);
  assert.match(out, /<h1 class="title">Senior Developer<\/h1>/);
  assert.match(out, /<div>Apply now<\/div>/);
  assert.match(out, /Code 42/);
});

test('sanitizeHtml never throws on malformed or non-string input', () => {
  assert.doesNotThrow(() => sanitizeHtml('<div><script>alert(1)'));
  assert.doesNotThrow(() => sanitizeHtml('<a href="unterminated>click</a><iframe'));
  assert.doesNotThrow(() => sanitizeHtml('<p>ok</p'));
  assert.equal(sanitizeHtml(null), '');
  assert.equal(sanitizeHtml(undefined), '');
  assert.equal(sanitizeHtml(''), '');
});
