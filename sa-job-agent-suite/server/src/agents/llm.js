import { callClaude, resolveModel, extractJson, isAnthropicKeyShape, normalizeKeyInput } from '@sajas/core';
import { addLog, addUsage, budgetStatus, budgetMessage } from '../db/helper.js';
import { demoOrigin } from '../demo.js';

/**
 * Thin server adapter over @sajas/core's callClaude: the single place the
 * server talks to Anthropic. Everything provider-specific (streaming, caching
 * blocks, structured outputs, pause_turn continuation, refusal fallback) lives
 * in core; this file only wires in the server's concerns:
 *
 *  - the synthetic-demo gate (no AI calls while SAJAS_DEMO_ORIGIN is set),
 *  - the daily budget guard (BUDGET_EXCEEDED, re-checked before EVERY request,
 *    so it also stops a pause_turn continuation mid-conversation),
 *  - the usage ledger (every response, bucketed by task),
 *  - profile toggles (useStructuredOutputs / usePromptCaching) and the
 *    per-task model override (resolveModel).
 *
 * `profile` is the merged profile object from getProfile() (includes keys).
 * `bucket` on the simple helpers is the core task key (tailor, smart-fill,
 * planner, vision, memory, referral, core, ...).
 */

export const MISSING_KEY_MESSAGE = 'Anthropic API key is missing. Add it in Settings.';

export { extractJson };

/**
 * True when the profile holds a key-shaped Anthropic API key (after the same
 * normalisation saveProfile applies). A stored non-key string or a placeholder
 * like "your_key_here" fails here, up front, instead of passing the gate and
 * throwing inside callClaude after the caller has already done work.
 */
export function hasAnthropicKey(profile) {
  const key = profile?.anthropicApiKey;
  if (typeof key !== 'string') return false;
  return isAnthropicKeyShape(normalizeKeyInput(key));
}

/** Throws a user-facing error when there is no usable Anthropic key. */
export function assertAnthropicKey(profile) {
  if (!hasAnthropicKey(profile)) throw new Error(MISSING_KEY_MESSAGE);
}

let testClient = null;
/** Tests only: inject a fake Anthropic client (or null to clear it). */
export function setClaudeClientForTests(client) {
  testClient = client || null;
}

function assertNotDemo() {
  if (demoOrigin()) throw new Error('AI calls are disabled in the synthetic demo. Answer missing questions yourself.');
}

function assertBudget() {
  const b = budgetStatus();
  if (b.exceeded) {
    const msg = budgetMessage(b);
    addLog(`[Budget] ${msg}`, 'error');
    const err = new Error(msg);
    err.code = 'BUDGET_EXCEEDED';
    throw err;
  }
}

/**
 * Full-fidelity call: returns core's ClaudeResult (text, content, stopReason,
 * usage, messages, ...). Used directly by features that need tools or the
 * conversation (AI search); callLlm wraps it for the plain-text callers.
 */
export async function callLlmFull(profile, {
  task = 'core', prompt, messages, images, system, cacheSystem = false, schema = null,
  tools, maxTokens, effort, maxContinuations
} = {}) {
  assertNotDemo();           // before the key check: the demo has no key
  assertAnthropicKey(profile);

  const p = profile || {};
  const hooks = {
    ...(testClient ? { client: testClient } : {}),
    beforeCall: () => { assertNotDemo(); assertBudget(); },
    onUsage: (u) => {
      addUsage({ ...u, bucket: task });
      if (u.cacheReadTokens || u.cacheWriteTokens) {
        addLog(`Prompt cache: ${u.cacheReadTokens || 0} read, ${u.cacheWriteTokens || 0} written.`, 'system');
      }
    },
    onLog: (msg, type) => addLog(msg, type || 'system')
  };

  return callClaude({
    apiKey: p.anthropicApiKey,
    task,
    model: resolveModel(p, task),
    prompt,
    messages,
    images,
    system,
    cacheSystem: Boolean(cacheSystem) && p.usePromptCaching !== false,
    // Structured outputs (user toggle, default ON): constrained decoding
    // guarantees schema-valid JSON, removing brittle text parsing.
    schema: schema && p.useStructuredOutputs !== false ? schema : undefined,
    tools,
    maxTokens,
    effort,
    maxContinuations
  }, hooks);
}

/** Plain-text call. `bucket` is the core task key. */
export async function callLlm(profile, prompt, { maxTokens, schema = null, system = null, cacheSystem = false, bucket = 'core', effort } = {}) {
  const r = await callLlmFull(profile, { task: bucket, prompt, system, cacheSystem, schema, maxTokens, effort });
  return r.text;
}

/**
 * Multimodal call: like callLlm but with one or more screenshots (base64, no
 * data: prefix). Used by the page-vision fallback.
 */
export async function callLlmVision(profile, prompt, images = [], { maxTokens, bucket = 'vision' } = {}) {
  const imgs = (images || []).filter(Boolean).map((data) => ({ data }));
  const r = await callLlmFull(profile, { task: bucket, prompt, images: imgs, maxTokens });
  return r.text;
}
