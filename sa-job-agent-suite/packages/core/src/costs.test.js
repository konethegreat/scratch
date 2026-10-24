import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateCostUSD, fromAnthropicUsage, priceFor, COST_PER_WEB_SEARCH_USD } from './costs.js';
import { MODEL_IDS } from './models.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `expected ${b}, got ${a}`);

test('sonnet 1M in + 1M out costs $12', () => {
  close(estimateCostUSD({ model: MODEL_IDS.sonnet, inputTokens: 1e6, outputTokens: 1e6 }), 12);
});

test("cache reads use the model's own rate", () => {
  // Fetched pricing: Sonnet 5.5 cache hit is 0.05x input = $0.10/MTok (plan assumed 0.20).
  close(estimateCostUSD({ model: MODEL_IDS.sonnet, cacheReadTokens: 1e6 }), 0.1);
  close(estimateCostUSD({ model: MODEL_IDS.opus, cacheReadTokens: 1e6 }), 0.2);
  close(estimateCostUSD({ model: MODEL_IDS.fable, cacheReadTokens: 1e6 }), 0.25);
  close(estimateCostUSD({ model: MODEL_IDS.haiku, cacheReadTokens: 1e6 }), 0.01);
});

test('cache writes cost 1.25x input', () => {
  close(estimateCostUSD({ model: MODEL_IDS.sonnet, cacheWriteTokens: 1e6 }), 2.5);
});

test('web searches cost $0.01 each', () => {
  assert.equal(COST_PER_WEB_SEARCH_USD, 0.01);
  close(estimateCostUSD({ model: MODEL_IDS.sonnet, webSearches: 100 }), 1);
});

test('unknown model ids price by family substring, defaulting to sonnet', () => {
  assert.deepEqual(priceFor('claude-haiku-9-9'), priceFor(MODEL_IDS.haiku));
  assert.deepEqual(priceFor('some-opus-thing'), priceFor(MODEL_IDS.opus));
  assert.deepEqual(priceFor('claude-fable-7'), priceFor(MODEL_IDS.fable));
  assert.deepEqual(priceFor('claude-sonnet-4-6'), priceFor(MODEL_IDS.sonnet));
  assert.deepEqual(priceFor('mystery-model'), priceFor(MODEL_IDS.sonnet));
  assert.deepEqual(priceFor(undefined), priceFor(MODEL_IDS.sonnet));
});

test('garbage input never returns NaN', () => {
  assert.equal(estimateCostUSD(), 0);
  assert.equal(estimateCostUSD({}), 0);
  assert.equal(estimateCostUSD({ model: 'x', inputTokens: -5 }), 0);
  assert.equal(Number.isNaN(estimateCostUSD({ model: 'x', inputTokens: 'abc', outputTokens: NaN })), false);
});

test('fromAnthropicUsage maps cache and web-search fields', () => {
  const u = fromAnthropicUsage(MODEL_IDS.sonnet, {
    input_tokens: 100, output_tokens: 50,
    cache_read_input_tokens: 10, cache_creation_input_tokens: 5,
    server_tool_use: { web_search_requests: 3 }
  });
  assert.deepEqual(u, {
    model: MODEL_IDS.sonnet, inputTokens: 100, outputTokens: 50,
    cacheReadTokens: 10, cacheWriteTokens: 5, webSearches: 3
  });
  assert.equal(fromAnthropicUsage('m').inputTokens, 0);
});
