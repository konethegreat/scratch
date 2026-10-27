import test from 'node:test';
import assert from 'node:assert/strict';
import { createSearchIndex } from './bm25.js';

function chunk(id, text, extra = {}) {
  const index = Number(id.split(':').pop()) || 0;
  return {
    id, docId: 'base-cv', docKind: 'base-cv', docTitle: 'Base CV', section: 'Experience',
    index, version: 'v1', text, tag: `[Doc: Base CV | Chunk: ${index}]`, ...extra
  };
}

test('ranks the overlapping passage and returns no match for unrelated terms', () => {
  const index = createSearchIndex([
    chunk('a:0', 'Kone has ten years of software engineering experience.'),
    chunk('b:0', 'Weekend hiking in the Drakensberg mountains.')
  ]);
  const results = index.search('years of experience');
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'a:0');
  assert.ok(results[0].score > 0);
  assert.deepEqual(index.search('zzzx qqqw'), []);
});

test('ties break by chunk id and topK is respected', () => {
  const index = createSearchIndex([
    chunk('b:0', 'React and Node experience.'),
    chunk('a:0', 'React and Node experience.')
  ]);
  const results = index.search('react node', { topK: 1 });
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'a:0');
});

test('the character cap stops adding passages but keeps the first', () => {
  const index = createSearchIndex([
    chunk('a:0', 'React and Node experience with payments.'),
    chunk('b:0', 'React and Node experience with banking.')
  ]);
  const results = index.search('react node', { maxChars: 10 });
  assert.equal(results.length, 1);
});
