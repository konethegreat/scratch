import test from 'node:test';
import assert from 'node:assert/strict';
import { clampJobLimit, decodeJobCursor } from './paging.js';

test('clampJobLimit defaults to 50 for missing or non-numeric values', () => {
  for (const value of [undefined, null, '', 'abc', 'ten']) {
    assert.equal(clampJobLimit(value), 50, String(value));
  }
});

test('clampJobLimit clamps to 1..200', () => {
  assert.equal(clampJobLimit('0'), 1);
  assert.equal(clampJobLimit('-9'), 1);
  assert.equal(clampJobLimit('1'), 1);
  assert.equal(clampJobLimit('2'), 2);
  assert.equal(clampJobLimit('200'), 200);
  assert.equal(clampJobLimit('201'), 200);
  assert.equal(clampJobLimit('9999'), 200);
});

test('decodeJobCursor reads base64 offsets', () => {
  const encode = (text) => Buffer.from(text).toString('base64');
  assert.equal(decodeJobCursor(encode('0')), 0);
  assert.equal(decodeJobCursor(encode('40')), 40);
});

test('decodeJobCursor falls back to 0 for anything that is not a non-negative safe integer', () => {
  const encode = (text) => Buffer.from(text).toString('base64');
  for (const bad of [undefined, '', 'not-a-cursor', encode('-3'), encode('1.5'),
    encode('abc'), encode('99999999999999999999')]) {
    assert.equal(decodeJobCursor(bad), 0, String(bad));
  }
});
