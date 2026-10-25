import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withPageParam } from './util.js';

const P = { param: 'page', firstValue: 1, step: 1, verified: false };

test('withPageParam: page 1 and single-page sources return the URL unchanged', () => {
  assert.equal(withPageParam('https://x.test/j?k=a%20b', P, 1), 'https://x.test/j?k=a%20b');
  assert.equal(withPageParam('https://x.test/j?k=a', { ...P, param: null }, 3), 'https://x.test/j?k=a');
});

test('withPageParam: a param containing regex metacharacters is matched literally', () => {
  const dot = { param: 'p.q', firstValue: 1, step: 1, verified: false };
  assert.equal(withPageParam('https://x.test/j?pxq=7', dot, 2), 'https://x.test/j?pxq=7&p.q=2');
  assert.equal(withPageParam('https://x.test/j?p.q=1', dot, 2), 'https://x.test/j?p.q=2');
  const br = { param: 'a[b]', firstValue: 1, step: 1, verified: false };
  assert.equal(withPageParam('https://x.test/j?k=1', br, 3), 'https://x.test/j?k=1&a[b]=3');
  assert.equal(withPageParam('https://x.test/j?a[b]=1&k=1', br, 3), 'https://x.test/j?a[b]=3&k=1');
});

test('withPageParam: appends, replaces and honours firstValue/step', () => {
  assert.equal(withPageParam('https://x.test/j?k=a%20b', P, 2), 'https://x.test/j?k=a%20b&page=2');
  assert.equal(withPageParam('https://x.test/j', P, 2), 'https://x.test/j?page=2');
  assert.equal(withPageParam('https://x.test/j?page=1&k=a', P, 3), 'https://x.test/j?page=3&k=a');
  assert.equal(withPageParam('https://x.test/j?k=a', { param: 'start', firstValue: 0, step: 25, verified: false }, 3), 'https://x.test/j?k=a&start=50');
  assert.equal(withPageParam('https://x.test/j?k=a#top', P, 2), 'https://x.test/j?k=a&page=2#top');
});
