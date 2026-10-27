// callClaude: the one place the suite talks to Anthropic.
//
// Rules (see docs/plan): never send sampling params, prefill, forced tool_choice,
// disabled thinking or budget_tokens; omit `thinking` (adaptive by default) and
// steer depth with output_config.effort. Always stream (long outputs/timeouts),
// read text only from `text` blocks (thinking blocks may come first), and
// continue `pause_turn` server-tool turns up to maxContinuations.
//
// NOTE: pause_turn continuation requests deliberately END on the assistant's
// paused turn. That is the API's documented continuation form, NOT prefill, and
// must not be "fixed" into a user-last request. Only the initial request is
// guaranteed user-last (enforced in buildMessages).
import Anthropic from '@anthropic-ai/sdk';
import { taskConfig, MODEL_IDS } from './models.js';
import { fromAnthropicUsage } from './costs.js';
import { isAnthropicKeyShape, isAdminKeyShape, normalizeKeyInput, scrubSecrets } from './secrets.js';
import {
  ClaudeAuthError, ClaudePermissionError, ClaudeRefusalError, ClaudeKeyError, isSpendCapError
} from './errors.js';

export const REFUSAL_FALLBACK_DEFAULT = true;
const FALLBACK_BETAS = ['server-side-fallback-2026-07-01'];
const DEFAULT_MAX_CONTINUATIONS = 12;
const DEFAULT_MAX_RETRIES = 2;
const MAX_RETRY_DELAY_MS = 60_000;

// Pinned: the SDK would otherwise honour ANTHROPIC_BASE_URL, and Electron hands
// the server the full process.env, so an environment variable (or a gateway URL
// configured for another tool) could redirect the user's key to another host.
export const ANTHROPIC_BASE_URL = 'https://api.anthropic.com';

// Retries belong to callClaude: the SDK retries every 429, including a spend
// cap, which is permanent. maxRetries: 0 keeps the SDK out of the decision.
export function makeClient({ apiKey, timeout, allowBrowser = false } = {}) {
  return new Anthropic({
    apiKey,
    baseURL: ANTHROPIC_BASE_URL,
    maxRetries: 0,
    ...(allowBrowser ? { dangerouslyAllowBrowser: true } : {}),
    ...(timeout ? { timeout } : {})
  });
}

function checkedKey(raw) {
  const key = normalizeKeyInput(raw);
  if (!key) throw new ClaudeKeyError('No Anthropic API key is set. Add one in Settings.');
  if (isAdminKeyShape(key)) {
    throw new ClaudeKeyError('That is an Anthropic Admin key. Create a standard API key (sk-ant-api...) in the Console and use that instead.');
  }
  if (!isAnthropicKeyShape(key)) {
    throw new ClaudeKeyError('That does not look like an Anthropic API key (it should start with sk-ant-api). Check it in Settings.');
  }
  return key;
}

function sniffMediaType(data) {
  if (data.startsWith('/9j/')) return 'image/jpeg';
  if (data.startsWith('R0lGOD')) return 'image/gif';
  if (data.startsWith('UklGR')) return 'image/webp';
  return 'image/png';
}

function buildSystem(system, cacheSystem) {
  if (system == null || system === '') return undefined;
  if (Array.isArray(system)) return system; // caller owns cache_control placement
  const block = { type: 'text', text: String(system) };
  if (cacheSystem) block.cache_control = { type: 'ephemeral' };
  return cacheSystem ? [block] : String(system);
}

function buildMessages(req) {
  const messages = [...(req.messages || [])];
  const hasImages = Array.isArray(req.images) && req.images.length > 0;
  if (req.prompt != null || hasImages) {
    const content = [];
    for (const img of req.images || []) {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: img.mediaType || sniffMediaType(img.data), data: img.data }
      });
    }
    if (Array.isArray(req.prompt)) content.push(...req.prompt);
    else if (req.prompt != null) content.push({ type: 'text', text: String(req.prompt) });
    // Plain string stays a plain string (smaller, equivalent) when there are no images.
    messages.push({ role: 'user', content: hasImages || Array.isArray(req.prompt) ? content : String(req.prompt) });
  }
  if (!messages.length) throw new Error('callClaude needs a prompt or messages');
  if (messages.at(-1).role !== 'user') throw new Error('callClaude: the last message must be a user turn (assistant prefill is not supported)');
  return messages;
}

const ZERO = {
  inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
  cacheWriteTokens: 0, cacheWrite1hTokens: 0, webSearches: 0
};
function addUsage(total, u) {
  for (const k of Object.keys(ZERO)) total[k] += u[k] || 0;
  return total;
}

function textOf(content) {
  return (content || []).filter((b) => b && b.type === 'text').map((b) => b.text ?? '').join('');
}

function wrapSdkError(err) {
  const status = err && err.status;
  if (status === 401) return new ClaudeAuthError(undefined, status);
  if (status === 403) return new ClaudePermissionError(undefined, status);
  if (err && typeof err.message === 'string') {
    const clean = scrubSecrets(err.message);
    if (clean !== err.message) {
      try { err.message = clean; } catch { /* read-only message: leave as is */ }
    }
  }
  return err;
}

function headerValue(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key == null ? null : headers[key];
}

/** Milliseconds from retry-after / retry-after-ms, or null when absent. */
export function retryAfterMsOf(err) {
  const headers = err?.headers;
  const ms = Number(headerValue(headers, 'retry-after-ms'));
  if (Number.isFinite(ms) && ms > 0) return ms;
  const raw = headerValue(headers, 'retry-after');
  if (raw == null) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return seconds > 0 ? seconds * 1000 : null;
  const at = Date.parse(raw);
  return Number.isFinite(at) && at > Date.now() ? at - Date.now() : null;
}

/**
 * Whether to retry a failed request. A spend cap is permanent. A 429 is retried
 * only when it carries retry-after, which is how rate limits differ from caps.
 */
export function shouldRetryError(err, retriesLeft) {
  if (!err || retriesLeft <= 0 || isSpendCapError(err)) return false;
  const status = err.status;
  if (status === 408 || status === 409 || status === 529) return true;
  if (typeof status === 'number' && status >= 500) return true;
  if (status === 429) return retryAfterMsOf(err) != null;
  return false;
}

export function retryDelayMsOf(err, retryNumber) {
  const asked = retryAfterMsOf(err);
  if (asked != null) return Math.min(asked, MAX_RETRY_DELAY_MS);
  return Math.min(500 * 2 ** Math.max(0, retryNumber - 1), 8000);
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- Self-degrading ---------------------------------------------------------------------------
// Three optional API features were never verified against the live API (the smoke test
// needs a real key): the refusal-fallback beta, JSON-schema output together with server
// tools, and web search on Haiku. If the API rejects one with a 400, retry the request
// once without it. The lesson is process-wide and only recorded when the retry SUCCEEDS,
// so a bad request of any other kind can never switch a feature off.
const STEP_FALLBACK = 'refusal-fallback';
const STEP_SCHEMA = 'schema-with-tools';
const STEP_HAIKU = 'haiku-search';
const LEARNED_KEY = { [STEP_FALLBACK]: 'refusalFallback', [STEP_SCHEMA]: 'schemaWithTools', [STEP_HAIKU]: 'haikuSearch' };

const learned = { refusalFallback: true, schemaWithTools: true, haikuSearch: true }; // true = still allowed

/** What the process has learned the API will not accept (true = still allowed). */
export function getLearnedCapabilities() {
  return { ...learned };
}

/** Tests only: forget everything learned. */
export function resetLearnedCapabilities() {
  learned.refusalFallback = true;
  learned.schemaWithTools = true;
  learned.haikuSearch = true;
  announced.clear();
}

// Lessons already announced by an up-front application (one notice per process per lesson).
const announced = new Set();

// First ~120 chars of an error message, secrets scrubbed BEFORE cutting (a key cut in half
// would no longer match the key pattern), whitespace collapsed.
function excerptOf(message) {
  return scrubSecrets(String(message ?? '')).replace(/\s+/g, ' ').trim().slice(0, 120);
}

const isWebSearchTool = (t) => Boolean(t) && typeof t.type === 'string' && t.type.startsWith('web_search');

/**
 * Pure. Which degrade step (if any) does this error call for?
 * `request` describes what was actually sent: { beta, hasTools, hasFormat, hasWebSearch, model }.
 * Only an HTTP 400 qualifies, and only for a feature the request really used.
 */
export function degradeStepFor(err, request) {
  if (!err || err.status !== 400 || !request) return null;
  const msg = typeof err.message === 'string' ? err.message.toLowerCase() : '';
  if (!msg) return null;
  const has = (...needles) => needles.some((n) => msg.includes(n));
  if (request.beta && has('fallback', 'server-side-fallback', 'betas')) return STEP_FALLBACK;
  // The schema and Haiku steps only make sense on the first request of a call: a search that
  // already succeeded earlier in this call followed by a continuation 400 teaches nothing true.
  const first = (request.attempt ?? 0) === 0;
  if (first && request.hasTools && request.hasFormat && has('output_config', 'format', 'json_schema', 'structured')) return STEP_SCHEMA;
  if (first && request.hasWebSearch && request.model === MODEL_IDS.haiku && has('web_search', 'tool')) return STEP_HAIKU;
  return null;
}

/**
 * When both `messages` and `prompt` (and/or `images`) are given, the prompt is
 * appended as a NEW user turn after `messages`, so a caller can continue a prior
 * ClaudeResult.messages conversation.
 *
 * @param {object} req  { apiKey, task, model?, system?, cacheSystem?, prompt?, messages?, images?, schema?,
 *                        tools?, maxTokens?, effort?, maxContinuations?, maxRetries?, refusalFallback? }
 * @param {object} hooks { client?, beforeCall?, onUsage?, onLog?, sleep?, retryDelayMs? }
 */
export async function callClaude(req, hooks = {}) {
  const apiKey = checkedKey(req.apiKey);
  const task = req.task || 'core';
  const cfg = taskConfig(task);
  const model = req.model || cfg.model;
  const effort = req.effort || cfg.effort;
  const maxTokens = Math.max(req.maxTokens || 0, cfg.maxTokens);
  const maxContinuations = req.maxContinuations ?? DEFAULT_MAX_CONTINUATIONS;
  const maxRetries = Math.max(0, req.maxRetries ?? DEFAULT_MAX_RETRIES);
  const log = (msg, type) => { if (hooks.onLog) hooks.onLog(scrubSecrets(msg), type); };

  const messages = buildMessages(req);
  const system = buildSystem(req.system, req.cacheSystem);
  const tools = req.tools && req.tools.length ? req.tools : undefined;
  const format = req.schema ? { type: 'json_schema', schema: req.schema } : undefined;
  const hasWebSearch = Boolean(tools && tools.some(isWebSearchTool));

  // The request variant: starts from what the process has already learned the API accepts,
  // and is narrowed further (for the rest of this call) when a retry succeeds without a feature.
  const variant = {
    useFallback: (req.refusalFallback ?? REFUSAL_FALLBACK_DEFAULT) && learned.refusalFallback,
    dropFormat: Boolean(format && tools && !learned.schemaWithTools),
    model: hasWebSearch && model === MODEL_IDS.haiku && !learned.haikuSearch ? MODEL_IDS.sonnet : model
  };
  // Make a silent swap visible once per process per lesson (the Haiku->Sonnet swap is ~20x the price).
  const upFront = [];
  if ((req.refusalFallback ?? REFUSAL_FALLBACK_DEFAULT) && !learned.refusalFallback) upFront.push(STEP_FALLBACK);
  if (variant.dropFormat) upFront.push(STEP_SCHEMA);
  if (variant.model !== model) upFront.push(STEP_HAIKU);
  for (const step of upFront) {
    if (announced.has(step)) continue;
    announced.add(step);
    log(`${task}: ${step} was rejected earlier; running without it`, 'system');
  }
  const tried = new Set();   // degrade steps already applied in this call (each at most once)
  const pending = [];        // applied but not yet confirmed by a successful response
  const degraded = [];       // confirmed this call (not those learned earlier)

  const client = hooks.client || makeClient({ apiKey });
  const total = { ...ZERO };
  const requestIds = [];
  let response;

  for (let attempt = 0; ; attempt++) {
    // A degraded or transient retry is a fresh request on the SAME attempt index;
    // beforeCall (the budget guard) runs again before it, so a retry can never
    // bypass the budget.
    let retries = 0;
    for (;;) {
      const ctx = { task, model: variant.model, attempt };
      if (hooks.beforeCall) await hooks.beforeCall(ctx);

      // Per-request snapshot: the array handed to the client is never mutated later.
      const params = {
        model: variant.model,
        max_tokens: maxTokens,
        output_config: { effort, ...(format && !variant.dropFormat ? { format } : {}) },
        ...(system !== undefined ? { system } : {}),
        ...(tools ? { tools } : {}),
        messages: [...messages]
      };
      try {
        const stream = variant.useFallback
          ? client.beta.messages.stream({ ...params, betas: FALLBACK_BETAS, fallbacks: 'default' })
          : client.messages.stream(params);
        response = await stream.finalMessage();
      } catch (err) {
        const step = degradeStepFor(err, {
          beta: variant.useFallback,
          hasTools: Boolean(tools),
          hasFormat: Boolean(format && !variant.dropFormat),
          hasWebSearch,
          model: variant.model,
          attempt
        });
        if (step && !tried.has(step)) {
          tried.add(step);
          pending.push(step);
          if (step === STEP_FALLBACK) variant.useFallback = false;
          else if (step === STEP_SCHEMA) variant.dropFormat = true;
          else variant.model = MODEL_IDS.sonnet;
          log(`${task}: ${step} not accepted by the API (${excerptOf(err.message)}); retried without it`, 'system');
          continue;
        }
        if (shouldRetryError(err, maxRetries - retries)) {
          retries += 1;
          const delay = hooks.retryDelayMs ?? retryDelayMsOf(err, retries);
          log(`${task}: ${err.status || 'request'} failed; retrying (${retries}/${maxRetries}) in ${Math.round(delay)}ms`, 'system');
          await (hooks.sleep || defaultSleep)(delay);
          continue;
        }
        throw wrapSdkError(err);
      }
      break;
    }

    // The retried request came back: the API accepts the degraded shape, so remember it.
    for (const step of pending.splice(0)) {
      learned[LEARNED_KEY[step]] = false;
      degraded.push(step);
    }
    const ctx = { task, model: variant.model, attempt };

    const usage = fromAnthropicUsage(response.model || variant.model, response.usage);
    addUsage(total, usage);
    if (response._request_id) requestIds.push(response._request_id);
    if (hooks.onUsage) hooks.onUsage(usage, ctx);

    if (response.stop_reason === 'pause_turn' && attempt < maxContinuations) {
      log(`${task}: continuing paused turn (${attempt + 1}/${maxContinuations})`, 'system');
      messages.push({ role: 'assistant', content: response.content });
      continue;
    }
    break;
  }

  if (response.stop_reason === 'refusal') {
    throw new ClaudeRefusalError(
      response.stop_details?.explanation || 'Claude declined this request.',
      response.stop_details
    );
  }
  const truncated = response.stop_reason === 'max_tokens'
    || response.stop_reason === 'model_context_window_exceeded';
  if (truncated) {
    const why = response.stop_reason === 'model_context_window_exceeded'
      ? 'the context window'
      : `max_tokens (${maxTokens})`;
    log(`${task}: output hit ${why}; returning partial text`, 'error');
  }

  return {
    text: textOf(response.content),
    content: response.content,
    stopReason: response.stop_reason,
    truncated,
    usage: { model: response.model || variant.model, ...total },
    model: response.model || variant.model,
    messages: [...messages, { role: 'assistant', content: response.content }],
    requestIds,
    degraded
  };
}
