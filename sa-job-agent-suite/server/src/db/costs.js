// ── AI cost estimation (pure module — no imports, unit-testable) ──────────────
// Converts raw token/search usage into an ESTIMATED USD cost so the user can see
// where their API money goes and set a daily budget cap. Prices are per MILLION
// tokens, sourced from public provider pricing (June 2026) and deliberately easy
// to edit below. These are ESTIMATES for budgeting — the provider's invoice is
// the source of truth.

// Ordered substring rules — first match wins.
const ANTHROPIC_PRICES = [
  // [model substring, input $/MTok, output $/MTok]
  ['claude-3-opus',  15,  75],   // legacy Opus 3
  ['opus-4-1',       15,  75],   // legacy Opus 4.1
  ['opus',            5,  25],   // Opus 4.5 / 4.7 / 4.8
  ['haiku',           1,   5],   // Haiku 3.5 / 4.5
  ['sonnet',          3,  15],   // Sonnet 3.5 / 4 / 4.6
];

const GEMINI_PRICES = [
  ['1.5-flash',   0.075, 0.30],
  ['flash',       0.10,  0.40],
  ['pro',         1.25,  5.00],
];

const OPENROUTER_PRICES = [
  ['deepseek',    0.14,  0.28],
  ['qwen',        0.20,  0.60],
  ['llama',       0.20,  0.60],
];

// Cache pricing (Anthropic): reads ~10% of input price, writes ~125%.
const CACHE_READ_MULT = 0.10;
const CACHE_WRITE_MULT = 1.25;

// Anthropic server-side web_search tool: ~$10 per 1,000 searches.
export const COST_PER_WEB_SEARCH_USD = 0.01;

function pickPrice(table, model, fallback) {
  const m = String(model || '').toLowerCase();
  for (const [needle, inP, outP] of table) {
    if (m.includes(needle)) return { input: inP, output: outP };
  }
  return fallback;
}

/** $/MTok for a provider+model. Always returns something usable. */
export function priceFor(provider, model) {
  if (provider === 'anthropic') return pickPrice(ANTHROPIC_PRICES, model, { input: 3, output: 15 });
  if (provider === 'gemini')    return pickPrice(GEMINI_PRICES, model, { input: 0.10, output: 0.40 });
  if (provider === 'openrouter') return pickPrice(OPENROUTER_PRICES, model, { input: 0.50, output: 1.50 });
  return { input: 1, output: 3 }; // unknown provider — rough
}

/**
 * Estimated USD cost of one call.
 * @param {{provider:string, model:string, inputTokens?:number, outputTokens?:number,
 *          cacheReadTokens?:number, cacheWriteTokens?:number, webSearches?:number}} u
 * @returns {number} USD (float, unrounded)
 */
export function estimateCostUSD(u = {}) {
  const p = priceFor(u.provider, u.model);
  const M = 1_000_000;
  const input  = Math.max(0, u.inputTokens  || 0);
  const output = Math.max(0, u.outputTokens || 0);
  const cRead  = Math.max(0, u.cacheReadTokens  || 0);
  const cWrite = Math.max(0, u.cacheWriteTokens || 0);
  const search = Math.max(0, u.webSearches || 0);
  return (
    (input  / M) * p.input +
    (output / M) * p.output +
    (cRead  / M) * p.input * CACHE_READ_MULT +
    (cWrite / M) * p.input * CACHE_WRITE_MULT +
    search * COST_PER_WEB_SEARCH_USD
  );
}

/**
 * Normalises an Anthropic `response.usage` block (messages API) into our shape,
 * including web-search counts from server_tool_use.
 */
export function fromAnthropicUsage(model, usage = {}) {
  return {
    provider: 'anthropic',
    model,
    inputTokens:      usage.input_tokens || 0,
    outputTokens:     usage.output_tokens || 0,
    cacheReadTokens:  usage.cache_read_input_tokens || 0,
    cacheWriteTokens: usage.cache_creation_input_tokens || 0,
    webSearches:      (usage.server_tool_use && usage.server_tool_use.web_search_requests) || 0
  };
}
