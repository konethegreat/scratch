import test from 'node:test';
import assert from 'node:assert/strict';
import { CHARS_PER_TOKEN, MAX_INPUT_TOKENS, estimateTokens, inputBudget } from './inputBudget.js';

test('estimates tokens pessimistically at three characters per token', () => {
  assert.equal(CHARS_PER_TOKEN, 3);
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens('abc'), 1);
  assert.equal(estimateTokens('abcd'), 2);
  assert.equal(estimateTokens(null), 0);
  assert.equal(estimateTokens(undefined), 0);
});

test('a normal CV and job prompt fits the budget', () => {
  const budget = inputBudget(['x'.repeat(30_000), 'y'.repeat(6_000)]);
  assert.equal(budget.estimatedTokens, 12_000);
  assert.equal(budget.maxTokens, MAX_INPUT_TOKENS);
  assert.equal(budget.maxChars, MAX_INPUT_TOKENS * CHARS_PER_TOKEN);
  assert.equal(budget.overBudget, false);
});

test('an oversized CV is over budget and reports the character ceiling', () => {
  const budget = inputBudget(['x'.repeat(MAX_INPUT_TOKENS * CHARS_PER_TOKEN + 1)]);
  assert.equal(budget.overBudget, true);
  assert.equal(budget.estimatedTokens, MAX_INPUT_TOKENS + 1);
});

test('exactly at the token limit is not over budget', () => {
  const budget = inputBudget(['x'.repeat(MAX_INPUT_TOKENS * CHARS_PER_TOKEN)]);
  assert.equal(budget.estimatedTokens, MAX_INPUT_TOKENS);
  assert.equal(budget.overBudget, false);
});

test('missing parts add nothing', () => {
  assert.deepEqual(inputBudget([null, undefined, '']).estimatedTokens, 0);
  assert.deepEqual(inputBudget(undefined).estimatedTokens, 0);
});
