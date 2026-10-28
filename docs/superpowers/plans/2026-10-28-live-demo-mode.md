# Hosted Live Demo Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-tab demo mode to the hosted web app that simulates every surface on fictional data, switches back to the real workspace on exit, and shares no storage, key, network destination or runtime state with it.

**Architecture:** A second runtime sits behind the one fetch seam. `client/src/web/runtime.js` becomes a stable dispatcher that reads a `sessionStorage` mode flag and forwards `/api/*` calls to either the existing IndexedDB runtime or a lazily imported demo runtime. The demo runtime builds the same `createWebApi` over a `sessionStorage` vault under `sajas:demo:`, with a stub key store, then wraps it in a simulation router for tailor, ask, check and the simulated copilot submission. Demo UI and fixtures load only after the visitor enters the demo.

**Tech Stack:** Node 22 ESM, React 18, Vite 7, Playwright Chromium, node:test, Cloudflare Pages static hosting.

**Spec:** [docs/superpowers/specs/2026-10-28-live-demo-mode-design.md](../specs/2026-10-28-live-demo-mode-design.md)

## Global Constraints

- No Anthropic key exists and none may be set. Never run `npm run smoke:live`, `node evals/run.mjs --live`, or anything needing `ANTHROPIC_API_KEY`.
- Every test is offline. No live scraping, no live application, no request to Anthropic or any upstream feed.
- Key-shaped strings are assembled at runtime from fragments. Never commit a literal that looks like a key.
- Never bypass the pre-commit hook. `--no-verify` is forbidden.
- Provider names live only in `server/src/db/migrations.js`. Model-ID literals live only in `packages/core/src/models.js` and `*.test.js`.
- Non-GET desktop requests carry `X-SAJAS-Client: 1`.
- Run npm commands from `sa-job-agent-suite/`. Run `node tools/check-secrets.mjs --all` from the worktree root.
- Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- No em dashes in UI copy, docs or chat. The existing `scripts/check-ui.mjs` scan enforces this for `client/src/**`.
- Demo mode never reads or writes IndexedDB, never reads or holds a key, and never calls `fetch` outside the intercepted API base.
- Every demo link and email uses a reserved `.test` domain.
- The desktop app, `SYNTHETIC_DEMO`, `server/src/demo.js` and the desktop copilot are untouched.

---

## File Structure

**Demo runtime (`client/src/web/demo/`)**
- Create `mode.js`: pure per-tab mode controller, storage probe.
- Create `sessionAdapter.js`: `sessionStorage` vault adapter with the demo prefix and a memory fallback.
- Create `fixtures.js`: the fictional universe, feed rows, seed builder and vault seeder.
- Create `feed.js`: local feed client in the real result shape.
- Create `simulationApi.js`: simulation router for tailor, ask, check and simulated apply.
- Create `runtime.js`: lazy demo runtime that seeds the vault, builds the API and exposes persistence.
- Create `progress.js`: suggested-step progress in the demo namespace.
- Create `DemoBanner.jsx`, `DemoTrialStrip.jsx`: demo chrome.
- Create `SimulatedHunter.jsx`, `SimulatedCopilot.jsx`: staged simulated agents.

**Tests**
- Create `mode.test.js`, `sessionAdapter.test.js`, `fixtures.test.js`, `feed.test.js`, `simulationApi.test.js`, `runtime.test.js`, `progress.test.js`, `isolation.test.js` beside the modules.

**Web seam**
- Modify `client/src/web/runtime.js`: dispatcher, `enterDemo`, `exitDemo`, mode subscription.
- Modify `client/src/main.jsx`: install the dispatcher.
- Modify `client/src/web/install.test.js`: prove the dispatcher can switch handlers without reinstalling.
- Modify `client/src/web/feeds.js`: async `getFeedClient()` returns the demo client in demo mode.
- Modify `client/src/JobFeeds.jsx`: await the client at three call sites.
- Modify `client/src/web/mode.js` and `mode.test.js`: demo tab and settings visibility.

**App**
- Modify `client/src/App.jsx`: demo state, banner, trial strip, simulated tab rendering, refetch on mode change, settings gating, demo-aware apply.
- Modify `client/src/Landing.jsx`: "Try the live demo" secondary action.
- Modify `client/src/web/WebStartup.jsx`: demo action in every phase.
- Modify `client/src/ApplyPacket.jsx`: simulated portal and simulated tag.

**Proof and docs**
- Create `scripts/check-demo-bundle.mjs`: entry chunk carries no demo fixture marker.
- Create `scripts/web-demo.mjs`: full browser proof.
- Create `scripts/web-demo-live.mjs`: post-deploy fresh-profile check.
- Modify `sa-job-agent-suite/package.json`: add both checks to `test:web`.
- Modify `README.md`, `SECURITY.md`, the spec status, and the pipeline table.

---

### Task 1: Mode controller and session vault adapter

**Files:**
- Create: `client/src/web/demo/mode.js`
- Create: `client/src/web/demo/mode.test.js`
- Create: `client/src/web/demo/sessionAdapter.js`
- Create: `client/src/web/demo/sessionAdapter.test.js`

**Interfaces:**
- Produces: `REAL`, `DEMO`, `MODE_STORAGE_KEY`, `getMode()`, `isDemoMode()`, `setMode(mode)`, `subscribeMode(listener)`, `enterDemo()`, `exitDemo()`, `storageAvailable()`.
- Produces: `DEMO_PREFIX`, `createSessionAdapter({ storage, prefix })`, `wipeDemoNamespace(storage, prefix)`.
- `createSessionAdapter` returns the vault adapter contract (`get`, `put`, `delete`, `getAll`, `entries`, `clear`, `clearAll`) plus `persistent` and `prefix`.

- [ ] **Step 1: Write the failing mode test**

Create `client/src/web/demo/mode.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REAL, DEMO, MODE_STORAGE_KEY,
  getMode, setMode, subscribeMode, enterDemo, exitDemo, storageAvailable
} from './mode.js';

function fakeSession() {
  const map = new Map();
  return {
    get length() { return map.size; },
    key(index) { return [...map.keys()][index] ?? null; },
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(String(key), String(value)); },
    removeItem(key) { map.delete(key); },
    clear() { map.clear(); }
  };
}

test.beforeEach(() => { globalThis.sessionStorage = fakeSession(); });
test.afterEach(() => { delete globalThis.sessionStorage; });

test('real is the default and exit removes the flag', () => {
  assert.equal(getMode(), REAL);
  enterDemo();
  assert.equal(getMode(), DEMO);
  assert.equal(globalThis.sessionStorage.getItem(MODE_STORAGE_KEY), DEMO);
  exitDemo();
  assert.equal(getMode(), REAL);
  assert.equal(globalThis.sessionStorage.getItem(MODE_STORAGE_KEY), null);
});

test('the flag is per tab and survives a reload in the same tab', () => {
  const tab = globalThis.sessionStorage;
  enterDemo();
  globalThis.sessionStorage = fakeSession();
  assert.equal(getMode(), REAL);
  globalThis.sessionStorage = tab;
  assert.equal(getMode(), DEMO);
});

test('subscribers hear every change and can unsubscribe', () => {
  const seen = [];
  const off = subscribeMode((mode) => seen.push(mode));
  enterDemo();
  exitDemo();
  off();
  enterDemo();
  assert.deepEqual(seen, [DEMO, REAL]);
});

test('a denied sessionStorage falls back to the in-memory flag', () => {
  globalThis.sessionStorage = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
    removeItem() { throw new Error('denied'); }
  };
  assert.equal(setMode(DEMO), DEMO);
  assert.equal(getMode(), DEMO);
  assert.equal(setMode(REAL), REAL);
  assert.equal(storageAvailable(), false);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run from `sa-job-agent-suite/`: `npm test --workspace=client`
Expected: FAIL, `Cannot find module './mode.js'`.

- [ ] **Step 3: Write `mode.js`**

```js
// Per-tab demo flag. Pure: no React and no runtime imports, so both the entry
// bundle and the demo bundle can read the same answer.
export const MODE_STORAGE_KEY = 'sajas:mode';
export const REAL = 'real';
export const DEMO = 'demo';

const listeners = new Set();
let fallbackMode = REAL;

function storage() {
  try {
    return globalThis.sessionStorage || null;
  } catch {
    return null;
  }
}

export function storageAvailable() {
  const store = storage();
  if (!store) return false;
  try {
    const probe = `${MODE_STORAGE_KEY}:probe`;
    store.setItem(probe, '1');
    store.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

export function getMode() {
  const store = storage();
  if (!store) return fallbackMode;
  try {
    return store.getItem(MODE_STORAGE_KEY) === DEMO ? DEMO : REAL;
  } catch {
    return fallbackMode;
  }
}

export function isDemoMode() {
  return getMode() === DEMO;
}

export function setMode(mode) {
  const next = mode === DEMO ? DEMO : REAL;
  fallbackMode = next;
  const store = storage();
  if (store) {
    try {
      if (next === DEMO) store.setItem(MODE_STORAGE_KEY, DEMO);
      else store.removeItem(MODE_STORAGE_KEY);
    } catch {
      // The in-memory flag keeps this tab in the chosen mode.
    }
  }
  for (const listener of listeners) listener(next);
  return next;
}

export function subscribeMode(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function enterDemo() {
  return setMode(DEMO);
}

export function exitDemo() {
  return setMode(REAL);
}
```

- [ ] **Step 4: Run the mode test**

Run: `node --test client/src/web/demo/mode.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the failing adapter test**

Create `client/src/web/demo/sessionAdapter.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionAdapter, wipeDemoNamespace, DEMO_PREFIX } from './sessionAdapter.js';

function fakeSession() {
  const map = new Map();
  return {
    get length() { return map.size; },
    key(index) { return [...map.keys()][index] ?? null; },
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(String(key), String(value)); },
    removeItem(key) { map.delete(key); },
    clear() { map.clear(); }
  };
}

function keys(store) {
  const found = [];
  for (let index = 0; index < store.length; index += 1) found.push(store.key(index));
  return found;
}

test.beforeEach(() => { globalThis.sessionStorage = fakeSession(); });
test.afterEach(() => { delete globalThis.sessionStorage; });

test('the adapter round-trips under the demo prefix only', async () => {
  globalThis.sessionStorage.setItem('sajas:real:profile:current', '{"fullName":"Real"}');
  const adapter = createSessionAdapter();
  await adapter.put('profile', 'current', { fullName: 'Alex Example' });
  assert.deepEqual(await adapter.get('profile', 'current'), { fullName: 'Alex Example' });
  assert.equal(adapter.persistent, true);
  assert.match(globalThis.sessionStorage.getItem(`${DEMO_PREFIX}profile:current`), /Alex Example/);
  await adapter.clearAll();
  assert.equal(globalThis.sessionStorage.getItem('sajas:real:profile:current'), '{"fullName":"Real"}');
  assert.deepEqual(keys(globalThis.sessionStorage), ['sajas:real:profile:current']);
});

test('getAll and entries stay inside one store', async () => {
  const adapter = createSessionAdapter();
  await adapter.put('jobs', 'a', { id: 'a' });
  await adapter.put('jobs', 'b', { id: 'b' });
  await adapter.put('answers', 'c', { id: 'c' });
  assert.deepEqual((await adapter.getAll('jobs')).map((job) => job.id).sort(), ['a', 'b']);
  assert.deepEqual((await adapter.entries('jobs')).map(([key]) => key).sort(), ['a', 'b']);
});

test('clear(store) leaves other stores and other prefixes alone', async () => {
  globalThis.sessionStorage.setItem('sajas:real:x', 'keep');
  const adapter = createSessionAdapter();
  await adapter.put('jobs', 'a', { id: 'a' });
  await adapter.put('answers', 'c', { id: 'c' });
  await adapter.clear('jobs');
  assert.equal(await adapter.get('jobs', 'a'), undefined);
  assert.deepEqual(await adapter.get('answers', 'c'), { id: 'c' });
  assert.equal(globalThis.sessionStorage.getItem('sajas:real:x'), 'keep');
});

test('a denied sessionStorage yields a working memory adapter', async () => {
  const denied = {
    length: 0,
    key() { return null; },
    getItem() { return null; },
    setItem() { throw new Error('denied'); },
    removeItem() {}
  };
  const adapter = createSessionAdapter({ storage: denied });
  assert.equal(adapter.persistent, false);
  await adapter.put('jobs', 'j1', { id: 'j1' });
  assert.deepEqual(await adapter.get('jobs', 'j1'), { id: 'j1' });
});

test('wipeDemoNamespace removes demo keys and nothing else', () => {
  globalThis.sessionStorage.setItem(`${DEMO_PREFIX}jobs:a`, '{}');
  globalThis.sessionStorage.setItem(`${DEMO_PREFIX}progress`, '{}');
  globalThis.sessionStorage.setItem('sajas:mode', 'demo');
  globalThis.sessionStorage.setItem('sajas:real:key', 'keep');
  wipeDemoNamespace();
  assert.deepEqual(keys(globalThis.sessionStorage).sort(), ['sajas:mode', 'sajas:real:key']);
});
```

- [ ] **Step 6: Run it and watch it fail**

Run: `node --test client/src/web/demo/sessionAdapter.test.js`
Expected: FAIL, `Cannot find module './sessionAdapter.js'`.

- [ ] **Step 7: Write `sessionAdapter.js`**

```js
// sessionStorage-backed vault adapter. Every key carries the demo prefix, so a
// wipe can only ever remove demo data. When storage is refused or full, the
// adapter silently becomes an in-memory store and reports persistent: false.
import { createMemoryAdapter } from '../memoryAdapter.js';

export const DEMO_PREFIX = 'sajas:demo:';

function defaultStorage() {
  try {
    return globalThis.sessionStorage || null;
  } catch {
    return null;
  }
}

function usable(storage, prefix) {
  try {
    const probe = `${prefix}probe`;
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

function clone(value) {
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

export function createSessionAdapter({ storage, prefix = DEMO_PREFIX } = {}) {
  const api = storage ?? defaultStorage();
  const persistent = Boolean(api && usable(api, prefix));
  if (!persistent) {
    const memory = createMemoryAdapter();
    return { ...memory, persistent: false, prefix };
  }

  const full = (store, key) => `${prefix}${store}:${key}`;
  function keysOf(store) {
    const head = `${prefix}${store}:`;
    const found = [];
    for (let index = 0; index < api.length; index += 1) {
      const key = api.key(index);
      if (key && key.startsWith(head)) found.push(key.slice(head.length));
    }
    return found;
  }

  return {
    persistent: true,
    prefix,
    async get(store, key) {
      const raw = api.getItem(full(store, key));
      return raw == null ? undefined : JSON.parse(raw);
    },
    async put(store, key, value) {
      api.setItem(full(store, key), JSON.stringify(value));
    },
    async delete(store, key) {
      api.removeItem(full(store, key));
    },
    async getAll(store) {
      return keysOf(store).map((key) => JSON.parse(api.getItem(full(store, key))));
    },
    async entries(store) {
      return keysOf(store).map((key) => [key, JSON.parse(api.getItem(full(store, key)))]);
    },
    async clear(store) {
      for (const key of keysOf(store)) api.removeItem(full(store, key));
    },
    async clearAll() {
      const doomed = [];
      for (let index = 0; index < api.length; index += 1) {
        const key = api.key(index);
        if (key && key.startsWith(prefix)) doomed.push(key);
      }
      for (const key of doomed) api.removeItem(key);
    }
  };
}

export function wipeDemoNamespace(storage = defaultStorage(), prefix = DEMO_PREFIX) {
  if (!storage) return;
  try {
    const doomed = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key && key.startsWith(prefix)) doomed.push(key);
    }
    for (const key of doomed) storage.removeItem(key);
  } catch {
    // Nothing persisted to remove.
  }
}
```

- [ ] **Step 8: Run the adapter test**

Run: `node --test client/src/web/demo/sessionAdapter.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 9: Commit**

```bash
git add client/src/web/demo/mode.js client/src/web/demo/mode.test.js client/src/web/demo/sessionAdapter.js client/src/web/demo/sessionAdapter.test.js
git commit -m "$(cat <<'EOF'
feat(demo): add the per-tab mode flag and session vault adapter

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: The fictional universe and the demo seed

**Files:**
- Create: `client/src/web/demo/fixtures.js`
- Create: `client/src/web/demo/fixtures.test.js`

**Interfaces:**
- Produces: `DEMO_SEED_VERSION`, `DEMO_QUESTION`, `DEMO_PROFILE`, `DEMO_JOBS`, `DEMO_ANSWERS`, `DEMO_MEMORY`, `DEMO_ACTIVITY`, `DEMO_HUNTER_JOBS`, `DEMO_FEEDS`, `tailoredDocuments(job)`, `buildDemoSeed(now)`, `seedDemoVault(vault, now)`.
- `buildDemoSeed` returns `{ profile, jobs, answers, memory, usage, meta, activity }`, each store a keyed map except `activity` (an array).
- `seedDemoVault(vault, now)` returns `true` when it wrote a seed and `false` when the vault already carries the current `DEMO_SEED_VERSION`.

- [ ] **Step 1: Write the failing fixture test**

Create `client/src/web/demo/fixtures.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createVault } from '../vault.js';
import { createMemoryAdapter } from '../memoryAdapter.js';
import { validateJobCards } from '@sajas/core/scrape';
import {
  DEMO_SEED_VERSION, DEMO_QUESTION, DEMO_PROFILE, DEMO_JOBS, DEMO_ANSWERS,
  DEMO_HUNTER_JOBS, DEMO_FEEDS, buildDemoSeed, seedDemoVault, tailoredDocuments
} from './fixtures.js';

test('every link and email uses a reserved .test domain', () => {
  const urls = [
    ...DEMO_JOBS.map((job) => job.applyUrl),
    ...DEMO_HUNTER_JOBS.map((job) => job.applyUrl),
    ...Object.values(DEMO_FEEDS).flat().map((job) => job.applyUrl),
    DEMO_PROFILE.linkedInUrl,
    DEMO_PROFILE.portfolioUrl
  ];
  for (const url of urls) assert.match(new URL(url).hostname, /\.test$/, url);
  assert.match(DEMO_PROFILE.email, /@example\.test$/);
});

test('no key-shaped string or real-looking contact detail appears', () => {
  const text = JSON.stringify({ DEMO_PROFILE, DEMO_JOBS, DEMO_ANSWERS, DEMO_HUNTER_JOBS, DEMO_FEEDS });
  assert.equal(/sk-ant-/.test(text), false);
  assert.equal(/\+27\s*\d{2}\s*\d{3}/.test(text), false, 'a real-looking phone number');
  for (const name of ['Mostoeneng', 'Kone']) assert.equal(text.includes(name), false);
});

test('the five fictional employers exist and the feeds include a foreign row', () => {
  const companies = new Set(DEMO_JOBS.map((job) => job.company));
  for (const name of ['Example Studio', 'Fable Fintech', 'Sample Logistics', 'Placeholder Health', 'Imaginary Retail']) {
    assert.ok(companies.has(name), name);
  }
  const rows = Object.values(DEMO_FEEDS).flat();
  assert.ok(rows.some((job) => !/south africa/i.test(job.location)), 'a foreign job for the SA filter');
});

test('every hunter job passes the shared card schema', () => {
  const result = validateJobCards(DEMO_HUNTER_JOBS);
  assert.equal(result.rejected.length, 0);
  assert.equal(result.valid.length, DEMO_HUNTER_JOBS.length);
});

test('the seed is versioned, onboarded and carries every store', () => {
  const seed = buildDemoSeed(new Date('2026-10-28T10:00:00Z'));
  assert.equal(seed.meta.app.demoSeed, DEMO_SEED_VERSION);
  assert.equal(seed.meta.app.onboarded, true);
  assert.match(seed.profile.current.baseCv, /accessibility dashboard/);
  assert.equal(Object.keys(seed.jobs).length, DEMO_JOBS.length);
  assert.ok(seed.usage.days['2026-10-28'].estCostUSD > 0);
  assert.ok(seed.activity.length > 0);
});

test('seeding is idempotent for a current version and rewrites a stale one', async () => {
  const fresh = createVault(createMemoryAdapter());
  assert.equal(await seedDemoVault(fresh, new Date('2026-10-28T10:00:00Z')), true);
  assert.equal(await seedDemoVault(fresh, new Date('2026-10-28T10:00:00Z')), false);
  const stale = createVault(createMemoryAdapter({ meta: { app: { demoSeed: 0 } } }));
  assert.equal(await seedDemoVault(stale, new Date('2026-10-28T10:00:00Z')), true);
  assert.equal((await stale.get('meta', 'app')).demoSeed, DEMO_SEED_VERSION);
});

test('tailored documents name the job and company', () => {
  const docs = tailoredDocuments({ title: 'Data Engineer', company: 'Sample Logistics' });
  assert.match(docs.tailoredCvText, /Data Engineer/);
  assert.match(docs.tailoredCvText, /Sample Logistics/);
  assert.match(docs.tailoredCoverLetterText, /Sample Logistics/);
  assert.equal(DEMO_QUESTION, 'Which fictional project would you like to discuss?');
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test client/src/web/demo/fixtures.test.js`
Expected: FAIL, `Cannot find module './fixtures.js'`.

- [ ] **Step 3: Write `fixtures.js`**

```js
// The demo universe. Every employer, address, phone number and link is
// fictional, and every host uses the reserved .test domain.
import { STORES } from '../vault.js';

export const DEMO_SEED_VERSION = 1;
export const DEMO_QUESTION = 'Which fictional project would you like to discuss?';

const BASE_CV = `# Alex Example

Software engineer in Johannesburg with four years of experience building accessible web applications.

## Selected work

- Built an accessibility dashboard that audits colour contrast and keyboard paths for a fictional public service portal.
- Led a small team that moved a reporting tool from a legacy stack to React and Node.
- Wrote the automated checks that kept the dashboard honest.

## Skills

React, Node.js, TypeScript, PostgreSQL, automated accessibility testing.`;

export const DEMO_PROFILE = {
  fullName: 'Alex Example',
  email: 'alex@example.test',
  phone: '000 000 0000',
  location: 'Johannesburg, South Africa',
  linkedInUrl: 'https://example.test/in/alex-example',
  portfolioUrl: 'https://example.test/alex',
  keywords: 'software engineer, react, node',
  locations: 'Johannesburg, Cape Town, Remote',
  feedSaOnly: true,
  maxKeywords: 3,
  maxLocations: 2,
  useStructuredOutputs: true,
  usePromptCaching: true,
  dailyBudgetUSD: 5,
  selectedModel: '',
  applicationDefaultsText: '',
  baseCv: BASE_CV,
  applicationProfile: {
    rightToWorkSA: 'Yes, South African citizen',
    noticePeriod: '30 days',
    expectedSalary: 'R 45 000 per month',
    driversLicense: 'Code B',
    willingToRelocate: 'Yes, within South Africa',
    highestQualification: 'BSc Computer Science',
    yearsExperience: '4 years',
    languages: 'English, Sesotho'
  }
};

export function tailoredDocuments(job = {}) {
  const title = String(job.title || 'Developer').trim();
  const company = String(job.company || 'Example Studio').trim();
  return {
    tailoredCvText: `# Alex Example

Simulated tailored CV for the ${title} role at ${company}.

## Summary

Software engineer with four years of experience building accessible React interfaces and the services behind them.

## Selected work

- Built an accessibility dashboard that audits colour contrast and keyboard paths for a fictional public service portal.
- Led a small team that moved a reporting tool to React and Node.
- Wrote automated checks that kept the dashboard honest.

## Why this role

The ${title} role at ${company} matches the accessibility and platform work in this fictional CV.`,
    tailoredCoverLetterText: `# Cover letter

Dear ${company} team,

I am applying for the ${title} role. In this simulated letter I would point to the accessibility dashboard I built and the reporting migration I led.

Thank you for considering this fictional application.

Alex Example`
  };
}

const GENERATED = (job) => tailoredDocuments(job);

export const DEMO_JOBS = [
  {
    id: 'demo-job-1', title: 'Frontend Engineer', company: 'Example Studio',
    location: 'Johannesburg, South Africa',
    description: 'Build accessible React interfaces for a fictional design studio.',
    applyUrl: 'https://example-studio.test/jobs/frontend',
    datePosted: '2026-10-20', matchScore: 92, status: 'tailored',
    notes: 'Fictional role for the demo.', source: 'Example Studio', dateAdded: '2026-10-21',
    ...GENERATED({ title: 'Frontend Engineer', company: 'Example Studio' })
  },
  {
    id: 'demo-job-2', title: 'Full Stack Developer', company: 'Fable Fintech',
    location: 'Cape Town, South Africa',
    description: 'Build fictional payment dashboards and the services behind them.',
    applyUrl: 'https://fable-fintech.test/careers/full-stack',
    datePosted: '2026-10-22', matchScore: 86, status: 'tailored',
    notes: '', source: 'Fable Fintech', dateAdded: '2026-10-22',
    ...GENERATED({ title: 'Full Stack Developer', company: 'Fable Fintech' })
  },
  {
    id: 'demo-job-3', title: 'Data Engineer', company: 'Sample Logistics',
    location: 'Durban, South Africa',
    description: 'Move fictional depot data into a warehouse the reporting team can trust.',
    applyUrl: 'https://sample-logistics.test/jobs/data',
    datePosted: '2026-10-23', matchScore: 78, status: 'found',
    notes: '', source: 'Sample Logistics', dateAdded: '2026-10-23',
    tailoredCvText: '', tailoredCoverLetterText: ''
  },
  {
    id: 'demo-job-4', title: 'QA Analyst', company: 'Placeholder Health',
    location: 'Pretoria, South Africa',
    description: 'Test a fictional clinic booking flow on web and mobile.',
    applyUrl: 'https://placeholder-health.test/jobs/qa',
    datePosted: '2026-10-24', matchScore: 71, status: 'found',
    notes: '', source: 'Placeholder Health', dateAdded: '2026-10-24',
    tailoredCvText: '', tailoredCoverLetterText: ''
  },
  {
    id: 'demo-job-5', title: 'Platform Engineer', company: 'Imaginary Retail',
    location: 'Remote, South Africa',
    description: 'Keep a fictional storefront platform fast and observable.',
    applyUrl: 'https://imaginary-retail.test/jobs/platform',
    datePosted: '2026-10-18', matchScore: 68, status: 'applied',
    appliedAt: '2026-10-19T09:00:00.000Z',
    notes: '', source: 'Imaginary Retail', dateAdded: '2026-10-18',
    tailoredCvText: '', tailoredCoverLetterText: ''
  }
];

export const DEMO_ANSWERS = [
  { id: 'demo-answer-notice', question: 'What is your notice period?', answer: '30 days', normalized: 'notice period' },
  { id: 'demo-answer-right', question: 'Do you have the right to work in South Africa?', answer: 'Yes, South African citizen.', normalized: 'right to work' },
  { id: 'demo-answer-salary', question: 'What is your expected salary?', answer: 'R 45 000 per month', normalized: 'expected salary' }
];

const STAMP = '2026-10-25T08:00:00.000Z';

export const DEMO_MEMORY = {
  version: 1,
  updatedAt: STAMP,
  insights: [
    {
      id: 'demo-insight-1', text: 'Prefers roles with an accessibility or public service angle.',
      category: 'preference', source: 'manual', createdAt: STAMP, weight: 1, lastConfirmedAt: STAMP
    },
    {
      id: 'demo-insight-2', text: 'Strongest when explaining a migration tradeoff to non-engineers.',
      category: 'strength', source: 'manual', createdAt: STAMP, weight: 1, lastConfirmedAt: STAMP
    }
  ],
  employers: [
    {
      id: 'demo-employer-1', company: 'Imaginary Retail', normalized: 'imaginary retail',
      notes: ['Simulated: replied within a week.'], applications: 1, updatedAt: STAMP
    },
    {
      id: 'demo-employer-2', company: 'Example Studio', normalized: 'example studio',
      notes: [], applications: 0, updatedAt: STAMP
    }
  ],
  applications: [
    {
      id: 'demo-application-1', jobId: 'demo-job-5', title: 'Platform Engineer',
      company: 'Imaginary Retail', appliedAt: '2026-10-19T09:00:00.000Z',
      outcome: 'applied', salarySnapshot: null, transcript: []
    }
  ],
  lastDream: null
};

export const DEMO_ACTIVITY = [
  { message: 'Demo workspace opened with fictional data.', type: 'system' },
  { message: 'Simulated application recorded for Imaginary Retail.', type: 'system' },
  { message: 'Simulated tailoring finished for Frontend Engineer at Example Studio.', type: 'system' }
];

export const DEMO_HUNTER_JOBS = [
  {
    title: 'Full Stack Developer', company: 'Fable Fintech', location: 'Cape Town, South Africa',
    description: 'Duplicate of a role already in the demo tracker.',
    applyUrl: 'https://fable-fintech.test/careers/full-stack',
    source: 'Simulated board', matchScore: 86, datePosted: '2026-10-22'
  },
  {
    title: 'Backend Engineer', company: 'Fable Fintech', location: 'Cape Town, South Africa',
    description: 'Build fictional payment services.',
    applyUrl: 'https://fable-fintech.test/careers/backend',
    source: 'Simulated board', matchScore: 83, datePosted: '2026-10-24'
  },
  {
    title: 'Support Engineer', company: 'Sample Logistics', location: 'Durban, South Africa',
    description: 'Help fictional depots use a tracking tool.',
    applyUrl: 'https://sample-logistics.test/jobs/support',
    source: 'Simulated board', matchScore: 74, datePosted: '2026-10-25'
  },
  {
    title: 'Mobile Developer', company: 'Placeholder Health', location: 'Pretoria, South Africa',
    description: 'Build a fictional clinic booking app.',
    applyUrl: 'https://placeholder-health.test/jobs/mobile',
    source: 'Simulated board', matchScore: 69, datePosted: '2026-10-26'
  }
];

function feedJob(source, title, company, location, applyUrl, description) {
  return {
    source,
    sourceId: `${source}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    title, company, location, description, applyUrl,
    datePosted: '2026-10-26',
    remote: /remote/i.test(location),
    tags: ['simulated'],
    salaryText: '',
    matchScore: 72
  };
}

export const DEMO_FEEDS = {
  remotive: [
    feedJob('remotive', 'React Developer', 'Example Studio', 'Johannesburg, South Africa', 'https://example-studio.test/feeds/react', 'Build fictional interfaces for a design studio.'),
    feedJob('remotive', 'Node Developer', 'Sample Logistics', 'Durban, South Africa', 'https://sample-logistics.test/feeds/node', 'Build fictional depot services.')
  ],
  arbeitnow: [
    feedJob('arbeitnow', 'Platform Engineer', 'Imaginary Retail', 'Remote, South Africa', 'https://imaginary-retail.test/feeds/platform', 'Keep a fictional storefront observable.'),
    feedJob('arbeitnow', 'Site Reliability Engineer', 'Fable Fintech', 'Cape Town, South Africa', 'https://fable-fintech.test/feeds/sre', 'Run fictional payment systems.'),
    feedJob('arbeitnow', 'Frontend Developer', 'Placeholder Health', 'Remote, United States', 'https://placeholder-health.test/feeds/frontend-us', 'Build a fictional clinic portal for a United States team.')
  ],
  jobicy: [
    feedJob('jobicy', 'Full Stack Developer', 'Fable Fintech', 'Cape Town, South Africa', 'https://fable-fintech.test/feeds/full-stack', 'Build fictional payment dashboards.'),
    feedJob('jobicy', 'Data Analyst', 'Sample Logistics', 'Pretoria, South Africa', 'https://sample-logistics.test/jobs/analyst', 'Read fictional depot data.')
  ]
};

function clone(value) {
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

export function buildDemoSeed(now = new Date()) {
  const today = (now instanceof Date ? now : new Date(now)).toISOString().slice(0, 10);
  return {
    profile: { current: clone(DEMO_PROFILE) },
    jobs: Object.fromEntries(DEMO_JOBS.map((job) => [job.id, clone(job)])),
    answers: Object.fromEntries(DEMO_ANSWERS.map((answer) => [answer.id, clone(answer)])),
    memory: { dossier: clone(DEMO_MEMORY) },
    usage: {
      days: {
        [today]: {
          calls: 6, inputTokens: 14200, outputTokens: 3600,
          cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 0, estCostUSD: 0.18,
          byBucket: {
            tailor: { calls: 2, inputTokens: 6000, outputTokens: 1600, cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 0, estCostUSD: 0.09 },
            rag: { calls: 4, inputTokens: 8200, outputTokens: 2000, cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 0, estCostUSD: 0.09 }
          },
          byTask: {}
        }
      }
    },
    meta: { app: { onboarded: true, demoSeed: DEMO_SEED_VERSION } },
    activity: DEMO_ACTIVITY.map((entry) => ({ ...entry }))
  };
}

export async function seedDemoVault(vault, now = new Date()) {
  if (!vault) throw new Error('A vault is required to seed the demo.');
  const meta = (await vault.get(STORES.meta, 'app', {})) || {};
  if (meta.demoSeed === DEMO_SEED_VERSION) return false;
  const seed = buildDemoSeed(now);
  for (const store of [STORES.profile, STORES.jobs, STORES.answers, STORES.memory, STORES.usage, STORES.meta]) {
    await vault.clear(store);
  }
  for (const store of [STORES.profile, STORES.jobs, STORES.answers, STORES.memory, STORES.usage]) {
    for (const [key, value] of Object.entries(seed[store])) await vault.put(store, key, value);
  }
  await vault.put(STORES.meta, 'app', seed.meta.app);
  return true;
}
```

- [ ] **Step 4: Run the fixture test**

Run: `node --test client/src/web/demo/fixtures.test.js`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add client/src/web/demo/fixtures.js client/src/web/demo/fixtures.test.js
git commit -m "$(cat <<'EOF'
feat(demo): add the fictional universe and versioned demo seed

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Local feed client and mode-aware feed selection

**Files:**
- Create: `client/src/web/demo/feed.js`
- Create: `client/src/web/demo/feed.test.js`
- Modify: `client/src/web/feeds.js:140-149`
- Modify: `client/src/JobFeeds.jsx:39-52,106-137`
- Modify: `client/src/web/WebKeyPanel.jsx:79-90`

**Interfaces:**
- Produces: `createDemoFeedClient({ datasets, now })`, `getDemoFeedClient()`, `clearDemoFeedCache()`.
- `getFeedClient()` becomes `async` and returns the demo client while the mode flag says demo.
- The demo client returns the same shape as `createFeedClient`: `{ load(id, { force }), loadAll({ force }), clear() }`.

- [ ] **Step 1: Write the failing feed test**

Create `client/src/web/demo/feed.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { FEED_SOURCES } from '@sajas/core/feeds';
import { createDemoFeedClient } from './feed.js';

test('load returns the real client result shape', async () => {
  const client = createDemoFeedClient({ now: () => new Date('2026-10-28T10:00:00Z') });
  const result = await client.load('remotive');
  assert.equal(result.source, 'remotive');
  assert.equal(result.label, 'Remotive');
  assert.ok(result.jobs.length > 0);
  assert.equal(result.fetchedAt, '2026-10-28T10:00:00.000Z');
  assert.equal(result.cached, false);
});

test('loadAll covers every shipped feed with no errors', async () => {
  const outcome = await createDemoFeedClient().loadAll();
  assert.deepEqual(outcome.errors, []);
  assert.deepEqual(outcome.results.map((result) => result.source), FEED_SOURCES.map((source) => source.id));
});

test('the demo client never calls fetch', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('fetch must not run'); };
  try {
    await createDemoFeedClient().loadAll();
  } finally {
    globalThis.fetch = original;
  }
});

test('an unknown feed is refused with a typed error', async () => {
  await assert.rejects(() => createDemoFeedClient().load('nope'), (error) => error.code === 'FEED_FAILED');
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test client/src/web/demo/feed.test.js`
Expected: FAIL, `Cannot find module './feed.js'`.

- [ ] **Step 3: Write `feed.js`**

```js
// Local feed results for the demo. No fetch, no retry and no cache: the rows are
// fixtures shaped exactly like createFeedClient results.
import { FEED_SOURCES, sourceById } from '@sajas/core/feeds';
import { AppError, ERROR_CODES } from '@sajas/core/errors';
import { DEMO_FEEDS } from './fixtures.js';

export function createDemoFeedClient({ datasets = DEMO_FEEDS, now = () => new Date() } = {}) {
  async function load(id) {
    const source = sourceById(id);
    if (!source) {
      throw new AppError(ERROR_CODES.FEED_FAILED, `There is no feed called ${id}.`, { retryable: false });
    }
    return {
      source: id,
      label: source.label,
      jobs: (datasets[id] || []).map((job) => ({ ...job })),
      fetchedAt: now().toISOString(),
      cached: false
    };
  }

  return {
    load,
    async loadAll() {
      const results = await Promise.all(FEED_SOURCES.map((source) => load(source.id)));
      return { results, errors: [] };
    },
    clear() {
      // Fixtures are static, so there is no cache to drop.
    }
  };
}

let shared = null;

export function getDemoFeedClient() {
  if (!shared) shared = createDemoFeedClient();
  return shared;
}

export function clearDemoFeedCache() {
  shared?.clear();
  shared = null;
}
```

- [ ] **Step 4: Run the feed test**

Run: `node --test client/src/web/demo/feed.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Make `getFeedClient` mode-aware**

In `client/src/web/feeds.js`, add the mode import at the top:

```js
import { isDemoMode } from './demo/mode.js';
```

Replace `getFeedClient` and `clearFeedCache` at the end of the file:

```js
let shared = null;

export async function getFeedClient() {
  if (isDemoMode()) {
    const { getDemoFeedClient } = await import('./demo/feed.js');
    return getDemoFeedClient();
  }
  if (!shared) shared = createFeedClient();
  return shared;
}

export async function clearFeedCache() {
  shared?.clear();
  if (isDemoMode()) {
    const { clearDemoFeedCache } = await import('./demo/feed.js');
    clearDemoFeedCache();
  }
}
```

- [ ] **Step 6: Await the client in `JobFeeds.jsx`**

Change the three call sites:

```js
const outcome = await (await getFeedClient()).loadAll({ force });
```

```js
const result = await (await getFeedClient()).load(id, { force: true });
```

The third reference is the import itself; no change. Confirm with `grep -n "getFeedClient" client/src/JobFeeds.jsx` that both call sites use the double await.

- [ ] **Step 7: Await the cache clear in `WebKeyPanel.jsx`**

`clearFeedCache` is now async. In the panic wipe handler, await it so no rejection escapes before the reload:

```js
      // Feed rows live in a memory cache; drop them so nothing survives the wipe.
      await clearFeedCache();
      window.location.reload();
```

- [ ] **Step 8: Run the client tests and the existing feed proof**

Run: `npm test --workspace=client`
Expected: PASS, including the new demo feed tests.

Run: `node --test client/src/web/feeds.test.js`
Expected: PASS unchanged.

- [ ] **Step 9: Commit**

```bash
git add client/src/web/demo/feed.js client/src/web/demo/feed.test.js client/src/web/feeds.js client/src/JobFeeds.jsx client/src/web/WebKeyPanel.jsx
git commit -m "$(cat <<'EOF'
feat(demo): serve local feed fixtures behind the feed seam

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Simulation router for tailor, ask, check and apply

**Files:**
- Create: `client/src/web/demo/simulationApi.js`
- Create: `client/src/web/demo/simulationApi.test.js`

**Interfaces:**
- Consumes: `createWebApi` as the delegation base, the vault, the stub key store, `createUsageLedger`, `buildApplyPacket`, `summariseSubmission`, `prepareAsk`, `prepareCheck`, `REFUSAL_SENTENCE`, `tailoredDocuments`, `DEMO_QUESTION`.
- Produces: `createSimulationRouter({ base, apiBase, vault, keyStore, activity, now, wait, tailorDelayMs })` returning `{ handle(input, init) }`.
- Routes owned by the router: `POST /jobs/:id/tailor`, `POST /rag/ask`, `POST /rag/check`, `POST /demo/apply/:id`. Everything else delegates to `base.handle`.

- [ ] **Step 1: Write the failing router test**

Create `client/src/web/demo/simulationApi.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { STORES, createVault } from '../vault.js';
import { createMemoryAdapter } from '../memoryAdapter.js';
import { createActivity } from '../activity.js';
import { createWebApi } from '../api.js';
import { REFUSAL_SENTENCE } from '@sajas/core/rag';
import { createSimulationRouter } from './simulationApi.js';
import { buildDemoSeed, tailoredDocuments } from './fixtures.js';

const API_BASE = 'http://localhost:5000/api';
const NOW = () => new Date('2026-10-28T10:00:00Z');

function harness() {
  const vault = createVault(createMemoryAdapter(buildDemoSeed(NOW())));
  const activity = createActivity();
  const keyStore = { hasKey: () => true, getKey: () => null };
  const base = createWebApi({ apiBase: API_BASE, vault, keyStore, activity, now: NOW });
  const waits = [];
  const router = createSimulationRouter({
    base, apiBase: API_BASE, vault, keyStore, activity, now: NOW,
    wait: (ms) => { waits.push(ms); return Promise.resolve(); }
  });
  return { vault, router, waits };
}

const post = (body) => ({ method: 'POST', body: JSON.stringify(body) });
const get = () => ({ method: 'GET' });

test('tailor moves through tailoring, waits, writes documents and records usage', async () => {
  const { vault, router, waits } = harness();
  const response = await router.handle(`${API_BASE}/jobs/demo-job-3/tailor`, post({}));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(waits, [900]);
  assert.equal(body.job.status, 'tailored');
  assert.match(body.job.tailoredCvText, /Sample Logistics/);
  assert.match(body.job.tailoredCoverLetterText, /Data Engineer/);
  const days = await vault.get(STORES.usage, 'days');
  assert.ok(days.days['2026-10-28'].calls > 6, 'simulated usage was not recorded');
});

test('a supported question answers with real citations and a simulated label', async () => {
  const { router } = harness();
  const response = await router.handle(`${API_BASE}/rag/ask`, post({ question: 'Which accessibility dashboard project did Alex build?' }));
  const body = await response.json();
  assert.equal(body.supported, true);
  assert.equal(body.refused, false);
  assert.match(body.answer, /\[Doc:/);
  assert.match(body.answer, /Simulated/);
  assert.ok(body.citations.length > 0);
  assert.ok(body.citations.every((citation) => citation.tag.startsWith('[Doc:')));
  assert.ok(Array.isArray(body.searched));
});

test('an unsupported question refuses with the fixed sentence', async () => {
  const { router } = harness();
  const response = await router.handle(`${API_BASE}/rag/ask`, post({ question: 'Do you have a commercial pilot licence?' }));
  const body = await response.json();
  assert.equal(body.refused, true);
  assert.equal(body.supported, false);
  assert.equal(body.answer, REFUSAL_SENTENCE);
  assert.deepEqual(body.citations, []);
  assert.ok(body.searched.length > 0, 'the refusal must name what was searched');
});

test('check reports one flagged claim with a citation', async () => {
  const { router } = harness();
  const response = await router.handle(`${API_BASE}/rag/check`, post({ jobId: 'demo-job-1', documentKind: 'cv' }));
  const body = await response.json();
  assert.equal(body.supported, false);
  assert.equal(body.refused, false);
  assert.equal(body.unsupportedClaims.length, 1);
  assert.match(body.unsupportedClaims[0], /\[Doc:/);
  assert.ok(body.citations.length > 0);
});

test('the simulated copilot records a confirmed desktop-copilot submission', async () => {
  const { vault, router } = harness();
  const response = await router.handle(`${API_BASE}/demo/apply/demo-job-2`, post({ answer: 'The accessibility dashboard project.' }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.application.delivery, 'desktop-copilot');
  assert.equal(body.application.submittedBy, 'copilot-confirmed');
  assert.equal(body.application.confirmation.text, 'Send application');
  assert.equal(body.job.status, 'applied');
  const saved = await vault.get(STORES.jobs, 'demo-job-2');
  assert.equal(saved.status, 'applied');
  const memory = await vault.get(STORES.memory, 'dossier');
  const record = memory.applications.find((entry) => entry.jobId === 'demo-job-2');
  assert.equal(record.delivery, 'desktop-copilot');
  const answer = await vault.get(STORES.answers, 'demo-visitor-answer');
  assert.equal(answer.answer, 'The accessibility dashboard project.');
});

test('ordinary routes delegate to the demo API', async () => {
  const { router } = harness();
  const jobs = await (await router.handle(`${API_BASE}/jobs`, get())).json();
  assert.ok(Array.isArray(jobs) && jobs.length === 5);
  const missing = await router.handle(`${API_BASE}/nothing-here`, get());
  assert.equal(missing.status, 404);
  const dream = await router.handle(`${API_BASE}/memory/dream`, post({}));
  assert.equal(dream.status, 501);
  assert.equal((await dream.json()).code, 'NOT_SUPPORTED_IN_WEB');
});

test('an unknown job is a typed 404', async () => {
  const { router } = harness();
  const response = await router.handle(`${API_BASE}/jobs/missing/tailor`, post({}));
  assert.equal(response.status, 404);
  assert.equal((await response.json()).code, 'NOT_FOUND');
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test client/src/web/demo/simulationApi.test.js`
Expected: FAIL, `Cannot find module './simulationApi.js'`.

- [ ] **Step 3: Write `simulationApi.js`**

```js
// The demo's simulation layer. It owns the four routes that would otherwise
// call a model or a desktop agent, and delegates every ordinary CRUD route to
// the vault-backed demo API. No AI client is ever constructed here.
import { AppError, ERROR_CODES, statusForCode, toUserError } from '@sajas/core/errors';
import { buildApplyPacket, summariseSubmission } from '@sajas/core/apply';
import { prepareAsk, prepareCheck, REFUSAL_SENTENCE } from '@sajas/core/rag';
import { STORES } from '../vault.js';
import { createUsageLedger } from '../usage.js';
import { DEMO_QUESTION, tailoredDocuments } from './fixtures.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const SIMULATED = 'Simulated';

function ok(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function fail(err) {
  const payload = toUserError(err);
  return new Response(JSON.stringify({ error: payload.message, ...payload }), {
    status: statusForCode(payload.code),
    headers: JSON_HEADERS
  });
}

function pathOf(input, base, basePath) {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
  const url = new URL(raw, base);
  if (url.pathname === basePath) return '/';
  if (url.pathname.startsWith(`${basePath}/`)) return url.pathname.slice(basePath.length);
  return url.pathname || '/';
}

function citationOf(chunk) {
  return {
    id: chunk.id, docId: chunk.docId, docKind: chunk.docKind, docTitle: chunk.docTitle,
    section: chunk.section, index: chunk.index, tag: chunk.tag
  };
}

export function createSimulationRouter({
  base,
  apiBase,
  vault,
  keyStore,
  activity = { add() {} },
  now = () => new Date(),
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  tailorDelayMs = 900
} = {}) {
  const baseUrl = new URL(apiBase);
  const basePath = baseUrl.pathname.replace(/\/$/, '');
  const usage = createUsageLedger({ vault, now });

  async function sources() {
    return {
      profile: (await vault.get(STORES.profile, 'current', {})) || {},
      jobs: await vault.getAll(STORES.jobs),
      memory: (await vault.get(STORES.memory, 'dossier')) || {},
      answers: await vault.getAll(STORES.answers)
    };
  }

  async function bodyOf(input, init) {
    const raw = init?.body ?? (typeof input === 'object' && input?.clone ? await input.clone().text() : undefined);
    if (raw == null || raw === '') return {};
    if (typeof raw !== 'string') return raw;
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      throw new AppError(ERROR_CODES.VALIDATION, 'That request was not valid JSON.');
    }
  }

  async function tailor(jobId) {
    const job = await vault.get(STORES.jobs, jobId);
    if (!job) throw new AppError(ERROR_CODES.NOT_FOUND, 'Job not found.');
    await vault.put(STORES.jobs, jobId, { ...job, status: 'tailoring' });
    await wait(tailorDelayMs);
    const updated = { ...job, ...tailoredDocuments(job), status: 'tailored' };
    await vault.put(STORES.jobs, jobId, updated);
    await usage.record({ model: 'simulated', bucket: 'tailor', inputTokens: 1500, outputTokens: 600 });
    activity.add(`Simulated tailoring finished for ${job.title} at ${job.company}.`, 'system');
    return ok({ success: true, job: updated, simulated: true });
  }

  async function ask(input, init) {
    const { question, purpose } = await bodyOf(input, init);
    const prepared = prepareAsk({ ...(await sources()), question, purpose });
    if (prepared.refused) {
      return ok({
        kind: 'answer',
        question: String(question || '').trim(),
        purpose: prepared.purpose || 'general',
        supported: false,
        refused: true,
        answer: REFUSAL_SENTENCE,
        citations: [],
        searched: prepared.searched,
        missing: prepared.missing,
        simulated: true
      });
    }
    const chunks = prepared.chunks.slice(0, 3);
    const answer = `${chunks.map((chunk, index) => `Simulated point ${index + 1} is drawn from ${chunk.tag}.`).join(' ')} ${SIMULATED} output for the demo.`;
    await usage.record({ model: 'simulated', bucket: 'rag', inputTokens: 900, outputTokens: 220 });
    return ok({
      kind: 'answer',
      question: prepared.question,
      purpose: prepared.purpose,
      supported: true,
      refused: false,
      answer,
      citations: chunks.map(citationOf),
      searched: prepared.searched,
      missing: prepared.missing,
      simulated: true
    });
  }

  async function check(input, init) {
    const { jobId, documentKind } = await bodyOf(input, init);
    const prepared = prepareCheck({ ...(await sources()), jobId, documentKind });
    const baseFields = {
      kind: 'check',
      jobId,
      documentKind: prepared.documentKind,
      documentTitle: prepared.documentTitle,
      searched: prepared.searched,
      missing: prepared.missing,
      simulated: true
    };
    if (prepared.refused) {
      return ok({ ...baseFields, supported: false, refused: true, answer: REFUSAL_SENTENCE, unsupportedClaims: [], citations: [] });
    }
    const top = prepared.chunks[0];
    await usage.record({ model: 'simulated', bucket: 'ground', inputTokens: 800, outputTokens: 180 });
    return ok({
      ...baseFields,
      supported: false,
      refused: false,
      unsupportedClaims: top ? [`The document claims experience this demo cannot verify ${top.tag}.`] : [],
      citations: top ? [citationOf(top)] : []
    });
  }

  async function applySimulated(input, init, jobId) {
    const { answer } = await bodyOf(input, init);
    const job = await vault.get(STORES.jobs, jobId);
    if (!job) throw new AppError(ERROR_CODES.NOT_FOUND, 'Job not found.');
    const profile = (await vault.get(STORES.profile, 'current', {})) || {};
    const answerBank = await vault.getAll(STORES.answers);
    const extra = String(answer || '').trim();
    const packetAnswers = extra
      ? [...answerBank, { id: 'demo-visitor-answer', question: DEMO_QUESTION, answer: extra, normalized: 'fictional project' }]
      : answerBank;
    const packet = buildApplyPacket({
      profile,
      job,
      answerBank: packetAnswers,
      supportingDocs: [
        ...(job.tailoredCvText ? [{ key: 'cv', label: 'Tailored CV', fileName: '', available: true }] : []),
        ...(job.tailoredCoverLetterText ? [{ key: 'cover-letter', label: 'Cover letter', fileName: '', available: true }] : [])
      ]
    });
    const submission = summariseSubmission(packet, {
      delivery: 'desktop-copilot',
      submittedBy: 'copilot-confirmed',
      confirmation: { confirmedAt: now().toISOString(), text: 'Send application' }
    });
    if (extra) {
      await vault.put(STORES.answers, 'demo-visitor-answer', {
        id: 'demo-visitor-answer', question: DEMO_QUESTION, answer: extra, normalized: 'fictional project'
      });
    }
    const appliedAt = now().toISOString();
    const updated = { ...job, status: 'applied', appliedAt };
    await vault.put(STORES.jobs, jobId, updated);

    const memory = (await vault.get(STORES.memory, 'dossier')) || { insights: [], employers: [], applications: [] };
    if (!Array.isArray(memory.applications)) memory.applications = [];
    if (!Array.isArray(memory.employers)) memory.employers = [];
    let record = memory.applications.find((entry) => entry.jobId === jobId);
    if (!record) {
      record = { id: crypto.randomUUID(), jobId, title: job.title, company: job.company, appliedAt, outcome: 'applied', salarySnapshot: null, transcript: [] };
      memory.applications.push(record);
      const normalized = String(job.company || '').trim().toLowerCase();
      let employer = memory.employers.find((entry) => String(entry.normalized || entry.company || '').toLowerCase() === normalized);
      if (!employer) {
        employer = { id: crypto.randomUUID(), company: job.company, normalized, notes: [], applications: 0, updatedAt: null };
        memory.employers.push(employer);
      }
      employer.applications = (Number(employer.applications) || 0) + 1;
      employer.updatedAt = appliedAt;
    }
    Object.assign(record, submission);
    memory.updatedAt = appliedAt;
    await vault.put(STORES.memory, 'dossier', memory);
    activity.add(`Simulated application recorded for ${job.title} at ${job.company}.`, 'system');
    return ok({ success: true, application: record, job: updated, simulated: true });
  }

  async function handle(input, init = {}) {
    try {
      const path = pathOf(input, baseUrl, basePath);
      const method = String(init.method || (typeof input === 'object' && input?.method) || 'GET').toUpperCase();
      let match;
      if ((match = path.match(/^\/jobs\/([^/]+)\/tailor$/)) && method === 'POST') return await tailor(match[1]);
      if (path === '/rag/ask' && method === 'POST') return await ask(input, init);
      if (path === '/rag/check' && method === 'POST') return await check(input, init);
      if ((match = path.match(/^\/demo\/apply\/([^/]+)$/)) && method === 'POST') return await applySimulated(input, init, match[1]);
      return await base.handle(input, init);
    } catch (err) {
      return fail(err);
    }
  }

  return { handle };
}
```

- [ ] **Step 4: Run the router test**

Run: `node --test client/src/web/demo/simulationApi.test.js`
Expected: PASS, 7 tests. If the supported question refuses, add the word `accessibility` to a `found` job description, not to the test: the CV already carries it in this fixture.

- [ ] **Step 5: Commit**

```bash
git add client/src/web/demo/simulationApi.js client/src/web/demo/simulationApi.test.js
git commit -m "$(cat <<'EOF'
feat(demo): simulate tailoring, grounded questions and the copilot record

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Demo runtime and the dispatcher seam

**Files:**
- Create: `client/src/web/demo/runtime.js`
- Create: `client/src/web/demo/runtime.test.js`
- Modify: `client/src/web/runtime.js` (whole file)
- Modify: `client/src/main.jsx:12-19`
- Modify: `client/src/web/install.test.js` (append one test)

**Interfaces:**
- Produces: `getDemoRuntime({ apiBase, now })`, `resetDemoRuntime()`.
- `getDemoRuntime` returns `{ vault, keyStore, activity, api: { handle }, persistent }`.
- `web/runtime.js` produces `handleApi(input, init)`, `async enterDemo()`, `async exitDemo()`, and re-exports `subscribeMode`, `isDemoMode`.

- [ ] **Step 1: Write the failing runtime test**

Create `client/src/web/demo/runtime.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { getDemoRuntime, resetDemoRuntime } from './runtime.js';
import { DEMO_PREFIX } from './sessionAdapter.js';

const API_BASE = 'http://localhost:5000/api';

function fakeSession() {
  const map = new Map();
  return {
    get length() { return map.size; },
    key(index) { return [...map.keys()][index] ?? null; },
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(String(key), String(value)); },
    removeItem(key) { map.delete(key); },
    clear() { map.clear(); }
  };
}

test.beforeEach(() => { globalThis.sessionStorage = fakeSession(); });
test.afterEach(async () => { await resetDemoRuntime(); delete globalThis.sessionStorage; });

test('the demo runtime seeds once, reports a key and answers profile', async () => {
  const runtime = await getDemoRuntime({ apiBase: API_BASE, now: () => new Date('2026-10-28T10:00:00Z') });
  assert.equal(runtime.persistent, true);
  assert.equal(runtime.keyStore.hasKey(), true);
  assert.equal(runtime.keyStore.getKey(), null);
  const response = await runtime.api.handle(`${API_BASE}/profile`, { method: 'GET' });
  const body = await response.json();
  assert.equal(body.fullName, 'Alex Example');
  assert.equal(body.hasAnthropicKey, true);
});

test('a second call returns the same runtime', async () => {
  const first = await getDemoRuntime({ apiBase: API_BASE });
  const second = await getDemoRuntime({ apiBase: API_BASE });
  assert.equal(first, second);
});

test('reset wipes every demo key and nothing else', async () => {
  globalThis.sessionStorage.setItem('sajas:real:keep', '1');
  await getDemoRuntime({ apiBase: API_BASE });
  await resetDemoRuntime();
  const keys = [];
  for (let index = 0; index < globalThis.sessionStorage.length; index += 1) {
    keys.push(globalThis.sessionStorage.key(index));
  }
  assert.deepEqual(keys.filter((key) => key.startsWith(DEMO_PREFIX)), []);
  assert.deepEqual(keys, ['sajas:real:keep']);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test client/src/web/demo/runtime.test.js`
Expected: FAIL, `Cannot find module './runtime.js'`.

- [ ] **Step 3: Write `demo/runtime.js`**

```js
// The demo runtime. It is built lazily on first entry, seeded from fixtures and
// cached for the tab. Nothing in this file reads the real vault or a key.
import { AppError, ERROR_CODES } from '@sajas/core/errors';
import { createVault } from '../vault.js';
import { createActivity } from '../activity.js';
import { createWebApi } from '../api.js';
import { createSessionAdapter, wipeDemoNamespace } from './sessionAdapter.js';
import { createSimulationRouter } from './simulationApi.js';
import { buildDemoSeed, seedDemoVault } from './fixtures.js';

let runtime = null;

function demoKeyStore() {
  return {
    hasKey: () => true,
    getKey: () => null,
    setKey() {
      throw new AppError(ERROR_CODES.KEY_INVALID, 'No key is used in demo mode. Add your key after you exit.');
    },
    clearMemory() {},
    touch() {},
    setIdleMinutes() {},
    getIdleMinutes: () => 0,
    async saveIdleMinutes() {},
    async loadIdleMinutes() { return 0; },
    isIdleExpired() { return false; },
    maybeForgetIdle() { return false; },
    async hasSavedKey() { return false; },
    async remember() {},
    async unlock() {},
    async forget() {},
    async panicWipe() {}
  };
}

export async function getDemoRuntime({ apiBase, now = () => new Date() } = {}) {
  if (runtime) return runtime;
  const adapter = createSessionAdapter();
  const vault = createVault(adapter);
  await seedDemoVault(vault, now());
  const keyStore = demoKeyStore();
  const activity = createActivity();
  for (const entry of buildDemoSeed(now()).activity) activity.add(entry.message, entry.type);
  const api = createWebApi({ apiBase, vault, keyStore, activity, now });
  const simulated = createSimulationRouter({ base: api, apiBase, vault, keyStore, activity, now });
  runtime = { vault, keyStore, activity, api: simulated, persistent: adapter.persistent };
  return runtime;
}

export async function resetDemoRuntime() {
  runtime = null;
  wipeDemoNamespace();
}
```

- [ ] **Step 4: Run the runtime test**

Run: `node --test client/src/web/demo/runtime.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 5: Rewrite `client/src/web/runtime.js` as the dispatcher**

```js
import { IS_WEB } from './env.js';
import { createIdbAdapter } from './idbAdapter.js';
import { createVault } from './vault.js';
import { createKeyStore } from './keyStore.js';
import { createActivity } from './activity.js';
import { createWebApi } from './api.js';
import { DEMO, REAL, getMode, setMode, subscribeMode, isDemoMode } from './demo/mode.js';

export const WEB_API_BASE = import.meta.env.VITE_SAJAS_API_BASE || 'http://localhost:5000/api';

function build() {
  const vault = createVault(createIdbAdapter());
  const keyStore = createKeyStore({ vault });
  const activity = createActivity();
  const api = createWebApi({ apiBase: WEB_API_BASE, vault, keyStore, activity });
  return { vault, keyStore, activity, api };
}

export const webRuntime = IS_WEB ? build() : null;

let demoPromise = null;

function loadDemo() {
  if (!demoPromise) {
    demoPromise = import('./demo/runtime.js').then(({ getDemoRuntime }) => getDemoRuntime({ apiBase: WEB_API_BASE }));
  }
  return demoPromise;
}

// One stable fetch handler. It reads the mode on every call, so the installed
// dispatcher never has to be replaced and a refresh restores the demo.
export function handleApi(input, init) {
  if (getMode() === DEMO) return loadDemo().then((runtime) => runtime.api.handle(input, init));
  return webRuntime.api.handle(input, init);
}

export async function enterDemo() {
  const runtime = await loadDemo();
  setMode(DEMO);
  return { persistent: runtime.persistent };
}

export async function exitDemo() {
  const { resetDemoRuntime } = await import('./demo/runtime.js');
  await resetDemoRuntime();
  demoPromise = null;
  setMode(REAL);
}

export { subscribeMode, isDemoMode };
```

- [ ] **Step 6: Install the dispatcher in `main.jsx`**

Change the import and the install call. `webRuntime` is no longer needed in `main.jsx`:

```js
import { WEB_API_BASE, handleApi } from './web/runtime.js';
```

```js
window.fetch = installWebApi({
  apiBase: WEB_API_BASE,
  handler: handleApi,
  nativeFetch: window.fetch.bind(window)
});
```

- [ ] **Step 7: Append the switching test to `install.test.js`**

```js
test('the dispatcher switches handlers without being reinstalled', async () => {
  let mode = 'real';
  const fetchImpl = installWebApi({
    apiBase: API_BASE,
    handler: async () => new Response(JSON.stringify({ mode })),
    nativeFetch: async () => { throw new Error('native fetch must not run'); }
  });
  const first = await (await fetchImpl(`${API_BASE}/profile`)).json();
  assert.equal(first.mode, 'real');
  mode = 'demo';
  const second = await (await fetchImpl(`${API_BASE}/profile`)).json();
  assert.equal(second.mode, 'demo');
});
```

- [ ] **Step 8: Run the tests**

Run: `node --test client/src/web/install.test.js client/src/web/demo/runtime.test.js`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add client/src/web/demo/runtime.js client/src/web/demo/runtime.test.js client/src/web/runtime.js client/src/main.jsx client/src/web/install.test.js
git commit -m "$(cat <<'EOF'
feat(demo): add the demo runtime and one mode-aware fetch dispatcher

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Demo tab and settings visibility

**Files:**
- Modify: `client/src/web/mode.js:1-16`
- Modify: `client/src/web/mode.test.js` (append)

**Interfaces:**
- Produces: `DEMO_HIDDEN_TABS`, `DEMO_HIDDEN_SETTINGS`; `isTabVisible(tab, isWeb, demo)`; `filterSettingsTabs(tabs, isWeb, demo)`.
- In demo: Copilot and Logs are visible, Referrals and Routines are hidden, Apply is visible, Backup is hidden.

- [ ] **Step 1: Write the failing visibility test**

Append to `client/src/web/mode.test.js`:

```js
test('demo shows copilot and logs, hides referrals, routines and backup', () => {
  for (const tab of ['copilot', 'logs', 'apply', 'dashboard', 'tailor', 'ask']) {
    assert.equal(isTabVisible(tab, true, true), true, tab);
  }
  for (const tab of ['referrals', 'routines']) {
    assert.equal(isTabVisible(tab, true, true), false, tab);
  }
  const tabs = [{ id: 'ai' }, { id: 'answers' }, { id: 'data' }, { id: 'backup' }];
  assert.deepEqual(filterSettingsTabs(tabs, true, true).map((tab) => tab.id), ['ai']);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test client/src/web/mode.test.js`
Expected: FAIL, the demo assertions see `false` for `copilot` and `logs`.

- [ ] **Step 3: Update `mode.js`**

```js
// Which parts of the desktop UI are meaningful in the hosted, server-less app.
export const SERVER_ONLY_TABS = Object.freeze(['copilot', 'referrals', 'routines', 'logs']);
export const SERVER_ONLY_SETTINGS = Object.freeze(['answers', 'data']);
// Tabs that only make sense in the hosted app, such as the guided Apply packet.
export const WEB_ONLY_TABS = Object.freeze(['apply']);
export const WEB_ONLY_SETTINGS = Object.freeze(['backup']);
// The demo keeps the simulated agents and the logs, and hides write-out surfaces.
export const DEMO_HIDDEN_TABS = Object.freeze(['referrals', 'routines']);
export const DEMO_HIDDEN_SETTINGS = Object.freeze(['backup']);

export function isTabVisible(tab, isWeb, demo = false) {
  if (WEB_ONLY_TABS.includes(tab)) return Boolean(isWeb);
  if (demo) return !DEMO_HIDDEN_TABS.includes(tab);
  return !isWeb || !SERVER_ONLY_TABS.includes(tab);
}

export function filterSettingsTabs(tabs, isWeb, demo = false) {
  const visible = isWeb
    ? tabs.filter((tab) => !SERVER_ONLY_SETTINGS.includes(tab.id))
    : tabs.filter((tab) => !WEB_ONLY_SETTINGS.includes(tab.id));
  return demo ? visible.filter((tab) => !DEMO_HIDDEN_SETTINGS.includes(tab.id)) : visible;
}
```

- [ ] **Step 4: Run the mode tests**

Run: `node --test client/src/web/mode.test.js`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add client/src/web/mode.js client/src/web/mode.test.js
git commit -m "$(cat <<'EOF'
feat(demo): expose the simulated agent tabs and hide backup

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Demo banner, trial strip and progress

**Files:**
- Create: `client/src/web/demo/progress.js`
- Create: `client/src/web/demo/progress.test.js`
- Create: `client/src/web/demo/DemoBanner.jsx`
- Create: `client/src/web/demo/DemoTrialStrip.jsx`

**Interfaces:**
- Produces: `DEMO_PROGRESS_KEY`, `DEMO_STEPS`, `loadDemoProgress()`, `saveDemoProgress(progress)`, `markStepDone(id)`, `dismissDemoStrip()`.
- `DEMO_STEPS` is `[{ id, label, tab }]` for feeds, tailor, ask, hunter and copilot.
- `DemoBanner({ onExit, persistent, busy })` with `data-testid="demo-banner"` and `data-testid="exit-demo"`.
- `DemoTrialStrip({ activeTab, onGo })` with `data-testid="demo-trial-strip"`, listens for `sajas:demo-step` window events.

- [ ] **Step 1: Write the failing progress test**

Create `client/src/web/demo/progress.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEMO_PROGRESS_KEY, DEMO_STEPS,
  loadDemoProgress, markStepDone, dismissDemoStrip
} from './progress.js';

function fakeSession() {
  const map = new Map();
  return {
    get length() { return map.size; },
    key(index) { return [...map.keys()][index] ?? null; },
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(String(key), String(value)); },
    removeItem(key) { map.delete(key); },
    clear() { map.clear(); }
  };
}

test.beforeEach(() => { globalThis.sessionStorage = fakeSession(); });
test.afterEach(() => { delete globalThis.sessionStorage; });

test('steps cover the five suggested surfaces', () => {
  assert.deepEqual(DEMO_STEPS.map((step) => step.tab), ['feeds', 'tailor', 'ask', 'hunter', 'copilot']);
});

test('a step is recorded once and survives a reload', () => {
  assert.deepEqual(loadDemoProgress(), { done: [], dismissed: false });
  markStepDone('feeds');
  markStepDone('feeds');
  markStepDone('tailor');
  assert.deepEqual(loadDemoProgress().done, ['feeds', 'tailor']);
  assert.equal(globalThis.sessionStorage.length, 1);
  assert.equal(globalThis.sessionStorage.key(0), DEMO_PROGRESS_KEY);
});

test('dismissal is remembered and only the demo progress key is written', () => {
  dismissDemoStrip();
  assert.equal(loadDemoProgress().dismissed, true);
  const keys = [];
  for (let index = 0; index < globalThis.sessionStorage.length; index += 1) {
    keys.push(globalThis.sessionStorage.key(index));
  }
  assert.deepEqual(keys, [DEMO_PROGRESS_KEY]);
  assert.equal(DEMO_PROGRESS_KEY.startsWith('sajas:demo:'), true);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test client/src/web/demo/progress.test.js`
Expected: FAIL, `Cannot find module './progress.js'`.

- [ ] **Step 3: Write `progress.js`**

```js
// Suggested-step progress for the demo. It lives in the demo namespace, so the
// exit wipe removes it with everything else.
export const DEMO_PROGRESS_KEY = 'sajas:demo:progress';

export const DEMO_STEPS = Object.freeze([
  { id: 'feeds', label: 'Browse feeds', tab: 'feeds' },
  { id: 'tailor', label: 'Tailor a CV', tab: 'tailor' },
  { id: 'ask', label: 'Ask a question', tab: 'ask' },
  { id: 'hunter', label: 'Run the Hunter', tab: 'hunter' },
  { id: 'copilot', label: 'Watch the copilot apply', tab: 'copilot' }
]);

function store() {
  try {
    return globalThis.sessionStorage || null;
  } catch {
    return null;
  }
}

export function loadDemoProgress() {
  const session = store();
  const raw = session ? session.getItem(DEMO_PROGRESS_KEY) : null;
  if (!raw) return { done: [], dismissed: false };
  try {
    const parsed = JSON.parse(raw);
    return {
      done: Array.isArray(parsed.done) ? parsed.done.filter((id) => typeof id === 'string') : [],
      dismissed: Boolean(parsed.dismissed)
    };
  } catch {
    return { done: [], dismissed: false };
  }
}

export function saveDemoProgress(progress) {
  const session = store();
  if (session) {
    try {
      session.setItem(DEMO_PROGRESS_KEY, JSON.stringify(progress));
    } catch {
      // The strip still works in memory for this render.
    }
  }
  return progress;
}

export function markStepDone(id) {
  const current = loadDemoProgress();
  if (!DEMO_STEPS.some((step) => step.id === id) || current.done.includes(id)) return current;
  return saveDemoProgress({ ...current, done: [...current.done, id] });
}

export function dismissDemoStrip() {
  return saveDemoProgress({ ...loadDemoProgress(), dismissed: true });
}
```

- [ ] **Step 4: Run the progress test**

Run: `node --test client/src/web/demo/progress.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 5: Write `DemoBanner.jsx`**

```jsx
import { LogOut } from 'lucide-react';

export default function DemoBanner({ onExit, persistent = true, busy = false }) {
  return (
    <div
      role="status"
      data-testid="demo-banner"
      className="panel"
      style={{
        padding: '12px 16px', marginBottom: 20, borderColor: 'var(--color-warning)',
        background: 'var(--bg-surface-2)', display: 'flex', gap: 12,
        alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap'
      }}
    >
      <div>
        <strong>Demo mode. Everything here is simulated.</strong>
        {!persistent && (
          <p className="tiny" style={{ margin: '4px 0 0' }}>
            This browser blocked session storage, so progress resets when you refresh.
          </p>
        )}
      </div>
      <button type="button" className="btn-secondary btn-sm" data-testid="exit-demo" onClick={onExit} disabled={busy}>
        <LogOut size={13} /> Exit demo
      </button>
    </div>
  );
}
```

- [ ] **Step 6: Write `DemoTrialStrip.jsx`**

```jsx
import { useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';
import { DEMO_STEPS, dismissDemoStrip, loadDemoProgress, markStepDone } from './progress.js';

export default function DemoTrialStrip({ activeTab, onGo }) {
  const [progress, setProgress] = useState(() => loadDemoProgress());

  useEffect(() => {
    const step = DEMO_STEPS.find((entry) => entry.tab === activeTab);
    if (step) setProgress(markStepDone(step.id));
  }, [activeTab]);

  useEffect(() => {
    const onStep = (event) => setProgress(markStepDone(event.detail));
    window.addEventListener('sajas:demo-step', onStep);
    return () => window.removeEventListener('sajas:demo-step', onStep);
  }, []);

  if (progress.dismissed) return null;

  return (
    <section className="panel" data-testid="demo-trial-strip" aria-label="Demo suggestions" style={{ padding: 14, marginBottom: 20 }}>
      <div className="flex-between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <p className="tiny" style={{ margin: 0 }}>Try the surfaces. Steps tick off as you go.</p>
        <button
          type="button"
          className="btn-ghost btn-xs"
          aria-label="Dismiss demo suggestions"
          onClick={() => setProgress(dismissDemoStrip())}
        >
          <X size={12} />
        </button>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
        {DEMO_STEPS.map((step) => {
          const done = progress.done.includes(step.id);
          return (
            <button
              key={step.id}
              type="button"
              className={`btn-sm ${done ? 'btn-ghost' : 'btn-secondary'}`}
              onClick={() => onGo(step.tab)}
            >
              {done && <Check size={12} />} {step.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}
```

- [ ] **Step 7: Run the design gate**

Run: `node scripts/check-ui.mjs`
Expected: PASS. If it fails on an em dash, remove it; do not edit the gate.

- [ ] **Step 8: Commit**

```bash
git add client/src/web/demo/progress.js client/src/web/demo/progress.test.js client/src/web/demo/DemoBanner.jsx client/src/web/demo/DemoTrialStrip.jsx
git commit -m "$(cat <<'EOF'
feat(demo): add the demo banner, suggested steps and their progress

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Simulated Hunter

**Files:**
- Create: `client/src/web/demo/SimulatedHunter.jsx`

**Interfaces:**
- Consumes: `DEMO_HUNTER_JOBS`, `API_BASE`, `onJobsChanged`, `toasts`.
- Produces: a section with `data-testid="simulated-hunter"`, `data-testid="run-demo-hunter"` and `data-testid="demo-hunter-result"`.
- Writes jobs through the ordinary `POST /jobs` route, so the demo API deduplicates them.
- Fires `window.dispatchEvent(new CustomEvent('sajas:demo-step', { detail: 'hunter' }))` on completion.

- [ ] **Step 1: Write `SimulatedHunter.jsx`**

```jsx
import { useEffect, useRef, useState } from 'react';
import { Loader2, Search, Square } from 'lucide-react';
import { DEMO_HUNTER_JOBS } from './fixtures.js';

const API_BASE = import.meta.env.VITE_SAJAS_API_BASE || 'http://localhost:5000/api';

const STAGES = [
  'Checking sources',
  'Reading job pages',
  'Filtering for South Africa',
  'Scoring matches',
  'Removing duplicates'
];

export default function SimulatedHunter({ onJobsChanged, toasts }) {
  const [stage, setStage] = useState(-1);
  const [running, setRunning] = useState(false);
  const [saved, setSaved] = useState(0);
  const [duplicates, setDuplicates] = useState(0);
  const [stopped, setStopped] = useState(false);
  const [complete, setComplete] = useState(false);
  const cancelled = useRef(false);
  const timer = useRef(null);
  const resume = useRef(null);

  useEffect(() => () => {
    cancelled.current = true;
    clearTimeout(timer.current);
    if (resume.current) resume.current();
  }, []);

  function sleep(ms) {
    return new Promise((resolve) => {
      resume.current = resolve;
      timer.current = setTimeout(resolve, ms);
    });
  }

  async function writeJobs() {
    let added = 0;
    let same = 0;
    for (const job of DEMO_HUNTER_JOBS) {
      if (cancelled.current) break;
      const response = await fetch(`${API_BASE}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(job)
      });
      if (response.status === 409) same += 1;
      else if (response.ok) added += 1;
    }
    return { added, same };
  }

  async function start() {
    cancelled.current = false;
    setRunning(true);
    setStopped(false);
    setComplete(false);
    setSaved(0);
    setDuplicates(0);
    for (let index = 0; index < STAGES.length; index += 1) {
      if (cancelled.current) return;
      setStage(index);
      if (index === STAGES.length - 1) {
        const { added, same } = await writeJobs();
        if (cancelled.current) return;
        setSaved(added);
        setDuplicates(same);
      } else {
        await sleep(600);
      }
      if (cancelled.current) return;
    }
    setRunning(false);
    setStage(STAGES.length);
    setComplete(true);
    onJobsChanged?.();
    toasts?.success?.('Simulated hunt finished. Nothing was scraped.');
    window.dispatchEvent(new CustomEvent('sajas:demo-step', { detail: 'hunter' }));
  }

  function stop() {
    cancelled.current = true;
    clearTimeout(timer.current);
    if (resume.current) resume.current();
    setRunning(false);
    setStopped(true);
    setStage(-1);
  }

  return (
    <section className="panel" style={{ padding: 24 }} data-testid="simulated-hunter">
      <div className="flex-between" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h3 style={{ fontSize: 18 }}>
            Simulated job hunt <span className="badge badge-warning">Simulated</span>
          </h3>
          <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            Five staged steps on fictional boards. The desktop app checks real job boards.
          </p>
        </div>
        {running ? (
          <button type="button" className="btn-secondary" onClick={stop}>
            <Square size={13} /> Stop
          </button>
        ) : (
          <button type="button" className="btn-primary" data-testid="run-demo-hunter" onClick={start}>
            <Search size={14} /> Run simulated hunt
          </button>
        )}
      </div>

      <ol style={{ marginTop: 20, display: 'grid', gap: 10, listStyle: 'none', padding: 0 }}>
        {STAGES.map((label, index) => (
          <li key={label} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {running && stage === index
              ? <Loader2 size={14} className="spin" />
              : <span className="status-dot" aria-hidden="true" />}
            <span className={stage > index || complete ? '' : 'muted'}>{label}</span>
          </li>
        ))}
      </ol>

      {stopped && <p className="tiny" style={{ marginTop: 12 }}>Stopped. Later steps were cancelled.</p>}
      {complete && (
        <p className="tiny" style={{ marginTop: 12 }} data-testid="demo-hunter-result">
          {saved} added, {duplicates} already tracked. Nothing left this page.
        </p>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Check the design gate**

Run: `node scripts/check-ui.mjs`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add client/src/web/demo/SimulatedHunter.jsx
git commit -m "$(cat <<'EOF'
feat(demo): add the staged simulated job hunter

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Simulated Copilot and the Apply portal

**Files:**
- Create: `client/src/web/demo/SimulatedCopilot.jsx`
- Modify: `client/src/ApplyPacket.jsx:37,133-149`

**Interfaces:**
- `SimulatedCopilot({ profile, jobs, answerBank, onJobsChanged, toasts })`.
- Test ids: `open-simulated-portal`, `demo-form-continue`, `demo-question`, `demo-question-continue`, `demo-review`, `demo-review-submit`, `demo-confirm`, `demo-receipt`.
- `ApplyPacket` gains `demo = false` and `onOpenPortal = null`; in demo it swaps the external link for a button with `data-testid="open-simulated-portal"`.

- [ ] **Step 1: Write `SimulatedCopilot.jsx`**

```jsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, ExternalLink, Loader2, Send, ShieldCheck } from 'lucide-react';
import { buildApplyPacket } from '@sajas/core/apply';
import Dialog from '../Dialog.jsx';
import { DEMO_QUESTION } from './fixtures.js';

const API_BASE = import.meta.env.VITE_SAJAS_API_BASE || 'http://localhost:5000/api';
const SITE = 'fable-fintech.test';
const BUTTON_LABEL = 'Send application';

function reducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export default function SimulatedCopilot({ profile, jobs, answerBank = [], onJobsChanged, toasts }) {
  const job = useMemo(
    () => jobs.find((entry) => entry.company === 'Fable Fintech' && entry.tailoredCvText)
      || jobs.find((entry) => entry.tailoredCvText)
      || null,
    [jobs]
  );
  const [stage, setStage] = useState('idle');
  const [answer, setAnswer] = useState('');
  const [visible, setVisible] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const confirmRef = useRef(null);

  const packet = useMemo(() => {
    if (!job) return null;
    return buildApplyPacket({
      profile: profile || {},
      job,
      answerBank,
      supportingDocs: [
        ...(job.tailoredCvText ? [{ key: 'cv', label: 'Tailored CV', fileName: '', available: true }] : []),
        ...(job.tailoredCoverLetterText ? [{ key: 'cover-letter', label: 'Cover letter', fileName: '', available: true }] : [])
      ]
    });
  }, [profile, job, answerBank]);

  const fields = packet ? [...packet.identity, ...packet.questions] : [];

  useEffect(() => {
    if (stage !== 'form') return undefined;
    if (reducedMotion()) { setVisible(fields.length); return undefined; }
    setVisible(0);
    if (!fields.length) return undefined;
    const timer = setInterval(() => {
      setVisible((count) => {
        if (count >= fields.length) { clearInterval(timer); return count; }
        return count + 1;
      });
    }, 150);
    return () => clearInterval(timer);
  }, [stage, fields.length]);

  if (!job || !packet) {
    return (
      <section className="panel" style={{ padding: 24 }}>
        <h3 style={{ fontSize: 18, marginBottom: 8 }}>Simulated apply copilot</h3>
        <p className="muted">Tailor a fictional job first, then come back to watch the copilot fill its form.</p>
      </section>
    );
  }

  async function submit() {
    setConfirmOpen(false);
    setBusy(true);
    try {
      const response = await fetch(`${API_BASE}/demo/apply/${job.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || data.error || 'The simulated submission failed.');
      setReceipt(data.application);
      setStage('receipt');
      onJobsChanged?.();
      toasts?.success?.('Simulated application recorded. Nothing was sent to an employer.');
      window.dispatchEvent(new CustomEvent('sajas:demo-step', { detail: 'copilot' }));
    } catch (error) {
      toasts?.error?.(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" style={{ padding: 24 }} data-testid="simulated-copilot">
      <h3 style={{ fontSize: 18 }}>
        Simulated apply copilot <span className="badge badge-warning">Simulated</span>
      </h3>
      <p className="muted" style={{ fontSize: 13, marginTop: 4, marginBottom: 18 }}>
        A fictional portal inside this page. Nothing is sent to an employer and no site outside this origin is opened.
      </p>

      {stage === 'idle' && (
        <>
          <p className="tiny" style={{ marginBottom: 12 }}>
            Target: <strong>{job.title}</strong> at {job.company}
          </p>
          <button type="button" className="btn-primary" data-testid="open-simulated-portal" onClick={() => setStage('form')}>
            <ExternalLink size={14} /> Open the simulated portal
          </button>
        </>
      )}

      {stage === 'form' && (
        <div data-testid="demo-form" style={{ display: 'grid', gap: 10 }}>
          <p className="tiny">{SITE} · fictional application form</p>
          {fields.slice(0, visible).map((field) => (
            <div key={`${field.key}-${field.label}`} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>
              <span className="tiny">{field.label}</span>
              <p style={{ margin: 0 }}>{field.value}</p>
            </div>
          ))}
          {visible >= fields.length && (
            <button type="button" className="btn-primary" data-testid="demo-form-continue" onClick={() => setStage('question')} style={{ justifySelf: 'start', marginTop: 8 }}>
              Continue
            </button>
          )}
        </div>
      )}

      {stage === 'question' && (
        <div style={{ display: 'grid', gap: 10 }}>
          <label htmlFor="demo-question">{DEMO_QUESTION}</label>
          <textarea
            id="demo-question"
            data-testid="demo-question"
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            style={{ minHeight: 80, width: '100%' }}
          />
          <p className="hint">The copilot pauses here until you answer.</p>
          <button
            type="button"
            className="btn-primary"
            data-testid="demo-question-continue"
            disabled={!answer.trim()}
            onClick={() => setStage('review')}
            style={{ justifySelf: 'start' }}
          >
            Review application
          </button>
        </div>
      )}

      {stage === 'review' && (
        <div data-testid="demo-review" style={{ display: 'grid', gap: 14 }}>
          <p className="tiny">{SITE} · final review</p>
          {[...fields, { key: 'answer', label: DEMO_QUESTION, value: answer }].map((field) => (
            <div key={`${field.key}-${field.label}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>
              <span className="tiny">{field.label}</span>
              <span className="tiny" style={{ textAlign: 'right' }}>{field.value}</span>
            </div>
          ))}
          <div>
            <span className="tiny">Documents</span>
            {packet.documents.filter((doc) => doc.available).map((doc) => (
              <p key={doc.key} className="tiny" style={{ margin: '2px 0' }}>{doc.label}</p>
            ))}
          </div>
          <button type="button" className="btn-primary" data-testid="demo-review-submit" onClick={() => setConfirmOpen(true)} style={{ justifySelf: 'start' }}>
            <Send size={14} /> Submit application
          </button>
        </div>
      )}

      {stage === 'receipt' && receipt && (
        <div data-testid="demo-receipt" role="status" style={{ border: '1px solid var(--color-success)', borderRadius: 8, padding: 16 }}>
          <strong style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <CheckCircle2 size={16} color="var(--color-success)" /> Simulated receipt
          </strong>
          <p className="tiny" style={{ marginTop: 8 }}>Nothing was sent to an employer.</p>
          <ul className="tiny" style={{ margin: '8px 0 0 16px', padding: 0 }}>
            <li>{job.title} at {job.company}</li>
            <li>Site: {receipt.site}</li>
            <li>{receipt.fields.length} field(s), {receipt.documents.length} document(s)</li>
            <li>Recorded as {receipt.delivery} / {receipt.submittedBy}</li>
          </ul>
        </div>
      )}

      <Dialog
        open={confirmOpen}
        labelledBy="demo-confirm-title"
        onClose={busy ? () => {} : () => setConfirmOpen(false)}
        initialFocus={confirmRef}
      >
        <h3 id="demo-confirm-title" style={{ fontSize: 18, marginBottom: 8 }}>Confirm this simulated application</h3>
        <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
          The copilot will record one simulated submission. Nothing leaves this page.
        </p>
        <div className="tiny" style={{ display: 'grid', gap: 4, marginBottom: 16 }}>
          <span><strong>{job.title}</strong> at {job.company}</span>
          <span>Site: {SITE}</span>
          <span>Button: {BUTTON_LABEL}</span>
          <span>{fields.length + 1} field(s) filled. {packet.documents.filter((doc) => doc.available).length} document(s) attached.</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button type="button" className="btn-ghost" onClick={() => setConfirmOpen(false)} disabled={busy}>Keep reviewing</button>
          <button type="button" className="btn-primary" data-testid="demo-confirm" ref={confirmRef} onClick={submit} disabled={busy}>
            {busy ? <Loader2 size={13} className="spin" /> : <ShieldCheck size={13} />} Confirm and submit
          </button>
        </div>
      </Dialog>
    </section>
  );
}
```

- [ ] **Step 2: Update `ApplyPacket.jsx`**

Change the signature:

```js
export default function ApplyPacket({ profile, jobs, answerBank = [], onMarkApplied, busyJobId = null, demo = false, onOpenPortal = null }) {
```

Replace the "Open the job site" block inside the actions with:

```jsx
{demo && onOpenPortal ? (
  <button type="button" className="btn-primary" data-testid="open-simulated-portal" onClick={onOpenPortal}>
    <ExternalLink size={15} /> Open the simulated portal
  </button>
) : job.applyUrl ? (
  <a className="btn-primary" href={job.applyUrl} target="_blank" rel="noopener noreferrer">
    <ExternalLink size={15} /> Open the job site
  </a>
) : (
  <span className="tiny">Add the application link in the tracker first.</span>
)}
```

- [ ] **Step 3: Check the design gate**

Run: `node scripts/check-ui.mjs`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add client/src/web/demo/SimulatedCopilot.jsx client/src/ApplyPacket.jsx
git commit -m "$(cat <<'EOF'
feat(demo): add the confirmed simulated copilot and portal

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Entry points and App wiring

**Files:**
- Modify: `client/src/Landing.jsx:83,116-119,134-139`
- Modify: `client/src/web/WebStartup.jsx:1-2,19,55-58,193-200`
- Modify: `client/src/App.jsx:1,50-84,315-321,364-367,509-525,542,1243-1275,1345-1369,1441,1533,1761-1772,1819-1821,1884-1900,2002-2017,2062-2069,2135-2148,2617-2619`

**Interfaces:**
- Consumes: `isDemoMode`, `storageAvailable`, `subscribeMode`, `enterDemo`, `exitDemo`, `DemoBanner`, `DemoTrialStrip`, `SimulatedHunter`, `SimulatedCopilot`.
- Produces: `startDemo()` and `stopDemo()` in App, passed to the landing page, the startup screen and the banner.

- [ ] **Step 1: Add the demo action to `Landing.jsx`**

Change the signature and add the buttons:

```jsx
export default function Landing({ onEnter, onTryDemo }) {
```

In `.landing-actions`, before "Open the app":

```jsx
{onTryDemo && (
  <button type="button" className="btn-ghost btn-sm" data-testid="try-demo-landing" onClick={onTryDemo}>
    Try the live demo
  </button>
)}
```

In `.hero-actions`, after "Enter the Suite":

```jsx
{onTryDemo && (
  <button type="button" className="btn-secondary btn-lg" onClick={onTryDemo}>
    Try the live demo
  </button>
)}
```

- [ ] **Step 2: Add the demo action to `WebStartup.jsx`**

Change the import to include `Play`:

```js
import { KeyRound, Loader2, ShieldCheck, ExternalLink, Play } from 'lucide-react';
```

Change the signature:

```jsx
export default function WebStartup({ runtime, onReady, forceEnter = false, onTryDemo = null, demoBusy = false }) {
```

Before the closing `</div>` of the panel, add:

```jsx
{onTryDemo && (
  <div style={{ marginTop: 20, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
    <p className="hint" style={{ marginBottom: 8 }}>
      No key yet? The demo uses fictional data and never leaves this page.
    </p>
    <button type="button" className="btn-secondary" data-testid="try-demo" onClick={onTryDemo} disabled={demoBusy}>
      {demoBusy ? <Loader2 size={14} className="spin" /> : <Play size={14} />} Try the live demo
    </button>
  </div>
)}
```

- [ ] **Step 3: Add demo state and handlers to `App.jsx`**

At the top, extend the React import and add the demo imports:

```js
import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
```

```js
import { isDemoMode, storageAvailable, subscribeMode } from './web/demo/mode.js';
import { enterDemo, exitDemo } from './web/runtime.js';
```

The demo UI stays out of the entry chunk:

```js
const DemoBanner = lazy(() => import('./web/demo/DemoBanner.jsx'));
const DemoTrialStrip = lazy(() => import('./web/demo/DemoTrialStrip.jsx'));
const SimulatedHunter = lazy(() => import('./web/demo/SimulatedHunter.jsx'));
const SimulatedCopilot = lazy(() => import('./web/demo/SimulatedCopilot.jsx'));
```

Change the initial tab and ready state:

```js
const [activeTab, setActiveTab] = useState(SYNTHETIC_DEMO || (IS_WEB && isDemoMode()) ? 'dashboard' : 'landing');
```

```js
const [webReady, setWebReady] = useState(!IS_WEB || (IS_WEB && isDemoMode()));
```

After the `webForceEnter` state, add:

```js
const [demoMode, setDemoMode] = useState(() => IS_WEB && isDemoMode());
const [demoPersistent, setDemoPersistent] = useState(() => (IS_WEB && isDemoMode() ? storageAvailable() : true));
const [demoBusy, setDemoBusy] = useState(false);
```

Add the handlers after `refreshAll`:

```js
const startDemo = useCallback(async () => {
  if (!IS_WEB || demoBusy) return;
  setDemoBusy(true);
  try {
    const { persistent } = await enterDemo();
    setDemoPersistent(persistent);
    setDemoMode(true);
    setWebReady(true);
    setWebForceEnter(false);
    setSelectedJob(null);
    setActiveTab('dashboard');
    clearFeedCache();
    refreshAll();
    fetchAnswers();
  } catch (err) {
    fail(err, 'start the demo');
  } finally {
    setDemoBusy(false);
  }
}, [demoBusy, refreshAll, fetchAnswers]); // eslint-disable-line react-hooks/exhaustive-deps

const stopDemo = useCallback(async () => {
  if (demoBusy) return;
  setDemoBusy(true);
  try {
    await exitDemo();
    setDemoMode(false);
    setSelectedJob(null);
    setJobs([]);
    setLogs([]);
    setAnswerBank([]);
    setWebForceEnter(false);
    setWebReady(false);
    setActiveTab('landing');
    clearFeedCache();
  } finally {
    setDemoBusy(false);
  }
}, [demoBusy]); // eslint-disable-line react-hooks/exhaustive-deps
```

Import `clearFeedCache` next to the other web imports:

```js
import { clearFeedCache } from './web/feeds.js';
```

Add the mode subscription effect right after the initial-load effect:

```js
useEffect(() => {
  if (!IS_WEB) return undefined;
  return subscribeMode((mode) => setDemoMode(mode === 'demo'));
}, []);
```

Guard the key idle effect so it never runs against the demo:

```js
if (!IS_WEB || !webReady || demoMode) return undefined;
```

Its dependency array becomes `[webReady, demoMode]`.

- [ ] **Step 4: Wire the entry screens and the banner**

WebStartup:

```jsx
<WebStartup
  runtime={webRuntime}
  forceEnter={webForceEnter}
  onTryDemo={startDemo}
  demoBusy={demoBusy}
  onReady={() => { /* unchanged */ }}
/>
```

Landing early return:

```jsx
if (activeTab === 'landing') {
  return (
    <>
      <ToastStack toasts={toasts.toasts} onClose={toasts.remove} />
      <Suspense fallback={null}>
        {demoMode && <DemoBanner onExit={stopDemo} persistent={demoPersistent} busy={demoBusy} />}
      </Suspense>
      <Landing onEnter={() => setActiveTab('dashboard')} onTryDemo={IS_WEB ? startDemo : null} />
    </>
  );
}
```

In the shell, directly inside `<main>` before the first error card:

```jsx
<Suspense fallback={null}>
  {demoMode && (
    <>
      <DemoBanner onExit={stopDemo} persistent={demoPersistent} busy={demoBusy} />
      <DemoTrialStrip activeTab={activeTab} onGo={setActiveTab} />
    </>
  )}
</Suspense>
```

- [ ] **Step 5: Render the simulated tabs**

Add the simulated Hunter block immediately above the existing hunter block:

```jsx
{activeTab === 'hunter' && demoMode && (
  <Suspense fallback={<p className="hint">Loading the simulated hunter…</p>}>
    <SimulatedHunter onJobsChanged={fetchJobs} toasts={toasts} />
  </Suspense>
)}
```

Change the existing hunter block condition to:

```jsx
{activeTab === 'hunter' && !demoMode && (
```

Add the simulated Copilot block before the desktop copilot block:

```jsx
{activeTab === 'copilot' && demoMode && (
  <Suspense fallback={<p className="hint">Loading the simulated copilot…</p>}>
    <SimulatedCopilot
      profile={profile}
      jobs={jobs}
      answerBank={answerBank}
      onJobsChanged={fetchJobs}
      toasts={toasts}
    />
  </Suspense>
)}
```

Change the desktop copilot condition to `{!IS_WEB && !demoMode && activeTab === 'copilot' && (`.

Change the logs condition to:

```jsx
{(demoMode || !IS_WEB) && activeTab === 'logs' && (
```

- [ ] **Step 6: Make the Apply and Tailor surfaces demo-aware**

Apply tab:

```jsx
{IS_WEB && activeTab === 'apply' && (
  <ApplyPacket
    profile={profile}
    jobs={jobs}
    answerBank={answerBank}
    onMarkApplied={markApplied}
    demo={demoMode}
    onOpenPortal={demoMode ? () => setActiveTab('copilot') : null}
  />
)}
```

Tailor "Apply" button:

```jsx
<button className="btn-secondary" onClick={() => { if (demoMode) setActiveTab('copilot'); else triggerApplyCopilot(selectedJob.id); }}>
  <Send size={14} /> Apply
</button>
```

- [ ] **Step 7: Gate settings and backup**

Settings sub-tabs:

```jsx
], IS_WEB, demoMode)}
```

Key panel, replacing the existing `{IS_WEB && (<WebKeyPanel ... />)}`:

```jsx
{IS_WEB && (demoMode ? (
  <p className="muted" data-testid="demo-key-note">
    No key is used in demo mode. Add your key after you exit.
  </p>
) : (
  <WebKeyPanel
    runtime={webRuntime}
    refreshSignal={webKeyTick}
    onAddKey={() => { setWebForceEnter(true); setWebReady(false); }}
    onChanged={() => { setWebKeyTick((t) => t + 1); fetchProfile(); }}
  />
))}
```

Backup block condition:

```jsx
{IS_WEB && !demoMode && settingsTab === 'backup' && (
```

Also change the tab-visibility effect:

```js
if (!isTabVisible(activeTab, IS_WEB, demoMode) && activeTab !== 'landing') setActiveTab('dashboard');
if (IS_WEB && SERVER_ONLY_SETTINGS.includes(settingsTab)) setSettingsTab('ai');
if (demoMode && settingsTab === 'backup') setSettingsTab('ai');
```

and its dependency array to `[activeTab, settingsTab, demoMode]`.

- [ ] **Step 8: Build and run the unit tests**

Run: `npm test --workspace=client`
Expected: PASS.

Run from `sa-job-agent-suite/`: `npm run build:web`
Expected: build succeeds. Fix any unresolved import or hook-order error before continuing.

- [ ] **Step 9: Commit**

```bash
git add client/src/Landing.jsx client/src/web/WebStartup.jsx client/src/App.jsx
git commit -m "$(cat <<'EOF'
feat(demo): enter the demo from the landing and startup screens

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Isolation guard and browser proof

**Files:**
- Create: `client/src/web/demo/isolation.test.js`
- Create: `scripts/check-demo-bundle.mjs`
- Create: `scripts/web-demo.mjs`
- Modify: `sa-job-agent-suite/package.json:17`

**Interfaces:**
- `isolation.test.js` scans the demo tree for forbidden imports and reserved-domain rules.
- `check-demo-bundle.mjs` reads the built entry script and asserts no fixture marker, then finds a demo chunk.
- `web-demo.mjs` drives the whole demo flow, a refresh, and the exit sentinel check.

- [ ] **Step 1: Write `isolation.test.js`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname);

async function demoFiles() {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/\.(js|jsx)$/.test(entry.name)) continue;
    if (entry.name.endsWith('.test.js') || entry.name.endsWith('.test.jsx')) continue;
    files.push(path.join(root, entry.name));
  }
  return files;
}

const FORBIDDEN = /from\s+['"](?:[^'"]*keyStore|[^'"]*keyCrypto|[^'"]*validateKey|@sajas\/core\/ai)['"]/;

test('the demo tree never imports a key, crypto or AI module', async () => {
  for (const file of await demoFiles()) {
    const text = await fs.readFile(file, 'utf8');
    assert.equal(FORBIDDEN.test(text), false, `${path.basename(file)} imports a forbidden module`);
    assert.equal(text.includes('api.anthropic.com'), false, `${path.basename(file)} names the provider origin`);
  }
});

test('only UI files may fetch, and only the intercepted API base', async () => {
  const ui = new Set(['SimulatedHunter.jsx', 'SimulatedCopilot.jsx']);
  for (const file of await demoFiles()) {
    const name = path.basename(file);
    if (ui.has(name)) continue;
    const text = await fs.readFile(file, 'utf8');
    assert.equal(text.includes('fetch('), false, `${name} performs a fetch outside the API seam`);
  }
  for (const name of ui) {
    const text = await fs.readFile(path.join(root, name), 'utf8');
    for (const match of text.matchAll(/fetch\(([^)]*)\)/g)) {
      assert.match(match[1], /API_BASE|\$\{API_BASE\}/, `${name} fetches outside the API base`);
    }
  }
});

test('fixtures contain only reserved .test hosts and emails', async () => {
  const text = await fs.readFile(path.join(root, 'fixtures.js'), 'utf8');
  const urls = [...text.matchAll(/https?:\/\/[^'"`\s)]+/g)].map((match) => match[0]);
  assert.ok(urls.length > 0);
  for (const url of urls) assert.match(new URL(url).hostname, /\.test$/, url);
  for (const email of [...text.matchAll(/[\w.+-]+@([\w.-]+)/g)].map((match) => match[1])) {
    assert.match(email, /\.test$/, email);
  }
});
```

- [ ] **Step 2: Run it**

Run: `node --test client/src/web/demo/isolation.test.js`
Expected: PASS. If the fetch regex trips on `fetchImpl`, adjust the regex to `/(?<![A-Za-z])fetch\(/`; do not weaken the file exclusion.

- [ ] **Step 3: Write `scripts/check-demo-bundle.mjs`**

```js
// Fails when demo fixtures or the demo storage namespace leak into the entry
// chunk, and fails when the demo chunk is missing entirely.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'client/dist');
const MARKERS = ['Alex Example', 'Example Studio', 'Fable Fintech', 'sajas:demo:'];

async function main() {
  const html = await fs.readFile(path.join(dist, 'index.html'), 'utf8').catch(() => {
    throw new Error('client/dist/index.html is missing. Run npm run build:web first.');
  });
  const source = /<script[^>]+src="([^"]+)"/.exec(html)?.[1];
  assert.ok(source, 'index.html has no module script');
  const entry = path.resolve(dist, source.replace(/^\.?\//, ''));
  const entryText = await fs.readFile(entry, 'utf8');
  for (const marker of MARKERS) {
    assert.equal(entryText.includes(marker), false, `the entry chunk contains the demo marker ${marker}`);
  }

  const assets = await fs.readdir(path.join(dist, 'assets'));
  const chunks = [];
  for (const name of assets.filter((file) => file.endsWith('.js'))) {
    chunks.push({ name, text: await fs.readFile(path.join(dist, 'assets', name), 'utf8') });
  }
  assert.ok(chunks.some((chunk) => chunk.name !== path.basename(entry) && chunk.text.includes('Alex Example')), 'no demo fixtures chunk was emitted');
  assert.ok(chunks.some((chunk) => chunk.text.includes('sajas:demo:')), 'no demo storage namespace chunk was emitted');
  console.log(`check-demo-bundle: PASS (${chunks.length} chunks)`);
}

main().catch((error) => {
  console.error(`check-demo-bundle: FAIL - ${error.message}`);
  process.exitCode = 1;
});
```

- [ ] **Step 4: Write `scripts/web-demo.mjs`**

```js
// Offline proof of the hosted demo: enter without a key, exercise every surface,
// refresh, exit, and verify the real vault sentinel is untouched.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startStaticServer } from './lib/staticServer.mjs';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'client/dist');

const PROFILE = { fullName: 'Sentinel Person', email: 'sentinel@example.test', applicationProfile: {} };
const JOB = {
  id: 'sentinel-job', title: 'Sentinel Job', company: 'Sentinel Company',
  location: 'Cape Town', description: 'A sentinel record.', applyUrl: 'https://sentinel.test/apply',
  datePosted: '2026-10-20', matchScore: 50, status: 'found', notes: '', source: 'Manual',
  tailoredCvText: '', tailoredCoverLetterText: '', dateAdded: '2026-10-20'
};

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

async function readVault(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('sajas-web', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const read = (store) => new Promise((resolve, reject) => {
      const request = db.transaction(store, 'readonly').objectStore(store).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return { profile: await read('profile'), jobs: await read('jobs') };
  });
}

const demoKeys = (page) => page.evaluate(() => {
  const keys = [];
  for (let index = 0; index < sessionStorage.length; index += 1) keys.push(sessionStorage.key(index));
  return keys.filter((key) => key.startsWith('sajas:demo:'));
});

async function main() {
  await fs.access(path.join(dist, 'index.html')).catch(() => {
    throw new Error('client/dist/index.html is missing. Run npm run build:web first.');
  });
  const server = await startStaticServer({ root: dist });
  const origin = new URL(server.url).origin;
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    const requests = [];
    const page = await context.newPage();
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('request', (request) => requests.push(request.url()));

    await page.goto(server.url, { waitUntil: 'networkidle' });
    await page.getByTestId('onboarding').waitFor({ timeout: 20_000 });
    await seed(page);
    await page.getByTestId('key-skip').click({ timeout: 20_000 });
    await page.getByRole('button', { name: /Enter the Suite/i }).waitFor({ timeout: 20_000 });

    assert.deepEqual(await demoKeys(page), [], 'demo keys exist before the demo action');
    assert.equal(await page.getByText('Alex Example', { exact: false }).count(), 0, 'fixture text is in the initial page');

    await page.getByTestId('try-demo-landing').click();
    await page.getByTestId('demo-banner').waitFor({ timeout: 20_000 });
    assert.match(await page.getByTestId('demo-banner').innerText(), /Demo mode\. Everything here is simulated\./);
    await page.getByTestId('demo-trial-strip').waitFor();
    await page.getByText('Example Studio', { exact: false }).first().waitFor({ timeout: 20_000 });

    await page.getByRole('button', { name: /Profile & Settings/i }).click();
    await page.getByTestId('demo-key-note').waitFor();
    assert.equal(await page.getByTestId('key-input').count(), 0, 'the key input is reachable in demo mode');

    await page.getByRole('button', { name: /^Job Feeds$/ }).click();
    await page.getByTestId('feed-source-remotive').waitFor({ timeout: 20_000 });
    await page.getByTestId('feed-hidden-foreign').waitFor();
    assert.match(await page.getByTestId('feed-hidden-foreign').innerText(), /outside South Africa hidden/);

    await page.getByRole('button', { name: /^Document Tailor$/ }).click();
    await page.getByText('Data Engineer').first().click();
    await page.getByTestId('optimise-cv').click();
    await page.getByTestId('tailored-cv').waitFor({ timeout: 15_000 });
    assert.match(await page.getByTestId('tailored-cv').innerText(), /Sample Logistics/);

    await page.getByRole('button', { name: /^Ask Documents$/ }).click();
    await page.getByTestId('ask-question').fill('Which accessibility dashboard project did Alex build?');
    await page.getByTestId('ask-submit').click();
    await page.getByTestId('ask-answer').waitFor({ timeout: 15_000 });
    const answer = await page.getByTestId('ask-answer').innerText();
    assert.match(answer, /\[Doc:/);
    assert.match(answer, /Simulated/);

    await page.getByTestId('ask-question').fill('Do you have a commercial pilot licence?');
    await page.getByTestId('ask-submit').click();
    await page.getByTestId('ask-refusal').waitFor({ timeout: 15_000 });

    await page.getByTestId('ask-check-submit').click();
    await page.getByTestId('ask-check-result').waitFor({ timeout: 15_000 });
    assert.match(await page.getByTestId('ask-check-result').innerText(), /cannot verify/);

    await page.getByRole('button', { name: /^Job Hunter$/ }).click();
    await page.getByTestId('run-demo-hunter').click();
    await page.getByTestId('demo-hunter-result').waitFor({ timeout: 25_000 });
    assert.match(await page.getByTestId('demo-hunter-result').innerText(), /3 added, 1 already tracked/);

    await page.getByRole('button', { name: /^Apply Copilot$/ }).click();
    await page.getByTestId('open-simulated-portal').click();
    await page.getByTestId('demo-form-continue').waitFor({ timeout: 15_000 });
    await page.getByTestId('demo-form-continue').click();
    await page.getByTestId('demo-question').fill('The accessibility dashboard project.');
    await page.getByTestId('demo-question-continue').click();
    await page.getByTestId('demo-review').waitFor();
    await page.getByTestId('demo-review-submit').click();
    await page.getByTestId('demo-confirm').click();
    await page.getByTestId('demo-receipt').waitFor({ timeout: 15_000 });
    assert.match(await page.getByTestId('demo-receipt').innerText(), /Nothing was sent to an employer\./);

    await page.reload({ waitUntil: 'networkidle' });
    await page.getByTestId('demo-banner').waitFor({ timeout: 20_000 });
    await page.getByText('Example Studio', { exact: false }).first().waitFor({ timeout: 20_000 });

    await page.getByTestId('exit-demo').click();
    await page.getByRole('button', { name: /Enter the Suite/i }).waitFor({ timeout: 20_000 });
    assert.deepEqual(await demoKeys(page), [], 'demo keys survived the exit');

    const vault = await readVault(page);
    assert.equal(vault.profile[0]?.fullName, 'Sentinel Person');
    assert.equal(vault.jobs.find((job) => job.id === JOB.id)?.status, 'found');
    assert.equal(vault.jobs.some((job) => job.id.startsWith('demo-job-')), false, 'demo data reached the real vault');

    assert.deepEqual(errors, [], `console errors: ${errors.join(' | ')}`);
    const external = requests.filter((url) => /^https?:\/\//.test(url) && !url.startsWith(origin));
    assert.deepEqual(external, [], 'a request left the page origin');

    console.log('web-demo: ok');
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

- [ ] **Step 5: Add both checks to `test:web`**

In `sa-job-agent-suite/package.json`, change the `test:web` script to:

```json
"test:web": "node scripts/check-ui.mjs && node scripts/check-demo-bundle.mjs && node scripts/web-canary.mjs && node scripts/web-feeds.mjs && node scripts/web-filters.mjs && node scripts/web-isolation.mjs && node scripts/web-ui.mjs && node scripts/web-tailor.mjs && node scripts/web-rag.mjs && node scripts/web-apply.mjs && node scripts/web-demo.mjs",
```

- [ ] **Step 6: Build and run the full browser proof**

Run from `sa-job-agent-suite/`:

```bash
npm run build:web
npm run test:web
```

Expected: `check-demo-bundle: PASS`, `web-demo: ok`, and every earlier proof still passes.

- [ ] **Step 7: Commit**

```bash
git add client/src/web/demo/isolation.test.js scripts/check-demo-bundle.mjs scripts/web-demo.mjs package.json
git commit -m "$(cat <<'EOF'
test(demo): prove isolation and the full simulated walk in a browser

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Docs, gates, PR, deploy and the live check

**Files:**
- Create: `scripts/web-demo-live.mjs`
- Modify: `README.md`
- Modify: `SECURITY.md`
- Modify: `docs/superpowers/specs/2026-10-28-live-demo-mode-design.md` (status line)
- Modify: `docs/superpowers/specs/2026-10-27-post-m3a3-pipeline.md` (Arc 9 status)

**Interfaces:**
- `web-demo-live.mjs` takes the deployed base URL as `process.argv[2]`, defaults to `https://sajas.pages.dev`, and never needs a key.

- [ ] **Step 1: Write `scripts/web-demo-live.mjs`**

```js
// Post-deploy check in a fresh browser profile. It never touches the real vault:
// it only enters the demo, tailors one fictional job and exits.
import assert from 'node:assert/strict';

const base = process.argv[2] || 'https://sajas.pages.dev';

async function main() {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    const requests = [];
    const page = await context.newPage();
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('request', (request) => requests.push(request.url()));

    await page.goto(base, { waitUntil: 'networkidle' });
    await page.getByTestId('try-demo-landing').click({ timeout: 20_000 });
    await page.getByTestId('demo-banner').waitFor({ timeout: 20_000 });
    await page.getByRole('button', { name: /^Document Tailor$/ }).click();
    await page.getByText('Data Engineer').first().click();
    await page.getByTestId('optimise-cv').click();
    await page.getByTestId('tailored-cv').waitFor({ timeout: 15_000 });
    assert.match(await page.getByTestId('tailored-cv').innerText(), /Sample Logistics/);
    await page.getByTestId('exit-demo').click();
    await page.getByRole('button', { name: /Enter the Suite/i }).waitFor({ timeout: 20_000 });
    assert.deepEqual(errors, [], `console errors: ${errors.join(' | ')}`);
    const external = requests.filter((url) => /^https?:\/\//.test(url) && !url.startsWith(new URL(base).origin));
    assert.deepEqual(external, [], 'a request left the deployed origin');
    console.log(`web-demo-live: ok (${base})`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: Update the docs**

`README.md`: add a "Try the live demo" subsection under the hosted web section. State that it is fictional, needs no key, runs in the tab, and `Exit demo` restores the real workspace.

`SECURITY.md`: add an "Isolation contract for demo mode" section with the seven rules from the spec, plus the `sessionStorage` prefix `sajas:demo:` and the fact that the real vault and key are never read.

`docs/superpowers/specs/2026-10-28-live-demo-mode-design.md`: change `**Status:** proposed 2026-10-28` to `**Status:** shipped 2026-10-28`.

`docs/superpowers/specs/2026-10-27-post-m3a3-pipeline.md`: set the Arc 9 row to `Shipped 2026-10-28 (PR #<number>)` after the merge, with the evidence line naming `scripts/web-demo.mjs`.

- [ ] **Step 3: Run every gate from `sa-job-agent-suite/`**

```bash
npm test
npm run test:demo
npm run build:client
npm run build:web
npm run test:web
node ../tools/check-secrets.mjs --all
```

Expected: every command exits 0. `npm test` runs offline with no key set.

- [ ] **Step 4: Commit and open the PR**

```bash
git add scripts/web-demo-live.mjs README.md SECURITY.md ../docs/superpowers/specs/2026-10-28-live-demo-mode-design.md ../docs/superpowers/specs/2026-10-27-post-m3a3-pipeline.md
git commit -m "$(cat <<'EOF'
docs(demo): record the isolation contract and ship notes

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
git push -u origin arc-9-live-demo
gh pr create --title "Arc 9: hosted live demo mode" --body "$(cat <<'EOF'
## Summary
- Add a per-tab demo mode behind the existing fetch seam, with a session vault under sajas:demo: and a stub key store.
- Simulate tailor, grounded ask and refusal, document check, feeds, Hunter and a confirmed Apply Copilot loop on fictional data.
- Add a banner and Exit control, suggested steps, demo-only tabs, a static isolation scan, a bundle guard and a full Playwright walk that proves the real vault sentinel is untouched.

## Test plan
- [ ] npm test
- [ ] npm run test:demo
- [ ] npm run build:client
- [ ] npm run build:web
- [ ] npm run test:web
- [ ] node tools/check-secrets.mjs --all
- [ ] On the deployed URL: enter the demo, tailor a job, run the hunter, complete the copilot, refresh, exit, confirm the real workspace is unchanged.
EOF
)"
```

- [ ] **Step 5: Merge green CI and deploy**

After CI is green and the PR is merged:

```bash
git checkout main
git pull --ff-only
cd sa-job-agent-suite
npm ci
npm run build:web
npx --yes wrangler@latest pages deploy client/dist --project-name sajas --branch main
```

- [ ] **Step 6: Run the live check**

Run from `sa-job-agent-suite/`:

```bash
node scripts/web-demo-live.mjs https://sajas.pages.dev
```

Expected: `web-demo-live: ok (https://sajas.pages.dev)`.

- [ ] **Step 7: Record the evidence**

Add the shipped PR number and the live-check result to the pipeline Arc 9 row, commit to `main` through a small docs PR, and merge. Do not amend the release commit.

---

## Self-Review

**Spec coverage**

| Spec section | Task |
|---|---|
| Isolation contract rules 1, 2, 6 | Tasks 1, 4, 5, 11 |
| Rule 3, no network | Tasks 3, 4, 8, 9, 11 |
| Rule 4, no bleed on exit | Tasks 5, 10, 11 |
| Rule 5, no export | Tasks 6, 10 |
| Rule 7, desktop untouched | Global constraints and the file list |
| Architecture and new modules | Tasks 1 to 10 |
| Demo data | Task 2 |
| Tailor, ask, check | Task 4 |
| Feeds and the SA filter | Tasks 2, 3 |
| Hunter stages, Stop, dedupe | Task 8 |
| Copilot full loop and receipt | Task 9 |
| Apply tab in demo | Tasks 9, 10 |
| Banner, steps, tags, settings, tabs, accessibility | Tasks 6, 7, 10 |
| Error handling | Tasks 1, 4, 5, 8, 9 |
| Unit tests and browser proof | Tasks 1 to 11 |
| Live check | Task 12 |

**Type consistency**

- `getFeedClient()` is async in both the real and demo branches, and both `JobFeeds` call sites await it twice.
- `isTabVisible` and `filterSettingsTabs` take the same third `demo` argument everywhere they are called.
- `createSimulationRouter` owns `POST /demo/apply/:id`, and `SimulatedCopilot` calls that exact path.
- `DEMO_STEPS` ids match the `sajas:demo-step` detail values for `hunter` and `copilot`.
- `seedDemoVault` uses the same `DEMO_SEED_VERSION` check that `getDemoRuntime` relies on.

**Placeholders**

No TBD, TODO or "similar to" steps remain. Every code step carries the literal code.

**Known risk**

The `isolation.test.js` fetch regex is intentionally narrow. If it fails on a legitimate expression, tighten the pattern, not the rule.
