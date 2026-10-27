# Web Tailoring and Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Document Tailor work in the hosted web app with real spend tracking and a daily cap, and add a support section that a stranger can actually use.

**Architecture:** Move the pure tailor prompts into `@sajas/core`, let `makeClient` opt into the browser allowance, then add three browser modules: a usage ledger over the existing vault, a tailor runner that calls Claude directly from the page, and a support helper that builds diagnostics-only mailto links. The web API routes to these modules, the React UI adds print and a Help tab, and a Playwright proof drives the whole flow against a mocked Anthropic SSE endpoint.

**Tech Stack:** React 18, Vite 7, Node 22 `node:test`, Playwright Chromium, IndexedDB via the existing vault, Anthropic SDK with `dangerouslyAllowBrowser`.

**Spec:** [`docs/superpowers/specs/2026-10-27-web-tailoring-support-design.md`](../specs/2026-10-27-web-tailoring-support-design.md)

## Global Constraints

- Work in `sa-job-agent-suite/` unless a step says otherwise.
- Never set `ANTHROPIC_API_KEY`, never run `npm run smoke:live`, and never call the live Anthropic API in any test.
- Key-shaped strings are assembled at runtime in tests. No key-shaped literal in the repo.
- The key never enters the DOM, localStorage, sessionStorage, IndexedDB plaintext, a backup, a log, a toast, or a request to our origin.
- No em dashes and no emoji in user-facing copy, docs, or chat replies.
- No model ID literals outside `packages/core/src/models.js` and `*.test.js`.
- Never send sampling parameters (temperature, top_p, top_k), prefill, forced tool_choice, disabled thinking, or budget_tokens.
- The Anthropic SDK must not load in the initial web bundle. Tailoring imports it dynamically.
- Run the secret scan from the repo root: `node tools/check-secrets.mjs --all`.
- Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Do not use `--no-verify`.

---

### Task 1: Move the prompts to core and add the browser allowance

**Files:**
- Move: `sa-job-agent-suite/server/src/agents/tailorPrompts.js` to `sa-job-agent-suite/packages/core/src/tailorPrompts.js`
- Move: `sa-job-agent-suite/server/src/agents/tailorPrompts.test.js` to `sa-job-agent-suite/packages/core/src/tailorPrompts.test.js`
- Modify: `sa-job-agent-suite/packages/core/package.json`
- Modify: `sa-job-agent-suite/packages/core/src/ai.js`
- Modify: `sa-job-agent-suite/packages/core/src/ai.test.js`
- Modify: `sa-job-agent-suite/server/src/agents/agent2-tailor.js`
- Modify: `sa-job-agent-suite/evals/run.mjs`

**Interfaces:**
- Produces: `@sajas/core/tailor` exports `INJECTION_SHIELD` and `buildTailorPrompts`.
- Produces: `@sajas/core/ai` exports `makeClient({ apiKey, timeout, allowBrowser })` and `callClaude`.
- Produces: `makeClient` sets `_options.dangerouslyAllowBrowser === true` only when `allowBrowser` is true.

- [ ] **Step 1: Move the files with git so history follows**

```bash
git mv server/src/agents/tailorPrompts.js packages/core/src/tailorPrompts.js
git mv server/src/agents/tailorPrompts.test.js packages/core/src/tailorPrompts.test.js
```

- [ ] **Step 2: Point the desktop agent and the eval at core**

In `server/src/agents/agent2-tailor.js`, replace:

```js
import { buildTailorPrompts, INJECTION_SHIELD } from './tailorPrompts.js';
```

with:

```js
import { buildTailorPrompts, INJECTION_SHIELD } from '@sajas/core/tailor';
```

In `evals/run.mjs`, replace:

```js
import { buildTailorPrompts } from '../server/src/agents/tailorPrompts.js';
```

with:

```js
import { buildTailorPrompts } from '@sajas/core/tailor';
```

The moved test keeps `import('./tailorPrompts.js')` because it now sits beside the module.

- [ ] **Step 3: Add the core exports**

In `packages/core/package.json`, replace the exports block with:

```json
  "exports": {
    ".": "./src/index.js",
    "./errors": "./src/errors.js",
    "./secrets": "./src/secrets.js",
    "./models": "./src/models.js",
    "./testing": "./src/testing.js",
    "./feeds": "./src/feeds/index.js",
    "./ai": "./src/ai.js",
    "./tailor": "./src/tailorPrompts.js"
  },
```

- [ ] **Step 4: Write the failing browser-flag test**

Append to `packages/core/src/ai.test.js`:

```js
test('the browser allowance is opt-in and absent by default', () => {
  const plain = makeClient({ apiKey: KEY });
  assert.equal(plain._options.dangerouslyAllowBrowser, undefined);
  const browser = makeClient({ apiKey: KEY, allowBrowser: true });
  assert.equal(browser._options.dangerouslyAllowBrowser, true);
  assert.equal(browser._options.baseURL, ANTHROPIC_BASE_URL);
});
```

- [ ] **Step 5: Run the test and watch it fail**

Run:

```bash
npm test --workspace=@sajas/core
```

Expected: FAIL because `plain._options.dangerouslyAllowBrowser` is `undefined` in both cases (the parameter is ignored).

- [ ] **Step 6: Implement the flag**

In `packages/core/src/ai.js`, replace `makeClient` with:

```js
export function makeClient({ apiKey, timeout, allowBrowser = false } = {}) {
  return new Anthropic({
    apiKey,
    baseURL: ANTHROPIC_BASE_URL,
    maxRetries: 0,
    ...(allowBrowser ? { dangerouslyAllowBrowser: true } : {}),
    ...(timeout ? { timeout } : {})
  });
}
```

- [ ] **Step 7: Run the core and server tests**

```bash
npm test --workspace=@sajas/core
npm test --workspace=server
```

Expected: PASS. The moved prompt tests now run under core.

- [ ] **Step 8: Commit**

```bash
git add packages/core server/src/agents/agent2-tailor.js evals/run.mjs
git commit -m "refactor(core): share tailor prompts and allow an explicit browser client"
```

---

### Task 2: Add the browser usage ledger and wire /usage

**Files:**
- Create: `sa-job-agent-suite/client/src/web/usage.js`
- Create: `sa-job-agent-suite/client/src/web/usage.test.js`
- Modify: `sa-job-agent-suite/client/src/web/api.js`
- Modify: `sa-job-agent-suite/client/src/web/api.test.js`

**Interfaces:**
- Consumes: `vault.get/put`, `STORES.usage`, `estimateCostUSD` from `@sajas/core/costs`.
- Produces: `createUsageLedger({ vault, now })` returns `{ record, summary, budget, clear }`.
- Produces: `summary(profile)` returns `{ today, history, last7CostUSD, budget: { capUSD, spentUSD, exceeded } }`, the same shape as the desktop server.
- Produces: `GET /usage` and `DELETE /usage` on the web API.

- [ ] **Step 1: Write the failing ledger tests**

Create `client/src/web/usage.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createVault } from './vault.js';
import { createMemoryAdapter } from './memoryAdapter.js';
import { createUsageLedger } from './usage.js';
import { MODEL_IDS } from '@sajas/core/models';

function harness(profile = {}) {
  const vault = createVault(createMemoryAdapter({ profile: { current: profile } }));
  let clock = Date.parse('2026-10-27T10:00:00Z');
  const usage = createUsageLedger({ vault, now: () => new Date(clock) });
  const advance = (days) => { clock += days * 86_400_000; };
  return { vault, usage, advance };
}

test('records a call and summarises it in the server shape', async () => {
  const { usage } = harness({ dailyBudgetUSD: 5 });
  const cost = await usage.record({ model: MODEL_IDS.sonnet, bucket: 'tailor', inputTokens: 1_000_000, outputTokens: 0 });
  assert.equal(cost, 2);
  const summary = await usage.summary({ dailyBudgetUSD: 5 });
  assert.equal(summary.today.date, '2026-10-27');
  assert.equal(summary.today.calls, 1);
  assert.equal(summary.today.inputTokens, 1_000_000);
  assert.equal(summary.today.byBucket.tailor.calls, 1);
  assert.equal(summary.today.estCostUSD, 2);
  assert.equal(summary.history.length, 1);
  assert.equal(summary.last7CostUSD, 2);
  assert.deepEqual(summary.budget, { capUSD: 5, spentUSD: 2, exceeded: false });
});

test('the budget is exceeded at the cap and 0 means no cap', async () => {
  const capped = harness({ dailyBudgetUSD: 2 });
  await capped.usage.record({ model: MODEL_IDS.sonnet, inputTokens: 1_000_000 });
  assert.equal((await capped.usage.budget({ dailyBudgetUSD: 2 })).exceeded, true);

  const uncapped = harness({ dailyBudgetUSD: 0 });
  await uncapped.usage.record({ model: MODEL_IDS.sonnet, inputTokens: 1_000_000 });
  assert.equal((await uncapped.usage.budget({ dailyBudgetUSD: 0 })).exceeded, false);
});

test('keeps 14 days and clears back to zero', async () => {
  const { usage, advance } = harness();
  for (let i = 0; i < 20; i += 1) {
    await usage.record({ model: MODEL_IDS.sonnet, inputTokens: 1000 });
    advance(1);
  }
  const summary = await usage.summary({});
  assert.equal(summary.history.length, 14);
  assert.equal(summary.history.at(-1).date, '2026-11-15');
  await usage.clear();
  const cleared = await usage.summary({});
  assert.deepEqual(cleared.history, []);
  assert.equal(cleared.today.calls, 0);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test client/src/web/usage.test.js
```

Expected: FAIL with `Cannot find module .../usage.js`.

- [ ] **Step 3: Implement the ledger**

Create `client/src/web/usage.js`:

```js
// Browser usage ledger. Mirrors the desktop server's /usage summary shape so the
// existing Usage panel needs no second format.
import { estimateCostUSD } from '@sajas/core/costs';
import { STORES } from './vault.js';

const KEEP_DAYS = 14;
const ZERO = {
  calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
  cacheWriteTokens: 0, webSearches: 0, estCostUSD: 0
};

function emptyDay() {
  return { ...ZERO, byBucket: {} };
}

function add(target, usage, cost) {
  target.calls += 1;
  target.inputTokens += usage.inputTokens || 0;
  target.outputTokens += usage.outputTokens || 0;
  target.cacheReadTokens += usage.cacheReadTokens || 0;
  target.cacheWriteTokens += usage.cacheWriteTokens || 0;
  target.webSearches += usage.webSearches || 0;
  target.estCostUSD += cost;
}

export function createUsageLedger({ vault, now = () => new Date() }) {
  const todayKey = () => now().toISOString().slice(0, 10);

  async function days() {
    const stored = await vault.get(STORES.usage, 'days', { days: {} });
    const source = stored && typeof stored === 'object' && stored.days && typeof stored.days === 'object'
      ? stored.days
      : {};
    return { ...source };
  }

  async function save(map) {
    const keys = Object.keys(map).sort();
    while (keys.length > KEEP_DAYS) delete map[keys.shift()];
    await vault.put(STORES.usage, 'days', { days: map });
  }

  async function record({ model = '', bucket = 'core', ...tokens } = {}) {
    try {
      const cost = estimateCostUSD({ model, ...tokens });
      const map = await days();
      const key = todayKey();
      const day = map[key] || emptyDay();
      add(day, tokens, cost);
      day.byBucket[bucket] = day.byBucket[bucket] || { ...ZERO };
      add(day.byBucket[bucket], tokens, cost);
      map[key] = day;
      await save(map);
      return cost;
    } catch {
      return 0;
    }
  }

  async function summary(profile = {}) {
    const map = await days();
    const today = map[todayKey()] || emptyDay();
    const history = Object.keys(map).sort().slice(-14).map((date) => ({
      date,
      estCostUSD: map[date].estCostUSD || 0,
      calls: map[date].calls || 0
    }));
    const last7CostUSD = history.slice(-7).reduce((sum, day) => sum + day.estCostUSD, 0);
    const capUSD = Number(profile.dailyBudgetUSD) || 0;
    const spentUSD = today.estCostUSD || 0;
    return {
      today: { ...emptyDay(), ...today, date: todayKey(), byBucket: { ...(today.byBucket || {}) } },
      history,
      last7CostUSD,
      budget: { capUSD, spentUSD, exceeded: capUSD > 0 && spentUSD >= capUSD }
    };
  }

  async function budget(profile = {}) {
    return (await summary(profile)).budget;
  }

  async function clear() {
    await vault.put(STORES.usage, 'days', { days: {} });
  }

  return { record, summary, budget, clear };
}
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
node --test client/src/web/usage.test.js
```

Expected: PASS, three tests.

- [ ] **Step 5: Write the failing API test for real usage**

In `client/src/web/api.test.js`, replace the existing usage test with:

```js
test('usage starts empty, reflects the ledger, and can be cleared', async () => {
  const { call, vault } = harness({ profile: { current: { dailyBudgetUSD: 5 } } });
  const { createUsageLedger } = await import('./usage.js');
  const ledger = createUsageLedger({ vault });
  await ledger.record({ model: 'claude-sonnet-5-5', bucket: 'tailor', inputTokens: 1_000_000 });

  const usage = await json(await call('/usage'));
  assert.equal(usage.today.calls, 1);
  assert.equal(usage.today.estCostUSD, 2);
  assert.equal(usage.history.length, 1);
  assert.equal(usage.budget.capUSD, 5);
  assert.equal(usage.budget.exceeded, false);

  assert.equal((await call('/usage', { method: 'DELETE' })).status, 200);
  const cleared = await json(await call('/usage'));
  assert.equal(cleared.today.calls, 0);
  assert.deepEqual(cleared.history, []);
});
```

`claude-sonnet-5-5` is allowed here because this is a test file.

- [ ] **Step 6: Run it and watch it fail**

```bash
node --test client/src/web/api.test.js
```

Expected: FAIL, `usage.today.calls` is 0 because the route still returns `emptyUsage`.

- [ ] **Step 7: Wire the ledger into the web API**

In `client/src/web/api.js`, add the import:

```js
import { createUsageLedger } from './usage.js';
```

Replace the `emptyUsage` helper and the two `/usage` routes. Delete `emptyUsage` entirely and remove its use. In `createWebApi`, add the ledger:

```js
export function createWebApi({ apiBase, vault, keyStore, activity, now = () => new Date(), loadAi } = {}) {
  const base = new URL(apiBase);
  const basePath = base.pathname.replace(/\/$/, '');
  const usage = createUsageLedger({ vault, now });
```

Replace the routes with:

```js
      if (path === '/usage' && method === 'GET') {
        const profile = (await vault.get(STORES.profile, 'current', {})) || {};
        return ok(await usage.summary(profile));
      }
      if (path === '/usage' && method === 'DELETE') {
        await usage.clear();
        activity.add('Usage history cleared by user.', 'system');
        return ok({ success: true });
      }
```

- [ ] **Step 8: Run the API tests**

```bash
node --test client/src/web/api.test.js
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add client/src/web/usage.js client/src/web/usage.test.js client/src/web/api.js client/src/web/api.test.js
git commit -m "feat(web): track AI usage and spend in the browser ledger"
```

---

### Task 3: Implement web tailoring and the tailor endpoint

**Files:**
- Create: `sa-job-agent-suite/client/src/web/tailor.js`
- Create: `sa-job-agent-suite/client/src/web/tailor.test.js`
- Modify: `sa-job-agent-suite/client/src/web/api.js`
- Modify: `sa-job-agent-suite/client/src/web/api.test.js`

**Interfaces:**
- Consumes: `buildTailorPrompts` from `@sajas/core/tailor`, `callClaude` and `makeClient` from `@sajas/core/ai` (lazy), `usage.budget` and `usage.record`.
- Produces: `createWebTailor({ vault, keyStore, usage, activity, now, loadAi })` returns `{ tailorJob(jobId, profile) }`.
- Produces: `tailorJob` resolves `{ job, warning }`, where `warning` is `''` or a plain sentence about the cover letter.
- Produces: `POST /jobs/:id/tailor` returns `{ success: true, job, warning? }`.

- [ ] **Step 1: Write the failing tailor tests**

Create `client/src/web/tailor.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createVault, STORES } from './vault.js';
import { createMemoryAdapter } from './memoryAdapter.js';
import { createKeyStore } from './keyStore.js';
import { createUsageLedger } from './usage.js';
import { createWebTailor } from './tailor.js';
import { fakeClient } from '@sajas/core/testing';
import { callClaude } from '@sajas/core/ai';
import { MODEL_IDS } from '@sajas/core/models';

const KEY = ['sk', 'ant', 'api03', 'B'.repeat(40)].join('-');
const PROFILE = {
  baseCv: 'Kone Tshivhinda. Software developer with ten years of experience building web systems in South Africa.',
  dailyBudgetUSD: 0,
  usePromptCaching: true
};
const JOB = {
  id: 'job-1', title: 'Developer', company: 'Acme', location: 'Cape Town',
  description: 'Build web apps with React and Node.', status: 'found',
  tailoredCvText: '', tailoredCoverLetterText: ''
};
const reply = (text, extra = {}) => ({
  id: 'msg_1', type: 'message', role: 'assistant', model: MODEL_IDS.sonnet,
  content: [{ type: 'text', text }], stop_reason: 'end_turn',
  usage: { input_tokens: 100, output_tokens: 50 }, ...extra
});

function harness(responses, profile = PROFILE, job = JOB) {
  const vault = createVault(createMemoryAdapter({
    profile: { current: profile },
    jobs: { [job.id]: job }
  }));
  const keyStore = createKeyStore({ vault });
  keyStore.setKey(KEY);
  const usage = createUsageLedger({ vault });
  const activity = { entries: [], add(text, type) { this.entries.push({ text, type }); } };
  const fake = fakeClient(responses);
  const tailor = createWebTailor({
    vault, keyStore, usage, activity,
    loadAi: async () => ({ callClaude, makeClient: () => fake.client })
  });
  return { vault, keyStore, usage, activity, fake, tailor };
}

test('tailors a CV and cover letter, saves both, and records usage', async () => {
  const { tailor, vault, usage, fake } = harness([
    reply('```markdown\n# Curated CV\nBuilt web systems.\n```'),
    reply('# Cover Letter\nDear Acme')
  ]);
  const { job, warning } = await tailor.tailorJob('job-1', PROFILE);
  assert.equal(warning, '');
  assert.equal(job.status, 'tailored');
  assert.equal(job.tailoredCvText, '# Curated CV\nBuilt web systems.');
  assert.equal(job.tailoredCoverLetterText, '# Cover Letter\nDear Acme');
  assert.equal((await vault.get(STORES.jobs, 'job-1')).tailoredCvText, job.tailoredCvText);
  assert.equal(fake.calls.length, 2);
  for (const call of fake.calls) {
    assert.equal(call.model, MODEL_IDS.sonnet);
    assert.equal('temperature' in call, false);
    assert.deepEqual(call.system[0].cache_control, { type: 'ephemeral' });
  }
  const summary = await usage.summary(PROFILE);
  assert.equal(summary.today.calls, 2);
  assert.ok(summary.today.estCostUSD > 0);
});

test('keeps the CV when only the cover letter fails', async () => {
  const { tailor, vault } = harness([
    reply('# Curated CV'),
    { __throw: new Error('the connection dropped') }
  ]);
  const { job, warning } = await tailor.tailorJob('job-1', PROFILE);
  assert.match(warning, /connection dropped/);
  assert.equal(job.status, 'tailored');
  assert.equal(job.tailoredCvText, '# Curated CV');
  assert.equal(job.tailoredCoverLetterText, '');
  assert.equal((await vault.get(STORES.jobs, 'job-1')).status, 'tailored');
});

test('restores the previous status and saves nothing when the CV fails', async () => {
  const { tailor, vault } = harness([{ __throw: new Error('overloaded') }]);
  await assert.rejects(() => tailor.tailorJob('job-1', PROFILE), /overloaded/);
  const job = await vault.get(STORES.jobs, 'job-1');
  assert.equal(job.status, 'found');
  assert.equal(job.tailoredCvText, '');
});

test('re-tailoring keeps the old documents when the new CV fails', async () => {
  const existing = { ...JOB, status: 'tailored', tailoredCvText: '# Old CV', tailoredCoverLetterText: '# Old Letter' };
  const { tailor, vault } = harness([{ __throw: new Error('overloaded') }], PROFILE, existing);
  await assert.rejects(() => tailor.tailorJob('job-1', PROFILE), /overloaded/);
  const job = await vault.get(STORES.jobs, 'job-1');
  assert.equal(job.status, 'tailored');
  assert.equal(job.tailoredCvText, '# Old CV');
  assert.equal(job.tailoredCoverLetterText, '# Old Letter');
});

test('a truncated or empty document is never saved', async () => {
  const truncated = harness([reply('# Half a CV', { stop_reason: 'max_tokens' })]);
  await assert.rejects(() => truncated.tailor.tailorJob('job-1', PROFILE), /cut off/);
  assert.equal((await truncated.vault.get(STORES.jobs, 'job-1')).status, 'found');

  const empty = harness([reply('   ')]);
  await assert.rejects(() => empty.tailor.tailorJob('job-1', PROFILE), /came back empty/);
  assert.equal((await empty.vault.get(STORES.jobs, 'job-1')).status, 'found');
});

test('refuses before any request without a key or with a short CV', async () => {
  const noKey = harness([reply('# CV')]);
  await noKey.keyStore.forget();
  await assert.rejects(() => noKey.tailor.tailorJob('job-1', PROFILE), (err) => err.code === 'KEY_INVALID');
  assert.equal(noKey.fake.calls.length, 0);

  const shortCv = harness([reply('# CV')]);
  await assert.rejects(
    () => shortCv.tailor.tailorJob('job-1', { ...PROFILE, baseCv: 'too short' }),
    (err) => err.code === 'VALIDATION'
  );
  assert.equal(shortCv.fake.calls.length, 0);
});

test('the daily cap stops the run before the request', async () => {
  const { tailor, usage, fake, vault } = harness([reply('# CV')], { ...PROFILE, dailyBudgetUSD: 1 });
  await usage.record({ model: MODEL_IDS.sonnet, bucket: 'tailor', inputTokens: 2_000_000 });
  await assert.rejects(
    () => tailor.tailorJob('job-1', { ...PROFILE, dailyBudgetUSD: 1 }),
    (err) => err.code === 'BUDGET_EXCEEDED'
  );
  assert.equal(fake.calls.length, 0);
  assert.equal((await vault.get(STORES.jobs, 'job-1')).status, 'found');
});

test('the key never reaches the vault or a backup', async () => {
  const { tailor, vault } = harness([reply('# CV'), reply('# Letter')]);
  await tailor.tailorJob('job-1', PROFILE);
  assert.equal(JSON.stringify(await vault.exportAll()).includes(KEY), false);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test client/src/web/tailor.test.js
```

Expected: FAIL with `Cannot find module .../tailor.js`.

- [ ] **Step 3: Implement the tailor runner**

Create `client/src/web/tailor.js`:

```js
// Browser Document Tailor: the same prompts as desktop, called directly from the
// page with the user's key. No document text or key reaches our origin.
import { AppError, ERROR_CODES } from '@sajas/core/errors';
import { buildTailorPrompts } from '@sajas/core/tailor';
import { STORES } from './vault.js';

const MIN_CV = 50;

const stripFences = (text = '') => String(text).trim()
  .replace(/^```[a-zA-Z]*\s*\r?\n?/, '')
  .replace(/\r?\n?```\s*$/, '')
  .trim();

function budgetMessage(budget) {
  return `Daily AI budget reached (est. $${budget.spentUSD.toFixed(2)} of $${budget.capUSD.toFixed(2)}). Raise or clear the cap in Profile & Settings, or wait until tomorrow.`;
}

export function createWebTailor({
  vault,
  keyStore,
  usage,
  activity = { add() {} },
  now = () => new Date(),
  loadAi = () => import('@sajas/core/ai')
}) {
  async function saveJob(job) {
    await vault.put(STORES.jobs, job.id, job);
    return job;
  }

  async function tailorJob(jobId, profile = {}) {
    const baseCv = String(profile.baseCv || '').trim();
    if (baseCv.length < MIN_CV) {
      throw new AppError(ERROR_CODES.VALIDATION, 'Your base CV is empty or too short. Paste your full CV in Profile & Settings first.');
    }
    const key = keyStore.getKey();
    if (!key) {
      throw new AppError(ERROR_CODES.KEY_INVALID, 'No Anthropic API key is loaded. Add one in the key panel first.');
    }
    const current = await vault.get(STORES.jobs, jobId);
    if (!current) throw new AppError(ERROR_CODES.NOT_FOUND, 'Job not found.');

    const previousStatus = current.status;
    let job = await saveJob({ ...current, status: 'tailoring' });
    activity.add(`Tailoring started for ${job.title} at ${job.company}.`, 'agent2');

    const { callClaude, makeClient } = await loadAi();
    // The key lives only in this closure and in the SDK client.
    const client = makeClient({ apiKey: key, allowBrowser: true });
    const { system, cvPrompt, coverLetterPrompt } = buildTailorPrompts({ baseCv, job });

    const generate = async (prompt, what) => {
      const pending = [];
      try {
        const result = await callClaude({
          apiKey: key,
          task: 'tailor',
          prompt,
          system,
          cacheSystem: profile.usePromptCaching !== false
        }, {
          client,
          beforeCall: async () => {
            const budget = await usage.budget(profile);
            if (budget.exceeded) {
              throw new AppError(ERROR_CODES.BUDGET_EXCEEDED, budgetMessage(budget));
            }
          },
          onUsage: (u) => pending.push(u),
          onLog: (message, type) => activity.add(message, type || 'system')
        });
        if (result.truncated) {
          throw new AppError(ERROR_CODES.UNKNOWN, `The ${what} was cut off before it finished, so it was not saved. Try again.`);
        }
        const text = stripFences(result.text);
        if (!text) {
          throw new AppError(ERROR_CODES.UNKNOWN, `The ${what} came back empty, so nothing was saved. Try again.`);
        }
        return text;
      } finally {
        for (const u of pending.splice(0)) {
          await usage.record({ ...u, bucket: 'tailor' });
        }
      }
    };

    let tailoredCv;
    try {
      tailoredCv = await generate(cvPrompt, 'tailored CV');
    } catch (err) {
      await saveJob({ ...current, status: previousStatus });
      activity.add(`Tailoring failed for ${job.title}: ${err.message}`, 'error');
      throw err;
    }

    job = await saveJob({ ...job, tailoredCvText: tailoredCv, status: 'tailored' });
    activity.add('Tailored CV saved.', 'agent2');

    let warning = '';
    try {
      const tailoredCoverLetterText = await generate(coverLetterPrompt, 'cover letter');
      job = await saveJob({ ...job, tailoredCoverLetterText });
      activity.add('Tailored cover letter saved.', 'agent2');
    } catch (err) {
      warning = `The cover letter was not generated: ${err.message}`;
      activity.add(warning, 'error');
    }

    return { job, warning };
  }

  return { tailorJob };
}
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
node --test client/src/web/tailor.test.js
```

Expected: PASS, eight tests.

- [ ] **Step 5: Write the failing API test for the tailor route**

Append to `client/src/web/api.test.js`:

```js
test('the tailor route runs in the browser and no longer answers 501', async () => {
  const { call, vault, keyStore } = harness({
    profile: { current: {
      baseCv: 'Kone Tshivhinda. Software developer with ten years of experience building web systems in South Africa.',
      dailyBudgetUSD: 5
    } }
  });
  await seedJob(vault);
  keyStore.setKey(API_KEY);

  const fake = fakeClient([reply('# Web CV'), reply('# Web Letter')]);
  const api = createWebApi({
    apiBase: API_BASE, vault, keyStore, activity: createActivity(),
    loadAi: async () => ({ callClaude, makeClient: () => fake.client })
  });
  const res = await api.handle(`${API_BASE}/jobs/job-1/tailor`, { method: 'POST', body: JSON.stringify({}) });
  assert.equal(res.status, 200);
  const body = await json(res);
  assert.equal(body.success, true);
  assert.equal(body.job.tailoredCvText, '# Web CV');
  assert.equal(body.job.tailoredCoverLetterText, '# Web Letter');

  const usage = await json(await api.handle(`${API_BASE}/usage`));
  assert.equal(usage.today.calls, 2);
  assert.ok(usage.today.estCostUSD > 0);

  const batch = await api.handle(`${API_BASE}/jobs/tailor-batch`, { method: 'POST', body: JSON.stringify({}) });
  assert.equal(batch.status, 501);
});
```

Add these imports to the top of `api.test.js`:

```js
import { fakeClient } from '@sajas/core/testing';
import { callClaude } from '@sajas/core/ai';
import { MODEL_IDS } from '@sajas/core/models';

const reply = (text) => ({
  id: 'msg_1', type: 'message', role: 'assistant', model: MODEL_IDS.sonnet,
  content: [{ type: 'text', text }], stop_reason: 'end_turn',
  usage: { input_tokens: 100, output_tokens: 50 }
});
```

- [ ] **Step 6: Run it and watch it fail**

```bash
node --test client/src/web/api.test.js
```

Expected: FAIL, status 501.

- [ ] **Step 7: Route POST /jobs/:id/tailor and remove it from the server-only list**

In `client/src/web/api.js`, add the import:

```js
import { createWebTailor } from './tailor.js';
```

After the usage ledger, add:

```js
  const tailor = createWebTailor({ vault, keyStore, usage, activity, now, ...(loadAi ? { loadAi } : {}) });
```

In the `SERVER_ONLY` list, delete this line:

```js
  /^\/jobs\/[^/]+\/(?:tailor|apply|referral)$/,
```

and replace it with:

```js
  /^\/jobs\/[^/]+\/(?:apply|referral)$/,
```

Add the route before the generic `/jobs/:id` block:

```js
      if ((match = path.match(/^\/jobs\/([^/]+)\/tailor$/)) && method === 'POST') {
        const profile = (await vault.get(STORES.profile, 'current', {})) || {};
        const result = await tailor.tailorJob(match[1], profile);
        return ok({ success: true, job: result.job, ...(result.warning ? { warning: result.warning } : {}) });
      }
```

- [ ] **Step 8: Run the API and tailor tests**

```bash
node --test client/src/web/api.test.js client/src/web/tailor.test.js
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add client/src/web/tailor.js client/src/web/tailor.test.js client/src/web/api.js client/src/web/api.test.js
git commit -m "feat(web): tailor CVs and cover letters in the browser"
```

---

### Task 4: Finish the web tailor UI and add print

**Files:**
- Create: `sa-job-agent-suite/client/src/print.js`
- Create: `sa-job-agent-suite/client/src/print.test.js`
- Modify: `sa-job-agent-suite/client/src/App.jsx`
- Modify: `sa-job-agent-suite/client/src/index.css`

**Interfaces:**
- Produces: `printDocument({ title, text, open })` returns `true` when a window opened, `false` when blocked or text is empty.
- Consumes: web tailor response `{ job, warning }`.
- Produces: `data-testid="tailored-cv"`, `data-testid="tailored-cover-letter"`, and `data-testid="optimise-cv"` for the browser proof.

- [ ] **Step 1: Write the failing print test**

Create `client/src/print.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { printDocument } from './print.js';

function fakeWindow() {
  const nodes = [];
  const win = {
    focused: false,
    printed: false,
    document: {
      title: '',
      createElement(tag) { return { tag, textContent: '', style: {} }; },
      head: { appendChild(node) { nodes.push(node); } },
      body: { append(...items) { nodes.push(...items); } }
    },
    focus() { win.focused = true; },
    print() { win.printed = true; }
  };
  win.nodes = nodes;
  return win;
}

test('writes the document as text and calls print', () => {
  const win = fakeWindow();
  const ok = printDocument({ title: 'Tailored CV', text: '# CV\nBuilt things <b>safely</b>.', open: () => win });
  assert.equal(ok, true);
  assert.equal(win.document.title, 'Tailored CV');
  assert.ok(win.nodes.some((node) => node.tag === 'h1' && node.textContent === 'Tailored CV'));
  assert.ok(win.nodes.some((node) => node.tag === 'pre' && node.textContent.includes('<b>safely</b>')));
  assert.equal(win.focused, true);
  assert.equal(win.printed, true);
});

test('reports a blocked window and refuses empty text', () => {
  assert.equal(printDocument({ title: 'CV', text: 'x', open: () => null }), false);
  assert.equal(printDocument({ title: 'CV', text: '   ', open: () => fakeWindow() }), false);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test client/src/print.test.js
```

Expected: FAIL with `Cannot find module .../print.js`.

- [ ] **Step 3: Implement print**

Create `client/src/print.js`:

```js
// Print a generated document through the browser's print dialog. The text is
// inserted with textContent, never HTML, so a generated document cannot inject
// markup into the print window.
const PRINT_STYLE = 'body{font-family:Georgia,serif;max-width:46rem;margin:2rem auto;line-height:1.5;color:#111}pre{white-space:pre-wrap;font-family:inherit;font-size:12pt}h1{font-size:14pt;margin-bottom:1.5rem}';

export function printDocument({ title, text, open = globalThis.open }) {
  if (!String(text || '').trim()) return false;
  const win = open('', '_blank');
  if (!win) return false;

  const doc = win.document;
  doc.title = title;
  const style = doc.createElement('style');
  style.textContent = PRINT_STYLE;
  const heading = doc.createElement('h1');
  heading.textContent = title;
  const body = doc.createElement('pre');
  body.textContent = text;
  doc.head.appendChild(style);
  doc.body.append(heading, body);
  win.focus();
  win.print();
  return true;
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
node --test client/src/print.test.js
```

Expected: PASS.

- [ ] **Step 5: Update the tailor flow in App.jsx**

Add imports near the other client imports:

```js
import { printDocument } from './print.js';
```

Replace `triggerTailor` with:

```js
  const triggerTailor = async (jobId) => {
    setTailoringJobId(jobId);
    try {
      const res = await fetch(`${API_BASE}/jobs/${jobId}/tailor`, { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        if (IS_WEB && data.job) {
          setJobs((list) => list.map((job) => (job.id === data.job.id ? data.job : job)));
          setSelectedJob((job) => (job && job.id === data.job.id ? data.job : job));
          if (data.warning) {
            toasts.error(data.warning, 'Cover letter not generated');
          } else {
            toasts.success('Your tailored CV and cover letter are ready.', 'Tailoring complete');
          }
        } else {
          toasts.info('Tailoring started. Watch the job status update when complete.', 'Tailor started');
          await fetchJobs();
        }
      } else {
        fail(contractFromBody(data, res.status, 'Tailoring failed. Check the logs for details.'), 'tailor job');
      }
    } catch (err) {
      fail(err, 'tailor job', 'Network error while tailoring.');
    } finally {
      setTailoringJobId(null);
    }
  };

  const printText = (title, text) => {
    if (!text) return toasts.error('Nothing to print yet.');
    const opened = printDocument({ title, text });
    if (!opened) toasts.error('The print window was blocked. Allow pop-ups for this site, or use Copy.');
  };
```

- [ ] **Step 6: Add print to the document boxes and a web note**

Replace the two `<DocumentBox ... />` blocks with:

```jsx
                    <DocumentBox
                      testId="tailored-cv"
                      title="Tailored CV"
                      tone="accent"
                      text={selectedJob.tailoredCvText}
                      filename={`CV_${slug(selectedJob.title)}_${slug(selectedJob.company)}.md`}
                      onCopy={copyText}
                      onDownload={downloadText}
                      onPrint={printText}
                    />
                    <DocumentBox
                      testId="tailored-cover-letter"
                      title="Tailored Cover Letter"
                      tone="info"
                      text={selectedJob.tailoredCoverLetterText}
                      filename={`CoverLetter_${slug(selectedJob.title)}_${slug(selectedJob.company)}.md`}
                      onCopy={copyText}
                      onDownload={downloadText}
                      onPrint={printText}
                    />
```

Add this note after the button row in the selected job header, before the job description details:

```jsx
                {IS_WEB && (
                  <p className="hint" style={{ marginBottom: 16 }}>
                    Web tailoring uses your base CV and the job description. Company research and employer notes stay in the desktop app.
                  </p>
                )}
```

- [ ] **Step 7: Update DocumentBox**

Replace the `DocumentBox` function signature and toolbar with:

```jsx
function DocumentBox({ title, tone, text, filename, onCopy, onDownload, onPrint, testId }) {
  const color = tone === 'accent' ? 'var(--color-accent)' : 'var(--color-info)';
  return (
    <div className="panel" style={{ padding: 16, background: 'var(--bg-surface-2)' }} data-testid={testId}>
      <div className="flex-between" style={{ marginBottom: 10 }}>
        <h4 style={{ fontSize: 14, color }}>{title}</h4>
        <div className="flex-gap">
          <button type="button" className="btn-ghost btn-xs" onClick={() => onCopy(text, `${title} copied to clipboard.`)}>
            <Copy size={12} /> Copy
          </button>
          <button type="button" className="btn-ghost btn-xs" onClick={() => onDownload(text, filename)}>
            <Download size={12} /> .md
          </button>
          <button type="button" className="btn-ghost btn-xs" onClick={() => onPrint(title, text)}>
            <Printer size={12} /> Print
          </button>
        </div>
      </div>
```

Add `Printer` to the lucide import list in `App.jsx` (alphabetical position near `Play`/`Plus` is fine).

Add `data-testid="optimise-cv"` to the main tailor button:

```jsx
                    <button data-testid="optimise-cv" className="btn-primary" onClick={() => triggerTailor(selectedJob.id)} disabled={tailoringJobId === selectedJob.id || selectedJob.status === 'tailoring'}>
```

- [ ] **Step 8: Add the toast action style**

Append to `client/src/index.css` near the toast rules:

```css
.toast-action {
  align-self: flex-start;
  margin-top: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-accent);
  text-decoration: underline;
}
```

- [ ] **Step 9: Build and run the design gate**

```bash
npm run build:client
npm run build:web
npm run test:web
```

Expected: builds pass. The existing E2E still passes. The tailor UI is now print-ready.

- [ ] **Step 10: Commit**

```bash
git add client/src/print.js client/src/print.test.js client/src/App.jsx client/src/index.css
git commit -m "feat(web): show tailored documents, print them, and surface the web scope"
```

---

### Task 5: Add support, the Help tab, and the Get help action

**Files:**
- Create: `sa-job-agent-suite/client/src/support.js`
- Create: `sa-job-agent-suite/client/src/support.test.js`
- Create: `sa-job-agent-suite/client/src/Help.jsx`
- Modify: `sa-job-agent-suite/client/src/App.jsx`
- Modify: `sa-job-agent-suite/client/src/Landing.jsx`
- Modify: `sa-job-agent-suite/client/src/index.css`

**Interfaces:**
- Produces: `SUPPORT` with `name`, `email`, `phone`, `phoneHref`, `linkedin`, `github`, `location`.
- Produces: `FAQ`, an array of `{ q, a }`.
- Produces: `supportMailto(info)` returning a `mailto:` URL whose body has code, message, hint, requestId, time, where, surface, page, and browser, and no details, key, profile, job, or CV text.

- [ ] **Step 1: Write the failing support test**

Create `client/src/support.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { SUPPORT, FAQ, supportMailto } from './support.js';

const KEY = ['sk', 'ant', 'api03', 'C'.repeat(40)].join('-');

test('the support details are the approved public ones', () => {
  assert.equal(SUPPORT.email, 'erictshivhinda@gmail.com');
  assert.equal(SUPPORT.phone, '+27 81 302 5435');
  assert.equal(SUPPORT.phoneHref, 'tel:+27813025435');
  assert.equal(SUPPORT.github, 'https://github.com/konethegreat');
  assert.ok(SUPPORT.linkedin.includes('kone-tshivhinda'));
  assert.equal(SUPPORT.location, 'Johannesburg, South Africa');
  assert.ok(FAQ.length >= 4);
});

test('the report link carries diagnostics but never a key or personal content', () => {
  const info = {
    code: 'BUDGET_EXCEEDED',
    message: 'The daily AI budget has been reached.',
    hint: 'Raise the daily budget in Settings, or wait until tomorrow.',
    requestId: 'local-abc123',
    at: '2026-10-27T10:00:00.000Z',
    where: 'tailor job',
    details: 'CV text that must not be emailed'
  };
  const href = supportMailto(info);
  assert.match(href, /^mailto:erictshivhinda@gmail\.com\?/);
  const decoded = decodeURIComponent(href.split('?')[1]);
  assert.match(decoded, /BUDGET_EXCEEDED/);
  assert.match(decoded, /local-abc123/);
  assert.match(decoded, /tailor job/);
  assert.equal(decoded.includes('CV text that must not be emailed'), false);
  assert.equal(decoded.includes(KEY), false);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test client/src/support.test.js
```

Expected: FAIL with `Cannot find module .../support.js`.

- [ ] **Step 3: Implement the support helper**

Create `client/src/support.js`:

```js
// The public support details and the diagnostics-only report link. The report
// deliberately omits error details and every user document so a bug report can
// never carry a key, profile, job, or CV text.
import { IS_WEB } from './web/env.js';

export const SUPPORT = Object.freeze({
  name: 'Kone Tshivhinda',
  email: 'erictshivhinda@gmail.com',
  phone: '+27 81 302 5435',
  phoneHref: 'tel:+27813025435',
  linkedin: 'https://www.linkedin.com/in/kone-tshivhinda-32a760233',
  github: 'https://github.com/konethegreat',
  location: 'Johannesburg, South Africa'
});

export const FAQ = Object.freeze([
  {
    q: 'Where is my API key stored?',
    a: 'The key lives in this tab while it is open. If you choose the encrypted option, it is saved on this device behind your passphrase. It is sent only to Anthropic, never to this site.'
  },
  {
    q: 'Where is my data stored?',
    a: 'Your profile, jobs, documents, and usage history stay in this browser. There are no accounts and no server copy. Use Backup to keep your own copy.'
  },
  {
    q: 'What does tailoring cost?',
    a: 'Anthropic bills the account behind your own key. The Usage panel shows an estimate, and the daily cap stops new runs when today reaches it.'
  },
  {
    q: 'Does SA-JAS submit applications for me?',
    a: 'No. It prepares the documents and can open the application page. You review and submit.'
  },
  {
    q: 'Why did my key stop working?',
    a: 'Check that it is a standard API key (not an admin key), that the Anthropic account has credit, and that the daily cap has not been reached.'
  }
]);

function environment() {
  const location = typeof globalThis.location !== 'undefined' ? globalThis.location : null;
  const nav = typeof globalThis.navigator !== 'undefined' ? globalThis.navigator : null;
  return [
    `surface: ${IS_WEB ? 'web' : 'desktop'}`,
    `page: ${location?.pathname || 'unknown'}`,
    `browser: ${nav?.userAgent || 'unknown'}`
  ].join('\n');
}

export function supportMailto(info = null) {
  const subject = info?.code ? `SA-JAS support: ${info.code}` : 'SA-JAS support request';
  const lines = info ? [
    'SA-JAS diagnostics',
    `code: ${info.code || 'UNKNOWN'}`,
    `message: ${info.message || ''}`,
    `hint: ${info.hint || ''}`,
    `requestId: ${info.requestId || 'unknown'}`,
    `at: ${info.at || new Date().toISOString()}`,
    `where: ${info.where || 'unknown'}`
  ] : ['SA-JAS support request'];
  const body = [...lines, '', environment(), '', 'What happened:', ''].join('\n');
  return `mailto:${SUPPORT.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
node --test client/src/support.test.js
```

Expected: PASS.

- [ ] **Step 5: Create the Help tab**

Create `client/src/Help.jsx`:

```jsx
import React from 'react';
import { Mail, Phone, MapPin, Send } from 'lucide-react';
import SocialLinks from './SocialLinks.jsx';
import { SUPPORT, FAQ, supportMailto } from './support.js';

export default function Help({ lastError = null }) {
  return (
    <div className="panel fade-in" style={{ padding: 24 }}>
      <h3 style={{ fontSize: 18, marginBottom: 8 }}>Help and support</h3>
      <p className="muted" style={{ fontSize: 13, marginBottom: 20 }}>
        Every feature runs with your own Anthropic key. If something does not work, send the diagnostics below and Kone will look at it.
      </p>

      <div className="grid-2">
        <div className="panel" style={{ padding: 18, background: 'var(--bg-surface-2)' }}>
          <h4 style={{ fontSize: 15, marginBottom: 12 }}>Contact</h4>
          <p style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <Mail size={14} aria-hidden="true" />
            <a href={`mailto:${SUPPORT.email}`}>{SUPPORT.email}</a>
          </p>
          <p style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginTop: 8 }}>
            <Phone size={14} aria-hidden="true" />
            <a href={SUPPORT.phoneHref}>{SUPPORT.phone}</a>
          </p>
          <p style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginTop: 8 }}>
            <MapPin size={14} aria-hidden="true" />
            {SUPPORT.location}
          </p>
          <div style={{ marginTop: 12 }}><SocialLinks /></div>
        </div>

        <div className="panel" style={{ padding: 18, background: 'var(--bg-surface-2)' }}>
          <h4 style={{ fontSize: 15, marginBottom: 12 }}>Report a problem</h4>
          <p className="hint" style={{ marginBottom: 12 }}>
            The report includes the error code, a request ID, the page, and your browser. It never includes your key, profile, jobs, or documents.
          </p>
          <a className="btn-primary btn-sm" href={supportMailto(lastError)} data-testid="support-report">
            <Send size={12} /> Email a report
          </a>
        </div>
      </div>

      <h4 style={{ fontSize: 15, marginTop: 24, marginBottom: 8 }}>Common questions</h4>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {FAQ.map((item) => (
          <details key={item.q} className="panel" style={{ padding: 12, background: 'var(--bg-surface-2)' }}>
            <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>{item.q}</summary>
            <p className="muted" style={{ fontSize: 12.5, marginTop: 8, lineHeight: 1.6 }}>{item.a}</p>
          </details>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Add the Help tab and the toast action in App.jsx**

Add imports:

```js
import Help from './Help.jsx';
import { getRecentErrors } from './errors.js';
import { supportMailto } from './support.js';
```

Add `LifeBuoy` to the lucide import list.

In `useToasts`, change `error` to accept options:

```js
    error: (msg, title = 'Error', options = {}) => push({ type: 'error', title, msg, duration: options.action ? 10_000 : 4_500, ...options }),
```

In `ToastStack`, after the message div and before the close button, add:

```jsx
          {toast.action && (
            <a className="toast-action" href={toast.action.href}>{toast.action.label}</a>
          )}
```

In `fail`, replace the toast call with:

```js
    toasts.error(describeUserError(info), info.code, {
      action: { label: 'Get help', href: supportMailto(info) }
    });
```

Add the sidebar link after Profile & Settings:

```jsx
          <SidebarLink active={activeTab === 'help'} onClick={() => setActiveTab('help')} icon={<LifeBuoy size={16} />}>Help &amp; Support</SidebarLink>
```

Add the panel near the profile tab:

```jsx
        {activeTab === 'help' && <Help lastError={getRecentErrors()[0] || null} />}
```

- [ ] **Step 7: Add the landing support section**

In `Landing.jsx`, add the import:

```js
import { SUPPORT, FAQ } from './support.js';
```

Before the footer, add:

```jsx
        <section className="landing-section reveal" id="support" aria-labelledby="support-title">
          <div className="landing-section-head">
            <h2 id="support-title">Support</h2>
            <p className="landing-section-sub">Reach the person who built it.</p>
          </div>
          <div className="grid-2">
            <div className="panel support-card">
              <h3>Contact</h3>
              <p><a href={`mailto:${SUPPORT.email}`}>{SUPPORT.email}</a></p>
              <p><a href={SUPPORT.phoneHref}>{SUPPORT.phone}</a></p>
              <p>{SUPPORT.location}</p>
              <div style={{ marginTop: 12 }}><SocialLinks /></div>
            </div>
            <div className="panel support-card">
              <h3>Common questions</h3>
              {FAQ.slice(0, 3).map((item) => (
                <details key={item.q}>
                  <summary>{item.q}</summary>
                  <p>{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
```

Add a Support anchor to the landing nav. Find the nav links near the top of `Landing.jsx` and add:

```jsx
          <a href="#support">Support</a>
```

- [ ] **Step 8: Style the support cards**

Append to `client/src/index.css`:

```css
.support-card h3 {
  font-size: 15px;
  margin-bottom: 10px;
}
.support-card p {
  font-size: 13px;
  color: var(--text-secondary);
  margin-top: 6px;
}
.support-card a {
  color: var(--color-info);
}
.support-card details {
  margin-top: 8px;
}
.support-card summary {
  cursor: pointer;
  font-size: 13px;
  color: var(--text-primary);
}
```

- [ ] **Step 9: Run the client tests and the design gate**

```bash
node --test client/src/support.test.js client/src/print.test.js
npm run build:web
npm run test:web
```

Expected: PASS. `check-ui.mjs` finds no em dash or emoji and the contrast checks still pass.

- [ ] **Step 10: Commit**

```bash
git add client/src/support.js client/src/support.test.js client/src/Help.jsx client/src/App.jsx client/src/Landing.jsx client/src/index.css
git commit -m "feat(ui): add support, FAQ, and diagnostics-only reports"
```

---

### Task 6: Prove the whole flow in a real browser

**Files:**
- Create: `sa-job-agent-suite/scripts/web-tailor.mjs`
- Modify: `sa-job-agent-suite/package.json`

**Interfaces:**
- Consumes: the built `client/dist`, the web API, the mocked Anthropic host.
- Produces: an offline Playwright proof added to `npm run test:web`.

- [ ] **Step 1: Write the browser proof**

Create `scripts/web-tailor.mjs`:

```js
// Offline proof that web tailoring works end to end: key entry, a mocked
// Anthropic stream, saved documents, copy, print, the budget stop, support, and
// persistence. No request leaves the machine except the mocked Anthropic host.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startStaticServer } from './lib/staticServer.mjs';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'client/dist');
const KEY = ['sk', 'ant', 'api03', 'D'.repeat(40)].join('-');
const TODAY = new Date().toISOString().slice(0, 10);

const PROFILE = {
  fullName: 'Kone Tshivhinda',
  email: 'test@example.com',
  baseCv: 'Kone Tshivhinda. Software developer with ten years of experience building web systems and leading small teams in South Africa.',
  dailyBudgetUSD: 5,
  usePromptCaching: true
};

const JOB = {
  id: 'job-e2e', title: 'Full Stack Developer', company: 'Acme',
  location: 'Cape Town', description: 'Build web applications with React and Node.',
  applyUrl: 'https://example.com/apply', datePosted: '2026-10-20',
  matchScore: 88, status: 'found', notes: '', source: 'Manual',
  tailoredCvText: '', tailoredCoverLetterText: '', dateAdded: '2026-10-20'
};

function sse(text) {
  const chunks = text.match(/[\s\S]{1,24}/g) || [''];
  const events = [
    `event: message_start\ndata: ${JSON.stringify({
      type: 'message_start',
      message: {
        id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5',
        content: [], stop_reason: null, stop_sequence: null,
        usage: { input_tokens: 1200, output_tokens: 1 }
      }
    })}\n\n`,
    `event: content_block_start\ndata: ${JSON.stringify({
      type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' }
    })}\n\n`
  ];
  for (const chunk of chunks) {
    events.push(`event: content_block_delta\ndata: ${JSON.stringify({
      type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: chunk }
    })}\n\n`);
  }
  events.push(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`);
  events.push(`event: message_delta\ndata: ${JSON.stringify({
    type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 450 }
  })}\n\n`);
  events.push(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
  return events.join('');
}

async function seed(page) {
  await page.evaluate(async ({ profile, job }) => {
    const stores = ['profile', 'jobs', 'answers', 'memory', 'usage', 'meta', 'keyVault'];
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('sajas-web', 1);
      request.onupgradeneeded = () => {
        for (const store of stores) {
          if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['profile', 'jobs', 'meta'], 'readwrite');
      tx.objectStore('profile').put(profile, 'current');
      tx.objectStore('jobs').put(job, job.id);
      tx.objectStore('meta').put({ onboarded: true }, 'app');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }, { profile: PROFILE, job: JOB });
}

async function forceBudget(page) {
  await page.evaluate(async ({ today }) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('sajas-web', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['profile', 'usage'], 'readwrite');
      const profiles = tx.objectStore('profile');
      const get = profiles.get('current');
      get.onsuccess = () => {
        profiles.put({ ...get.result, dailyBudgetUSD: 1 }, 'current');
        tx.objectStore('usage').put({
          days: {
            [today]: {
              calls: 1, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
              cacheWriteTokens: 0, webSearches: 0, estCostUSD: 25, byBucket: {}
            }
          }
        }, 'days');
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }, { today: TODAY });
}

async function main() {
  try {
    await fs.access(path.join(dist, 'index.html'));
  } catch {
    throw new Error('client/dist/index.html is missing. Run npm run build:web first.');
  }

  const server = await startStaticServer({ root: dist });
  const origin = new URL(server.url).origin;
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    await context.addInitScript(() => { window.print = () => { window.__sajasPrinted = true; }; });

    const errors = [];
    const requests = [];
    const anthropicHeaders = [];
    const page = await context.newPage();
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('request', (request) => requests.push({ url: request.url(), body: request.postData() || '' }));

    await context.route('https://api.anthropic.com/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      anthropicHeaders.push(request.headers());
      if (url.pathname === '/v1/models') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
      let prompt = '';
      try { prompt = JSON.stringify(request.postDataJSON()?.messages || ''); } catch { /* no body */ }
      const text = prompt.includes('Tailored Cover Letter')
        ? '# Tailored Cover Letter\n\nDear Acme, I build reliable web systems.\n'
        : '# Tailored CV\n\nKone Tshivhinda\n\nBuilt web systems with React and Node.\n';
      return route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream', 'request-id': 'req_test' },
        body: sse(text)
      });
    });

    await page.goto(server.url, { waitUntil: 'networkidle' });
    await page.getByTestId('onboarding').waitFor({ timeout: 20_000 });
    await seed(page);

    await page.getByTestId('key-input').fill(KEY);
    await page.getByTestId('key-submit').click();
    await page.getByRole('button', { name: /Enter the Suite/i }).click({ timeout: 20_000 });

    await page.getByRole('button', { name: /Document Tailor/i }).click();
    await page.getByRole('button', { name: /Full Stack Developer/i }).click();
    await page.getByTestId('optimise-cv').click();

    await page.getByTestId('tailored-cv').waitFor({ timeout: 60_000 });
    assert.match(await page.getByTestId('tailored-cv').locator('textarea').inputValue(), /# Tailored CV/);
    assert.match(await page.getByTestId('tailored-cover-letter').locator('textarea').inputValue(), /# Tailored Cover Letter/);
    assert.equal(await page.getByText('Your tailored CV and cover letter are ready.').count(), 1);

    await page.getByTestId('tailored-cv').getByRole('button', { name: /Copy/i }).click();
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(clipboard, /# Tailored CV/);

    const popupPromise = page.waitForEvent('popup');
    await page.getByTestId('tailored-cv').getByRole('button', { name: /Print/i }).click();
    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded');
    assert.match(await popup.locator('pre').textContent(), /# Tailored CV/);
    assert.equal(await popup.evaluate(() => window.__sajasPrinted), true);

    await forceBudget(page);
    await page.getByTestId('optimise-cv').click();
    const help = page.getByRole('link', { name: /Get help/i });
    await help.waitFor({ timeout: 20_000 });
    assert.match(await page.getByText(/Daily AI budget reached/i).first().textContent(), /Daily AI budget reached/);
    assert.match(await help.getAttribute('href'), /^mailto:erictshivhinda@gmail\.com/);
    assert.match(decodeURIComponent(await help.getAttribute('href')), /BUDGET_EXCEEDED/);
    assert.match(await page.getByTestId('tailored-cv').locator('textarea').inputValue(), /# Tailored CV/);

    await page.getByRole('button', { name: /Help & Support/i }).click();
    assert.ok(await page.locator('a[href="mailto:erictshivhinda@gmail.com"]').count() > 0);
    assert.ok(await page.locator('a[href="tel:+27813025435"]').count() > 0);
    assert.ok(await page.getByText('Common questions').count() > 0);
    assert.match(await page.getByTestId('support-report').getAttribute('href'), /^mailto:erictshivhinda@gmail\.com/);

    await page.getByRole('button', { name: /Home \/ About/i }).click();
    assert.ok(await page.getByRole('heading', { name: 'Support' }).count() > 0);
    assert.ok(await page.locator('#support a[href="mailto:erictshivhinda@gmail.com"]').count() > 0);

    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /Enter the Suite/i }).click({ timeout: 20_000 });
    await page.getByRole('button', { name: /Document Tailor/i }).click();
    await page.getByRole('button', { name: /Full Stack Developer/i }).click();
    assert.match(await page.getByTestId('tailored-cv').locator('textarea').inputValue(), /# Tailored CV/);

    assert.equal((await page.content()).includes(KEY), false, 'the key appeared in the DOM');
    const storage = await page.evaluate(async () => {
      const dump = { local: JSON.stringify(localStorage), session: JSON.stringify(sessionStorage) };
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('sajas-web', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const stores = ['profile', 'jobs', 'answers', 'memory', 'usage', 'meta', 'keyVault'];
      for (const store of stores) {
        dump[store] = await new Promise((resolve, reject) => {
          const tx = db.transaction(store, 'readonly').objectStore(store).getAll();
          tx.onsuccess = () => resolve(JSON.stringify(tx.result));
          tx.onerror = () => reject(tx.error);
        });
      }
      return dump;
    });
    assert.equal(JSON.stringify(storage).includes(KEY), false, 'the key reached persistent storage');

    for (const request of requests) {
      assert.equal(request.url.includes(KEY), false, 'the key appeared in a request URL');
      assert.equal(request.body.includes(KEY), false, 'the key appeared in a request body');
      assert.equal(request.url.startsWith('http://localhost:5000'), false, 'an API call escaped the in-page port');
    }
    assert.ok(anthropicHeaders.length >= 2, 'the Anthropic host was not called');
    for (const headers of anthropicHeaders) {
      assert.equal(headers['anthropic-dangerous-direct-browser-access'], 'true');
    }
    assert.deepEqual(errors, [], `console errors: ${errors.join(' | ')}`);

    console.log('web-tailor: ok');
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: Add it to the web test command**

In `sa-job-agent-suite/package.json`, change `test:web` to:

```json
    "test:web": "node scripts/check-ui.mjs && node scripts/web-canary.mjs && node scripts/web-feeds.mjs && node scripts/web-isolation.mjs && node scripts/web-ui.mjs && node scripts/web-tailor.mjs",
```

- [ ] **Step 3: Run the proof**

```bash
npm run build:web
node scripts/web-tailor.mjs
```

Expected: `web-tailor: ok`.

If the SDK sends a beta request path, the route still matches `/v1/messages`; if the SDK rejects the SSE shape, compare the first failing event with the SDK's `MessageStream` parser and add the missing event, do not weaken the assertion.

- [ ] **Step 4: Run the full web gate**

```bash
npm run test:web
```

Expected: PASS, including the new proof.

- [ ] **Step 5: Commit**

```bash
git add scripts/web-tailor.mjs package.json
git commit -m "test(web): prove tailoring, print, budget stop, and support in a browser"
```

---

### Task 7: Documentation, gates, PR, deploy, and live check

**Files:**
- Modify: `README.md`
- Modify: `SECURITY.md`
- Modify: `docs/superpowers/specs/2026-10-27-web-tailoring-support-design.md` (status)
- Modify: `docs/superpowers/specs/2026-10-27-post-m3a3-pipeline.md` (Arc 4 status)

**Interfaces:**
- Produces: accurate public copy for the hosted app.
- Produces: a merged, deployed, live-checked Arc 4.

- [ ] **Step 1: Update the hosted web section in README.md**

Replace lines 111 to 119 with:

```markdown
The alpha is a browser workbench, not the full suite: your profile, the job
tracker, candidate memory, settings and Document Tailor work and persist in
this browser. Tailoring calls Anthropic directly with your own key and never
sends your documents to this site. Hunting and the apply copilot are desktop
features; the Copilot, Referrals, Routines and Logs tabs are hidden in web
mode. Job Feeds is available in web mode.
```

Immediately after that paragraph, add:

```markdown
### Tailoring in the browser

1. Add a standard Anthropic API key in the key panel. It stays in the tab.
2. Paste your base CV in Profile & Settings.
3. Open Document Tailor, pick a job, and choose Optimise CV and letter.
4. Copy, download the Markdown, or print to PDF.

Usage and estimated spend appear in Profile & Settings, and the daily cap stops
a run before the request when today reaches it. Company research and employer
notes remain desktop-only.

### Support

The landing page and the Help and Support tab list Kone's public contact
details and an FAQ. Every error toast offers Get help, which opens an email
with the error code, request ID, page, and browser. The report never includes
your key, profile, jobs, or documents.
```

Update the repository tree line:

```markdown
            ├── tailorPrompts.js   # moved to packages/core/src/tailorPrompts.js
```

- [ ] **Step 2: Update SECURITY.md**

In the hosted web table, extend the isolation row with:

```markdown
Tailoring runs in the page against `api.anthropic.com`; the key stays in the tab closure and the outbound header. Usage history is stored in IndexedDB without key material. Support reports are built from error metadata only and exclude error details, the profile, jobs, CV text, and the key.
```

Add a new row after the merge gate:

```markdown
| Support reports | Generated only when the user clicks Get help or Email a report. The body contains the error code, safe message, request ID, time, page, surface, and browser. It excludes error details, the profile, jobs, documents, and the key. |
```

- [ ] **Step 3: Mark the spec and pipeline shipped**

In the spec header, change:

```markdown
**Status:** approved, implementing
```

to:

```markdown
**Status:** implemented 2026-10-27
```

In the pipeline row, change Arc 4 status to `Shipped 2026-10-27 (PR #<number>)` after the merge, and add an evidence paragraph after the Arc 4 criteria:

```markdown
**Shipped 2026-10-27 in PR #<number>.** Evidence: `npm run test:web` runs `scripts/web-tailor.mjs`, which drives key entry, a mocked Anthropic stream, both documents, copy, print, the budget stop, the support tab, the landing support section, persistence, and the key canary.
```

- [ ] **Step 4: Run every gate from `sa-job-agent-suite/`**

```bash
npm test
npm run test:demo
npm run build:client
npm run build:web
npm run test:web
```

Then from the repo root:

```bash
node tools/check-secrets.mjs --all
```

Expected: every command exits 0. The secret scan reports no findings.

- [ ] **Step 5: Commit, push, and open the PR**

```bash
git add README.md SECURITY.md docs/superpowers/specs
git commit -m "docs: document browser tailoring, spend caps, and support"
git push -u origin feat/web-tailoring-support
gh pr create --title "feat(web): browser tailoring and a real support path" --body "$(cat <<'EOF'
## Summary
- Tailor CVs and cover letters in the hosted app with the user's own key, sharing the desktop prompts
- Track usage and enforce the daily cap in the browser, with a real Usage panel
- Add copy, Markdown download, and print to PDF
- Add a landing support section, a Help tab, and a diagnostics-only Get help action

## Test plan
- [ ] `npm test`
- [ ] `npm run test:demo`
- [ ] `npm run build:client`
- [ ] `npm run build:web`
- [ ] `npm run test:web`
- [ ] `node tools/check-secrets.mjs --all`
- [ ] Live check on the deployed URL: add a key, tailor a job, copy and print, reach Help
EOF
)"
```

- [ ] **Step 6: Merge the green PR**

```bash
gh pr checks --watch
gh pr merge --squash --delete-branch
```

Only merge when every check is green. Do not force-push main.

- [ ] **Step 7: Deploy and check the live flow**

```bash
git fetch origin
git checkout --detach origin/main
npm run build:web
npx wrangler pages deploy client/dist --project-name sajas --branch main
```

Then verify on https://sajas.pages.dev with a real key:

1. Add the key, paste a base CV, and tailor one saved job.
2. Confirm both documents, Copy, Print, and the Usage numbers.
3. Reach Help and Support from the sidebar and the landing page.
4. Confirm no console error and no request to our origin that carries the key.

Record the deployment ID and the checks in the PR and in project memory.

---

## Self-Review

**Spec coverage:** browser tailoring (Tasks 1, 3, 4), shared prompts (Task 1), usage and cap (Task 2, 3), copy and print (Task 4), support (Task 5), security and diagnostics (Tasks 3, 5), browser proof (Task 6), docs and live check (Task 7). No spec section is unimplemented.

**Type consistency:** `createUsageLedger` returns `summary` and `budget` used exactly as defined. `createWebTailor` returns `{ job, warning }`, which the API and the client both consume. `printDocument` returns a boolean that `printText` checks. `supportMailto` accepts the error contract object returned by `recordError`.

**Global constraints:** no sampling parameters, no key in storage, no live Anthropic call, no em dashes, SDK loaded lazily, tests offline.
