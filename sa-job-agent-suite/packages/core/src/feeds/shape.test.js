// packages/core/src/feeds/shape.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRawJob, plainText, httpUrl, dateOnly, looksRemote, FeedShapeError } from './shape.js';

test('makeRawJob drops rows without a title or company', () => {
  assert.equal(makeRawJob('remotive', { title: '', company: 'Acme' }), null);
  assert.equal(makeRawJob('remotive', { title: 'Dev', company: '  ' }), null);
  assert.equal(makeRawJob('remotive', { title: 'Dev', company: 'Acme' }).title, 'Dev');
});

test('plainText strips tags, decodes entities and collapses space', () => {
  assert.equal(
    plainText('<p>Build&nbsp;with <strong>React</strong> &amp; Node</p>'),
    'Build with React & Node'
  );
});

test('httpUrl keeps only absolute http(s) URLs', () => {
  assert.equal(httpUrl('https://example.com/job'), 'https://example.com/job');
  assert.equal(httpUrl(' JavaScript:alert(1)'), '');
  assert.equal(httpUrl('not a url'), '');
  assert.equal(httpUrl(''), '');
});

test('dateOnly accepts ISO dates and unix seconds', () => {
  assert.equal(dateOnly('2026-10-20T09:12:00'), '2026-10-20');
  assert.equal(dateOnly(1761000000), '2025-10-20');
  assert.equal(dateOnly('not a date'), '');
  assert.equal(dateOnly(null), '');
});

test('looksRemote reads location and title text', () => {
  assert.equal(looksRemote('Remote (Worldwide)'), true);
  assert.equal(looksRemote('Cape Town'), false);
});

test('FeedShapeError carries the source name', () => {
  const err = new FeedShapeError('Remotive', 'expected jobs[]');
  assert.equal(err.source, 'Remotive');
  assert.match(err.message, /Remotive/);
});
