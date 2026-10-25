// Model registry: the ONLY file in the repo that may contain model ID literals
// (plus *.test.js). Other packages name models via MODEL_IDS / resolveModel.
//
// Prices verified 2026-10-24 against
// https://platform.claude.com/docs/en/about-claude/pricing.md ($/MTok):
//   Fable 5.1  in 10    out 50   cache-write(5m) 12.50  cache-hit 0.25
//   Opus 5.5   in 4     out 20   cache-write(5m) 5      cache-hit 0.20
//   Sonnet 5.5 in 2     out 10   cache-write(5m) 2.50   cache-hit 0.10  (0.05x input)
//   Haiku 5.5  in 0.10  out 0.50 cache-write(5m) 0.125  cache-hit 0.01
//   Web search: $10 per 1,000 searches.
// Differs from the plan's assumption: Sonnet cache-read is 0.10, not 0.20.
// Haiku 5.5 charges higher rates (in 0.50 / out 2.50) for prompts over 100k
// tokens; the estimator uses the standard (<=100k) rate.

export const MODEL_IDS = Object.freeze({
  haiku: 'claude-haiku-5-5',
  sonnet: 'claude-sonnet-5-5',
  opus: 'claude-opus-5-5',
  fable: 'claude-fable-5-1'
});

/**
 * Capability flags decided by the live smoke probes (scripts/smoke-live.mjs).
 * Defaults are the documented behaviour; flip a flag to false if its probe fails.
 *   searchStructuredOutput: Sonnet + web_search + json_schema output works together.
 *   haikuWebSearch: Haiku supports the web_search tool (the Token Saver search model).
 */
export const CAPABILITIES = Object.freeze({ searchStructuredOutput: true, haikuWebSearch: true });

export const DEFAULT_MODEL_ID = MODEL_IDS.sonnet;

export const MODELS = Object.freeze({
  [MODEL_IDS.haiku]:  { id: MODEL_IDS.haiku,  label: 'Claude Haiku 5.5',  tier: 0, inputPerMTok: 0.1, outputPerMTok: 0.5, cacheReadPerMTok: 0.01 },
  [MODEL_IDS.sonnet]: { id: MODEL_IDS.sonnet, label: 'Claude Sonnet 5.5', tier: 1, inputPerMTok: 2,   outputPerMTok: 10,  cacheReadPerMTok: 0.1 },
  [MODEL_IDS.opus]:   { id: MODEL_IDS.opus,   label: 'Claude Opus 5.5',   tier: 2, inputPerMTok: 4,   outputPerMTok: 20,  cacheReadPerMTok: 0.2 },
  [MODEL_IDS.fable]:  { id: MODEL_IDS.fable,  label: 'Claude Fable 5.1',  tier: 3, inputPerMTok: 10,  outputPerMTok: 50,  cacheReadPerMTok: 0.25, optIn: true }
});

export function modelSpec(id) {
  return typeof id === 'string' && Object.hasOwn(MODELS, id) ? MODELS[id] : null;
}

const S = MODEL_IDS.sonnet;
export const TASKS = Object.freeze({
  'ai-search':       { model: S, effort: 'medium', maxTokens: 16000 },
  'link-repair':     { model: S, effort: 'low',    maxTokens: 4000 },
  'research':        { model: S, effort: 'low',    maxTokens: 6000 },
  'referral-search': { model: S, effort: 'low',    maxTokens: 6000 },
  'referral':        { model: S, effort: 'low',    maxTokens: 3000 },
  'tailor':          { model: S, effort: 'medium', maxTokens: 16000 },
  'smart-fill':      { model: S, effort: 'low',    maxTokens: 8000 },
  'planner':         { model: MODEL_IDS.haiku, effort: 'low', maxTokens: 2000 },
  'vision':          { model: S, effort: 'low',    maxTokens: 2000 },
  'memory':          { model: S, effort: 'low',    maxTokens: 6000 },
  'computer-use':    { model: S, effort: 'medium', maxTokens: 4096 },
  'core':            { model: S, effort: 'medium', maxTokens: 8000 }
});

export function taskConfig(task) {
  return Object.hasOwn(TASKS, task) ? TASKS[task] : TASKS.core;
}

const SEARCH_TASKS = new Set(['ai-search', 'link-repair', 'research', 'referral-search']);

/** Model for a task: a profile override applies only if it is an exact registry ID. */
export function resolveModel(profile, task) {
  const p = profile || {};
  const override = SEARCH_TASKS.has(task) ? p.aiSearchModel
    : task === 'computer-use' ? p.computerUseModel
    : p.selectedModel;
  return modelSpec(override) ? override : taskConfig(task).model;
}
