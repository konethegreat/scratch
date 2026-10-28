import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDebugArgs, formatDebugReport, DEBUG_USAGE } from './debugReport.js';

test('debug arguments parse with sane defaults', () => {
  assert.deepEqual(parseDebugArgs(['--source', 'pnet', '--keyword', 'developer']), {
    source: 'pnet', keyword: 'developer', location: null, headful: false, save: false, html: null, capture: null, help: false, error: null
  });
  const full = parseDebugArgs(['--source', 'indeed', '--keyword', 'rust', '--location', 'Cape Town', '--headful', '--save', '--html', 'page.html', '--capture', 'capture.json']);
  assert.equal(full.location, 'Cape Town');
  assert.equal(full.headful, true);
  assert.equal(full.save, true);
  assert.equal(full.html, 'page.html');
  assert.equal(full.capture, 'capture.json');
});

test('missing or unknown arguments report a clear error', () => {
  assert.match(parseDebugArgs([]).error, /Missing --source/);
  assert.match(parseDebugArgs(['--source', 'pnet', '--bogus']).error, /Unknown argument/);
  assert.match(parseDebugArgs(['--source', 'pnet', '--capture', 'c.json']).error, /needs --html/);
  assert.equal(parseDebugArgs(['--help']).error, null);
  assert.match(DEBUG_USAGE, /--source pnet/);
});

test('the report names the strategy counts, winner and first row', () => {
  const text = formatDebugReport({
    source: { id: 'pnet', name: 'PNet' },
    url: 'https://www.pnet.co.za/jobs?k=developer',
    title: 'Developer jobs',
    httpStatus: 200,
    blocked: false,
    blockKind: null,
    error: null,
    strategy: 'semantic',
    strategies: {
      structured: { raw: 0, valid: 0, rejected: 0, error: null },
      dom: { raw: 4, valid: 1, rejected: 3, error: null },
      semantic: { raw: 5, valid: 5, rejected: 0, error: null }
    },
    rejectReasons: ['3 rows with no apply link'],
    firstItem: { title: 'Backend Developer', company: 'Acme', location: 'Cape Town', applyUrl: 'https://x.test/1' }
  });
  assert.match(text, /PNet/);
  assert.match(text, /dom: raw 4, valid 1, rejected 3/);
  assert.match(text, /semantic: raw 5, valid 5, rejected 0/);
  assert.match(text, /Winner: semantic/);
  assert.match(text, /no apply link/);
  assert.match(text, /First valid row: Backend Developer/);
});

test('a blocked report is never mistaken for a working source', () => {
  const text = formatDebugReport({
    source: { name: 'PNet' }, url: 'https://x.test', title: 'Just a moment...',
    httpStatus: 403, blocked: true, blockKind: 'challenge', strategy: 'none'
  });
  assert.match(text, /Blocked: yes \(challenge\)/);
  assert.match(text, /Winner: none/);
});
