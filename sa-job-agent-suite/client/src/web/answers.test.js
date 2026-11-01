import test from 'node:test';
import assert from 'node:assert/strict';
import { withAnswerDefaults } from './answers.js';

test('a legacy answer gains v2 defaults without losing its own fields', () => {
  const answer = { id: 'q1', question: 'Notice period?', answer: 'One month', normalized: 'notice period' };
  assert.deepEqual(withAnswerDefaults(answer), {
    id: 'q1',
    question: 'Notice period?',
    answer: 'One month',
    normalized: 'notice period',
    category: 'other',
    source: 'manual',
    timesUsed: 0,
    lastUsed: null,
    createdAt: ''
  });
});

test('a stored v2 value wins over the default', () => {
  const answer = { id: 'q1', question: 'Q', answer: 'A', category: 'strength', source: 'edit', timesUsed: 3, lastUsed: '2026-10-01T00:00:00.000Z', createdAt: '2026-09-01T00:00:00.000Z' };
  assert.equal(withAnswerDefaults(answer).category, 'strength');
  assert.equal(withAnswerDefaults(answer).timesUsed, 3);
  assert.equal(withAnswerDefaults(answer).source, 'edit');
});
