#!/usr/bin/env node
// Live smoke probes against the real Anthropic API. SPENDS REAL MONEY (a few
// cents in total) and uses your key, so it refuses to run unless BOTH
// ANTHROPIC_API_KEY is set in the environment AND --yes-spend is passed:
//
//   ANTHROPIC_API_KEY=... node scripts/smoke-live.mjs --yes-spend [--no-fallback]
//
// Probes 1-4 and 6 send exactly what production sends: the beta server-side
// fallback stream (REFUSAL_FALLBACK_DEFAULT). If probe 3 or 4 fails, re-run with
// --no-fallback (the fallback beta is switched off for EVERY probe; probes 5 and
// 5b, which test the fallback itself, are skipped). If it then passes, the
// failure was the fallback beta transport, not the schema/tool, so flip
// REFUSAL_FALLBACK_DEFAULT (not the CAPABILITIES flag).
//
// Probes run sequentially. Each prints PASS or FAIL, its estimated cost and a
// one-line reason. Three results decide switches in the codebase:
//   probe 3 -> CAPABILITIES.searchStructuredOutput  (packages/core/src/models.js)
//   probe 4 -> CAPABILITIES.haikuWebSearch          (packages/core/src/models.js)
//   probe 5 -> REFUSAL_FALLBACK_DEFAULT             (packages/core/src/ai.js)
// (Probe 5 runs on Sonnet; fallbacks:'default' is a documented no-op on Haiku, so
// 5b only shows the request is accepted there.)
// Importing this file runs nothing; only executing it as a script does.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  callClaude, makeClient, estimateCostUSD, extractJson, scrubSecrets, normalizeKeyInput,
  MODEL_IDS, webSearchTool, REFUSAL_FALLBACK_DEFAULT
} from '@sajas/core';

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

const ANSWER_SCHEMA = {
  type: 'object',
  properties: { answer: { type: 'string' } },
  required: ['answer'],
  additionalProperties: false
};
const SEARCH_SCHEMA = {
  type: 'object',
  properties: {
    jobs: {
      type: 'array',
      items: {
        type: 'object',
        properties: { title: { type: 'string' }, company: { type: 'string' }, applyUrl: { type: 'string' } },
        required: ['title', 'company', 'applyUrl'],
        additionalProperties: false
      }
    }
  },
  required: ['jobs'],
  additionalProperties: false
};
const SEARCH_PROMPT = 'Search the web once for a current software developer vacancy in Cape Town, South Africa. Return the single best match as JSON with a "jobs" array. If you find none, return {"jobs":[]}.';

// More than 600 tokens (roughly 3,000 tokens here) so it clears every model's minimum cacheable prefix.
const LONG_SYSTEM = 'You are a careful assistant. Answer in one word. Background notes follow.\n' +
  Array.from({ length: 160 }, (_, i) => `Note ${i + 1}: the quick brown fox jumps over the lazy dog near the old jacaranda tree in Pretoria.`).join('\n');

/**
 * Per-run context handed to every probe. `fallback` is the refusalFallback value
 * probes 1-4 and 6 send: production's default, or false with --no-fallback.
 */
export function probeContext(argv = []) {
  return { noFallback: argv.includes('--no-fallback'), fallback: argv.includes('--no-fallback') ? false : REFUSAL_FALLBACK_DEFAULT };
}

const cost = (res) => (res?.usage ? estimateCostUSD(res.usage) : 0);

/** Each probe: async ({ apiKey, client }) => { ok, reason, costUSD }. */
export const probes = [
  {
    name: '1. Haiku text call',
    async run({ apiKey, client, fallback }) {
      const res = await callClaude({ apiKey, task: 'core', model: MODEL_IDS.haiku, prompt: 'Reply with the single word OK.', refusalFallback: fallback }, { client });
      return { ok: res.text.trim().length > 0, reason: `stop_reason ${res.stopReason}, ${res.usage.outputTokens} output tokens`, costUSD: cost(res) };
    }
  },
  {
    name: '2. Sonnet with effort + json schema',
    async run({ apiKey, client, fallback }) {
      const res = await callClaude({
        apiKey, task: 'core', model: MODEL_IDS.sonnet, effort: 'low', schema: ANSWER_SCHEMA,
        prompt: 'What is the capital of South Africa that hosts the national executive? Answer in the "answer" field.', refusalFallback: fallback
      }, { client });
      const parsed = extractJson(res.text);
      return { ok: typeof parsed?.answer === 'string' && parsed.answer.length > 0, reason: `schema-valid JSON ${parsed ? 'parsed' : 'not parsed'}`, costUSD: cost(res) };
    }
  },
  {
    name: '3. Sonnet web_search + schema (decides CAPABILITIES.searchStructuredOutput)',
    async run({ apiKey, client, fallback }) {
      const res = await callClaude({
        apiKey, task: 'ai-search', model: MODEL_IDS.sonnet, schema: SEARCH_SCHEMA, prompt: SEARCH_PROMPT,
        tools: [webSearchTool({ maxUses: 1 })], maxContinuations: 3, refusalFallback: fallback
      }, { client });
      const parsed = extractJson(res.text);
      const ok = Array.isArray(parsed?.jobs);
      return { ok, reason: ok ? `searches ${res.usage.webSearches}, ${parsed.jobs.length} job(s) in schema-shaped JSON` : 'search + schema combination did not return {"jobs":[...]}', costUSD: cost(res) };
    }
  },
  {
    name: '4. Haiku web_search (decides CAPABILITIES.haikuWebSearch)',
    async run({ apiKey, client, fallback }) {
      const res = await callClaude({
        apiKey, task: 'ai-search', model: MODEL_IDS.haiku,
        prompt: 'Search the web once for a current software developer vacancy in Cape Town, South Africa and name the company in one sentence.',
        tools: [webSearchTool({ maxUses: 1 })], maxContinuations: 3, refusalFallback: fallback
      }, { client });
      // An unsupported tool would throw a 400 (caught as FAIL), so a clean non-empty reply is a PASS.
      return { ok: res.text.trim().length > 0, reason: `no error, searches used ${res.usage.webSearches}, stop_reason ${res.stopReason}`, costUSD: cost(res) };
    }
  },
  {
    name: '5. beta fallbacks:"default" request on Sonnet (decides REFUSAL_FALLBACK_DEFAULT)',
    async run({ apiKey, client, noFallback }) {
      if (noFallback) return { skipped: true, ok: true, reason: 'skipped with --no-fallback', costUSD: 0 };
      // refusalFallback:true sends the beta header + fallbacks:'default' exactly as production does.
      // Sonnet, not Haiku: on Haiku the parameter is a documented no-op, so it proves nothing.
      const res = await callClaude({ apiKey, task: 'core', model: MODEL_IDS.sonnet, effort: 'low', prompt: 'Reply with the single word OK.', refusalFallback: true }, { client });
      return { ok: res.text.trim().length > 0, reason: `beta ${FALLBACK_BETA} accepted on Sonnet, stop_reason ${res.stopReason}`, costUSD: cost(res) };
    }
  },
  {
    name: '5b. beta fallbacks:"default" request on Haiku (documented no-op; checks the request is accepted)',
    async run({ apiKey, client, noFallback }) {
      if (noFallback) return { skipped: true, ok: true, reason: 'skipped with --no-fallback', costUSD: 0 };
      const res = await callClaude({ apiKey, task: 'core', model: MODEL_IDS.haiku, prompt: 'Reply with the single word OK.', refusalFallback: true }, { client });
      return { ok: res.text.trim().length > 0, reason: `beta ${FALLBACK_BETA} accepted on Haiku, stop_reason ${res.stopReason}`, costUSD: cost(res) };
    }
  },
  {
    name: '6. prompt cache read on the second identical call',
    async run({ apiKey, client, fallback }) {
      const req = { apiKey, task: 'core', model: MODEL_IDS.sonnet, system: LONG_SYSTEM, cacheSystem: true, prompt: 'Reply with the single word OK.', refusalFallback: fallback };
      const first = await callClaude(req, { client });
      const second = await callClaude(req, { client });
      const read = second.usage.cacheReadTokens;
      return {
        ok: read > 0,
        reason: `call 1 wrote ${first.usage.cacheWriteTokens} tokens, call 2 read ${read} tokens`,
        costUSD: cost(first) + cost(second)
      };
    }
  },
  {
    name: '7. models.list() contains every registry ID',
    async run({ client }) {
      const seen = new Set();
      for await (const m of client.models.list({ limit: 100 })) seen.add(m.id);
      const missing = Object.values(MODEL_IDS).filter((id) => !seen.has(id));
      return { ok: missing.length === 0, reason: missing.length ? `missing from the account's model list: ${missing.join(', ')}` : `all ${Object.keys(MODEL_IDS).length} registry IDs are listed`, costUSD: 0 };
    }
  }
];

const TRANSPORT_NOTE = ' This probe used the production fallback beta transport: if the error mentions the beta, fallbacks or an unknown parameter, re-run with --no-fallback and, if it then passes, flip REFUSAL_FALLBACK_DEFAULT instead.';
const ADVICE = {
  '3': 'Set CAPABILITIES.searchStructuredOutput to false in packages/core/src/models.js.' + TRANSPORT_NOTE,
  '4': 'Set CAPABILITIES.haikuWebSearch to false in packages/core/src/models.js.' + TRANSPORT_NOTE,
  '5': 'Set REFUSAL_FALLBACK_DEFAULT to false in packages/core/src/ai.js.'
};

async function main(argv, env) {
  const apiKey = normalizeKeyInput(env.ANTHROPIC_API_KEY);
  if (!apiKey) { console.error('smoke-live needs ANTHROPIC_API_KEY in the environment. Nothing was run.'); return 1; }
  if (!argv.includes('--yes-spend')) { console.error('smoke-live spends real money (a few cents). Re-run with --yes-spend to confirm. Nothing was run.'); return 1; }

  const ctx = probeContext(argv);
  console.log(`Transport for probes 1-4 and 6: ${ctx.fallback ? 'beta server-side fallback stream (as production sends)' : 'plain stream (fallback off)'}`);
  const client = makeClient({ apiKey, maxRetries: 2 });
  let total = 0;
  const failed = [];
  for (const probe of probes) {
    let r;
    try {
      r = await probe.run({ apiKey, client, ...ctx });
    } catch (err) {
      r = { ok: false, reason: scrubSecrets(`${err?.name || 'Error'}: ${err?.message || err}`).slice(0, 200), costUSD: 0 };
    }
    total += r.costUSD || 0;
    console.log(`${r.skipped ? 'SKIP' : r.ok ? 'PASS' : 'FAIL'}  ${probe.name}  ~$${(r.costUSD || 0).toFixed(5)}  ${r.reason}`);
    if (!r.ok) failed.push(probe);
  }
  console.log(`\nTotal estimated cost: ~$${total.toFixed(5)}`);
  for (const p of failed) {
    const n = p.name.split('.')[0]; // '5b' deliberately has no advice entry
    if (ADVICE[n]) console.log(`Action for probe ${n}: ${ADVICE[n]}`);
  }
  return failed.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2), process.env).then((code) => { process.exitCode = code; });
}
