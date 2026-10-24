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
import { taskConfig } from './models.js';
import { fromAnthropicUsage } from './costs.js';
import { isAnthropicKeyShape, isAdminKeyShape, normalizeKeyInput, scrubSecrets } from './secrets.js';
import { ClaudeAuthError, ClaudeRefusalError, ClaudeKeyError } from './errors.js';

export const REFUSAL_FALLBACK_DEFAULT = true;
const FALLBACK_BETAS = ['server-side-fallback-2026-07-01'];
const DEFAULT_MAX_CONTINUATIONS = 12;

export function makeClient({ apiKey, maxRetries = 6, timeout } = {}) {
  return new Anthropic({ apiKey, maxRetries, ...(timeout ? { timeout } : {}) });
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

const ZERO = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 0 };
function addUsage(total, u) {
  for (const k of Object.keys(ZERO)) total[k] += u[k] || 0;
  return total;
}

function textOf(content) {
  return (content || []).filter((b) => b && b.type === 'text').map((b) => b.text ?? '').join('');
}

function wrapSdkError(err) {
  const status = err && err.status;
  if (status === 401 || status === 403) return new ClaudeAuthError(undefined, status);
  if (err && typeof err.message === 'string') {
    const clean = scrubSecrets(err.message);
    if (clean !== err.message) {
      try { err.message = clean; } catch { /* read-only message: leave as is */ }
    }
  }
  return err;
}

/**
 * When both `messages` and `prompt` (and/or `images`) are given, the prompt is
 * appended as a NEW user turn after `messages`, so a caller can continue a prior
 * ClaudeResult.messages conversation.
 *
 * @param {object} req  { apiKey, task, model?, system?, cacheSystem?, prompt?, messages?, images?, schema?,
 *                        tools?, maxTokens?, effort?, maxContinuations?, refusalFallback? }
 * @param {object} hooks { client?, beforeCall?, onUsage?, onLog? }
 */
export async function callClaude(req, hooks = {}) {
  const apiKey = checkedKey(req.apiKey);
  const task = req.task || 'core';
  const cfg = taskConfig(task);
  const model = req.model || cfg.model;
  const effort = req.effort || cfg.effort;
  const maxTokens = Math.max(req.maxTokens || 0, cfg.maxTokens);
  const maxContinuations = req.maxContinuations ?? DEFAULT_MAX_CONTINUATIONS;
  const useFallback = req.refusalFallback ?? REFUSAL_FALLBACK_DEFAULT;
  const log = (msg, type) => { if (hooks.onLog) hooks.onLog(scrubSecrets(msg), type); };

  const messages = buildMessages(req);
  const system = buildSystem(req.system, req.cacheSystem);
  const base = {
    model,
    max_tokens: maxTokens,
    output_config: { effort, ...(req.schema ? { format: { type: 'json_schema', schema: req.schema } } : {}) },
    ...(system !== undefined ? { system } : {}),
    ...(req.tools && req.tools.length ? { tools: req.tools } : {})
  };

  const client = hooks.client || makeClient({ apiKey });
  const total = { ...ZERO };
  const requestIds = [];
  let response;

  for (let attempt = 0; ; attempt++) {
    const ctx = { task, model, attempt };
    if (hooks.beforeCall) await hooks.beforeCall(ctx);

    // Per-request snapshot: the array handed to the client is never mutated later.
    const params = { ...base, messages: [...messages] };
    try {
      const stream = useFallback
        ? client.beta.messages.stream({ ...params, betas: FALLBACK_BETAS, fallbacks: 'default' })
        : client.messages.stream(params);
      response = await stream.finalMessage();
    } catch (err) {
      throw wrapSdkError(err);
    }

    const usage = fromAnthropicUsage(response.model || model, response.usage);
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
  const truncated = response.stop_reason === 'max_tokens';
  if (truncated) log(`${task}: output hit max_tokens (${maxTokens}); returning partial text`, 'error');

  return {
    text: textOf(response.content),
    content: response.content,
    stopReason: response.stop_reason,
    truncated,
    usage: { model: response.model || model, ...total },
    model: response.model || model,
    messages: [...messages, { role: 'assistant', content: response.content }],
    requestIds
  };
}
