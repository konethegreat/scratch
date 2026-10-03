// Unit tests for the cost estimator, performance presets, search depth and the
// log secret-scrubber — pure logic only (no db writes, no network).
import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateCostUSD, priceFor, fromAnthropicUsage, COST_PER_WEB_SEARCH_USD } from '../db/costs.js';
import { PERFORMANCE_PRESETS, detectActivePreset, scrubSecrets, SEARCH_DEPTHS } from '../db/helper.js';
import { resolveSearchDepth } from './jobSearchAI.js';

test('priceFor matches models by substring with sane fallbacks', () => {
  assert.deepEqual(priceFor('anthropic', 'claude-haiku-4-5'), { input: 1, output: 5 });
  assert.deepEqual(priceFor('anthropic', 'claude-sonnet-4-6'), { input: 3, output: 15 });
  assert.deepEqual(priceFor('anthropic', 'claude-opus-4-8'), { input: 5, output: 25 });
  assert.deepEqual(priceFor('anthropic', 'claude-3-5-sonnet-latest'), { input: 3, output: 15 });
  assert.deepEqual(priceFor('gemini', 'gemini-1.5-flash'), { input: 0.075, output: 0.30 });
  // Unknown models still return something usable.
  assert.ok(priceFor('anthropic', 'mystery-model').input > 0);
  assert.ok(priceFor('openrouter', 'deepseek/deepseek-chat').input > 0);
});

test('estimateCostUSD: tokens, cache and web searches all priced', () => {
  // 1M in + 1M out on Sonnet = $3 + $15.
  const c = estimateCostUSD({ provider: 'anthropic', model: 'claude-sonnet-4-6', inputTokens: 1_000_000, outputTokens: 1_000_000 });
  assert.ok(Math.abs(c - 18) < 1e-9, `expected 18, got ${c}`);
  // Cache reads are ~10% of input price.
  const cr = estimateCostUSD({ provider: 'anthropic', model: 'claude-sonnet-4-6', cacheReadTokens: 1_000_000 });
  assert.ok(Math.abs(cr - 0.3) < 1e-9);
  // 100 searches at $10/1000 = $1.
  const s = estimateCostUSD({ provider: 'anthropic', model: 'claude-sonnet-4-6', webSearches: 100 });
  assert.ok(Math.abs(s - 100 * COST_PER_WEB_SEARCH_USD) < 1e-9);
  // Garbage in → 0, never NaN.
  assert.equal(estimateCostUSD({}), 0);
  assert.equal(Number.isNaN(estimateCostUSD({ provider: 'x', inputTokens: -5 })), false);
});

test('fromAnthropicUsage maps the messages-API usage block incl. web searches', () => {
  const u = fromAnthropicUsage('claude-sonnet-4-6', {
    input_tokens: 100, output_tokens: 50,
    cache_read_input_tokens: 10, cache_creation_input_tokens: 5,
    server_tool_use: { web_search_requests: 3 }
  });
  assert.equal(u.inputTokens, 100);
  assert.equal(u.outputTokens, 50);
  assert.equal(u.cacheReadTokens, 10);
  assert.equal(u.cacheWriteTokens, 5);
  assert.equal(u.webSearches, 3);
  assert.equal(u.provider, 'anthropic');
});

test('performance presets are coherent and detectable', () => {
  for (const [mode, preset] of Object.entries(PERFORMANCE_PRESETS)) {
    // Every preset sets a valid depth and a clamped concurrency.
    assert.ok(SEARCH_DEPTHS.includes(preset.values.searchDepth), `${mode} depth`);
    assert.ok(preset.values.tailorConcurrency >= 1 && preset.values.tailorConcurrency <= 5, `${mode} concurrency`);
    // Safety: no preset may ever enable an auto-submit (no such field exists,
    // but guard against one sneaking into the bundle by name).
    assert.ok(!('autoSubmit' in preset.values) && !('useAutoApply' in preset.values), `${mode} must not auto-apply`);
    // A profile built from the preset's own values is detected as that preset.
    assert.equal(detectActivePreset({ ...preset.values }), mode, `${mode} should self-detect`);
  }
  // Any tweak away from a bundle reads as custom.
  assert.equal(detectActivePreset({ ...PERFORMANCE_PRESETS.saver.values, useVision: true }), 'custom');
});

test('saver is strictly cheaper-or-equal than max on every cost lever', () => {
  const s = PERFORMANCE_PRESETS.saver.values;
  const m = PERFORMANCE_PRESETS.max.values;
  const COST_FLAGS = ['useLinkRepair', 'useVision', 'useComputerUse', 'useResearchFanout', 'useMemoryReflection', 'useDreaming'];
  for (const f of COST_FLAGS) assert.ok(Number(s[f]) <= Number(m[f]), `${f}: saver must not exceed max`);
  assert.ok(s.tailorConcurrency <= m.tailorConcurrency);
  assert.ok(s.maxKeywords <= m.maxKeywords);
});

test('resolveSearchDepth falls back to standard on junk', () => {
  assert.equal(resolveSearchDepth({ searchDepth: 'deep' }), 'deep');
  assert.equal(resolveSearchDepth({ searchDepth: 'light' }), 'light');
  assert.equal(resolveSearchDepth({ searchDepth: 'turbo' }), 'standard');
  assert.equal(resolveSearchDepth({}), 'standard');
});

test('scrubSecrets redacts provider API keys from log lines', () => {
  // Fake keys are assembled at runtime so the repository never contains a
  // key-shaped literal (the key-commit guard and GitHub push protection flag those).
  const anthropic = 'sk-' + 'ant-api03-AbCdEfGh1234567890xyz';
  const google = 'AIza' + 'SyA1234567890abcdefghijklm';
  const openrouter = 'sk-' + 'or-v1-9876543210abcdef';
  const out = scrubSecrets(`Error: bad key ${anthropic} used with ${google} and ${openrouter}`);
  for (const key of [anthropic, google, openrouter]) {
    assert.ok(!out.includes(key), 'a full key leaked');
    assert.ok(!out.includes(key.slice(0, 14)), 'a key prefix leaked');
  }
  assert.ok(out.includes('•••redacted-key•••'));
  // Normal text passes through untouched.
  assert.equal(scrubSecrets('Saved 12 jobs from PNet'), 'Saved 12 jobs from PNet');
});
