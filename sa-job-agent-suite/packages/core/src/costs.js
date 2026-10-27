// AI cost estimation (pure). ESTIMATES for budgeting; the provider invoice is
// the source of truth. Prices live in models.js.
import { MODELS, MODEL_IDS, modelSpec } from './models.js';

const CACHE_WRITE_5M_MULT = 1.25; // 5-minute cache write
const CACHE_WRITE_1H_MULT = 2;    // 1-hour cache write
export const COST_PER_WEB_SEARCH_USD = 0.01; // $10 per 1,000 searches
const FAMILIES = ['haiku', 'sonnet', 'opus', 'fable'];

const num = (v) => (Number.isFinite(v) && v > 0 ? v : 0);

/**
 * $/MTok for a model id: exact registry match, then family substring, else
 * Sonnet. Haiku 5.5 switches to its long-context rates above 100k prompt tokens.
 */
export function priceFor(model, promptTokens = 0) {
  let spec = modelSpec(model);
  if (!spec) {
    const m = String(model || '').toLowerCase();
    const fam = FAMILIES.find((f) => m.includes(f));
    spec = MODELS[MODEL_IDS[fam || 'sonnet']];
  }
  const long = spec.longContext && num(promptTokens) > spec.longContext.thresholdTokens
    ? spec.longContext
    : null;
  return {
    input: long ? long.inputPerMTok : spec.inputPerMTok,
    output: long ? long.outputPerMTok : spec.outputPerMTok,
    cacheRead: long ? long.cacheReadPerMTok : spec.cacheReadPerMTok
  };
}

/** Estimated USD cost of one call (float, unrounded). */
export function estimateCostUSD(u = {}) {
  const write1h = Math.min(num(u.cacheWrite1hTokens), num(u.cacheWriteTokens));
  const write5m = Math.max(0, num(u.cacheWriteTokens) - write1h);
  const promptTokens = num(u.inputTokens) + num(u.cacheReadTokens) + num(u.cacheWriteTokens);
  const p = priceFor(u.model, promptTokens);
  const M = 1_000_000;
  return (
    (num(u.inputTokens) / M) * p.input +
    (num(u.outputTokens) / M) * p.output +
    (num(u.cacheReadTokens) / M) * p.cacheRead +
    (write5m / M) * p.input * CACHE_WRITE_5M_MULT +
    (write1h / M) * p.input * CACHE_WRITE_1H_MULT +
    num(u.webSearches) * COST_PER_WEB_SEARCH_USD
  );
}

/** Normalises an Anthropic `response.usage` block into our usage shape. */
export function fromAnthropicUsage(model, usage = {}) {
  const u = usage || {};
  const creation = u.cache_creation || {};
  const oneHour = num(creation.ephemeral_1h_input_tokens);
  const fromBreakdown = num(creation.ephemeral_5m_input_tokens) + oneHour;
  const cacheWriteTokens = num(u.cache_creation_input_tokens) || fromBreakdown;
  return {
    model,
    inputTokens: u.input_tokens || 0,
    outputTokens: u.output_tokens || 0,
    cacheReadTokens: u.cache_read_input_tokens || 0,
    cacheWriteTokens,
    cacheWrite1hTokens: Math.min(oneHour, cacheWriteTokens),
    webSearches: (u.server_tool_use && u.server_tool_use.web_search_requests) || 0
  };
}
