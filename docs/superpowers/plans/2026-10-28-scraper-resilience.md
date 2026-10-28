# Scraper Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the hunter read the most stable representation of a page, validate every row before saving it, and report exactly what broke when it cannot recover.

**Architecture:** Add a pure card validator in `@sajas/core/scrape`, a same-origin JSON and embedded-state capture layer, structured and semantic extraction strategies, and one pipeline that validates every strategy's rows and picks the winner. The runner installs capture before navigation and returns the winning strategy plus quality counts; health turns a high rejection ratio into a broken or degraded status. Browser creation and pacing move into shared, injectable modules.

**Tech Stack:** Node 22 ESM, node:test, Playwright Chromium, React 18 client, no new runtime dependencies.

**Spec:** [`docs/superpowers/specs/2026-10-28-scraper-resilience-design.md`](../specs/2026-10-28-scraper-resilience-design.md)

## Global Constraints

- Work from `sa-job-agent-suite/` for npm commands. Run `node tools/check-secrets.mjs` from the worktree root.
- Never run `npm run smoke:live`, `node evals/run.mjs --live`, or anything needing `ANTHROPIC_API_KEY`. Never set that variable.
- All tests are offline. Use `fakeClient`, routed fixtures, or fake page objects. No live scraping in tests.
- Never bypass the pre-commit hook. `--no-verify` is forbidden.
- No provider names outside `server/src/db/migrations.js`. No model-ID literals outside `packages/core/src/models.js` and `*.test.js`.
- No new runtime dependencies. The card schema is hand-rolled.
- No em dashes in code, docs, UI copy or commit messages.
- Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- One spec, one plan, one PR, one merge and one manual live check for this arc.
- Tests that need a browser must use `launchTestBrowser()` and skip when it returns null. Server unit tests run in CI without Playwright browsers installed.
- The South Africa gate, scoring, link validation, canary cadence and circuit breaker semantics stay unchanged except for the new quality fields.

---

### Task 1: Core card schema

**Files:**
- Create: `packages/core/src/scrape/cardSchema.js`
- Create: `packages/core/src/scrape/cardSchema.test.js`
- Create: `packages/core/src/scrape/index.js`
- Modify: `packages/core/package.json` (subpath export)

**Interfaces:**
- Produces: `CARD_LIMITS`, `isHttpUrl(value)`, `validateJobCard(raw, { linkless })`, `validateJobCards(list, { linkless })`, all from `@sajas/core/scrape`.
- `validateJobCard` returns `{ ok, value, issues }`. `validateJobCards` returns `{ valid, rejected, rejectReasons }` with at most three reasons.

- [ ] **Step 1: Write the failing test**

```js
// packages/core/src/scrape/cardSchema.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { CARD_LIMITS, isHttpUrl, validateJobCard, validateJobCards } from './cardSchema.js';

const card = (over = {}) => ({
  title: 'Senior Developer',
  company: 'Acme',
  location: 'Cape Town',
  description: 'Build things.',
  applyUrl: 'https://example.test/j/1',
  datePosted: 'Today',
  source: 'Example Board',
  ...over
});

test('a complete card is accepted and trimmed', () => {
  const result = validateJobCard(card({ title: '  Senior Developer  ' }));
  assert.equal(result.ok, true);
  assert.equal(result.value.title, 'Senior Developer');
  assert.equal(result.value.applyUrl, 'https://example.test/j/1');
  assert.equal(result.value.company, 'Acme');
  assert.deepEqual(result.issues, []);
});

test('title is required and bounded', () => {
  assert.equal(validateJobCard(card({ title: '' })).ok, false);
  assert.equal(validateJobCard(card({ title: 'Dev' })).issues[0].code, 'title-required');
  assert.equal(validateJobCard(card({ title: 'D'.repeat(CARD_LIMITS.titleMax + 1) })).issues[0].code, 'title-too-long');
  assert.equal(validateJobCard({ title: 42, applyUrl: 'https://x.test/1' }).ok, false);
});

test('applyUrl is required unless the source is linkless', () => {
  assert.equal(validateJobCard(card({ applyUrl: '' })).issues[0].code, 'url-required');
  assert.equal(validateJobCard({ title: 'Senior Developer' }).issues[0].code, 'url-required');
  const linkless = validateJobCard({ title: 'Senior Developer' }, { linkless: true });
  assert.equal(linkless.ok, true);
  assert.equal('applyUrl' in linkless.value, false);
});

test('applyUrl must be an absolute http(s) link', () => {
  for (const bad of ['/jobs/1', 'jobs/1', 'ftp://x.test/1', 'javascript:alert(1)', 'https://', 'x'.repeat(CARD_LIMITS.urlMax + 1)]) {
    assert.equal(validateJobCard(card({ applyUrl: bad })).issues[0].code, 'url-invalid', bad);
  }
  assert.equal(isHttpUrl('https://example.test/a'), true);
  assert.equal(isHttpUrl('http://example.test/a'), true);
  assert.equal(isHttpUrl('HTTPS://EXAMPLE.TEST/A'), true);
});

test('optional fields are dropped when empty or over the cap', () => {
  const result = validateJobCard(card({
    company: 'C'.repeat(CARD_LIMITS.companyMax + 1),
    location: '   ',
    description: 'D'.repeat(CARD_LIMITS.descriptionMax + 1),
    datePosted: 'T'.repeat(CARD_LIMITS.datePostedMax + 1),
    source: 'S'.repeat(CARD_LIMITS.sourceMax + 1)
  }));
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.value).sort(), ['applyUrl', 'title']);
});

test('unknown fields and non-object rows are dropped or rejected', () => {
  const result = validateJobCard(card({ salary: 'R100', id: 9 }));
  assert.equal('salary' in result.value, false);
  assert.equal('id' in result.value, false);
  for (const bad of [null, undefined, 42, 'job', []]) {
    assert.equal(validateJobCard(bad).issues[0].code, 'invalid-row');
  }
});

test('validateJobCards separates valid rows and summarises rejections', () => {
  const result = validateJobCards([
    card(),
    card({ title: 'Dev', applyUrl: 'https://example.test/j/2' }),
    { title: 'Senior Developer' },
    card({ title: '', applyUrl: 'not a url' })
  ]);
  assert.equal(result.valid.length, 1);
  assert.equal(result.rejected.length, 3);
  assert.ok(result.rejectReasons.length <= 3);
  assert.ok(result.rejectReasons.every((reason) => typeof reason === 'string' && reason.length > 0));
});

test('validateJobCards never throws on a missing list', () => {
  for (const value of [null, undefined, 42, {}]) {
    assert.deepEqual(validateJobCards(value), { valid: [], rejected: [], rejectReasons: [] });
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd sa-job-agent-suite && node --test packages/core/src/scrape/cardSchema.test.js
```

Expected: FAIL, `Cannot find module .../cardSchema.js`.

- [ ] **Step 3: Implement the schema**

```js
// packages/core/src/scrape/cardSchema.js
// Pure job-card validation shared by every extraction strategy. No I/O.
export const CARD_LIMITS = Object.freeze({
  titleMin: 4,
  titleMax: 300,
  companyMax: 200,
  locationMax: 200,
  descriptionMax: 5000,
  datePostedMax: 100,
  sourceMax: 100,
  urlMax: 500
});

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value) => (typeof value === 'string' ? value.trim() : '');

export function isHttpUrl(value) {
  const raw = text(value);
  if (!raw || raw.length > CARD_LIMITS.urlMax) return false;
  try {
    const url = new URL(raw);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.length > 0;
  } catch {
    return false;
  }
}

function copyOptional(raw, key, max, value) {
  const trimmed = text(raw[key]);
  if (trimmed && trimmed.length <= max) value[key] = trimmed;
}

export function validateJobCard(raw, { linkless = false } = {}) {
  if (!isObject(raw)) {
    return { ok: false, value: null, issues: [{ field: 'row', code: 'invalid-row', message: 'not a job card object' }] };
  }
  const issues = [];
  const title = text(raw.title);
  if (title.length < CARD_LIMITS.titleMin) {
    issues.push({ field: 'title', code: 'title-required', message: `title needs at least ${CARD_LIMITS.titleMin} characters` });
  } else if (title.length > CARD_LIMITS.titleMax) {
    issues.push({ field: 'title', code: 'title-too-long', message: `title is over ${CARD_LIMITS.titleMax} characters` });
  }

  const applyUrl = text(raw.applyUrl ?? raw.url);
  if (!applyUrl && !linkless) {
    issues.push({ field: 'applyUrl', code: 'url-required', message: 'applyUrl is missing' });
  } else if (applyUrl && !isHttpUrl(applyUrl)) {
    issues.push({ field: 'applyUrl', code: 'url-invalid', message: 'applyUrl is not an absolute http(s) link' });
  }

  if (issues.length) return { ok: false, value: null, issues };

  const value = { title };
  if (applyUrl) value.applyUrl = applyUrl;
  copyOptional(raw, 'company', CARD_LIMITS.companyMax, value);
  copyOptional(raw, 'location', CARD_LIMITS.locationMax, value);
  copyOptional(raw, 'description', CARD_LIMITS.descriptionMax, value);
  copyOptional(raw, 'datePosted', CARD_LIMITS.datePostedMax, value);
  copyOptional(raw, 'source', CARD_LIMITS.sourceMax, value);
  return { ok: true, value, issues: [] };
}

const REASON_TEXT = Object.freeze({
  'invalid-row': 'not a job card',
  'title-required': 'no usable title',
  'title-too-long': 'an overlong title',
  'url-required': 'no apply link',
  'url-invalid': 'a link that is not a web address'
});

export function validateJobCards(list, options = {}) {
  const rows = Array.isArray(list) ? list : [];
  const valid = [];
  const rejected = [];
  const counts = new Map();
  for (const row of rows) {
    const result = validateJobCard(row, options);
    if (result.ok) {
      valid.push(result.value);
      continue;
    }
    rejected.push({ row, issues: result.issues });
    const code = result.issues[0]?.code || 'invalid-row';
    counts.set(code, (counts.get(code) || 0) + 1);
  }
  const rejectReasons = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([code, n]) => `${n} ${n === 1 ? 'row' : 'rows'} with ${REASON_TEXT[code] || REASON_TEXT['invalid-row']}`);
  return { valid, rejected, rejectReasons };
}
```

```js
// packages/core/src/scrape/index.js
export * from './cardSchema.js';
```

- [ ] **Step 4: Add the subpath export**

In `packages/core/package.json`, add this line after `"./jobs": "./src/jobs/index.js"`:

```json
    "./scrape": "./src/scrape/index.js"
```

- [ ] **Step 5: Run the tests and the core suite**

```bash
cd sa-job-agent-suite && node --test packages/core/src/scrape/cardSchema.test.js && npm test --workspace=packages/core
```

Expected: PASS for the new file and the existing core suite.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/scrape packages/core/package.json
git commit -m "feat(core): validate job cards with one shared schema" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Capture same-origin JSON, embedded state and JSON-LD

**Files:**
- Create: `server/src/hunter/capture.js`
- Create: `server/src/hunter/capture.test.js`

**Interfaces:**
- Produces: `CAPTURE_LIMITS`, `createCollector({ origin, limits })`, `installCapture(page, collector)`, `readStateInPage(options)`, `parseStateEntries(entries)`, `collectPageData({ page, collector, origin })`.
- `collectPageData` returns `{ origin, payloads, malformed, skipped }` where each payload is `{ kind, json }` and `kind` is `'xhr'`, `'jsonld'` or a state global name.
- Consumes nothing from Task 1.

- [ ] **Step 1: Write the failing pure tests**

```js
// server/src/hunter/capture.test.js
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchTestBrowser } from '../testSupport/browser.js';
import {
  CAPTURE_LIMITS, createCollector, installCapture, parseStateEntries, collectPageData
} from './capture.js';

const response = (url, type, body) => ({
  url: () => url,
  headers: () => (type ? { 'content-type': type } : {}),
  body: async () => Buffer.from(body)
});
const xml = 'https://jobs.test';

test('the collector keeps same-origin JSON and ignores the rest', async () => {
  const collector = createCollector({ origin: xml });
  collector.collect(response(`${xml}/api/jobs`, 'application/json; charset=utf-8', '[{"title":"Dev"}]'));
  collector.collect(response(`${xml}/api/feed`, 'application/ld+json', '{"a":1}'));
  collector.collect(response(`${xml}/api/page`, 'text/html', '<p>x</p>'));
  collector.collect(response('https://other.test/api/jobs', 'application/json', '[{"title":"No"}]'));
  await collector.settle();
  assert.equal(collector.payloads.length, 2);
  assert.equal(collector.payloads[0].kind, 'xhr');
  assert.deepEqual(collector.payloads[1].json, { a: 1 });
});

test('the collector caps responses, malformed bodies and body failures', async () => {
  const collector = createCollector({ origin: xml, limits: { maxResponses: 2, maxResponseBytes: 10, maxTotalBytes: 100 } });
  collector.collect(response(`${xml}/api/big`, 'application/json', '{"too":"large"}'));
  collector.collect(response(`${xml}/api/bad`, 'application/json', 'not json'));
  collector.collect(response(`${xml}/api/one`, 'application/json', '{"a":1}'));
  collector.collect(response(`${xml}/api/two`, 'application/json', '{"b":2}'));
  collector.collect(response(`${xml}/api/three`, 'application/json', '{"c":3}'));
  const broken = { url: () => `${xml}/api/broken`, headers: () => ({ 'content-type': 'application/json' }), body: async () => { throw new Error('detached'); } };
  collector.collect(broken);
  await collector.settle();
  assert.equal(collector.payloads.length, 2);
  assert.equal(collector.state.malformed, 1);
  assert.ok(collector.state.skipped >= 2);
});

test('the total cap stops collection', async () => {
  const collector = createCollector({ origin: xml, limits: { maxResponseBytes: 100, maxTotalBytes: 10 } });
  collector.collect(response(`${xml}/a`, 'application/json', '{"a":1}'));
  collector.collect(response(`${xml}/b`, 'application/json', '{"b":2}'));
  await collector.settle();
  assert.equal(collector.payloads.length, 1);
  assert.equal(collector.state.stopped, true);
});

test('state entries are parsed strictly and malformed payloads are counted', () => {
  const { payloads, malformed } = parseStateEntries([
    { kind: '__NEXT_DATA__', text: '{"props":{}}' },
    { kind: 'jsonld', text: '{"@type":"JobPosting"}' },
    { kind: 'jsonld', text: '{broken' },
    { kind: '__NUXT__', text: '   ' },
    { kind: '__APOLLO_STATE__', text: '[]' }
  ]);
  assert.equal(payloads.length, 3);
  assert.equal(payloads[0].kind, '__NEXT_DATA__');
  assert.equal(malformed, 1);
});

test('collectPageData never throws without a page or collector', async () => {
  assert.deepEqual(await collectPageData({}), { payloads: [], malformed: 0, skipped: 0, origin: '' });
  assert.deepEqual(await collectPageData({ page: { evaluate: async () => { throw new Error('no'); } }, collector: createCollector({ origin: xml }) }), {
    payloads: [], malformed: 0, skipped: 0, origin: 'https://jobs.test'
  });
});

let browser = null;
before(async () => { browser = await launchTestBrowser(); });
after(async () => { if (browser) await browser.close(); });

test('installCapture runs before navigation and collectPageData reads state and JSON-LD', async (t) => {
  if (!browser) return t.skip('no browser available');
  const context = await browser.newContext();
  const page = await context.newPage();
  const requests = [];
  await page.route('**/*', (route) => {
    const url = route.request().url();
    requests.push(url);
    if (url.endsWith('/api/jobs')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"jobs":[{"title":"Backend Developer"}]}' });
    }
    return route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<!doctype html><html><head><title>Jobs</title>
        <script type="application/ld+json">{"@type":"JobPosting","title":"Frontend Developer"}</script>
        <script id="__NEXT_DATA__" type="application/json">{"props":{"jobs":[]}}</script>
        </head><body><script>fetch('/api/jobs')</script></body></html>`
    });
  });
  try {
    const collector = createCollector({ origin: 'https://fixture.test' });
    const detach = installCapture(page, collector);
    await page.goto('https://fixture.test/jobs', { waitUntil: 'networkidle' });
    const captured = await collectPageData({ page, collector, origin: 'https://fixture.test' });
    detach();
    assert.ok(requests.includes('https://fixture.test/api/jobs'));
    assert.equal(captured.payloads.filter((p) => p.kind === 'xhr').length, 1);
    assert.equal(captured.payloads.filter((p) => p.kind === 'jsonld').length, 1);
    assert.equal(captured.payloads.filter((p) => p.kind === '__NEXT_DATA__').length, 1);
    assert.equal(captured.malformed, 0);
  } finally {
    await context.close();
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd sa-job-agent-suite && node --test server/src/hunter/capture.test.js
```

Expected: FAIL, `Cannot find module .../capture.js`.

- [ ] **Step 3: Implement capture**

```js
// server/src/hunter/capture.js
// Collects the most stable representations of a loaded page: same-origin JSON
// responses, embedded application state and JSON-LD. Best effort only.
export const CAPTURE_LIMITS = Object.freeze({
  maxResponses: 12,
  maxResponseBytes: 512 * 1024,
  maxTotalBytes: 1536 * 1024,
  maxStatePayloads: 5,
  maxStateBytes: 2 * 1024 * 1024
});

const isJsonType = (type) => {
  const base = String(type || '').toLowerCase().split(';')[0].trim();
  return base === 'application/json' || base.endsWith('+json');
};

const originOf = (url) => {
  try { return new URL(url).origin; } catch { return ''; }
};

export function createCollector({ origin, limits } = {}) {
  const lim = { ...CAPTURE_LIMITS, ...(limits || {}) };
  const payloads = [];
  const pending = new Set();
  const state = { malformed: 0, skipped: 0, totalBytes: 0, stopped: false };
  let target = origin ? originOf(origin) : '';

  const accept = (response) => {
    try {
      if (state.stopped) return false;
      if (payloads.length >= lim.maxResponses) { state.stopped = true; return false; }
      const url = String(response?.url?.() || '');
      if (!url) return false;
      if (!target) target = originOf(url);
      if (originOf(url) !== target) return false;
      const headers = response?.headers?.() || {};
      return isJsonType(headers['content-type'] || headers['Content-Type']);
    } catch {
      return false;
    }
  };

  const collect = (response) => {
    if (!accept(response)) return;
    let task;
    task = (async () => {
      const url = response.url();
      let body;
      try { body = await response.body(); } catch { state.skipped += 1; return; }
      const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body || '');
      if (!buffer.length || buffer.length > lim.maxResponseBytes) { state.skipped += 1; return; }
      if (state.totalBytes + buffer.length > lim.maxTotalBytes) {
        state.stopped = true;
        state.skipped += 1;
        return;
      }
      state.totalBytes += buffer.length;
      let json;
      try { json = JSON.parse(buffer.toString('utf8')); } catch { state.malformed += 1; return; }
      payloads.push({ kind: 'xhr', url, json });
    })().catch(() => { state.skipped += 1; }).finally(() => { pending.delete(task); });
    pending.add(task);
  };

  const settle = async () => {
    while (pending.size) await Promise.allSettled([...pending]);
  };

  return { origin: target, payloads, state, accept, collect, settle };
}

export function installCapture(page, collector) {
  if (!page || typeof page.on !== 'function') return () => {};
  const handler = (response) => collector.collect(response);
  page.on('response', handler);
  return () => {
    try { page.off?.('response', handler); } catch { /* teardown must not throw */ }
  };
}

// Runs inside the page. Self-contained on purpose.
export function readStateInPage({ maxPayloads = 5, maxBytes = 2 * 1024 * 1024 } = {}) {
  const out = [];
  const seen = new Set();
  const push = (kind, raw) => {
    if (out.length >= maxPayloads) return;
    const text = typeof raw === 'string' ? raw : '';
    if (!text || text.length > maxBytes || seen.has(text)) return;
    seen.add(text);
    out.push({ kind, text });
  };
  for (const name of ['__NEXT_DATA__', '__NUXT__', '__INITIAL_STATE__', '__APOLLO_STATE__']) {
    try {
      if (window[name] != null) push(name, JSON.stringify(window[name]));
    } catch { /* a cyclic or hostile global must not break the snapshot */ }
  }
  const nextData = document.getElementById('__NEXT_DATA__');
  if (nextData && nextData.textContent) push('__NEXT_DATA__', nextData.textContent);
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (let i = 0; i < scripts.length && out.length < maxPayloads; i += 1) {
    push('jsonld', scripts[i].textContent || '');
  }
  return out;
}

export function parseStateEntries(entries = []) {
  const payloads = [];
  let malformed = 0;
  for (const entry of Array.isArray(entries) ? entries : []) {
    const text = typeof entry?.text === 'string' ? entry.text.trim() : '';
    if (!text) continue;
    try { payloads.push({ kind: entry.kind || 'state', json: JSON.parse(text) }); } catch { malformed += 1; }
  }
  return { payloads, malformed };
}

export async function collectPageData({ page, collector, origin } = {}) {
  const base = { payloads: [], malformed: 0, skipped: 0, origin: origin || collector?.origin || '' };
  if (!page || !collector) return base;
  await collector.settle();
  let entries = [];
  try {
    entries = await page.evaluate(readStateInPage, {
      maxPayloads: CAPTURE_LIMITS.maxStatePayloads,
      maxBytes: CAPTURE_LIMITS.maxStateBytes
    });
  } catch {
    entries = [];
  }
  const parsed = parseStateEntries(entries);
  return {
    origin: origin || collector.origin || '',
    payloads: [...collector.payloads, ...parsed.payloads],
    malformed: collector.state.malformed + parsed.malformed,
    skipped: collector.state.skipped
  };
}
```

- [ ] **Step 4: Run the tests**

```bash
cd sa-job-agent-suite && node --test server/src/hunter/capture.test.js
```

Expected: PASS, browser test runs locally and skips when no browser is installed.

- [ ] **Step 5: Commit**

```bash
git add server/src/hunter/capture.js server/src/hunter/capture.test.js
git commit -m "feat(hunter): capture same-origin JSON and embedded page state" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Structured payload mapping

**Files:**
- Create: `server/src/hunter/structured.js`
- Create: `server/src/hunter/structured.test.js`

**Interfaces:**
- Produces: `absolutize(value, origin)`, `stripHtml(value)`, `locationOf(node)`, `mapJsonLdNode(node, origin)`, `mapJsonLd(payloads, origin)`, `looksLikeJobObject(node)`, `mapGenericObject(node, origin)`, `findJobArrays(root, limits)`, `dedupeCards(items)`, `mapStructured(payloads, { source, origin })`.
- `mapStructured` prefers `source.mapStructured({ payloads, origin })` when it returns a non-empty array, then JSON-LD, then generic job arrays. Output rows are unvalidated raw cards.

- [ ] **Step 1: Write the failing tests**

```js
// server/src/hunter/structured.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  absolutize, stripHtml, mapJsonLd, mapStructured, findJobArrays, dedupeCards
} from './structured.js';

const origin = 'https://jobs.test';
const posting = (over = {}) => ({
  '@type': 'JobPosting',
  title: 'Backend Developer',
  description: '<p>Build <b>APIs</b></p>',
  url: '/jobs/1',
  datePosted: '2026-10-20',
  hiringOrganization: { name: 'Acme' },
  jobLocation: { address: { addressLocality: 'Cape Town', addressRegion: 'Western Cape', addressCountry: 'ZA' } },
  ...over
});

test('absolutize and stripHtml handle hostile input', () => {
  assert.equal(absolutize('/jobs/1', origin), 'https://jobs.test/jobs/1');
  assert.equal(absolutize('https://other.test/x', origin), 'https://other.test/x');
  assert.equal(absolutize('', origin), '');
  assert.equal(absolutize('http://[', origin), '');
  assert.equal(stripHtml('<p>Hello <b>world</b></p>'), 'Hello world');
  assert.equal(stripHtml('<script>alert(1)</script>Safe'), 'Safe');
  assert.equal(stripHtml(null), '');
});

test('JSON-LD postings map inside arrays, @graph and single objects', () => {
  const payloads = [
    { kind: 'jsonld', json: posting() },
    { kind: 'jsonld', json: [posting({ title: 'Frontend Developer', url: '/jobs/2' })] },
    { kind: 'jsonld', json: { '@graph': [posting({ title: 'Data Engineer', url: '/jobs/3' }), { '@type': 'Organization', name: 'Acme' }] } }
  ];
  const items = mapJsonLd(payloads, origin);
  assert.equal(items.length, 3);
  assert.equal(items[0].title, 'Backend Developer');
  assert.equal(items[0].company, 'Acme');
  assert.equal(items[0].location, 'Cape Town, Western Cape, ZA');
  assert.equal(items[0].applyUrl, 'https://jobs.test/jobs/1');
  assert.equal(items[0].description, 'Build APIs');
  assert.equal(items[1].applyUrl, 'https://jobs.test/jobs/2');
});

test('JSON-LD split locations are joined and remote type is kept', () => {
  const items = mapJsonLd([{ kind: 'jsonld', json: posting({
    title: 'Remote Developer',
    jobLocation: [{ address: { addressLocality: 'Cape Town' } }, { address: { addressLocality: 'Durban' } }]
  }) }], origin);
  assert.equal(items[0].location, 'Cape Town, Durban');
});

test('generic arrays need a title-like and a link-like key', () => {
  const root = {
    data: {
      jobs: [
        { title: 'Backend Developer', url: '/j/1', companyName: 'Acme', city: 'Cape Town' },
        { title: 'Frontend Developer', url: '/j/2', employer: 'Beta', area: 'Durban', snippet: '<b>Great</b> role' }
      ]
    },
    nav: [{ name: 'Home', link: '/' }, { name: 'Jobs', link: '/jobs' }]
  };
  const arrays = findJobArrays(root);
  assert.equal(arrays.length, 1);
  assert.equal(arrays[0].length, 2);
  const items = mapStructured([{ kind: 'state', json: root }], { origin });
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Backend Developer');
  assert.equal(items[0].company, 'Acme');
  assert.equal(items[0].location, 'Cape Town');
  assert.equal(items[1].company, 'Beta');
  assert.equal(items[1].description, 'Great role');
});

test('generic detection is bounded by depth and node count', () => {
  let deep = { jobs: [{ title: 'Backend Developer', url: '/j/1' }, { title: 'Frontend Developer', url: '/j/2' }] };
  for (let i = 0; i < 15; i += 1) deep = { next: deep };
  assert.equal(findJobArrays(deep).length, 0);
  const wide = { jobs: [{ title: 'Backend Developer', url: '/j/1' }, { title: 'Frontend Developer', url: '/j/2' }] };
  assert.equal(findJobArrays(wide, { maxNodes: 0 }).length, 0);
});

test('a source adapter wins over JSON-LD and generic arrays', () => {
  const source = {
    mapStructured: ({ payloads, origin: base }) => [{ title: 'Adapter Developer', applyUrl: `${base}/adapter`, company: 'Adapter Co' }]
  };
  const payloads = [
    { kind: 'jsonld', json: posting() },
    { kind: 'state', json: { jobs: [{ title: 'Array Developer', url: '/j/1' }, { title: 'Array Developer 2', url: '/j/2' }] } }
  ];
  const items = mapStructured(payloads, { source, origin });
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Adapter Developer');
});

test('a throwing adapter falls through to the generic readers', () => {
  const source = { mapStructured: () => { throw new Error('bad adapter'); } };
  const items = mapStructured([{ kind: 'jsonld', json: posting() }], { source, origin });
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Backend Developer');
});

test('dedupe removes the same URL and the same title plus company', () => {
  const items = dedupeCards([
    { title: 'Backend Developer', company: 'Acme', applyUrl: 'https://jobs.test/j/1' },
    { title: 'Backend Developer', company: 'Acme', applyUrl: 'https://jobs.test/j/1#top' },
    { title: 'Frontend Developer', company: 'Acme' },
    { title: 'Frontend Developer', company: 'Acme' },
    { title: 'Data Engineer', company: 'Beta' }
  ]);
  assert.equal(items.length, 3);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd sa-job-agent-suite && node --test server/src/hunter/structured.test.js
```

Expected: FAIL, module missing.

- [ ] **Step 3: Implement structured mapping**

```js
// server/src/hunter/structured.js
// Maps captured payloads to raw job cards: source adapter first, then JSON-LD,
// then generic job arrays found anywhere in the captured JSON. Pure, no I/O.
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const textOf = (value) => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  return '';
};
const firstText = (...values) => {
  for (const value of values) {
    const text = textOf(value);
    if (text) return text;
  }
  return '';
};

export function stripHtml(value) {
  return String(value ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export function absolutize(value, origin = '') {
  const raw = textOf(value);
  if (!raw) return '';
  try { return new URL(raw, origin || undefined).toString(); } catch { return ''; }
}

const typeNames = (node) => {
  const type = node?.['@type'];
  return (Array.isArray(type) ? type : [type]).filter(Boolean).map((value) => String(value).toLowerCase());
};

export function isJobPosting(node) {
  return isObject(node) && typeNames(node).includes('jobposting');
}

export function locationOf(node) {
  const parts = [];
  const addText = (value) => {
    const text = stripHtml(value);
    if (text && !parts.includes(text)) parts.push(text);
  };
  const add = (location) => {
    if (!location) return;
    if (Array.isArray(location)) { location.forEach(add); return; }
    if (typeof location === 'string') { addText(location); return; }
    if (!isObject(location)) return;
    if (location.address) {
      const address = location.address;
      if (typeof address === 'string') addText(address);
      else {
        addText(address.addressLocality);
        addText(address.addressRegion);
        addText(isObject(address.addressCountry) ? address.addressCountry.name : address.addressCountry);
      }
    } else {
      addText(location.name);
    }
  };
  add(node?.jobLocation);
  add(node?.applicantLocationRequirements);
  return parts.join(', ');
}

export function mapJsonLdNode(node, origin = '') {
  const organization = node?.hiringOrganization;
  const company = isObject(organization) ? firstText(organization.name, organization.legalName) : textOf(organization);
  return {
    title: stripHtml(node?.title ?? node?.name),
    company: stripHtml(company),
    location: locationOf(node),
    description: stripHtml(node?.description),
    applyUrl: absolutize(firstText(node?.url, node?.sameAs), origin),
    datePosted: firstText(node?.datePosted)
  };
}

export function mapJsonLd(payloads = [], origin = '') {
  const items = [];
  const visit = (node) => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!isObject(node)) return;
    if (isJobPosting(node)) { items.push(mapJsonLdNode(node, origin)); return; }
    if (Array.isArray(node['@graph'])) node['@graph'].forEach(visit);
  };
  for (const entry of Array.isArray(payloads) ? payloads : []) visit(entry?.json);
  return items;
}

const TITLE_KEYS = ['title', 'jobtitle', 'positiontitle', 'position', 'role', 'jobtitletext'];
const LINK_KEYS = ['url', 'applyurl', 'link', 'joburl', 'href', 'externalurl', 'redirecturl'];
const COMPANY_KEYS = ['company', 'companyname', 'employer', 'advertiser', 'hiringorganization'];
const LOCATION_KEYS = ['location', 'city', 'town', 'place', 'area', 'locationname', 'region'];
const DESC_KEYS = ['description', 'summary', 'snippet', 'teaser'];
const DATE_KEYS = ['dateposted', 'posteddate', 'published', 'publishedat', 'createdat', 'date'];

const lower = (key) => String(key || '').toLowerCase();
const hasAnyKey = (node, keys) => Object.keys(node).some((key) => keys.includes(lower(key)));

function pick(node, keys) {
  for (const key of Object.keys(node)) {
    if (!keys.includes(lower(key))) continue;
    const value = node[key];
    const text = textOf(value);
    if (text) return text;
    if (isObject(value)) {
      const nested = firstText(value.name, value.title);
      if (nested) return nested;
    }
  }
  return '';
}

export function looksLikeJobObject(node) {
  return isObject(node) && hasAnyKey(node, TITLE_KEYS) && hasAnyKey(node, LINK_KEYS);
}

export function mapGenericObject(node, origin = '') {
  return {
    title: stripHtml(pick(node, TITLE_KEYS)),
    company: stripHtml(pick(node, COMPANY_KEYS)),
    location: stripHtml(pick(node, LOCATION_KEYS)),
    description: stripHtml(pick(node, DESC_KEYS)),
    applyUrl: absolutize(pick(node, LINK_KEYS), origin),
    datePosted: pick(node, DATE_KEYS)
  };
}

export function findJobArrays(root, { maxDepth = 12, maxNodes = 5000, maxItems = 200 } = {}) {
  const found = [];
  const queue = [{ node: root, depth: 0 }];
  let visited = 0;
  while (queue.length && visited < maxNodes) {
    const { node, depth } = queue.shift();
    visited += 1;
    if (depth > maxDepth) continue;
    if (Array.isArray(node)) {
      const jobs = node.filter(looksLikeJobObject).slice(0, maxItems);
      if (jobs.length) { found.push(jobs); continue; }
      for (const child of node.slice(0, maxItems)) {
        if (child && typeof child === 'object') queue.push({ node: child, depth: depth + 1 });
      }
      continue;
    }
    if (isObject(node)) {
      for (const value of Object.values(node)) {
        if (value && typeof value === 'object') queue.push({ node: value, depth: depth + 1 });
      }
    }
  }
  return found;
}

export function dedupeCards(items = []) {
  const seen = new Set();
  const out = [];
  for (const card of Array.isArray(items) ? items : []) {
    if (!isObject(card)) continue;
    const url = textOf(card.applyUrl).toLowerCase().replace(/#.*$/, '').replace(/\/$/, '');
    const key = url || `${textOf(card.title).toLowerCase()}::${textOf(card.company).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(card);
  }
  return out;
}

export function mapStructured(payloads = [], { source = null, origin = '' } = {}) {
  const list = Array.isArray(payloads) ? payloads : [];
  if (typeof source?.mapStructured === 'function') {
    try {
      const adapted = source.mapStructured({ payloads: list, origin });
      if (Array.isArray(adapted) && adapted.length) return dedupeCards(adapted);
    } catch { /* a broken adapter must not block the generic readers */ }
  }
  const jsonLd = mapJsonLd(list, origin);
  if (jsonLd.length) return dedupeCards(jsonLd);
  const generic = [];
  for (const entry of list) {
    for (const array of findJobArrays(entry?.json)) {
      for (const node of array) generic.push(mapGenericObject(node, origin));
    }
  }
  return dedupeCards(generic);
}
```

- [ ] **Step 4: Run the tests**

```bash
cd sa-job-agent-suite && node --test server/src/hunter/structured.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/hunter/structured.js server/src/hunter/structured.test.js
git commit -m "feat(hunter): map JSON-LD and captured job arrays to cards" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Semantic DOM extraction

**Files:**
- Create: `server/src/hunter/semanticDom.js`
- Create: `server/src/hunter/semanticDom.test.js`

**Interfaces:**
- Produces: `snapshotCandidatesInPage({ maxCards })`, a self-contained in-page function returning serialised candidate cards, and `extractSemanticCards(snapshot, { origin, linkless, maxCards })` in Node.
- The split exists because CI runs server unit tests without Playwright browsers, so field extraction must be pure.

- [ ] **Step 1: Write the failing tests**

```js
// server/src/hunter/semanticDom.test.js
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchTestBrowser } from '../testSupport/browser.js';
import { snapshotCandidatesInPage, extractSemanticCards } from './semanticDom.js';

const origin = 'https://jobs.test';
const card = (over = {}) => ({
  tag: 'li',
  className: 'job-card',
  testId: 'job-card',
  ariaLabel: '',
  itemprops: [],
  headings: [{ tag: 'h2', text: 'Backend Developer' }],
  links: [{ href: '/jobs/1', text: 'Backend Developer', className: 'job-link' }],
  fields: [
    { className: 'company-name', itemprop: '', tag: 'span', text: 'Acme' },
    { className: 'job-location', itemprop: '', tag: 'span', text: 'Cape Town' },
    { className: 'posted-date', itemprop: '', tag: 'time', text: '2 days ago' }
  ],
  text: 'Backend Developer Acme Cape Town 2 days ago',
  ...over
});

test('a semantic card maps its heading, link and fields', () => {
  const [item] = extractSemanticCards([card()], { origin });
  assert.equal(item.title, 'Backend Developer');
  assert.equal(item.company, 'Acme');
  assert.equal(item.location, 'Cape Town');
  assert.equal(item.datePosted, '2 days ago');
  assert.equal(item.applyUrl, 'https://jobs.test/jobs/1');
  assert.ok(item.description.length > 0);
});

test('itemprop values win over class heuristics', () => {
  const [item] = extractSemanticCards([card({
    itemprops: [
      { name: 'title', text: 'Data Engineer' },
      { name: 'hiringOrganization', text: 'Beta' },
      { name: 'jobLocation', text: 'Durban' },
      { name: 'description', text: 'Build pipelines' }
    ]
  })], { origin });
  assert.equal(item.title, 'Data Engineer');
  assert.equal(item.company, 'Beta');
  assert.equal(item.location, 'Durban');
  assert.equal(item.description, 'Build pipelines');
});

test('cards without a usable title or link are skipped', () => {
  const noTitle = card({ headings: [], ariaLabel: '', itemprops: [], text: 'tiny' });
  const noLink = card({ links: [] });
  assert.equal(extractSemanticCards([noTitle, noLink], { origin }).length, 0);
  assert.equal(extractSemanticCards([noLink], { origin, linkless: true }).length, 1);
});

test('relative links are absolutised and duplicates collapse', () => {
  const items = extractSemanticCards([
    card(),
    card({ links: [{ href: '/jobs/1#apply', text: 'Backend Developer', className: '' }] }),
    card({ headings: [{ tag: 'h3', text: 'Frontend Developer' }], links: [{ href: '/jobs/2', text: 'Frontend Developer', className: '' }] })
  ], { origin });
  assert.equal(items.length, 2);
  assert.equal(items[1].applyUrl, 'https://jobs.test/jobs/2');
});

test('the aria label is used when no heading exists', () => {
  const [item] = extractSemanticCards([card({ headings: [], ariaLabel: 'Backend Developer at Acme' })], { origin });
  assert.equal(item.title, 'Backend Developer at Acme');
});

test('the card cap is respected', () => {
  const many = Array.from({ length: 20 }, (_, i) => card({
    headings: [{ tag: 'h2', text: `Developer ${i}` }],
    links: [{ href: `/jobs/${i}`, text: `Developer ${i}`, className: '' }]
  }));
  assert.equal(extractSemanticCards(many, { origin, maxCards: 5 }).length, 5);
});

let browser = null;
before(async () => { browser = await launchTestBrowser(); });
after(async () => { if (browser) await browser.close(); });

test('the in-page snapshot reads headings, links, attributes and fields', async (t) => {
  if (!browser) return t.skip('no browser available');
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.setContent(`<!doctype html><html><body><ul>
      <li class="job-card" data-testid="job-card" aria-label="Backend Developer at Acme">
        <h2>Backend Developer</h2>
        <a href="/jobs/1">Backend Developer</a>
        <span class="company-name">Acme</span>
        <span class="job-location">Cape Town</span>
        <time datetime="2026-10-26">2 days ago</time>
      </li>
      <li class="news-item"><h3>Not a job</h3></li>
    </ul></body></html>`);
    const snapshot = await page.evaluate(snapshotCandidatesInPage, { maxCards: 10 });
    assert.equal(snapshot.length, 1);
    assert.equal(snapshot[0].headings[0].text, 'Backend Developer');
    assert.equal(snapshot[0].links[0].href, '/jobs/1');
    assert.equal(snapshot[0].testId, 'job-card');
    assert.ok(snapshot[0].fields.some((field) => field.className.includes('company-name') && field.text === 'Acme'));
    const [item] = extractSemanticCards(snapshot, { origin });
    assert.equal(item.title, 'Backend Developer');
    assert.equal(item.company, 'Acme');
    assert.equal(item.location, 'Cape Town');
  } finally {
    await context.close();
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd sa-job-agent-suite && node --test server/src/hunter/semanticDom.test.js
```

Expected: FAIL, module missing.

- [ ] **Step 3: Implement the snapshot and extraction**

```js
// server/src/hunter/semanticDom.js
// Last free resort before AI: read cards from semantic attributes, headings and
// heading anchors. The snapshot runs in the page; extraction is pure Node so it
// stays unit-testable without a browser.
import { absolutize, dedupeCards } from './structured.js';

const textOf = (value) => (typeof value === 'string' ? value.trim() : '');

// Runs inside the page. Self-contained on purpose.
export function snapshotCandidatesInPage({ maxCards = 100 } = {}) {
  const SELECTOR = 'article, li, [role="listitem"], [data-job-id], [data-jobid], [data-testid*="job" i], [class*="job" i], [class*="vacanc" i], [class*="position" i]';
  const clip = (value, max) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
  const attr = (element, name) => element.getAttribute(name) || '';
  const all = Array.from(document.querySelectorAll(SELECTOR));
  const useful = all.filter((element) => element.querySelector('h1, h2, h3, h4, h5, h6') && element.querySelector('a[href]'));
  const roots = (useful.length ? useful : all)
    .filter((element) => !useful.some((other) => other !== element && element.contains(other)))
    .slice(0, maxCards);
  return roots.map((element) => ({
    tag: element.tagName.toLowerCase(),
    className: clip(attr(element, 'class'), 200),
    testId: clip(attr(element, 'data-testid'), 100),
    ariaLabel: clip(attr(element, 'aria-label'), 300),
    itemprops: Array.from(element.querySelectorAll('[itemprop]')).slice(0, 40).map((node) => ({
      name: attr(node, 'itemprop'),
      text: clip(node.getAttribute('content') || node.getAttribute('href') || node.textContent, 300)
    })),
    headings: Array.from(element.querySelectorAll('h1, h2, h3, h4, h5, h6')).slice(0, 10).map((heading) => ({
      tag: heading.tagName.toLowerCase(),
      text: clip(heading.textContent, 300)
    })),
    links: Array.from(element.querySelectorAll('a[href]')).slice(0, 20).map((link) => ({
      href: attr(link, 'href'),
      text: clip(link.textContent, 200),
      className: clip(attr(link, 'class'), 200)
    })),
    fields: Array.from(element.querySelectorAll('[class], [itemprop], time')).slice(0, 40).map((node) => ({
      className: clip(attr(node, 'class'), 200),
      itemprop: clip(attr(node, 'itemprop'), 100),
      tag: node.tagName.toLowerCase(),
      text: clip(node.getAttribute('datetime') || node.textContent, 300)
    })),
    text: clip(element.innerText || element.textContent, 2000)
  }));
}

const byProp = (card, name) => (card.itemprops || []).find((entry) => entry.name === name)?.text || '';

const byClass = (card, words) => {
  for (const field of card.fields || []) {
    const classes = String(field.className || '').toLowerCase();
    if (!words.some((word) => classes.includes(word))) continue;
    const text = String(field.text || '').trim();
    if (text) return text;
  }
  return '';
};

const headingOf = (card) => (card.headings || []).map((heading) => heading.text).find((text) => text && text.length >= 4) || '';

const ageOf = (card) => {
  const field = byClass(card, ['date', 'posted', 'age']);
  if (field && field.length <= 100) return field;
  const match = /(posted\s+)?(yesterday|today|\d+\s*(hour|day|week|month)s?\s+ago)/i.exec(card.text || '');
  return match ? match[0].slice(0, 100) : '';
};

export function extractSemanticCards(snapshot, { origin = '', linkless = false, maxCards = 100 } = {}) {
  const cards = [];
  for (const card of (Array.isArray(snapshot) ? snapshot : []).slice(0, maxCards)) {
    if (!card || typeof card !== 'object') continue;
    const title = textOf(byProp(card, 'title'))
      || textOf(byProp(card, 'name'))
      || headingOf(card)
      || textOf(card.ariaLabel).split('|')[0].trim();
    if (title.length < 4) continue;
    const links = Array.isArray(card.links) ? card.links : [];
    const chosen = links.find((link) => /url|apply|job|vacanc/i.test(`${link.className} ${link.text}`)) || links[0];
    const applyUrl = absolutize(chosen?.href, origin);
    if (!linkless && !applyUrl) continue;
    cards.push({
      title,
      company: textOf(byProp(card, 'hiringOrganization')) || byClass(card, ['company', 'employer', 'advertiser', 'org']),
      location: textOf(byProp(card, 'jobLocation')) || byClass(card, ['location', 'place', 'area', 'city', 'region']),
      description: textOf(byProp(card, 'description')) || String(card.text || '').slice(0, 5000),
      applyUrl,
      datePosted: ageOf(card)
    });
  }
  return dedupeCards(cards);
}
```

- [ ] **Step 4: Run the tests**

```bash
cd sa-job-agent-suite && node --test server/src/hunter/semanticDom.test.js
```

Expected: PASS, browser test skips when unavailable.

- [ ] **Step 5: Commit**

```bash
git add server/src/hunter/semanticDom.js server/src/hunter/semanticDom.test.js
git commit -m "feat(hunter): add semantic DOM extraction with a pure adapter" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Extraction pipeline and runner integration

**Files:**
- Create: `server/src/hunter/extract.js`
- Create: `server/src/hunter/extract.test.js`
- Modify: `server/src/hunter/runner.js`
- Modify: `server/src/hunter/runner.test.js`

**Interfaces:**
- Produces: `STRATEGY_ORDER`, `chooseStrategy(strategies)`, `mergeRejectReasons(lists)`, `strategySummary(strategies)`, `extractPage({ page, source, query, captured, aiExtract, maxCards })`.
- `extractPage` returns `{ items, strategy, valid, rejected, rejectReasons, strategies }`. Strategies are `structured`, `dom`, `semantic`, then `ai` only when the free strategies return zero valid rows.
- `fetchSourcePage` meta gains `strategy`, `valid`, `rejected`, `rejectReasons`, `strategies`. It accepts `opts.aiExtract`, `opts.maxCards`, `opts.collector`.

- [ ] **Step 1: Write the failing pipeline tests**

```js
// server/src/hunter/extract.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseStrategy, mergeRejectReasons, extractPage } from './extract.js';
import { snapshotCandidatesInPage } from './semanticDom.js';

const origin = 'https://jobs.test';
const posting = (n, over = {}) => ({
  '@type': 'JobPosting',
  title: `Backend Developer ${n}`,
  url: `/jobs/${n}`,
  hiringOrganization: { name: 'Acme' },
  jobLocation: { address: { addressLocality: 'Cape Town' } },
  ...over
});

const fakePage = ({ snapshot = [] } = {}) => ({
  evaluate: async (fn, arg) => (
    fn === snapshotCandidatesInPage || fn?.name === 'snapshotCandidatesInPage' ? snapshot : fn(arg)
  )
});

const source = (over = {}) => ({
  id: 'fake',
  name: 'Fake',
  origin,
  extractInPage: () => [],
  ...over
});

const card = (n) => ({
  title: `Backend Developer ${n}`,
  applyUrl: `${origin}/jobs/${n}`,
  company: 'Acme',
  location: 'Cape Town'
});

test('chooseStrategy takes the most valid rows and breaks ties by order', () => {
  const entry = (n) => ({ raw: n, valid: Array.from({ length: n }, (_, i) => card(i)), rejected: [], rejectReasons: [], error: null });
  assert.equal(chooseStrategy({ structured: entry(2), dom: entry(3) }).name, 'dom');
  assert.equal(chooseStrategy({ structured: entry(3), dom: entry(3) }).name, 'structured');
  assert.equal(chooseStrategy({ structured: entry(0), dom: entry(0), semantic: entry(1) }).name, 'semantic');
  assert.equal(chooseStrategy({ structured: entry(0), dom: entry(0), semantic: entry(0) }), null);
});

test('reject reasons merge by frequency and keep three', () => {
  assert.deepEqual(mergeRejectReasons([['a', 'a'], ['b'], ['c'], ['d']]), ['a', 'b', 'c']);
});

test('structured wins when it has more valid rows than the DOM', async () => {
  const result = await extractPage({
    page: fakePage(),
    source: source({ extractInPage: () => [card(1)] }),
    query: { keyword: 'developer' },
    captured: { payloads: [{ kind: 'jsonld', json: [posting(1), posting(2), posting(3)] }] }
  });
  assert.equal(result.strategy, 'structured');
  assert.equal(result.valid, 3);
  assert.equal(result.items.length, 3);
});

test('invalid rows are rejected before they are returned', async () => {
  const result = await extractPage({
    page: fakePage(),
    source: source({ extractInPage: () => [{ title: 'Dev' }, { title: 'Backend Developer', applyUrl: 'javascript:alert(1)' }, card(9)] }),
    query: { keyword: 'developer' }
  });
  assert.equal(result.strategy, 'dom');
  assert.equal(result.valid, 1);
  assert.equal(result.rejected, 2);
  assert.ok(result.rejectReasons.length >= 1);
});

test('a throwing strategy does not stop the others', async () => {
  const result = await extractPage({
    page: fakePage({ dom: [card(1)] }),
    source: source({ extractInPage: () => { throw new Error('selector exploded'); } }),
    query: { keyword: 'developer' }
  });
  assert.equal(result.strategy, 'dom');
  assert.equal(result.strategies.dom.error, 'selector exploded');
  assert.equal(result.valid, 1);
});

test('AI runs only when every free strategy returns zero valid rows', async () => {
  let calls = 0;
  const aiExtract = async () => { calls += 1; return [card(7)]; };
  const free = await extractPage({
    page: fakePage({ dom: [card(1)] }),
    source: source({ extractInPage: () => [card(1)] }),
    query: { keyword: 'developer' },
    aiExtract
  });
  assert.equal(calls, 0);
  assert.equal(free.strategy, 'dom');
  const recovered = await extractPage({
    page: fakePage(),
    source: source(),
    query: { keyword: 'developer' },
    aiExtract
  });
  assert.equal(calls, 1);
  assert.equal(recovered.strategy, 'ai');
  assert.equal(recovered.valid, 1);
});

test('AI rows pass the same schema gate and a throwing AI is contained', async () => {
  const invalid = await extractPage({
    page: fakePage(),
    source: source(),
    query: { keyword: 'developer' },
    aiExtract: async () => [{ title: 'x' }]
  });
  assert.equal(invalid.strategy, 'none');
  assert.equal(invalid.rejected, 1);
  const thrown = await extractPage({
    page: fakePage(),
    source: source(),
    query: { keyword: 'developer' },
    aiExtract: async () => { throw new Error('budget'); }
  });
  assert.equal(thrown.strategy, 'none');
  assert.equal(thrown.strategies.ai.error, 'budget');
});

test('semantic extraction runs and can win when the DOM breaks', async () => {
  const snapshot = [{
    tag: 'li', className: 'job-card', testId: '', ariaLabel: '',
    itemprops: [], headings: [{ tag: 'h2', text: 'Frontend Developer' }],
    links: [{ href: '/jobs/5', text: 'Frontend Developer', className: '' }],
    fields: [{ className: 'company', itemprop: '', tag: 'span', text: 'Beta' }],
    text: 'Frontend Developer Beta'
  }];
  const result = await extractPage({
    page: fakePage({ dom: [], snapshot }),
    source: source(),
    query: { keyword: 'developer' }
  });
  assert.equal(result.strategy, 'semantic');
  assert.equal(result.items[0].title, 'Frontend Developer');
  assert.equal(result.items[0].applyUrl, 'https://jobs.test/jobs/5');
});

test('the result cap is enforced', async () => {
  const many = Array.from({ length: 10 }, (_, i) => card(i));
  const result = await extractPage({
    page: fakePage({ dom: many }),
    source: source({ extractInPage: () => many }),
    query: { keyword: 'developer' },
    maxCards: 4
  });
  assert.equal(result.items.length, 4);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd sa-job-agent-suite && node --test server/src/hunter/extract.test.js
```

Expected: FAIL, module missing.

- [ ] **Step 3: Implement the pipeline**

```js
// server/src/hunter/extract.js
// Runs every free extraction strategy on one loaded page, validates the rows
// through one schema gate and returns the strategy with the most valid rows.
import { validateJobCards } from '@sajas/core/scrape';
import { mapStructured } from './structured.js';
import { extractSemanticCards, snapshotCandidatesInPage } from './semanticDom.js';

export const STRATEGY_ORDER = Object.freeze(['structured', 'dom', 'semantic']);

const errorText = (err) => err?.message || String(err) || 'strategy failed';
const empty = (error) => ({ raw: 0, valid: [], rejected: [], rejectReasons: [], error });

export function chooseStrategy(strategies = {}) {
  let winner = null;
  for (const name of STRATEGY_ORDER) {
    const entry = strategies[name];
    if (!entry || !Array.isArray(entry.valid) || entry.valid.length === 0) continue;
    if (!winner || entry.valid.length > winner.valid.length) winner = { name, ...entry };
  }
  return winner;
}

export function mergeRejectReasons(lists = []) {
  const counts = new Map();
  for (const list of lists) {
    for (const reason of Array.isArray(list) ? list : []) {
      counts.set(reason, (counts.get(reason) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([reason]) => reason);
}

export function strategySummary(strategies = {}) {
  const out = {};
  for (const [name, entry] of Object.entries(strategies)) {
    out[name] = {
      raw: entry?.raw || 0,
      valid: Array.isArray(entry?.valid) ? entry.valid.length : 0,
      rejected: Array.isArray(entry?.rejected) ? entry.rejected.length : 0,
      error: entry?.error || null
    };
  }
  return out;
}

function record(name, produce, strategies, options) {
  try {
    const raw = produce();
    const list = Array.isArray(raw) ? raw : [];
    const { valid, rejected, rejectReasons } = validateJobCards(
      list.slice(0, options.maxCards),
      { linkless: options.linkless }
    );
    strategies[name] = { raw: list.length, valid, rejected, rejectReasons, error: null };
  } catch (err) {
    strategies[name] = empty(errorText(err));
  }
}

export async function extractPage({ page, source, query = {}, captured = null, aiExtract = null, maxCards = 80 } = {}) {
  const options = { maxCards, linkless: !!source?.linkless };
  const origin = source?.origin || captured?.origin || '';
  const strategies = {};

  record('structured', () => mapStructured(captured?.payloads || [], { source, origin }), strategies, options);

  try {
    const raw = await page.evaluate(source.extractInPage, {
      keyword: query?.keyword,
      location: query?.location ?? null,
      origin
    });
    record('dom', () => raw, strategies, options);
  } catch (err) {
    strategies.dom = empty(errorText(err));
  }

  try {
    const snapshot = await page.evaluate(snapshotCandidatesInPage, { maxCards });
    record('semantic', () => extractSemanticCards(snapshot, {
      origin,
      linkless: options.linkless,
      maxCards
    }), strategies, options);
  } catch (err) {
    strategies.semantic = empty(errorText(err));
  }

  let winner = chooseStrategy(strategies);
  if (!winner && typeof aiExtract === 'function') {
    try {
      const raw = await aiExtract({ page, source, query });
      record('ai', () => raw, strategies, options);
      if (strategies.ai.valid.length) winner = { name: 'ai', ...strategies.ai };
    } catch (err) {
      strategies.ai = empty(errorText(err));
    }
  }

  const rejectReasons = mergeRejectReasons(Object.values(strategies).map((entry) => entry.rejectReasons));
  if (winner) {
    return {
      items: winner.valid.slice(0, maxCards),
      strategy: winner.name,
      valid: winner.valid.length,
      rejected: winner.rejected.length,
      rejectReasons: winner.rejectReasons.length ? winner.rejectReasons : rejectReasons,
      strategies: strategySummary(strategies)
    };
  }
  return {
    items: [],
    strategy: 'none',
    valid: 0,
    rejected: Object.values(strategies).reduce((total, entry) => total + (entry.rejected?.length || 0), 0),
    rejectReasons,
    strategies: strategySummary(strategies)
  };
}
```

- [ ] **Step 4: Run the pipeline tests**

```bash
cd sa-job-agent-suite && node --test server/src/hunter/extract.test.js
```

Expected: PASS.

- [ ] **Step 5: Write the failing runner tests**

Append to `server/src/hunter/runner.test.js`:

```js
test('runner: embedded JSON-LD yields structured items even when the DOM extractor throws', async (t) => {
  if (!browser) return t.skip('no browser available');
  const source = {
    ...fakeSource,
    extractInPage: () => { throw new Error('selectors changed'); },
  };
  await withPage(
    (route) => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: html('Jobs', '<script type="application/ld+json">{"@type":"JobPosting","title":"Senior Developer","url":"https://fixture.test/j/7","hiringOrganization":{"name":"Acme"},"jobLocation":{"address":{"addressLocality":"Cape Town"}}}</script>'),
    }),
    async (page) => {
      const { items, meta } = await fetchSourcePage(page, source, { keyword: 'developer', location: null }, 1);
      assert.equal(meta.strategy, 'structured');
      assert.equal(meta.valid, 1);
      assert.equal(meta.rejected, 0);
      assert.equal(items.length, 1);
      assert.equal(items[0].title, 'Senior Developer');
      assert.match(meta.strategies.dom.error, /selectors changed/);
    },
  );
});

test('runner: invalid DOM rows are counted and never returned', async (t) => {
  if (!browser) return t.skip('no browser available');
  const source = {
    ...fakeSource,
    extractInPage: () => [{ title: 'Dev' }, { title: 'Backend Developer', applyUrl: 'javascript:alert(1)' }, { title: 'Frontend Developer', applyUrl: 'https://fixture.test/j/2' }],
  };
  await withPage(
    (route) => route.fulfill({ status: 200, contentType: 'text/html', body: html('Jobs', '<p>rendered</p>') }),
    async (page) => {
      const { items, meta } = await fetchSourcePage(page, source, { keyword: 'developer', location: null }, 1);
      assert.equal(meta.strategy, 'dom');
      assert.equal(meta.valid, 1);
      assert.equal(meta.rejected, 2);
      assert.equal(items.length, 1);
      assert.equal(meta.rejectReasons.length >= 1, true);
    },
  );
});

test('runner: the injected AI callback runs only after all free strategies are empty', async (t) => {
  if (!browser) return t.skip('no browser available');
  let calls = 0;
  const source = { ...fakeSource, extractInPage: () => [] };
  await withPage(
    (route) => route.fulfill({ status: 200, contentType: 'text/html', body: html('Jobs', '<p>nothing</p>') }),
    async (page) => {
      const { items, meta } = await fetchSourcePage(page, source, { keyword: 'developer', location: null }, 1, {
        aiExtract: async () => {
          calls += 1;
          return [{ title: 'Backend Developer', applyUrl: 'https://fixture.test/ai', company: 'Acme', location: 'Cape Town' }];
        },
      });
      assert.equal(calls, 1);
      assert.equal(meta.strategy, 'ai');
      assert.equal(items.length, 1);
    },
  );
});

test('runner: a blocked page never calls the AI callback', async (t) => {
  if (!browser) return t.skip('no browser available');
  let calls = 0;
  await withPage(
    (route) => route.fulfill({ status: 200, contentType: 'text/html', body: html('Just a moment...', '<p>challenge</p>') }),
    async (page) => {
      const { items, meta } = await fetchSourcePage(page, fakeSource, { keyword: 'developer', location: null }, 1, {
        aiExtract: async () => { calls += 1; return []; },
      });
      assert.deepEqual(items, []);
      assert.equal(meta.blocked, true);
      assert.equal(calls, 0);
    },
  );
});
```

- [ ] **Step 6: Modify the runner**

In `server/src/hunter/runner.js`, add imports at the top:

```js
import { collectPageData, createCollector, installCapture } from './capture.js';
import { extractPage } from './extract.js';
```

Replace the meta initialiser with:

```js
  const meta = {
    url: '', title: '', httpStatus: null, ms: 0, blocked: false, blockKind: null, blockHint: null,
    error: null, strategy: null, valid: 0, rejected: 0, rejectReasons: [], strategies: null
  };
```

Declare teardown before the `try`:

```js
  let detachCapture = () => {};
```

Immediately after the search log, install capture before navigation:

```js
    const collector = opts.collector ?? createCollector({ origin: source.origin });
    detachCapture = installCapture(page, collector);
```

After the idle wait, read the captured page data before block detection:

```js
    const captured = await collectPageData({ page, collector, origin: source.origin });
```

Replace the DOM extraction branch with the pipeline call, keeping the soft block check:

```js
    } else {
      const result = await extractPage({
        page,
        source,
        query,
        captured,
        aiExtract: typeof opts.aiExtract === 'function' ? opts.aiExtract : null,
        maxCards: Number.isFinite(opts.maxCards) && opts.maxCards > 0 ? opts.maxCards : 80
      });
      items = result.items;
      meta.strategy = result.strategy;
      meta.valid = result.valid;
      meta.rejected = result.rejected;
      meta.rejectReasons = result.rejectReasons;
      meta.strategies = result.strategies;
      if (soft) {
        if (items.length >= 1) {
          meta.blockHint = 'text signal ignored: items were found';
        } else {
          markBlocked();
        }
      }
      addLog(`[${name}] Found ${items.length} valid card(s) via ${result.strategy} for "${kw}"${where}${pageTag}`, 'agent1');
    }
```

Add a `finally` to release the response listener:

```js
  } catch (err) {
    meta.error = err?.message || String(err);
    items = [];
    try { addLog(`[${name}] Error: ${meta.error}`, 'error'); } catch { /* logging must not throw */ }
  } finally {
    detachCapture();
  }
```

- [ ] **Step 7: Run the runner tests**

```bash
cd sa-job-agent-suite && node --test server/src/hunter/runner.test.js
```

Expected: PASS. All existing tests still pass, and the new tests pass or skip when no browser exists.

- [ ] **Step 8: Commit**

```bash
git add server/src/hunter/extract.js server/src/hunter/extract.test.js server/src/hunter/runner.js server/src/hunter/runner.test.js
git commit -m "feat(hunter): pick the richest validated extraction strategy per page" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Quality fields in health and strategy labels in the UI

**Files:**
- Modify: `server/src/hunter/health.js`
- Modify: `server/src/hunter/health.test.js`
- Create: `client/src/viaLabels.js`
- Create: `client/src/viaLabels.test.js`
- Modify: `client/src/SourceHealth.jsx`

**Interfaces:**
- `summariseRun` accepts `strategy`, `valid`, `rejected`, `rejectReasons` and stores them. `raw` becomes `valid + rejected`.
- `computeStatus` treats a rejection ratio below 0.8 as broken and below 0.95 as degraded once there are at least four attempts. Old records without `valid`/`rejected` behave exactly as before.
- `viaLabel(value)` maps old and new `via` values to plain labels.

- [ ] **Step 1: Write the failing health tests**

Append to `server/src/hunter/health.test.js`:

```js
test('summariseRun stores strategy and quality counts with raw as attempts', () => {
  const r = summariseRun({
    kind: 'hunt', items: [{ title: 'Backend Developer', applyUrl: 'https://x/1' }],
    strategy: 'structured', valid: 1, rejected: 3, rejectReasons: ['3 rows with no apply link'], at: iso(900)
  });
  assert.equal(r.raw, 4);
  assert.equal(r.valid, 1);
  assert.equal(r.rejected, 3);
  assert.equal(r.strategy, 'structured');
  assert.deepEqual(r.rejectReasons, ['3 rows with no apply link']);
});

test('a high rejection ratio marks the source broken and names the count', () => {
  const entry = entryWith([run({ raw: 10, valid: 5, rejected: 5, rejectReasons: ['5 rows with no apply link'] })]);
  const { status, reason } = computeStatus(entry);
  assert.equal(status, 'broken');
  assert.match(reason, /5 of 10 cards failed validation/);
});

test('a moderate rejection ratio marks the source degraded with the top reason', () => {
  const entry = entryWith([run({ raw: 10, valid: 8, rejected: 2, rejectReasons: ['2 rows with no apply link'] })]);
  const { status, reason } = computeStatus(entry);
  assert.equal(status, 'degraded');
  assert.match(reason, /no apply link/);
});

test('a small sample is judged by completeness, not the ratio', () => {
  const entry = entryWith([run({ raw: 3, valid: 2, rejected: 1, withTitle: 2, withUrl: 2, withCompany: 2, withLocation: 2 })]);
  assert.equal(computeStatus(entry).status, 'healthy');
});

test('all rows rejected is never a success or a healthy status', () => {
  const before = { ...emptyEntry(), lastSuccessAt: null, consecutiveBroken: 0, runs: [] };
  const rejectedRun = run({ raw: 5, valid: 0, rejected: 5, rejectReasons: ['5 rows with no usable title'] });
  const next = applyRun(before, rejectedRun, NOW);
  assert.equal(next.lastSuccessAt, null);
  assert.equal(next.consecutiveBroken, 1);
  assert.equal(computeStatus(next).status, 'broken');
});

test('old run records without quality fields keep the previous behaviour', () => {
  const entry = entryWith(goodRuns(3));
  assert.equal(computeStatus(entry).status, 'healthy');
  assert.equal(baselineRaw(entry.runs).median, 10);
});

test('the baseline counts valid rows, not rejected attempts', () => {
  const runs = [run({ raw: 10, valid: 10, rejected: 0 }), run({ raw: 20, valid: 6, rejected: 14 }), run({ raw: 10, valid: 10, rejected: 0 })];
  assert.equal(baselineRaw(runs).median, 10);
});
```

- [ ] **Step 2: Run the health tests to verify they fail**

```bash
cd sa-job-agent-suite && node --test server/src/hunter/health.test.js
```

Expected: FAIL on the new assertions.

- [ ] **Step 3: Implement the health changes**

In `server/src/hunter/health.js`, change the `summariseRun` signature to add:

```js
  strategy = null, valid, rejected, rejectReasons = []
```

Compute the counts before `return`:

```js
  const validCount = Number.isFinite(valid) && valid >= 0 ? Math.floor(valid) : list.length;
  const rejectedCount = Number.isFinite(rejected) && rejected >= 0 ? Math.floor(rejected) : 0;
```

Change the returned `raw` and add the new fields:

```js
    raw: validCount + rejectedCount,
    valid: validCount,
    rejected: rejectedCount,
    strategy: strategy || null,
    rejectReasons: Array.isArray(rejectReasons) ? rejectReasons.slice(0, 3) : [],
```

Replace `isSuccess` and the baseline counter:

```js
const usable = (r) => {
  const n = Number.isFinite(r?.valid) ? r.valid : r?.raw;
  return Number.isFinite(n) ? n : 0;
};
const isSuccess = (r) => !!r && usable(r) > 0 && !r.error && !r.blocked;
```

In `baselineRaw`, replace `.map((r) => r.raw)` with `.map(usable)` and add `usable(r) > 0` instead of `r.raw > 0` in the filter.

In `computeStatus`, after the error check and before the `raw === 0` branch, insert:

```js
  const raw = Number.isFinite(newest.valid) ? newest.valid : newest.raw;
  const rejected = Number.isFinite(newest.rejected) ? newest.rejected : 0;
  const attempts = raw + rejected;
  if (attempts >= 4 && rejected > 0) {
    const ratio = raw / attempts;
    if (ratio < 0.8) {
      return out('broken', `the page layout changed: ${rejected} of ${attempts} cards failed validation`);
    }
    if (ratio < 0.95) {
      return out('degraded', newest.rejectReasons?.[0] || `${rejected} of ${attempts} cards failed validation`);
    }
  }
```

Remove the old `const raw = newest.raw;` line so the new `raw` is used by the completeness checks below it.

- [ ] **Step 4: Run the health tests**

```bash
cd sa-job-agent-suite && node --test server/src/hunter/health.test.js
```

Expected: PASS, including the existing cases.

- [ ] **Step 5: Write the failing label tests**

```js
// client/src/viaLabels.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { viaLabel } from './viaLabels.js';

test('known extraction strategies get plain labels', () => {
  assert.equal(viaLabel('structured'), 'structured data');
  assert.equal(viaLabel('dom'), 'page layout');
  assert.equal(viaLabel('semantic'), 'semantic layout');
  assert.equal(viaLabel('ai'), 'AI assist');
  assert.equal(viaLabel('mixed'), 'mixed');
  assert.equal(viaLabel('none'), 'none');
});

test('old run values still read well', () => {
  assert.equal(viaLabel('css'), 'page layout');
  assert.equal(viaLabel('jsonld'), 'structured data');
  assert.equal(viaLabel('ai-extract'), 'AI assist');
});

test('unknown and empty values pass through unchanged', () => {
  assert.equal(viaLabel('custom'), 'custom');
  assert.equal(viaLabel(''), '');
  assert.equal(viaLabel(null), '');
});
```

- [ ] **Step 6: Implement the labels and use them**

```js
// client/src/viaLabels.js
const LABELS = Object.freeze({
  structured: 'structured data',
  dom: 'page layout',
  semantic: 'semantic layout',
  ai: 'AI assist',
  mixed: 'mixed',
  none: 'none',
  css: 'page layout',
  jsonld: 'structured data',
  'ai-extract': 'AI assist'
});

export function viaLabel(value) {
  const key = String(value || '').toLowerCase();
  return LABELS[key] || value || '';
}
```

In `client/src/SourceHealth.jsx`, import `viaLabel` and change the chip text:

```jsx
                        via {viaLabel(row.via)}
```

- [ ] **Step 7: Run the client tests**

```bash
cd sa-job-agent-suite && npm test --workspace=client
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/src/hunter/health.js server/src/hunter/health.test.js client/src/viaLabels.js client/src/viaLabels.test.js client/src/SourceHealth.jsx
git commit -m "feat(health): fail a source whose rows stop validating" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Shared browser factory and pacing with bounded retries

**Files:**
- Create: `server/src/hunter/browser.js`
- Create: `server/src/hunter/browser.test.js`
- Create: `server/src/hunter/pacing.js`
- Create: `server/src/hunter/pacing.test.js`
- Modify: `server/src/hunter/runner.js`
- Modify: `server/src/hunter/runner.test.js`
- Modify: `server/src/hunter/canary.js`

**Interfaces:**
- `profileLaunchOptions({ headless, args, viewport })` and `openProfileContext({ headless, args, viewport, launch })`.
- `PACING_DEFAULTS`, `parseRetryAfter(value, now, maxMs)`, `isTransientError(err)`, `retryPlan({ status, error, attempt, retryAfter, blocked, maxRetries })`, `createPacer({ minIntervalMs, jitterMs, now, sleep, random })`.
- `fetchSourcePage` gains `opts.pacer`, `opts.sleep`, `opts.retryCount`.

- [ ] **Step 1: Write the failing browser tests**

```js
// server/src/hunter/browser.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { profileLaunchOptions, openProfileContext, SCRAPE_LAUNCH_OPTS, LOGIN_LAUNCH_OPTS } from './browser.js';

test('headless scrape options keep the South African locale and timezone', () => {
  const options = profileLaunchOptions();
  assert.equal(options.locale, 'en-ZA');
  assert.equal(options.timezoneId, 'Africa/Johannesburg');
  assert.deepEqual(options.viewport, { width: 1366, height: 768 });
  assert.ok(options.args.includes('--disable-blink-features=AutomationControlled'));
  assert.equal(options.headless, true);
});

test('headful login options stay visible and maximised', () => {
  const options = profileLaunchOptions({ headless: false });
  assert.equal(options.headless, false);
  assert.deepEqual(options.args, LOGIN_LAUNCH_OPTS.args);
  assert.equal(options.viewport, null);
});

test('args and viewport can be overridden without losing the base', () => {
  const options = profileLaunchOptions({ args: ['--no-sandbox'], viewport: { width: 800, height: 600 } });
  assert.deepEqual(options.args, ['--no-sandbox']);
  assert.deepEqual(options.viewport, { width: 800, height: 600 });
  assert.equal(options.locale, SCRAPE_LAUNCH_OPTS.locale);
});

test('openProfileContext tries Chrome first, then bundled Chromium, with one option set', async () => {
  const calls = [];
  const launch = async (path, options) => {
    calls.push(options);
    if (options.channel === 'chrome') throw new Error('no chrome');
    return { ok: true };
  };
  const context = await openProfileContext({ launch });
  assert.deepEqual(context, { ok: true });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].channel, 'chrome');
  assert.equal(calls[1].channel, undefined);
  assert.equal(calls[0].locale, calls[1].locale);
});
```

- [ ] **Step 2: Write the failing pacing tests**

```js
// server/src/hunter/pacing.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPacer, parseRetryAfter, retryPlan, isTransientError, PACING_DEFAULTS } from './pacing.js';

test('parseRetryAfter reads seconds, HTTP dates and caps the wait', () => {
  const now = Date.parse('2026-10-28T10:00:00.000Z');
  assert.equal(parseRetryAfter('3', now), 3000);
  assert.equal(parseRetryAfter('0', now), 0);
  assert.equal(parseRetryAfter('999', now), 60000);
  assert.equal(parseRetryAfter('Wed, 28 Oct 2026 10:00:10 GMT', now), 10000);
  assert.equal(parseRetryAfter('Wed, 28 Oct 2026 09:59:00 GMT', now), 0);
  assert.equal(parseRetryAfter('not a date', now), 0);
  assert.equal(parseRetryAfter(null, now), 0);
});

test('only 408, 429, 503 and transient network errors are retryable', () => {
  assert.equal(retryPlan({ status: 429, attempt: 0 }).retry, true);
  assert.equal(retryPlan({ status: 503, attempt: 0 }).retry, true);
  assert.equal(retryPlan({ status: 408, attempt: 0 }).retry, true);
  for (const status of [401, 403, 404, 500]) {
    assert.equal(retryPlan({ status, attempt: 0 }).retry, false, String(status));
  }
  assert.equal(retryPlan({ status: 429, attempt: 2 }).retry, false);
  assert.equal(retryPlan({ error: new Error('net::ERR_CONNECTION_RESET'), attempt: 0 }).retry, true);
  assert.equal(retryPlan({ error: new Error('strict mode violation'), attempt: 0 }).retry, false);
  assert.equal(retryPlan({ status: 429, attempt: 0, blocked: true }).retry, false);
  assert.equal(isTransientError(new Error('socket hang up')), true);
  assert.equal(isTransientError(new Error('Timeout 300ms exceeded')), true);
});

test('retry delays use Retry-After first, then 5s and 15s', () => {
  assert.equal(retryPlan({ status: 429, attempt: 0, retryAfter: '2' }).delayMs, 2000);
  assert.equal(retryPlan({ status: 429, attempt: 0 }).delayMs, 5000);
  assert.equal(retryPlan({ status: 429, attempt: 1 }).delayMs, 15000);
  assert.equal(retryPlan({ status: 429, attempt: 0, maxRetries: 0 }).retry, false);
  assert.equal(PACING_DEFAULTS.minIntervalMs, 2000);
});

test('a pacer waits between pages on the same host only', async () => {
  let now = 0;
  const sleeps = [];
  const pacer = createPacer({
    now: () => now,
    sleep: async (ms) => { sleeps.push(ms); now += ms; },
    random: () => 0.5
  });
  await pacer.wait('jobs.test');
  assert.deepEqual(sleeps, []);
  now += 500;
  await pacer.wait('jobs.test');
  assert.deepEqual(sleeps, [1750]);
  now += 5000;
  await pacer.wait('jobs.test');
  assert.deepEqual(sleeps, [1750]);
  await pacer.wait('other.test');
  assert.deepEqual(sleeps, [1750]);
});
```

- [ ] **Step 3: Run both tests to verify they fail**

```bash
cd sa-job-agent-suite && node --test server/src/hunter/browser.test.js server/src/hunter/pacing.test.js
```

Expected: FAIL, modules missing.

- [ ] **Step 4: Implement the browser factory**

```js
// server/src/hunter/browser.js
// One persistent-profile context factory for the hunter, canary, login browser
// and login status check.
import { chromium } from 'playwright';
import { BROWSER_PROFILE_PATH } from '../db/helper.js';

export const SCRAPE_LAUNCH_OPTS = Object.freeze({
  headless: true,
  args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-setuid-sandbox'],
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  viewport: { width: 1366, height: 768 },
  locale: 'en-ZA',
  timezoneId: 'Africa/Johannesburg'
});

export const LOGIN_LAUNCH_OPTS = Object.freeze({
  headless: false,
  args: ['--start-maximized'],
  viewport: null
});

export function profileLaunchOptions({ headless = true, args, viewport } = {}) {
  const options = headless ? { ...SCRAPE_LAUNCH_OPTS } : { ...LOGIN_LAUNCH_OPTS };
  if (Array.isArray(args)) options.args = [...args];
  if (viewport !== undefined) options.viewport = viewport;
  return options;
}

export async function openProfileContext({ headless = true, args, viewport, launch } = {}) {
  const options = profileLaunchOptions({ headless, args, viewport });
  const start = launch || chromium.launchPersistentContext.bind(chromium);
  try {
    return await start(BROWSER_PROFILE_PATH, { ...options, channel: 'chrome' });
  } catch {
    return await start(BROWSER_PROFILE_PATH, options);
  }
}
```

- [ ] **Step 5: Implement pacing**

```js
// server/src/hunter/pacing.js
// Pure pacing, Retry-After parsing and retry policy. All timing is injectable.
export const PACING_DEFAULTS = Object.freeze({
  minIntervalMs: 2000,
  jitterMs: 500,
  maxRetryAfterMs: 60000,
  retryDelaysMs: Object.freeze([5000, 15000])
});

const defaultSleep = (ms) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

export function parseRetryAfter(value, now = Date.now(), maxMs = PACING_DEFAULTS.maxRetryAfterMs) {
  const text = String(value ?? '').trim();
  if (!text) return 0;
  if (/^\d+$/.test(text)) return Math.min(Number(text) * 1000, maxMs);
  const when = Date.parse(text);
  if (Number.isNaN(when)) return 0;
  return Math.min(Math.max(when - now, 0), maxMs);
}

export function isTransientError(err) {
  const text = `${err?.name || ''} ${err?.message || err || ''}`.toLowerCase();
  return /timeout|econnreset|econnrefused|enotfound|eai_again|socket hang up|net::err_(connection|timed_out|network)/.test(text);
}

export function retryPlan({ status = null, error = null, attempt = 0, retryAfter = null, blocked = false, maxRetries = 2 } = {}) {
  if (blocked) return { retry: false, delayMs: 0 };
  if (attempt >= maxRetries) return { retry: false, delayMs: 0 };
  const transient = status == null ? isTransientError(error) : [408, 429, 503].includes(status);
  if (!transient) return { retry: false, delayMs: 0 };
  const header = parseRetryAfter(retryAfter);
  return { retry: true, delayMs: header || PACING_DEFAULTS.retryDelaysMs[attempt] || PACING_DEFAULTS.retryDelaysMs.at(-1) };
}

export function createPacer({
  minIntervalMs = PACING_DEFAULTS.minIntervalMs,
  jitterMs = PACING_DEFAULTS.jitterMs,
  now = Date.now,
  sleep = defaultSleep,
  random = Math.random
} = {}) {
  const last = new Map();
  return {
    async wait(host) {
      const key = String(host || '');
      const previous = last.get(key);
      if (previous != null) {
        const remaining = minIntervalMs + Math.floor(random() * jitterMs) - (now() - previous);
        if (remaining > 0) await sleep(remaining);
      }
      last.set(key, now());
    }
  };
}
```

- [ ] **Step 6: Wire pacing and retries into the runner**

In `server/src/hunter/runner.js`, add the import:

```js
import { retryPlan } from './pacing.js';
```

At the top of the `try` block, after `timeoutMs` is computed, add:

```js
    const pause = typeof opts.sleep === 'function' ? opts.sleep : (ms) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());
    const retryCount = Number.isFinite(opts.retryCount) ? Math.max(0, opts.retryCount) : 2;
```

Replace the single `page.goto` call with:

```js
    if (opts.pacer && typeof opts.pacer.wait === 'function') {
      await opts.pacer.wait(new URL(meta.url).host);
    }

    let response = null;
    for (let attempt = 0; ; attempt += 1) {
      try {
        response = await page.goto(meta.url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
        const headers = (() => {
          try { return response?.headers?.() || {}; } catch { return {}; }
        })();
        const plan = retryPlan({
          status: response ? response.status() : null,
          attempt,
          retryAfter: headers['retry-after'] ?? headers['Retry-After'] ?? null,
          maxRetries: retryCount
        });
        if (!plan.retry) break;
        addLog(`[${name}] Retrying after HTTP ${response.status()} in ${plan.delayMs}ms${pageTag}`, 'agent1');
        await pause(plan.delayMs);
      } catch (err) {
        const plan = retryPlan({ error: err, attempt, maxRetries: retryCount });
        if (!plan.retry) throw err;
        addLog(`[${name}] Retrying after a network error in ${plan.delayMs}ms${pageTag}`, 'agent1');
        await pause(plan.delayMs);
      }
    }
```

Remove the old `const response = await page.goto(...);` line. Keep `meta.httpStatus = response ? response.status() : null;` after the loop.

- [ ] **Step 7: Update the existing navigation tests and add retry tests**

In `server/src/hunter/runner.test.js`:

Change the abort test call to:

```js
      const { items, meta } = await fetchSourcePage(page, fakeSource, { keyword: 'developer', location: null }, 1, { retryCount: 0 });
```

Change the timeout test call to:

```js
      const { items, meta } = await fetchSourcePage(page, fakeSource, { keyword: 'developer', location: null }, 1, { timeoutMs: 300, retryCount: 0 });
```

The existing persistent 429 and 503 tests would now wait through two real backoff sleeps. Add a no-op sleeper to both calls so they stay fast:

```js
      const { items, meta } = await fetchSourcePage(page, fakeSource, { keyword: 'developer', location: null }, 1, { sleep: async () => {} });
```

Append:

```js
test('runner: a 503 is retried and the recovered page is used', async (t) => {
  if (!browser) return t.skip('no browser available');
  let requests = 0;
  await withPage(
    (route) => {
      requests += 1;
      return requests === 1
        ? route.fulfill({ status: 503, contentType: 'text/html', body: html('Busy', '<p>later</p>') })
        : route.fulfill({ status: 200, contentType: 'text/html', body: html('Jobs', '<ul><li class="job" data-id="1">Dev One</li></ul>') });
    },
    async (page) => {
      const { items, meta } = await fetchSourcePage(page, fakeSource, { keyword: 'developer', location: null }, 1, {
        sleep: async () => {},
      });
      assert.equal(requests, 2);
      assert.equal(meta.httpStatus, 200);
      assert.equal(items.length, 1);
      assert.equal(meta.blocked, false);
    },
  );
});

test('runner: a persistent 429 is retried twice and then reads as blocked', async (t) => {
  if (!browser) return t.skip('no browser available');
  let requests = 0;
  await withPage(
    (route) => {
      requests += 1;
      return route.fulfill({ status: 429, contentType: 'text/html', body: html('Slow down', '<p>Too many requests</p>') });
    },
    async (page) => {
      const { items, meta } = await fetchSourcePage(page, fakeSource, { keyword: 'developer', location: null }, 1, {
        sleep: async () => {},
      });
      assert.equal(requests, 3);
      assert.deepEqual(items, []);
      assert.equal(meta.blocked, true);
      assert.equal(meta.blockKind, 'rate-limit');
    },
  );
});

test('runner: the pacer is asked to wait for the page host before navigation', async (t) => {
  if (!browser) return t.skip('no browser available');
  const hosts = [];
  await withPage(
    (route) => route.fulfill({ status: 200, contentType: 'text/html', body: html('Jobs', '<ul><li class="job" data-id="1">Dev One</li></ul>') }),
    async (page) => {
      await fetchSourcePage(page, fakeSource, { keyword: 'developer', location: null }, 1, {
        pacer: { wait: async (host) => { hosts.push(host); } },
      });
      assert.deepEqual(hosts, ['fixture.test']);
    },
  );
});
```

- [ ] **Step 8: Replace the canary launch block**

In `server/src/hunter/canary.js`:

Remove the `import { chromium } from 'playwright';` and `BROWSER_PROFILE_PATH` import. Remove the `LAUNCH_OPTS` constant. Add:

```js
import { openProfileContext } from './browser.js';
```

Replace the launch block in `runCanarySession` with:

```js
    context = await openProfileContext();
```

- [ ] **Step 9: Run the hunter suites**

```bash
cd sa-job-agent-suite && node --test server/src/hunter/browser.test.js server/src/hunter/pacing.test.js server/src/hunter/runner.test.js server/src/hunter/canary.test.js
```

Expected: PASS. Browser tests skip when no browser exists.

- [ ] **Step 10: Commit**

```bash
git add server/src/hunter/browser.js server/src/hunter/browser.test.js server/src/hunter/pacing.js server/src/hunter/pacing.test.js server/src/hunter/runner.js server/src/hunter/runner.test.js server/src/hunter/canary.js
git commit -m "feat(hunter): share the browser profile and pace each host politely" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Hunter integration

**Files:**
- Modify: `server/src/agents/agent1-hunter.js`
- Modify: `server/src/agents/agent1-hunter.test.js` (only if an existing test asserts the old `via` values)

**Interfaces:**
- The hunter passes `pacer`, `aiExtract` and `maxCards` into `fetchSourcePage`, records the winning strategy and quality counts, and uses `openProfileContext` for its browser, the visible login browser and the login status check.
- `scrapeJsonLd` and `tagOrigin` are removed. JSON-LD now arrives through the structured strategy.

- [ ] **Step 1: Update the failing hunter assertions**

In `server/src/agents/agent1-hunter.test.js`, in the test named `a fixture source is crawled to the page cap and de-duplicated`, add after `assert.equal(stats.status, 'healthy');`:

```js
  const latest = healthStore.getHealthEntry('paged').runs.at(-1);
  assert.equal(latest.strategy, 'dom');
  assert.equal(latest.valid, 4);
  assert.equal(latest.rejected, 0);
```

In the test named `a silent zero after a good baseline triggers the AI extractor ...`, change the `via` assertion and add the strategy check:

```js
  assert.equal(result.perSourceStats['Extractor Board'].via, 'ai');
  assert.equal(healthStore.getHealthEntry(id).runs.at(-1).strategy, 'ai');
```

Run the file to see it fail:

```bash
cd sa-job-agent-suite && node --test server/src/agents/agent1-hunter.test.js
```

Expected: FAIL. The old code stores no `strategy` or `valid`, and it reports `ai-extract`.

- [ ] **Step 2: Replace the browser imports and helpers**

At the top of `server/src/agents/agent1-hunter.js`:

Remove `import { chromium } from 'playwright';`, remove `BROWSER_PROFILE_PATH` from the db helper import, add:

```js
import { openProfileContext } from '../hunter/browser.js';
import { createPacer } from '../hunter/pacing.js';
import { mergeRejectReasons } from '../hunter/extract.js';
```

Delete the `tagOrigin` function and the entire `scrapeJsonLd` function. `MAX_CARDS_PER_PAGE` stays.

- [ ] **Step 3: Use the factory in all three launch sites**

Replace the hunter launch block with:

```js
      addLog('Launching browser context...', 'agent1');
      context = await openProfileContext();
      addLog('Using the persistent browser profile.', 'agent1');
```

In `setupBrowserSession`, replace the launch block with:

```js
    context = await openProfileContext({ headless: false, viewport: null });
```

In `checkLoginStatuses`, replace both launch calls with:

```js
    context = await openProfileContext({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
```

- [ ] **Step 4: Create one pacer and pass the pipeline hooks**

Before `for (const source of sources) {` add:

```js
    const pacer = createPacer();
```

Inside the source loop, replace the `origins` counter with:

```js
      const strategiesSeen = new Set();
      const rejectReasonLists = [];
      let rejectedTotal = 0;
      let duplicateValid = 0;
```

Replace the `fetchPage` callback body with:

```js
            fetchPage: async (pageNo) => {
              const allowAiHere = extractOnFirstPage && pageNo === 1 && allowExtract && extractLeft > 0;
              const aiExtract = allowAiHere
                ? async () => {
                  extractLeft -= 1;
                  const extracted = await extractJobsFromPage(profile, page, source, query);
                  if (extracted.items.length) {
                    addLog(`[${source.name}] AI extractor recovered ${extracted.items.length} card(s)`, 'agent1');
                  }
                  return extracted.items;
                }
                : null;
              const { items, meta } = await fetchSourcePage(page, source, query, pageNo, {
                pacer,
                aiExtract,
                maxCards: MAX_CARDS_PER_PAGE
              });
              if (meta.strategy && meta.strategy !== 'none') strategiesSeen.add(meta.strategy);
              if (meta.rejected > 0) {
                rejectedTotal += meta.rejected;
                rejectReasonLists.push(meta.rejectReasons);
                addLog(`[${source.name}] ${meta.rejected} card(s) rejected before saving${meta.rejectReasons[0] ? `: ${meta.rejectReasons[0]}` : ''}`, 'agent1');
              }
              return { items, meta };
            },
```

- [ ] **Step 5: Count duplicate valid rows and compute `via`**

In the health item loop, change the duplicate branch to count instead of dropping silently:

```js
          for (const item of crawl.items) {
            const key = defaultKeyOf(item);
            if (healthSeen.has(key)) { duplicateValid += 1; continue; }
            healthSeen.add(key);
            healthItems.push(item);
          }
          totalFound += crawl.items.length;
```

Remove the `__origin` counter block.

Replace the `via` computation with:

```js
      const strategies = [...strategiesSeen].filter((name) => name && name !== 'none');
      const via = strategies.length === 0 ? 'none' : strategies.length === 1 ? strategies[0] : 'mixed';
```

Remove the now unused `extractSupplied` variable and its assignment.

- [ ] **Step 6: Add the quality fields to the run record**

Replace the `summariseRun` call with:

```js
      const rejectReasons = mergeRejectReasons(rejectReasonLists);
      const run = summariseRun({
        kind: 'hunt',
        items: healthItems,
        pages: pagesTotal,
        httpStatus: lastHttpStatus,
        blocked,
        blockKind,
        error: runError,
        ms: Date.now() - startedAt,
        via,
        strategy: strategies.length === 1 ? strategies[0] : (strategies.length ? 'mixed' : 'none'),
        valid: healthItems.length + duplicateValid,
        rejected: rejectedTotal,
        rejectReasons,
        stopReason,
        expectsUrl: !source.linkless
      });
```

- [ ] **Step 7: Run the hunter tests and the full server suite**

```bash
cd sa-job-agent-suite && node --test server/src/agents/agent1-hunter.test.js && npm test --workspace=server
```

Expected: PASS, or browser-dependent tests skip locally. If an older test asserts `via === 'dom'` and the fake source now reports `dom`, it still passes. Update only assertions that named the removed `jsonld` or `ai-extract` values to the new strategy names.

- [ ] **Step 8: Commit**

```bash
git add server/src/agents/agent1-hunter.js server/src/agents/agent1-hunter.test.js
git commit -m "feat(hunter): run every source through the resilient extraction pipeline" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Debug CLI and guide

**Files:**
- Create: `server/src/hunter/debugReport.js`
- Create: `server/src/hunter/debugReport.test.js`
- Create: `scripts/hunter-debug.mjs`
- Create: `docs/SCRAPER-DEBUGGING.md`
- Modify: `sa-job-agent-suite/.gitignore`

**Interfaces:**
- `parseDebugArgs(argv)`, `formatDebugReport(report)`, `DEBUG_USAGE` from `server/src/hunter/debugReport.js`.
- `scripts/hunter-debug.mjs` is manual only and runs one page through capture, the free strategies and the schema gate. It never calls AI and needs no key.

- [ ] **Step 1: Write the failing report tests**

```js
// server/src/hunter/debugReport.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDebugArgs, formatDebugReport, DEBUG_USAGE } from './debugReport.js';

test('debug arguments parse with sane defaults', () => {
  assert.deepEqual(parseDebugArgs(['--source', 'pnet', '--keyword', 'developer']), {
    source: 'pnet', keyword: 'developer', location: null, headful: false, save: false, html: null, capture: null, help: false, error: null
  });
  const full = parseDebugArgs(['--source', 'indeed', '--keyword', 'rust', '--location', 'Cape Town', '--headful', '--save', '--html', 'page.html', '--capture', 'capture.json']);
  assert.equal(full.location, 'Cape Town');
  assert.equal(full.headful, true);
  assert.equal(full.save, true);
  assert.equal(full.html, 'page.html');
  assert.equal(full.capture, 'capture.json');
});

test('missing or unknown arguments report a clear error', () => {
  assert.match(parseDebugArgs([]).error, /Missing --source/);
  assert.match(parseDebugArgs(['--source', 'pnet', '--bogus']).error, /Unknown argument/);
  assert.match(parseDebugArgs(['--source', 'pnet', '--capture', 'c.json']).error, /needs --html/);
  assert.equal(parseDebugArgs(['--help']).error, null);
  assert.match(DEBUG_USAGE, /--source pnet/);
});

test('the report names the strategy counts, winner and first row', () => {
  const text = formatDebugReport({
    source: { id: 'pnet', name: 'PNet' },
    url: 'https://www.pnet.co.za/jobs?k=developer',
    title: 'Developer jobs',
    httpStatus: 200,
    blocked: false,
    blockKind: null,
    error: null,
    strategy: 'semantic',
    strategies: {
      structured: { raw: 0, valid: 0, rejected: 0, error: null },
      dom: { raw: 4, valid: 1, rejected: 3, error: null },
      semantic: { raw: 5, valid: 5, rejected: 0, error: null }
    },
    rejectReasons: ['3 rows with no apply link'],
    firstItem: { title: 'Backend Developer', company: 'Acme', location: 'Cape Town', applyUrl: 'https://x.test/1' }
  });
  assert.match(text, /PNet/);
  assert.match(text, /dom: raw 4, valid 1, rejected 3/);
  assert.match(text, /semantic: raw 5, valid 5, rejected 0/);
  assert.match(text, /Winner: semantic/);
  assert.match(text, /no apply link/);
  assert.match(text, /First valid row: Backend Developer/);
});

test('a blocked report is never mistaken for a working source', () => {
  const text = formatDebugReport({
    source: { name: 'PNet' }, url: 'https://x.test', title: 'Just a moment...',
    httpStatus: 403, blocked: true, blockKind: 'challenge', strategy: 'none'
  });
  assert.match(text, /Blocked: yes \(challenge\)/);
  assert.match(text, /Winner: none/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd sa-job-agent-suite && node --test server/src/hunter/debugReport.test.js
```

Expected: FAIL, module missing.

- [ ] **Step 3: Implement the report helpers**

```js
// server/src/hunter/debugReport.js
// Pure helpers for scripts/hunter-debug.mjs so the CLI's decisions are testable
// without a browser or a network.
export const DEBUG_USAGE = 'node scripts/hunter-debug.mjs --source pnet --keyword developer [--location Johannesburg] [--headful] [--save] [--html path] [--capture path]';

export function parseDebugArgs(argv = []) {
  const out = {
    source: '', keyword: 'developer', location: null, headful: false,
    save: false, html: null, capture: null, help: false, error: null
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => { i += 1; return argv[i] ?? ''; };
    if (arg === '--source') out.source = next();
    else if (arg === '--keyword') out.keyword = next() || 'developer';
    else if (arg === '--location') out.location = next() || null;
    else if (arg === '--headful') out.headful = true;
    else if (arg === '--save') out.save = true;
    else if (arg === '--html') out.html = next();
    else if (arg === '--capture') out.capture = next();
    else if (arg === '--help' || arg === '-h') out.help = true;
    else out.error = `Unknown argument: ${arg}`;
  }
  if (!out.help && !out.source) out.error = out.error || 'Missing --source.';
  if (!out.help && out.capture && !out.html) out.error = out.error || '--capture needs --html.';
  return out;
}

export function formatDebugReport({
  source, url, title, httpStatus, blocked, blockKind, error,
  strategy, strategies = {}, rejectReasons = [], firstItem = null, malformed = 0, skipped = 0
} = {}) {
  const lines = [];
  lines.push(`Source: ${source?.name || source?.id || 'unknown'}`);
  lines.push(`URL: ${url || '(none)'}`);
  lines.push(`HTTP: ${httpStatus ?? '(none)'}  Title: ${title || '(none)'}`);
  lines.push(`Blocked: ${blocked ? `yes (${blockKind || 'unknown'})` : 'no'}`);
  if (error) lines.push(`Error: ${error}`);
  for (const [name, entry] of Object.entries(strategies)) {
    lines.push(`  ${name}: raw ${entry?.raw || 0}, valid ${entry?.valid || 0}, rejected ${entry?.rejected || 0}${entry?.error ? ` (error: ${entry.error})` : ''}`);
  }
  lines.push(`Winner: ${strategy || 'none'}`);
  if (rejectReasons.length) lines.push(`Rejections: ${rejectReasons.join('; ')}`);
  if (malformed || skipped) lines.push(`Capture: ${malformed} malformed payload(s), ${skipped} skipped response(s)`);
  if (firstItem) {
    lines.push(`First valid row: ${firstItem.title} | ${firstItem.company || '-'} | ${firstItem.location || '-'} | ${firstItem.applyUrl || '-'}`);
  }
  return lines.join('\n');
}
```

- [ ] **Step 4: Run the report tests**

```bash
cd sa-job-agent-suite && node --test server/src/hunter/debugReport.test.js
```

Expected: PASS.

- [ ] **Step 5: Write the CLI**

```js
// scripts/hunter-debug.mjs
// Manual single-source replay. No AI, no key, not part of npm test or CI.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { openProfileContext } from '../server/src/hunter/browser.js';
import { getSource } from '../server/src/hunter/registry.js';
import { createCollector, installCapture, collectPageData } from '../server/src/hunter/capture.js';
import { detectBlock } from '../server/src/hunter/blockDetect.js';
import { extractPage } from '../server/src/hunter/extract.js';
import { parseDebugArgs, formatDebugReport, DEBUG_USAGE } from '../server/src/hunter/debugReport.js';

const MAX_CARDS = 80;

async function pageText(page) {
  try {
    return await page.evaluate(() => (document.body ? document.body.innerText : '').slice(0, 2000));
  } catch {
    return '';
  }
}

async function runLive(args, source) {
  const query = { keyword: args.keyword, location: args.location };
  const context = await openProfileContext({ headless: !args.headful });
  const page = await context.newPage();
  const collector = createCollector({ origin: source.origin });
  const detach = installCapture(page, collector);
  try {
    const url = source.buildUrl(query, 1);
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (source.waitIdleMs > 0) {
      await page.waitForLoadState('networkidle', { timeout: source.waitIdleMs }).catch(() => {});
    }
    const captured = await collectPageData({ page, collector, origin: source.origin });
    detach();
    const title = await page.title();
    const block = detectBlock({ status: response?.status(), title, text: await pageText(page), url: page.url() }) || {};
    const html = args.save ? await page.content() : '';
    let result = { items: [], strategy: 'none', valid: 0, rejected: 0, rejectReasons: [], strategies: {} };
    if (!block.blocked) {
      result = await extractPage({ page, source, query, captured, maxCards: MAX_CARDS });
    }
    return {
      url: page.url(),
      title,
      httpStatus: response?.status() ?? null,
      blocked: !!block.blocked,
      blockKind: block.kind || null,
      error: null,
      captured,
      html,
      result,
      malformed: captured.malformed,
      skipped: captured.skipped
    };
  } finally {
    detach();
    await context.close().catch(() => {});
  }
}

async function runReplay(args, source) {
  const html = await fs.readFile(args.html, 'utf8');
  const captured = args.capture
    ? JSON.parse(await fs.readFile(args.capture, 'utf8'))
    : { origin: source.origin, payloads: [], malformed: 0, skipped: 0 };
  const browser = await chromium.launch({ headless: true, channel: 'chrome' }).catch(() => chromium.launch({ headless: true }));
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    const block = detectBlock({ status: 200, title: await page.title(), text: await pageText(page), url: source.origin }) || {};
    const result = block.blocked
      ? { items: [], strategy: 'none', valid: 0, rejected: 0, rejectReasons: [], strategies: {} }
      : await extractPage({ page, source, query: { keyword: args.keyword, location: args.location }, captured, maxCards: MAX_CARDS });
    return {
      url: args.html,
      title: await page.title(),
      httpStatus: 200,
      blocked: !!block.blocked,
      blockKind: block.kind || null,
      error: null,
      captured,
      html,
      result,
      malformed: captured.malformed || 0,
      skipped: captured.skipped || 0
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function save(run) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join('hunter-debug', `${run.sourceId}-${stamp}`);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'page.html'), run.html || '', 'utf8');
  await fs.writeFile(path.join(dir, 'capture.json'), JSON.stringify(run.captured, null, 2), 'utf8');
  await fs.writeFile(path.join(dir, 'report.json'), JSON.stringify({
    url: run.url, title: run.title, httpStatus: run.httpStatus, blocked: run.blocked,
    blockKind: run.blockKind, strategy: run.result.strategy, strategies: run.result.strategies,
    valid: run.result.valid, rejected: run.result.rejected, rejectReasons: run.result.rejectReasons,
    malformed: run.malformed, skipped: run.skipped
  }, null, 2), 'utf8');
  return dir;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseDebugArgs(argv);
  if (args.help) { console.log(DEBUG_USAGE); return 0; }
  if (args.error) { console.error(args.error); console.error(DEBUG_USAGE); return 1; }
  const source = getSource(args.source);
  if (!source) { console.error(`Unknown source: ${args.source}`); return 1; }
  try {
    const run = args.html ? await runReplay(args, source) : await runLive(args, source);
    const firstItem = run.result.items[0] || null;
    console.log(formatDebugReport({
      source,
      url: run.url,
      title: run.title,
      httpStatus: run.httpStatus,
      blocked: run.blocked,
      blockKind: run.blockKind,
      error: run.error,
      strategy: run.result.strategy,
      strategies: run.result.strategies,
      rejectReasons: run.result.rejectReasons,
      firstItem,
      malformed: run.malformed,
      skipped: run.skipped
    }));
    if (args.save) console.log(`Saved: ${await save({ ...run, sourceId: source.id })}`);
    return 0;
  } catch (err) {
    console.error(`Debug run failed: ${err?.message || err}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => { process.exitCode = code; });
}
```

- [ ] **Step 6: Ignore saved snapshots**

Append to `sa-job-agent-suite/.gitignore`:

```gitignore
# manual debug snapshots (real page HTML and captured JSON)
hunter-debug/
```

- [ ] **Step 7: Write the debugging guide**

Create `docs/SCRAPER-DEBUGGING.md` with these sections, in plain language and without em dashes:

```markdown
# Scraper Debugging Guide

**Status:** Arc 7, 2026-10-28

## What the hunter reads

Each page is read through four strategies, in this order:

1. `structured`: the source adapter, then JSON-LD, then job arrays found in embedded state or same-origin JSON responses.
2. `dom`: the source's own CSS extractor.
3. `semantic`: headings, semantic attributes and heading anchors.
4. `ai`: only when the three free strategies return zero valid rows, only with a key and budget.

Every row passes the same schema gate. The strategy with the most valid rows wins. Ties prefer structured, then dom, then semantic. A rejected row is never saved.

## Triage from a canary failure

1. Open Source Health and read the status and reason. "the page layout changed" means rows were found but validation failed. "returned nothing" means no rows were found at all.
2. Run the debug CLI for that source with the canary keyword.
3. Read the per-strategy counts. If `structured` or `semantic` wins, the source is already recovered and the DOM selectors need a later cleanup. If every strategy is zero, go to the snapshot.
4. Save the snapshot and open `report.json`. The rejection reasons name what failed.
5. Fix the source selector or add a source adapter, then rerun the CLI and the source contract tests.

## The CLI

```bash
node scripts/hunter-debug.mjs --source pnet --keyword developer
node scripts/hunter-debug.mjs --source indeed --keyword developer --location "Cape Town" --save
node scripts/hunter-debug.mjs --source pnet --html hunter-debug/pnet-.../page.html --capture hunter-debug/pnet-.../capture.json
```

It needs no key and never calls AI. `--save` writes `page.html`, `capture.json` and `report.json` under `hunter-debug/`, which is gitignored. `--html` replays a saved page offline.

## Adding a source adapter

Add an optional `mapStructured({ payloads, origin })` function to the source in `server/src/hunter/registry.js`. Return an array of raw cards, or an empty array to fall through to JSON-LD and generic arrays. Never fetch inside the adapter: it receives what the page already loaded.

## The anti-bot baseline

The hunter uses real Chrome with the persistent profile, a South African locale and timezone, per-host pacing with jitter, `Retry-After` honored up to 60 seconds, and at most two retries for 408, 429, 503 or a transient network error. It never solves a CAPTCHA, rotates a proxy, spoofs fingerprints beyond the existing automation flag, or retries a login wall or a 403. When a site challenges the browser, the source cools down for six hours and the user should use the site's own search. When a site needs a login, the login browser is the fix.
```

- [ ] **Step 8: Run the report tests and the secret scanner**

```bash
cd sa-job-agent-suite && node --test server/src/hunter/debugReport.test.js
cd .. && node tools/check-secrets.mjs
```

Expected: PASS and no secrets found.

- [ ] **Step 9: Commit**

```bash
git add server/src/hunter/debugReport.js server/src/hunter/debugReport.test.js scripts/hunter-debug.mjs docs/SCRAPER-DEBUGGING.md sa-job-agent-suite/.gitignore
git commit -m "feat(hunter): add a manual debug replay and triage guide" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Docs, gates, PR, merge and manual live check

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-10-28-scraper-resilience-design.md`
- Modify: `docs/superpowers/specs/2026-10-27-post-m3a3-pipeline.md`
- Update memory files after the merge.

**Interfaces:** none.

- [ ] **Step 1: Add the anti-bot baseline to the README**

Add a short section after the existing hunter description:

```markdown
### Scraper resilience and the anti-bot baseline

The hunter reads each page through structured data (JSON-LD and the page's own JSON responses), the source's DOM extractor, and a semantic fallback. Every row is validated before it is saved, and a source whose rows stop validating is marked broken instead of quietly returning nothing.

The tool uses real Chrome with the persistent profile, a South African locale and timezone, polite per-host pacing and bounded retries. It does not solve CAPTCHAs, rotate proxies or spoof fingerprints. When a site challenges the browser or needs a login, use the site's own interface or the login browser. The full triage guide is in `docs/SCRAPER-DEBUGGING.md`.
```

- [ ] **Step 2: Run every gate**

From `sa-job-agent-suite/`:

```bash
npm test
npm run test:web
npm run test:desktop
```

From the worktree root:

```bash
node tools/check-secrets.mjs
```

Expected: all pass. If `test:web` needs a build, run `npm run build:web` first. Do not run `smoke:live` or any live eval.

- [ ] **Step 3: Commit the docs and open the PR**

```bash
git add README.md
git commit -m "docs: document scraper resilience and the anti-bot baseline" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git push -u origin arc-7-scraper-resilience
gh pr create --title "feat: scraper resilience (Arc 7)" --body "$(cat <<'EOF'
## Summary

- One schema gate for every extraction strategy, so an invalid row is never saved.
- Capture of same-origin JSON, embedded state and JSON-LD, plus structured and semantic fallbacks.
- The strategy with the most valid rows wins, with the existing DOM extractor unchanged.
- Health marks a source broken or degraded when its rows stop validating.
- Shared browser factory, per-host pacing and bounded retries for 408, 429, 503 and transient network errors.
- Manual debug CLI and triage guide.

## Anti-bot scope

Honest baseline only: real Chrome persistent profile, SA locale and timezone, pacing, Retry-After, bounded retries, and a clear handoff for challenges and login walls. No CAPTCHA solving, no proxies, no fingerprint spoofing.

## Test plan

- [ ] `npm test`
- [ ] `npm run test:web`
- [ ] `npm run test:desktop`
- [ ] `node tools/check-secrets.mjs`
- [ ] Manual debug run against two sources, strategy and valid count recorded below

## Manual live check

Recorded after merge, one page per source.
EOF
)"
```

- [ ] **Step 4: Merge when green**

Wait for CI, then merge the green PR. Do not merge a red PR.

- [ ] **Step 5: Manual live check against two sources**

From `sa-job-agent-suite/` on merged `main`:

```bash
node scripts/hunter-debug.mjs --source pnet --keyword developer --save
node scripts/hunter-debug.mjs --source careerjunction --keyword developer --save
```

Record each source's winning strategy, valid count, rejection summary and whether the page was blocked. If a source is blocked or returns nothing, say so plainly in the PR body. Do not change code during the check.

- [ ] **Step 6: Update the PR body and the spec status**

Append the manual results to the PR body with `gh pr edit`. Then set the spec status line to:

```markdown
**Status:** shipped 2026-10-28 (PR #<number>)
```

In `docs/superpowers/specs/2026-10-27-post-m3a3-pipeline.md`, mark Arc 7 as shipped with the PR number.

- [ ] **Step 7: Commit the status update and merge it**

```bash
git add docs/superpowers/specs/2026-10-28-scraper-resilience-design.md docs/superpowers/specs/2026-10-27-post-m3a3-pipeline.md
git commit -m "docs: mark Arc 7 shipped" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git push
```

Open and merge a small docs PR, following the Arc 6 pattern.

- [ ] **Step 8: Update memory**

Update the project memory index and add or update an Arc 7 memory file with: what shipped, the strategy order, the honest anti-bot scope, and the live-check result. Keep the hosted alpha memory unchanged because this arc changes no web hosting.

---

## Self-Review

**Spec coverage:**
- Structured, DOM, semantic and AI strategies: Tasks 3, 4, 5.
- One schema gate: Tasks 1, 5.
- Capture limits: Task 2.
- Strategy winner and tie-break: Task 5.
- Health quality fields and strategy labels: Task 6.
- Browser factory and pacing: Task 7.
- Hunter integration and removal of the old JSON-LD path: Task 8.
- Debug CLI, snapshots and guide: Task 9.
- Anti-bot documentation, gates, PR, merge and live check: Task 10.
- No new runtime dependencies: all code uses Node built-ins and existing Playwright.
- No login or cookie sessions, no web app changes: out of scope and untouched.

**Type consistency:**
- `validateJobCards` is the only validator name used from Task 1 onward.
- `mapStructured(payloads, { source, origin })` and `extractSemanticCards(snapshot, options)` match their call sites in `extract.js`.
- `extractPage` result fields (`items`, `strategy`, `valid`, `rejected`, `rejectReasons`, `strategies`) match the runner meta and the hunter health aggregation.
- `retryPlan` is called with `maxRetries` and `parseRetryAfter` is called inside it with the default clock.
- `openProfileContext` options match every call site, including the canary, the login browser and the login status check.

**Placeholders:** none. Every step names exact files, code, commands and expected results.
