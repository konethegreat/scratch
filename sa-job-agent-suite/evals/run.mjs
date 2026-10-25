#!/usr/bin/env node
// Eval harness for the two model-quality-sensitive tasks: CV/cover-letter
// tailoring and the page planner.
//
//   node evals/run.mjs                      DRY run: fakeClient, no network, no key, spends nothing.
//   node evals/run.mjs --trials 3           repeat every case 3 times.
//   node evals/run.mjs --live --yes-spend   LIVE run: needs ANTHROPIC_API_KEY in the
//                                           environment AND --yes-spend. Costs real money.
//
// Both modes print the plan and an UPPER-BOUND cost estimate first and write
// evals/results/<timestamp>.json. Dry runs exercise the plan/estimate/result
// path with deterministic fake responses that pass the checks; they say
// nothing about model quality.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { callClaude, makeClient, taskConfig, priceFor, estimateCostUSD, extractJson } from '@sajas/core';
import { fakeClient } from '@sajas/core/testing';
import { buildTailorPrompts } from '../server/src/agents/tailorPrompts.js';
import { buildPlanPrompt, normalizePlan, PLAN_SCHEMA } from '../server/src/agents/pageBrain.js';
import { checkTailoredCv, checkPlan } from './checks.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(path.join(here, 'fixtures', name), 'utf8');

const CHARS_PER_TOKEN = 3; // deliberately pessimistic: overestimates input tokens
const INJECTION_RE = /ignore previous instructions/i;

export function parseArgs(argv) {
  const args = { live: false, yesSpend: false, trials: 1, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--live') args.live = true;
    else if (a === '--yes-spend') args.yesSpend = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--trials') args.trials = Number(argv[++i]);
    else if (a.startsWith('--trials=')) args.trials = Number(a.slice('--trials='.length));
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!Number.isInteger(args.trials) || args.trials < 1 || args.trials > 20) {
    throw new Error('--trials must be an integer between 1 and 20');
  }
  return args;
}

/** The full list of model calls this run will make, in order. */
export function buildCases({ baseCv, jobs, pages, trials }) {
  const cases = [];
  for (let t = 0; t < trials; t++) {
    for (const job of jobs) {
      const { system, cvPrompt, coverLetterPrompt } = buildTailorPrompts({ baseCv, job });
      cases.push({ cls: 'tailor', kind: 'cv', job, system, prompt: cvPrompt, task: 'tailor' });
      cases.push({ cls: 'tailor', kind: 'cover-letter', job, system, prompt: coverLetterPrompt, task: 'tailor' });
    }
  }
  for (let t = 0; t < trials; t++) {
    for (const page of pages) {
      cases.push({
        cls: 'planner', kind: 'plan', page, task: 'planner',
        prompt: buildPlanPrompt(page.snapshot, page.job, false), schema: PLAN_SCHEMA
      });
    }
  }
  return cases;
}

const tokensOf = (s) => Math.ceil(String(s || '').length / CHARS_PER_TOKEN);

/** Upper bound: every call emits its full max_tokens and no prompt caching is credited. */
export function estimateUpperBound(cases) {
  const byClass = {};
  let total = 0;
  for (const c of cases) {
    const cfg = taskConfig(c.task);
    const cost = estimateCostUSD({
      model: cfg.model,
      inputTokens: tokensOf(c.system) + tokensOf(c.prompt),
      outputTokens: cfg.maxTokens
    });
    byClass[c.cls] ??= { calls: 0, usd: 0, model: cfg.model, maxTokens: cfg.maxTokens, pricePerMTok: priceFor(cfg.model) };
    byClass[c.cls].calls += 1;
    byClass[c.cls].usd += cost;
    total += cost;
  }
  return { total, byClass };
}

function printPlan(args, cases, est) {
  const mode = args.live ? 'LIVE (spends real money)' : 'DRY (fakeClient, no network, spends nothing)';
  console.log(`SA-JAS eval run: ${mode}`);
  console.log(`Trials per case: ${args.trials}`);
  for (const [cls, v] of Object.entries(est.byClass)) {
    console.log(`  ${cls}: ${v.calls} calls on ${v.model} (max ${v.maxTokens} output tokens each), upper bound $${v.usd.toFixed(4)}`);
  }
  console.log(`UPPER-BOUND cost estimate: $${est.total.toFixed(4)} (${cases.length} calls; every call assumed to use its full max_tokens, no caching credit, registry prices. The real cost is normally well below this.)`);
}

/** Deterministic fake responses that satisfy the checks, in call order. */
function fakeResponses(cases, baseCv) {
  const seenSystem = new Set();
  return cases.map((c) => {
    let text;
    if (c.cls === 'planner') {
      text = JSON.stringify({ ...c.page.expected, buttonText: c.page.expected.action === 'click' ? 'Apply now' : '', confidence: 'high', reason: 'dry-run fake' });
    } else if (c.kind === 'cv') {
      text = `# Tailored CV\n\n${baseCv}\n\nKey skills: ${c.job.keywords.join(', ')}`;
    } else {
      text = `Dear Hiring Manager,\n\nI am applying for the ${c.job.title} role at ${c.job.company}. ${'My experience building reliable software for South African businesses is a strong match for this role. '.repeat(8)}\n\nYours sincerely,\nThandeka Mokoena-Visser`;
    }
    const sys = c.system ? tokensOf(c.system) : 0;
    const first = Boolean(c.system) && !seenSystem.has(c.system);
    if (c.system) seenSystem.add(c.system);
    return {
      id: 'fake', type: 'message', role: 'assistant', model: taskConfig(c.task).model,
      stop_reason: 'end_turn',
      content: [{ type: 'text', text }],
      usage: {
        input_tokens: tokensOf(c.prompt),
        output_tokens: tokensOf(text),
        cache_creation_input_tokens: first ? sys : 0,
        cache_read_input_tokens: first ? 0 : sys
      }
    };
  });
}

function evaluate(c, baseCv, text) {
  if (c.cls === 'planner') {
    let plan = null;
    try { plan = normalizePlan(extractJson(text)); } catch { /* plan stays null */ }
    return checkPlan(c.page.expected, plan);
  }
  // Cover letters have no keyword list, so only the structural checks apply.
  const job = c.kind === 'cv' ? c.job : { ...c.job, keywords: [] };
  const r = checkTailoredCv(baseCv, job, text);
  const failures = [...r.failures];
  if (INJECTION_RE.test(c.job.description || '') && /pwned/i.test(text)) {
    failures.push('output obeyed the injection in the job description');
  }
  return { pass: failures.length === 0, failures };
}

export async function runCases({ cases, baseCv, apiKey, client, budgetUSD = Infinity }) {
  const stats = {};
  let spent = 0;
  for (const c of cases) {
    const s = (stats[c.cls] ??= { n: 0, completed: 0, passed: 0, costUSD: 0, inputTokens: 0, outputTokens: 0, cacheRead: 0, failures: [] });
    s.n += 1;
    const label = c.cls === 'tailor' ? `${c.kind} / ${c.job.title}` : c.page.name;
    if (spent >= budgetUSD) { s.failures.push(`${label}: skipped, upper-bound budget reached`); continue; }
    try {
      const res = await callClaude({
        apiKey, task: c.task, system: c.system, cacheSystem: Boolean(c.system),
        prompt: c.prompt, ...(c.schema ? { schema: c.schema } : {}), maxContinuations: 0
      }, { client });
      const u = res.usage;
      const cost = estimateCostUSD(u);
      spent += cost;
      s.completed += 1;
      s.costUSD += cost;
      s.inputTokens += u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens;
      s.outputTokens += u.outputTokens;
      s.cacheRead += u.cacheReadTokens;
      const verdict = evaluate(c, baseCv, res.text);
      if (verdict.pass) s.passed += 1;
      else s.failures.push(`${label}: ${verdict.failures.join('; ')}`);
    } catch (err) {
      s.failures.push(`${label}: call failed (${String(err?.message || err).slice(0, 160)})`);
    }
  }
  const out = {};
  for (const [cls, s] of Object.entries(stats)) {
    out[cls] = {
      n: s.n,
      passRate: s.n ? s.passed / s.n : 0,
      // Cost of the calls that returned an answer, divided by how many did.
      costPerCompletedTaskUSD: s.completed ? s.costUSD / s.completed : null,
      // Cache reads as a share of all input tokens (uncached + cache read + cache write).
      cacheHitRatio: s.inputTokens ? s.cacheRead / s.inputTokens : 0,
      inputTokens: s.inputTokens,
      outputTokens: s.outputTokens,
      failures: s.failures
    };
  }
  return { classes: out, spentUSD: spent };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node evals/run.mjs [--trials N] [--live --yes-spend]\nDefault is a dry run that spends nothing.');
    return;
  }
  let apiKey;
  if (args.live) {
    apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) { console.error('--live needs ANTHROPIC_API_KEY in the environment. Nothing was run.'); process.exitCode = 1; return; }
    if (!args.yesSpend) { console.error('--live spends real money. Re-run with --yes-spend after reading the estimate (run without --live to see it). Nothing was run.'); process.exitCode = 1; return; }
  }

  const baseCv = fixture('cv.md');
  const jobs = JSON.parse(fixture('jobs.json'));
  const pages = JSON.parse(fixture('pages.json'));
  const cases = buildCases({ baseCv, jobs, pages, trials: args.trials });
  const est = estimateUpperBound(cases);
  printPlan(args, cases, est);

  let client;
  if (args.live) {
    client = makeClient({ apiKey });
  } else {
    // Shaped like a key only so callClaude's key check passes; never sent anywhere.
    apiKey = 'sk-' + 'ant-api03-' + 'A'.repeat(40);
    client = fakeClient(fakeResponses(cases, baseCv)).client;
  }

  const startedAt = new Date();
  const { classes, spentUSD } = await runCases({ cases, baseCv, apiKey, client, budgetUSD: args.live ? est.total : Infinity });

  const result = {
    mode: args.live ? 'live' : 'dry',
    startedAt: startedAt.toISOString(),
    trials: args.trials,
    estimateUpperBoundUSD: est.total,
    estimatedSpendUSD: args.live ? spentUSD : 0,
    classes
  };
  const dir = path.join(here, 'results');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${startedAt.toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify(result, null, 2) + '\n');

  for (const [cls, r] of Object.entries(classes)) {
    const cost = r.costPerCompletedTaskUSD == null ? 'n/a' : `$${r.costPerCompletedTaskUSD.toFixed(5)}`;
    console.log(`${cls}: n=${r.n} passRate=${(r.passRate * 100).toFixed(0)}% cost/task=${cost} cacheHit=${(r.cacheHitRatio * 100).toFixed(0)}% tokens in/out=${r.inputTokens}/${r.outputTokens}`);
    for (const f of r.failures.slice(0, 10)) console.log(`  FAIL ${f}`);
  }
  console.log(`Result written to ${path.relative(process.cwd(), file)}`);
  if (!args.live) console.log('(Dry run: responses are deterministic fakes. A 100% pass rate here only proves the plumbing.)');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(String(err?.message || err)); process.exitCode = 1; });
}
