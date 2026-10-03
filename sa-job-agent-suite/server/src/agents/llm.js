import { GoogleGenerativeAI } from '@google/generative-ai';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { addLog, addUsage, budgetStatus, budgetMessage } from '../db/helper.js';
import { fromAnthropicUsage } from '../db/costs.js';

/**
 * Shared LLM provider call used by Agent 2 (document tailoring) and Agent 3
 * (form field-mapping + page planning). Single place for provider/model choice.
 * `profile` is the merged profile object from getProfile() (includes keys).
 *
 * Cost controls (see db/helper.js):
 *  - Every call records its token usage into the AI usage ledger (addUsage),
 *    bucketed by opts.bucket so the Settings panel can show where money goes.
 *  - When the user's daily budget cap is exceeded, the call REFUSES with a
 *    clear error instead of silently spending more. Callers that are
 *    best-effort (research, reflection, planner) already catch and skip.
 */
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

export async function callLlm(profile, prompt, { maxTokens = 4000, schema = null, system = null, cacheSystem = false, bucket = 'core' } = {}) {
  const provider = profile.aiProvider || 'gemini';
  const modelName = (profile.selectedModel || '').trim();
  assertBudget();

  if (provider === 'gemini') {
    const genAI = new GoogleGenerativeAI(profile.geminiApiKey);
    const model = genAI.getGenerativeModel({ model: modelName || 'gemini-1.5-flash' });
    // Gemini path keeps it simple: fold any system preamble into the prompt.
    const text = system ? `${system}\n\n${prompt}` : prompt;
    const result = await model.generateContent(text);
    const meta = result.response?.usageMetadata || {};
    addUsage({
      provider: 'gemini', model: modelName || 'gemini-1.5-flash', bucket,
      inputTokens: meta.promptTokenCount || 0, outputTokens: meta.candidatesTokenCount || 0
    });
    return result.response.text();
  }

  if (provider === 'anthropic') {
    const anthropic = new Anthropic({ apiKey: profile.anthropicApiKey });
    const model = modelName || 'claude-3-5-sonnet-latest';
    const params = {
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }]
    };
    // Prompt caching (user toggle, default ON): cache the large reusable system
    // block (e.g. the base CV) so repeat calls reuse it at ~10% of input cost.
    if (system) {
      const cache = cacheSystem && profile.usePromptCaching !== false;
      params.system = cache
        ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
        : system;
    }
    // Structured outputs (user toggle, default ON): constrained decoding
    // guarantees schema-valid JSON, removing brittle text parsing.
    if (schema && profile.useStructuredOutputs !== false) {
      params.output_config = { format: { type: 'json_schema', schema } };
    }
    const response = await anthropic.messages.create(params);
    const u = response.usage || {};
    if (u.cache_read_input_tokens || u.cache_creation_input_tokens) {
      addLog(`Prompt cache: ${u.cache_read_input_tokens || 0} read, ${u.cache_creation_input_tokens || 0} written.`, 'system');
    }
    addUsage({ ...fromAnthropicUsage(model, u), bucket });
    return response.content[0].text;
  }

  if (provider === 'openrouter') {
    const openai = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: profile.openRouterApiKey,
      defaultHeaders: { 'HTTP-Referer': 'http://localhost:3000', 'X-Title': 'SA Job Agent Suite' }
    });
    const messages = system
      ? [{ role: 'system', content: system }, { role: 'user', content: prompt }]
      : [{ role: 'user', content: prompt }];
    const model = modelName || 'deepseek/deepseek-chat';
    const response = await openai.chat.completions.create({ model, messages });
    const u = response.usage || {};
    addUsage({
      provider: 'openrouter', model, bucket,
      inputTokens: u.prompt_tokens || 0, outputTokens: u.completion_tokens || 0
    });
    return response.choices[0].message.content;
  }

  throw new Error(`Unknown AI provider: ${provider}`);
}

/**
 * True if the selected provider can accept images (for the vision fallback).
 * Gemini 1.5 Flash and Claude 3.5 are multimodal; OpenRouter's default
 * (DeepSeek-chat) is text-only, so vision is skipped there.
 */
export function providerSupportsVision(profile) {
  const provider = profile.aiProvider || 'gemini';
  return provider === 'gemini' || provider === 'anthropic';
}

/**
 * Multimodal call: like callLlm but with one or more PNG screenshots (base64,
 * no data: prefix). Used by the page-vision fallback.
 */
export async function callLlmVision(profile, prompt, images = [], { maxTokens = 1500, bucket = 'vision' } = {}) {
  const provider = profile.aiProvider || 'gemini';
  const modelName = (profile.selectedModel || '').trim();
  const imgs = (images || []).filter(Boolean);
  assertBudget();

  if (provider === 'gemini') {
    const genAI = new GoogleGenerativeAI(profile.geminiApiKey);
    const model = genAI.getGenerativeModel({ model: modelName || 'gemini-1.5-flash' });
    const parts = [{ text: prompt }, ...imgs.map((data) => ({ inlineData: { mimeType: 'image/png', data } }))];
    const result = await model.generateContent(parts);
    const meta = result.response?.usageMetadata || {};
    addUsage({
      provider: 'gemini', model: modelName || 'gemini-1.5-flash', bucket,
      inputTokens: meta.promptTokenCount || 0, outputTokens: meta.candidatesTokenCount || 0
    });
    return result.response.text();
  }

  if (provider === 'anthropic') {
    const anthropic = new Anthropic({ apiKey: profile.anthropicApiKey });
    const model = modelName || 'claude-3-5-sonnet-latest';
    const content = [
      { type: 'text', text: prompt },
      ...imgs.map((data) => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data } }))
    ];
    const response = await anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content }]
    });
    addUsage({ ...fromAnthropicUsage(model, response.usage || {}), bucket });
    return response.content[0].text;
  }

  if (provider === 'openrouter') {
    const openai = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: profile.openRouterApiKey,
      defaultHeaders: { 'HTTP-Referer': 'http://localhost:3000', 'X-Title': 'SA Job Agent Suite' }
    });
    const content = [
      { type: 'text', text: prompt },
      ...imgs.map((data) => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${data}` } }))
    ];
    const model = modelName || 'deepseek/deepseek-chat';
    const response = await openai.chat.completions.create({
      model,
      messages: [{ role: 'user', content }]
    });
    const u = response.usage || {};
    addUsage({
      provider: 'openrouter', model, bucket,
      inputTokens: u.prompt_tokens || 0, outputTokens: u.completion_tokens || 0
    });
    return response.choices[0].message.content;
  }

  throw new Error(`Unknown AI provider: ${provider}`);
}

/**
 * Validates that the selected provider has a usable key. Throws a user-facing
 * error otherwise. Returns the provider name.
 */
export function assertProviderKey(profile) {
  const provider = profile.aiProvider || 'gemini';
  const key = {
    gemini:     profile.geminiApiKey,
    anthropic:  profile.anthropicApiKey,
    openrouter: profile.openRouterApiKey
  }[provider];
  if (!key || key.includes('your_')) {
    throw new Error(`${provider} API key is missing. Add it in the Profile & Settings tab.`);
  }
  return provider;
}

/**
 * Extracts the first JSON object/array from an LLM response that may be wrapped
 * in prose or ```json fences. Returns null if nothing parseable is found.
 */
export function extractJson(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.search(/[\[{]/);
  if (start === -1) return null;
  const lastObj = candidate.lastIndexOf('}');
  const lastArr = candidate.lastIndexOf(']');
  const end = Math.max(lastObj, lastArr);
  if (end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}
