// AI cost estimation (pure). ESTIMATES for budgeting; the provider invoice is
// the source of truth. Prices live in models.js.
import { MODELS, MODEL_IDS, modelSpec } from './models.js';

const CACHE_WRITE_MULT = 1.25; // 5-minute cache write
export const COST_PER_WEB_SEARCH_USD = 0.01; // $10 per 1,000 searches
const FAMILIES = ['haiku', 'sonnet', 'opus', 'fable'];

/** $/MTok for a model id: exact registry match, then family substring, else Sonnet. */
export function priceFor(model) {
  let spec = modelSpec(model);
  if (!spec) {
    const m = String(model || '').toLowerCase();
    const fam = FAMILIES.find((f) => m.includes(f));
    spec = MODELS[MODEL_IDS[fam || 'sonnet']];
  }
  return { input: spec.inputPerMTok, output: spec.outputPerMTok, cacheRead: spec.cacheReadPerMTok };
}

const num = (v) => (Number.isFinite(v) && v > 0 ? v : 0);

/** Estimated USD cost of one call (float, unrounded). */
export function estimateCostUSD(u = {}) {
  const p = priceFor(u.model);
  const M = 1_000_000;
  return (
    (num(u.inputTokens) / M) * p.input +
    (num(u.outputTokens) / M) * p.output +
    (num(u.cacheReadTokens) / M) * p.cacheRead +
    (num(u.cacheWriteTokens) / M) * p.input * CACHE_WRITE_MULT +
    num(u.webSearches) * COST_PER_WEB_SEARCH_USD
  );
}

/** Normalises an Anthropic `response.usage` block into our usage shape. */
export function fromAnthropicUsage(model, usage = {}) {
  const u = usage || {};
  return {
    model,
    inputTokens: u.input_tokens || 0,
    outputTokens: u.output_tokens || 0,
    cacheReadTokens: u.cache_read_input_tokens || 0,
    cacheWriteTokens: u.cache_creation_input_tokens || 0,
    webSearches: (u.server_tool_use && u.server_tool_use.web_search_requests) || 0
  };
}
