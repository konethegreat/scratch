import test from 'node:test';
import assert from 'node:assert/strict';
import { hashText, tokenize } from './text.js';

test('hashText is stable FNV-1a hex', () => {
  assert.equal(hashText('hello'), '4f9f2cab');
  assert.equal(hashText(''), '811c9dc5');
  assert.equal(hashText('Base CV'), 'b27f3ec5');
  assert.equal(hashText('hello\nworld'), 'a2cdf7f9');
  assert.equal(hashText(null), hashText(''));
});

test('tokenize lowercases, strips accents, keeps + and #, drops stop words and one character words', () => {
  assert.deepEqual(tokenize('C++ and C# for Node.js, café!'), ['c++', 'c#', 'node', 'js', 'cafe']);
  assert.deepEqual(tokenize('A I am the one'), ['one']);
  assert.deepEqual(tokenize(''), []);
});
