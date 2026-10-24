import test from 'node:test';
import assert from 'node:assert/strict';
import { extractJson, salvageJsonArray } from './json.js';

test('extractJson reads fenced and prose-wrapped JSON and returns null for junk', () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('```\n[1,2]\n```'), [1, 2]);
  assert.deepEqual(extractJson('Sure! Here you go: {"a":{"b":2}} hope that helps'), { a: { b: 2 } });
  assert.deepEqual(extractJson('Result: [{"x":1}]'), [{ x: 1 }]);
  assert.equal(extractJson(''), null);
  assert.equal(extractJson(null), null);
  assert.equal(extractJson('no json here'), null);
  assert.equal(extractJson('{"a": '), null);
});

test('salvageJsonArray returns complete elements of a truncated array', () => {
  assert.deepEqual(salvageJsonArray('[{"a":1},{"b":2},{"c":'), [{ a: 1 }, { b: 2 }]);
});

test('salvageJsonArray ignores braces and escaped quotes inside strings', () => {
  const out = salvageJsonArray('[{"t":"a } b \\" c"},{"t":"x');
  assert.equal(out.length, 1);
  assert.equal(out[0].t, 'a } b " c');
});

test('salvageJsonArray reads an array under opts.key', () => {
  const out = salvageJsonArray('{"jobs":[{"a":1},{"a":2},{"a', { key: 'jobs' });
  assert.deepEqual(out, [{ a: 1 }, { a: 2 }]);
});

test('salvageJsonArray handles nested arrays and returns [] when there is no array', () => {
  assert.deepEqual(salvageJsonArray('[[1,2],[3,[4]],[5'), [[1, 2], [3, [4]]]);
  assert.deepEqual(salvageJsonArray('[1,2,3,'), [1, 2, 3]);
  assert.deepEqual(salvageJsonArray('no array at all'), []);
  assert.deepEqual(salvageJsonArray(''), []);
  assert.deepEqual(salvageJsonArray(null), []);
  assert.deepEqual(salvageJsonArray('{"other":[1]}', { key: 'jobs' }), []);
});

test('salvageJsonArray tolerates a code fence and prose before the array', () => {
  assert.deepEqual(salvageJsonArray('Here:\n```json\n[{"a":1},{"a":'), [{ a: 1 }]);
});
