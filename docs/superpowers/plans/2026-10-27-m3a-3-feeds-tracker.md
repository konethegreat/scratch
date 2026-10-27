# M3a-3: Free Job Feeds, Dedupe, and Tracker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship three keyless job feeds with dedupe and filtering, add-to-tracker, application statuses and notes, and a web backup tab in the hosted app.

**Architecture:** Pure normalizers and matching live in `packages/core/src/feeds/`. A browser-only feed client (`client/src/web/feeds.js`) owns fetch, timeout, retry, and a 15-minute in-memory cache. The Job Feeds tab renders per-source results and writes selected jobs through the existing `/jobs` web port into IndexedDB. Tracker edits use the existing `PATCH /jobs/:id` route with a stricter allowlist.

**Tech Stack:** Node 22 (`node:test`), React 18 + Vite, IndexedDB, Playwright for the offline canary.

**Spec:** `docs/superpowers/specs/2026-10-27-m3a-3-feeds-tracker-design.md`

## Global Constraints

- Run every command from `sa-job-agent-suite/`.
- No live network in any test. No Anthropic key exists; never set `ANTHROPIC_API_KEY`; never run `npm run smoke:live` or `node evals/run.mjs --live`.
- No live scraping. Feed tests use committed fixtures and an injected fetch.
- Never bypass the pre-commit hook. `--no-verify` is forbidden.
- Key-shaped strings are assembled at runtime, never committed.
- No provider names outside `server/src/db/migrations.js`.
- No model-ID literals outside `packages/core/src/models.js` and `*.test.js`.
- `X-SAJAS-Client: 1` on non-GET requests to the desktop server only; web mode does not use it.
- Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- No em dashes in new user-facing copy. Use commas, colons, or full stops.
- Do not touch `docs/superpowers/HANDOFF-2026-10-26.md` or `.superpowers/` except SDD artifacts.
- Feed data is never sent to the origin. Filters run in the browser.
- All new feed text is rendered as text. URLs are validated to `http(s)` before becoming links.

---

### Task 1: Core feed shape and matcher

**Files:**
- Create: `packages/core/src/feeds/shape.js`
- Create: `packages/core/src/feeds/match.js`
- Test: `packages/core/src/feeds/shape.test.js`
- Test: `packages/core/src/feeds/match.test.js`

**Interfaces:**
- Produces: `makeRawJob(source, row)`, `FeedShapeError`, `clip`, `plainText`, `httpUrl`, `dateOnly`, `looksRemote`, `MAXES`.
- Produces: `normalizeText(value)`, `fingerprint(title, company)`, `splitList(value)`, `dedupeJobs(jobs)`, `filterJobs(jobs, { keywords, locations, onlyMatches })`, `scoreJob(job, keywords)`, `trackerFingerprints(jobs)`.

- [ ] **Step 1: Write the failing shape tests**

```js
// packages/core/src/feeds/shape.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRawJob, plainText, httpUrl, dateOnly, looksRemote, FeedShapeError } from './shape.js';

test('makeRawJob drops rows without a title or company', () => {
  assert.equal(makeRawJob('remotive', { title: '', company: 'Acme' }), null);
  assert.equal(makeRawJob('remotive', { title: 'Dev', company: '  ' }), null);
  assert.equal(makeRawJob('remotive', { title: 'Dev', company: 'Acme' }).title, 'Dev');
});

test('plainText strips tags, decodes entities and collapses space', () => {
  assert.equal(
    plainText('<p>Build&nbsp;with <strong>React</strong> &amp; Node</p>'),
    'Build with React & Node'
  );
});

test('httpUrl keeps only absolute http(s) URLs', () => {
  assert.equal(httpUrl('https://example.com/job'), 'https://example.com/job');
  assert.equal(httpUrl(' JavaScript:alert(1)'), '');
  assert.equal(httpUrl('not a url'), '');
  assert.equal(httpUrl(''), '');
});

test('dateOnly accepts ISO dates and unix seconds', () => {
  assert.equal(dateOnly('2026-10-20T09:12:00'), '2026-10-20');
  assert.equal(dateOnly(1761000000), '2026-10-21');
  assert.equal(dateOnly('not a date'), '');
  assert.equal(dateOnly(null), '');
});

test('looksRemote reads location and title text', () => {
  assert.equal(looksRemote('Remote (Worldwide)'), true);
  assert.equal(looksRemote('Cape Town'), false);
});

test('FeedShapeError carries the source name', () => {
  const err = new FeedShapeError('Remotive', 'expected jobs[]');
  assert.equal(err.source, 'Remotive');
  assert.match(err.message, /Remotive/);
});
```

- [ ] **Step 2: Run the shape tests and watch them fail**

Run: `node --test packages/core/src/feeds/shape.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `shape.js`**

```js
// Bounds for untrusted feed text. Everything that reaches the vault or the DOM
// passes through one of these helpers first.
export const MAXES = Object.freeze({
  title: 300,
  company: 200,
  location: 200,
  description: 20000,
  url: 2000,
  tags: 10,
  tag: 40,
  salary: 120
});

export class FeedShapeError extends Error {
  constructor(source, detail) {
    super(`${source} sent data this app does not understand.`);
    this.name = 'FeedShapeError';
    this.source = source;
    this.detail = detail;
  }
}

export function clip(value, max) {
  return String(value == null ? '' : value).slice(0, max);
}

const ENTITIES = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'"
};

export function plainText(value, max = MAXES.description) {
  return String(value == null ? '' : value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(nbsp|amp|lt|gt|quot|#39|apos);/g, (match) => ENTITIES[match] || ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function httpUrl(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.href.slice(0, MAXES.url);
  } catch {
    return '';
  }
}

export function dateOnly(value) {
  if (value == null || value === '') return '';
  const raw = String(value).trim();
  const direct = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (direct) return direct[1];
  const numeric = typeof value === 'number' ? value : /^\d+$/.test(raw) ? Number(raw) : NaN;
  const date = Number.isFinite(numeric)
    ? new Date((numeric > 1e12 ? numeric : numeric * 1000))
    : new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getUTCFullYear();
  if (year < 1990 || year > 2100) return '';
  return date.toISOString().slice(0, 10);
}

const REMOTE = /remote|worldwide|anywhere|work from home|distributed/i;

export function looksRemote(...values) {
  return values.some((value) => REMOTE.test(String(value || '')));
}

export function makeRawJob(source, row) {
  const title = plainText(row.title, MAXES.title);
  const company = plainText(row.company, MAXES.company);
  if (!title || !company) return null;
  const tags = Array.isArray(row.tags)
    ? [...new Set(row.tags.map((tag) => clip(tag, MAXES.tag).trim()).filter(Boolean))].slice(0, MAXES.tags)
    : [];
  return {
    source,
    sourceId: clip(row.sourceId, 200),
    title,
    company,
    location: plainText(row.location, MAXES.location),
    description: plainText(row.description, MAXES.description),
    applyUrl: httpUrl(row.applyUrl),
    datePosted: dateOnly(row.datePosted),
    remote: Boolean(row.remote),
    tags,
    salaryText: clip(row.salaryText, MAXES.salary)
  };
}
```

- [ ] **Step 4: Run the shape tests again**

Run: `node --test packages/core/src/feeds/shape.test.js`
Expected: PASS.

- [ ] **Step 5: Write the failing matcher tests**

```js
// packages/core/src/feeds/match.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeText, fingerprint, splitList, dedupeJobs, filterJobs, scoreJob, trackerFingerprints
} from './match.js';

const job = (over = {}) => ({
  source: 'remotive', sourceId: '1', title: 'Senior React Engineer', company: 'Acme Labs',
  location: 'Cape Town', description: 'React and Node.js', applyUrl: 'https://x.test/1',
  datePosted: '2026-10-20', remote: false, tags: [], salaryText: '', ...over
});

test('normalizeText lowercases, strips punctuation and diacritics', () => {
  assert.equal(normalizeText('  Développeur, Sénior  '), 'developpeur senior');
});

test('fingerprint ignores legal suffixes and punctuation', () => {
  assert.equal(fingerprint('Senior Dev', 'Acme (Pty) Ltd'), fingerprint('senior dev', 'ACME'));
  assert.equal(fingerprint('Senior Dev', 'Acme'), fingerprint('Senior-Dev', 'acme'));
});

test('splitList trims and drops empty entries', () => {
  assert.deepEqual(splitList(' React, Node ,, '), ['React', 'Node']);
  assert.deepEqual(splitList(''), []);
});

test('dedupe merges the same job from two sources', () => {
  const merged = dedupeJobs([
    job({ source: 'remotive', description: 'short' }),
    job({ source: 'jobicy', description: 'a much longer description', applyUrl: '' })
  ]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].sources, ['remotive', 'jobicy']);
  assert.equal(merged[0].description, 'a much longer description');
  assert.equal(merged[0].applyUrl, 'https://x.test/1');
});

test('score favours title hits and caps', () => {
  assert.equal(scoreJob(job(), []), 50);
  assert.equal(scoreJob(job(), ['react']), 25);
  assert.equal(scoreJob(job(), ['react', 'engineer', 'node']), 60);
});

test('filters match keywords and locations, including remote', () => {
  const rows = [job(), job({ title: 'Chef', company: 'Bistro', location: 'Durban', description: 'food' })];
  assert.equal(filterJobs(rows, { keywords: ['react'], locations: [] }).length, 1);
  assert.equal(filterJobs(rows, { keywords: [], locations: ['Cape Town'] }).length, 1);
  const remote = job({ location: 'Worldwide', remote: true });
  assert.equal(filterJobs([remote], { locations: ['remote'] }).length, 1);
  assert.equal(filterJobs(rows, { keywords: ['react'], locations: [], onlyMatches: false }).length, 2);
});

test('trackerFingerprints exposes a set of existing jobs', () => {
  const set = trackerFingerprints([job()]);
  assert.equal(set.has(fingerprint('Senior React Engineer', 'Acme')), true);
});
```

- [ ] **Step 6: Run the matcher tests and watch them fail**

Run: `node --test packages/core/src/feeds/match.test.js`
Expected: FAIL, module not found.

- [ ] **Step 7: Implement `match.js`**

```js
export function normalizeText(value) {
  return String(value == null ? '' : value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const LEGAL_SUFFIX = /(?:^|\s)(?:pty\s+ltd|pty|ltd|inc|llc|cc|co|corp)$/;

export function fingerprint(title, company) {
  const head = normalizeText(title);
  const full = normalizeText(company);
  const stripped = full.replace(LEGAL_SUFFIX, '').trim();
  return `${head}|${stripped || full}`;
}

export function trackerFingerprints(jobs = []) {
  return new Set(jobs.map((entry) => fingerprint(entry.title, entry.company)));
}

export function splitList(value) {
  return String(value == null ? '' : value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function phrasePattern(phrase) {
  const parts = normalizeText(phrase).split(' ').filter(Boolean);
  if (!parts.length) return null;
  return new RegExp(`(?:^|\\s)${parts.map(escapeRegExp).join('\\s+')}(?:\\s|$)`, 'i');
}

function hits(haystack, phrase) {
  const pattern = phrasePattern(phrase);
  return Boolean(pattern && pattern.test(haystack));
}

export function scoreJob(job, keywords = []) {
  const phrases = keywords.map(normalizeText).filter(Boolean);
  if (!phrases.length) return 50;
  const title = normalizeText(job.title);
  const description = normalizeText(job.description);
  let titleHits = 0;
  let descriptionHits = 0;
  for (const phrase of phrases) {
    if (hits(title, phrase)) titleHits += 1;
    else if (hits(description, phrase)) descriptionHits += 1;
  }
  return Math.min(75, titleHits * 25) + Math.min(25, descriptionHits * 10);
}

const REMOTE_WORDS = new Set(['remote', 'anywhere', 'worldwide']);

function matchesLocations(job, locations) {
  if (!locations.length) return true;
  const haystack = normalizeText(`${job.location || ''} ${job.description || ''}`);
  return locations.some((value) => {
    const phrase = normalizeText(value);
    if (!phrase) return false;
    if (job.remote && REMOTE_WORDS.has(phrase)) return true;
    return hits(haystack, phrase);
  });
}

function matchesKeywords(job, keywords) {
  if (!keywords.length) return true;
  return keywords.some((value) => hits(normalizeText(job.title), value)
    || hits(normalizeText(job.description), value));
}

function byScore(a, b) {
  if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
  if (a.datePosted !== b.datePosted) return String(b.datePosted).localeCompare(String(a.datePosted));
  return String(a.title).localeCompare(String(b.title));
}

export function filterJobs(jobs = [], { keywords = [], locations = [], onlyMatches = true } = {}) {
  const keywordList = keywords.map((value) => String(value).trim()).filter(Boolean);
  const locationList = locations.map((value) => String(value).trim()).filter(Boolean);
  const scored = jobs.map((job) => ({ ...job, matchScore: scoreJob(job, keywordList) }));
  const kept = onlyMatches
    ? scored.filter((job) => matchesKeywords(job, keywordList) && matchesLocations(job, locationList))
    : scored;
  return kept.sort(byScore);
}

function earlier(a, b) {
  if (!a) return b || '';
  if (!b) return a;
  return a < b ? a : b;
}

export function dedupeJobs(jobs = []) {
  const merged = new Map();
  for (const job of jobs) {
    const key = fingerprint(job.title, job.company);
    const current = merged.get(key);
    if (!current) {
      merged.set(key, { ...job, sources: [job.source] });
      continue;
    }
    merged.set(key, {
      ...current,
      sources: [...new Set([...current.sources, job.source])],
      description: job.description.length > current.description.length ? job.description : current.description,
      applyUrl: current.applyUrl || job.applyUrl,
      datePosted: earlier(current.datePosted, job.datePosted),
      remote: current.remote || job.remote,
      tags: [...new Set([...current.tags, ...job.tags])].slice(0, 10),
      salaryText: current.salaryText || job.salaryText
    });
  }
  return [...merged.values()];
}
```

- [ ] **Step 8: Run all core tests**

Run: `npm test --workspace=packages/core`
Expected: PASS for every test file.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/feeds
git commit -m "feat(core): feed shape helpers and dedupe matcher" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Feed normalizers and fixtures

**Files:**
- Create: `packages/core/src/feeds/remotive.js`
- Create: `packages/core/src/feeds/arbeitnow.js`
- Create: `packages/core/src/feeds/jobicy.js`
- Create: `packages/core/src/feeds/index.js`
- Create: `packages/core/src/feeds/fixtures/remotive.json`
- Create: `packages/core/src/feeds/fixtures/arbeitnow.json`
- Create: `packages/core/src/feeds/fixtures/jobicy.json`
- Test: `packages/core/src/feeds/adapters.test.js`
- Modify: `packages/core/package.json` (add `"./feeds"` export)

**Interfaces:**
- Consumes: `makeRawJob`, `FeedShapeError`, `looksRemote` from `./shape.js`.
- Produces: `normalizeRemotive(raw)`, `normalizeArbeitnow(raw)`, `normalizeJobicy(raw)`, each returning `RawJob[]` or throwing `FeedShapeError`.
- Produces: `FEED_SOURCES` (array of `{ id, label, endpoint, home, normalize }`), `sourceById(id)`, and re-exports of `shape.js` and `match.js`.

- [ ] **Step 1: Write the failing adapter tests**

```js
// packages/core/src/feeds/adapters.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeRemotive } from './remotive.js';
import { normalizeArbeitnow } from './arbeitnow.js';
import { normalizeJobicy } from './jobicy.js';
import { FEED_SOURCES, sourceById } from './index.js';

const fixture = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));

test('remotive fixture normalizes every row', () => {
  const rows = normalizeRemotive(fixture('remotive'));
  assert.equal(rows.length, 3);
  assert.equal(rows[0].title, 'Senior Frontend Engineer');
  assert.equal(rows[0].company, 'Acme Labs');
  assert.equal(rows[0].datePosted, '2026-10-20');
  assert.equal(rows[0].applyUrl, 'https://remotive.com/remote-jobs/software-development/senior-frontend-engineer-1001');
  assert.match(rows[0].description, /React/);
  assert.equal(rows[0].remote, true);
});

test('arbeitnow fixture normalizes unix dates and remote flags', () => {
  const rows = normalizeArbeitnow(fixture('arbeitnow'));
  assert.equal(rows.length, 3);
  assert.equal(rows[0].datePosted, '2026-10-21');
  assert.equal(rows[1].remote, true);
});

test('jobicy fixture normalizes salary text', () => {
  const rows = normalizeJobicy(fixture('jobicy'));
  assert.equal(rows.length, 3);
  assert.equal(rows[0].salaryText, 'USD 60 000 - 80 000');
});

test('a missing root array is a FeedShapeError', () => {
  assert.throws(() => normalizeRemotive({}), /Remotive/);
  assert.throws(() => normalizeArbeitnow({ jobs: [] }), /Arbeitnow/);
  assert.throws(() => normalizeJobicy({ jobs: {} }), /Jobicy/);
});

test('an empty array is a valid empty result', () => {
  assert.deepEqual(normalizeRemotive({ jobs: [] }), []);
});

test('invalid rows are dropped and fields are bounded', () => {
  const rows = normalizeRemotive({ jobs: [
    { id: 1, title: '', company_name: 'No title' },
    { id: 2, title: 'Dev', company_name: 'Acme', url: 'javascript:alert(1)', tags: 'not-an-array' }
  ] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].applyUrl, '');
  assert.deepEqual(rows[0].tags, []);
});

test('the registry exposes three sources with unique ids', () => {
  assert.deepEqual(FEED_SOURCES.map((source) => source.id), ['remotive', 'arbeitnow', 'jobicy']);
  assert.equal(sourceById('jobicy').label, 'Jobicy');
  assert.equal(sourceById('nope'), null);
});
```

- [ ] **Step 2: Run the adapter tests and watch them fail**

Run: `node --test packages/core/src/feeds/adapters.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Create the three fixtures**

`fixtures/remotive.json`:

```json
{
  "job-count": 3,
  "jobs": [
    {
      "id": 1001,
      "url": "https://remotive.com/remote-jobs/software-development/senior-frontend-engineer-1001",
      "title": "Senior Frontend Engineer",
      "company_name": "Acme Labs",
      "category": "Software Development",
      "tags": ["react", "typescript"],
      "job_type": "full_time",
      "publication_date": "2026-10-20T09:12:00",
      "candidate_required_location": "Remote (Worldwide)",
      "salary": "R 900 000 - R 1 200 000",
      "description": "<p>Build the design system with <strong>React</strong> and TypeScript.</p>"
    },
    {
      "id": 1002,
      "url": "https://remotive.com/remote-jobs/software-development/backend-engineer-1002",
      "title": "Backend Engineer",
      "company_name": "Karoo Systems",
      "category": "Software Development",
      "tags": ["nodejs"],
      "job_type": "full_time",
      "publication_date": "2026-10-19T08:00:00",
      "candidate_required_location": "South Africa",
      "salary": "",
      "description": "<p>Node.js services and PostgreSQL.</p>"
    },
    {
      "id": 1003,
      "url": "",
      "title": "Data Analyst",
      "company_name": "Nimbus Data",
      "category": "Data",
      "tags": ["sql"],
      "job_type": "contract",
      "publication_date": "2026-10-18T10:30:00",
      "candidate_required_location": "Cape Town",
      "salary": "",
      "description": "<p>SQL and dashboards.</p>"
    }
  ]
}
```

`fixtures/arbeitnow.json`:

```json
{
  "data": [
    {
      "slug": "backend-engineer-cape-town-123",
      "company_name": "Karoo Systems",
      "title": "Backend Engineer",
      "description": "<p>Node.js services and Docker.</p>",
      "remote": false,
      "url": "https://www.arbeitnow.com/jobs/companies/karoo-systems/backend-engineer-cape-town-123",
      "tags": ["nodejs", "docker"],
      "job_types": ["full-time"],
      "location": "Cape Town",
      "created_at": 1761000000
    },
    {
      "slug": "support-engineer-remote-456",
      "company_name": "Helio Support",
      "title": "Support Engineer",
      "description": "<p>Help customers remotely.</p>",
      "remote": true,
      "url": "https://www.arbeitnow.com/jobs/companies/helio-support/support-engineer-remote-456",
      "tags": ["support"],
      "job_types": ["full-time"],
      "location": "Berlin",
      "created_at": 1761100000
    },
    {
      "slug": "junior-developer-789",
      "company_name": "",
      "title": "Junior Developer",
      "description": "<p>No company, should be dropped.</p>",
      "remote": false,
      "url": "https://www.arbeitnow.com/jobs/companies/unknown/junior-developer-789",
      "tags": [],
      "job_types": ["full-time"],
      "location": "Durban",
      "created_at": 1761200000
    }
  ],
  "links": {},
  "meta": {}
}
```

The third row is dropped, so `normalizeArbeitnow` returns 2 rows, not 3. Adjust the test to `assert.equal(rows.length, 2)` and check that the remaining rows are the two valid ones. Do that now in the test above.

`fixtures/jobicy.json`:

```json
{
  "jobCount": 3,
  "jobs": [
    {
      "id": 555,
      "url": "https://jobicy.com/jobs/555-senior-data-engineer",
      "jobTitle": "Senior Data Engineer",
      "companyName": "Nimbus Data",
      "jobIndustry": ["Data"],
      "jobType": ["full-time"],
      "jobGeo": "Remote",
      "jobLevel": "Senior",
      "jobExcerpt": "Build pipelines.",
      "jobDescription": "<p>Build data pipelines with Python.</p>",
      "pubDate": "2026-10-22 08:00:00",
      "annualSalaryMin": "60000",
      "annualSalaryMax": "80000",
      "salaryCurrency": "USD"
    },
    {
      "id": 556,
      "url": "https://jobicy.com/jobs/556-product-designer",
      "jobTitle": "Product Designer",
      "companyName": "Studio Nine",
      "jobIndustry": ["Design"],
      "jobType": ["contract"],
      "jobGeo": "Cape Town",
      "jobLevel": "Mid",
      "jobExcerpt": "Design systems.",
      "jobDescription": "<p>Own the design system.</p>",
      "pubDate": "2026-10-21 09:00:00",
      "annualSalaryMin": "",
      "annualSalaryMax": "",
      "salaryCurrency": "ZAR"
    },
    {
      "id": 557,
      "url": "",
      "jobTitle": "",
      "companyName": "Dropped Co",
      "jobDescription": "<p>No title.</p>",
      "pubDate": "2026-10-20 09:00:00"
    }
  ]
}
```

Jobicy returns 2 valid rows. Adjust the test accordingly.

- [ ] **Step 4: Implement the three normalizers**

```js
// packages/core/src/feeds/remotive.js
import { FeedShapeError, makeRawJob, looksRemote } from './shape.js';

const LIMIT = 300;

export function normalizeRemotive(raw) {
  if (!raw || !Array.isArray(raw.jobs)) throw new FeedShapeError('Remotive', 'expected jobs[]');
  return raw.jobs
    .map((row) => makeRawJob('remotive', {
      sourceId: row.id ?? row.url,
      title: row.title,
      company: row.company_name,
      location: row.candidate_required_location,
      description: row.description,
      applyUrl: row.url,
      datePosted: row.publication_date,
      remote: looksRemote(row.candidate_required_location),
      tags: row.tags,
      salaryText: row.salary
    }))
    .filter(Boolean)
    .slice(0, LIMIT);
}
```

```js
// packages/core/src/feeds/arbeitnow.js
import { FeedShapeError, makeRawJob, looksRemote } from './shape.js';

const LIMIT = 300;

export function normalizeArbeitnow(raw) {
  if (!raw || !Array.isArray(raw.data)) throw new FeedShapeError('Arbeitnow', 'expected data[]');
  return raw.data
    .map((row) => makeRawJob('arbeitnow', {
      sourceId: row.slug ?? row.url,
      title: row.title,
      company: row.company_name,
      location: row.location,
      description: row.description,
      applyUrl: row.url,
      datePosted: row.created_at,
      remote: row.remote === true || looksRemote(row.location, row.title),
      tags: row.tags,
      salaryText: ''
    }))
    .filter(Boolean)
    .slice(0, LIMIT);
}
```

```js
// packages/core/src/feeds/jobicy.js
import { FeedShapeError, makeRawJob, looksRemote } from './shape.js';

const LIMIT = 300;

function grouped(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function salaryText(row) {
  const min = row.annualSalaryMin ? grouped(row.annualSalaryMin) : '';
  const max = row.annualSalaryMax ? grouped(row.annualSalaryMax) : '';
  const range = min && max ? `${min} - ${max}` : (min || max);
  if (!range) return '';
  return [row.salaryCurrency, range].filter(Boolean).join(' ');
}

export function normalizeJobicy(raw) {
  if (!raw || !Array.isArray(raw.jobs)) throw new FeedShapeError('Jobicy', 'expected jobs[]');
  return raw.jobs
    .map((row) => makeRawJob('jobicy', {
      sourceId: row.id ?? row.url,
      title: row.jobTitle,
      company: row.companyName,
      location: row.jobGeo,
      description: row.jobDescription || row.jobExcerpt,
      applyUrl: row.url,
      datePosted: row.pubDate,
      remote: looksRemote(row.jobGeo, row.jobTitle),
      tags: row.jobIndustry,
      salaryText: salaryText(row)
    }))
    .filter(Boolean)
    .slice(0, LIMIT);
}
```

- [ ] **Step 5: Implement the registry and subtractive exports**

```js
// packages/core/src/feeds/index.js
import { normalizeRemotive } from './remotive.js';
import { normalizeArbeitnow } from './arbeitnow.js';
import { normalizeJobicy } from './jobicy.js';

export { normalizeRemotive, normalizeArbeitnow, normalizeJobicy };
export * from './shape.js';
export * from './match.js';

export const FEED_SOURCES = Object.freeze([
  {
    id: 'remotive',
    label: 'Remotive',
    endpoint: 'https://remotive.com/api/remote-jobs',
    home: 'https://remotive.com',
    normalize: normalizeRemotive
  },
  {
    id: 'arbeitnow',
    label: 'Arbeitnow',
    endpoint: 'https://www.arbeitnow.com/api/job-board-api',
    home: 'https://www.arbeitnow.com',
    normalize: normalizeArbeitnow
  },
  {
    id: 'jobicy',
    label: 'Jobicy',
    endpoint: 'https://jobicy.com/api/v2/remote-jobs',
    home: 'https://jobicy.com',
    normalize: normalizeJobicy
  }
]);

export function sourceById(id) {
  return FEED_SOURCES.find((source) => source.id === id) || null;
}

export function sourceLabel(id) {
  return sourceById(id)?.label || String(id || '');
}
```

- [ ] **Step 6: Add the package export**

In `packages/core/package.json`, add to `exports`:

```json
"./feeds": "./src/feeds/index.js"
```

- [ ] **Step 7: Run the adapter tests and all core tests**

Run: `node --test packages/core/src/feeds/adapters.test.js`
Run: `npm test --workspace=packages/core`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/core
git commit -m "feat(core): Remotive, Arbeitnow and Jobicy normalizers" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Web feed client

**Files:**
- Create: `client/src/web/feeds.js`
- Test: `client/src/web/feeds.test.js`

**Interfaces:**
- Consumes: `FEED_SOURCES`, `sourceById`, `sourceLabel` from `@sajas/core/feeds`; `AppError`, `ERROR_CODES`, `toUserError` from `@sajas/core/errors`.
- Produces: `createFeedClient({ fetchImpl, now, sleep, timeoutMs, retryDelayMs, cacheTtlMs })` with `load(id, { force })`, `loadAll({ force })`, `clear()`.
- Produces: `getFeedClient()` and `clearFeedCache()` for the app and panic wipe.

- [ ] **Step 1: Write the failing client tests**

```js
// client/src/web/feeds.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFeedClient } from './feeds.js';

const fixture = (jobs) => ({ jobs });

function response(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function makeClient(handler, over = {}) {
  let clock = 0;
  const client = createFeedClient({
    fetchImpl: handler,
    now: () => clock,
    sleep: async () => {},
    timeoutMs: 50,
    retryDelayMs: 0,
    cacheTtlMs: 1000,
    ...over
  });
  return { client, tick: (ms) => { clock += ms; } };
}

const okBody = () => fixture([{
  id: 1, url: 'https://remotive.com/jobs/1', title: 'React Engineer', company_name: 'Acme',
  candidate_required_location: 'Remote', publication_date: '2026-10-20', description: '<p>React</p>'
}]);

test('a successful load returns normalized jobs', async () => {
  const { client } = makeClient(async () => response(200, okBody()));
  const result = await client.load('remotive');
  assert.equal(result.cached, false);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].company, 'Acme');
});

test('a 500 is retried once and can succeed', async () => {
  let calls = 0;
  const { client } = makeClient(async () => {
    calls += 1;
    return calls === 1 ? response(500, {}) : response(200, okBody());
  });
  const result = await client.load('remotive');
  assert.equal(calls, 2);
  assert.equal(result.jobs.length, 1);
});

test('a persistent 500 is FEED_FAILED and retryable', async () => {
  const { client } = makeClient(async () => response(500, {}));
  await assert.rejects(() => client.load('remotive'), (err) => err.code === 'FEED_FAILED' && err.retryable === true);
});

test('a 404 is not retried', async () => {
  let calls = 0;
  const { client } = makeClient(async () => { calls += 1; return response(404, {}); });
  await assert.rejects(() => client.load('remotive'), (err) => err.code === 'FEED_FAILED' && err.retryable === false);
  assert.equal(calls, 1);
});

test('a network TypeError maps to CORS_BLOCKED', async () => {
  const { client } = makeClient(async () => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(() => client.load('remotive'), (err) => err.code === 'CORS_BLOCKED');
});

test('a timeout is FEED_FAILED', async () => {
  const { client } = makeClient((_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  }));
  await assert.rejects(() => client.load('remotive'), (err) => err.code === 'FEED_FAILED' && err.retryable === true);
});

test('a malformed payload is not retried', async () => {
  let calls = 0;
  const { client } = makeClient(async () => { calls += 1; return response(200, { nope: true }); });
  await assert.rejects(() => client.load('remotive'), (err) => err.code === 'FEED_FAILED' && err.retryable === false);
  assert.equal(calls, 1);
});

test('a fresh cache entry skips the network and force bypasses it', async () => {
  let calls = 0;
  const { client, tick } = makeClient(async () => { calls += 1; return response(200, okBody()); });
  await client.load('remotive');
  await client.load('remotive');
  assert.equal(calls, 1);
  const cached = await client.load('remotive');
  assert.equal(cached.cached, true);
  tick(1001);
  await client.load('remotive');
  assert.equal(calls, 2);
  await client.load('remotive', { force: true });
  assert.equal(calls, 3);
});

test('loadAll isolates a failing source', async () => {
  const { client } = makeClient(async (url) => (
    String(url).includes('remotive') ? response(500, {}) : response(200, okBody())
  ));
  const outcome = await client.loadAll();
  assert.equal(outcome.results.length, 2);
  assert.equal(outcome.errors.length, 1);
  assert.equal(outcome.errors[0].source, 'remotive');
  assert.equal(outcome.errors[0].error.code, 'FEED_FAILED');
});

test('clear empties the cache', async () => {
  let calls = 0;
  const { client } = makeClient(async () => { calls += 1; return response(200, okBody()); });
  await client.load('remotive');
  client.clear();
  await client.load('remotive');
  assert.equal(calls, 2);
});
```

Note: `loadAll` expects the Arbeitnow and Jobicy fixtures to differ by URL. In the test handler, use `String(url).includes('remotive')`; the other two get `okBody()`, which is a Remotive-shaped payload, so their normalizers will throw `FeedShapeError`. To keep the test focused on isolation, return source-shaped bodies per URL:

```js
function bodyFor(url) {
  if (String(url).includes('arbeitnow')) return { data: [{ slug: '1', title: 'Dev', company_name: 'Acme', url: 'https://a.test/1' }] };
  if (String(url).includes('jobicy')) return { jobs: [{ id: 1, jobTitle: 'Dev', companyName: 'Acme', url: 'https://j.test/1' }] };
  return okBody();
}
```

Use `bodyFor` in the loadAll test.

- [ ] **Step 2: Run the client tests and watch them fail**

Run: `node --test client/src/web/feeds.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `feeds.js`**

```js
// Browser-only feed client. No key, no profile data, and no persistence: results
// live in a module-level cache for this tab only.
import { FEED_SOURCES, sourceById } from '@sajas/core/feeds';
import { AppError, ERROR_CODES, toUserError } from '@sajas/core/errors';

const DEFAULTS = {
  timeoutMs: 20000,
  retryDelayMs: 750,
  cacheTtlMs: 15 * 60 * 1000
};

const RETRY_HINT = 'Retry this feed; the other feeds still work.';
const CHANGE_HINT = 'Try another feed; this one may have changed its API.';

function retryableStatus(status) {
  return status === 429 || status >= 500;
}

function offlineNow() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function failure(message, { retryable, hint, details } = {}) {
  return new AppError(ERROR_CODES.FEED_FAILED, message, {
    retryable,
    hint: hint || (retryable ? RETRY_HINT : CHANGE_HINT),
    details
  });
}

export function createFeedClient(options = {}) {
  const config = { ...DEFAULTS, ...options };
  const fetchImpl = config.fetchImpl || ((...args) => globalThis.fetch(...args));
  const now = config.now || (() => Date.now());
  const sleep = config.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const cache = new Map();

  async function request(source) {
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (attempt > 0) await sleep(config.retryDelayMs);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);
      try {
        const response = await fetchImpl(source.endpoint, {
          signal: controller.signal,
          headers: { Accept: 'application/json' }
        });
        if (!response.ok) {
          const retryable = retryableStatus(response.status);
          const error = failure(`${source.label} rejected the request (HTTP ${response.status}).`, { retryable });
          if (attempt === 0 && retryable) { lastError = error; continue; }
          throw error;
        }
        let raw;
        try {
          raw = await response.json();
        } catch {
          throw failure(`${source.label} sent a response this app could not read.`, { retryable: false });
        }
        try {
          return source.normalize(raw);
        } catch (error) {
          throw failure(error.message, {
            retryable: false,
            details: `${error.name}: ${error.detail || 'unexpected payload'}`
          });
        }
      } catch (error) {
        if (error instanceof AppError) {
          if (attempt === 0 && error.retryable) { lastError = error; continue; }
          throw error;
        }
        const timedOut = error?.name === 'AbortError';
        const mapped = offlineNow()
          ? new AppError(ERROR_CODES.NETWORK_OFFLINE, 'You are offline.', {
            retryable: true,
            hint: 'Reconnect, then retry this feed.'
          })
          : timedOut
            ? failure(`${source.label} did not respond in time.`, { retryable: true })
            : new AppError(ERROR_CODES.CORS_BLOCKED, `This browser blocked the request to ${source.label}.`, {
              retryable: true,
              hint: 'Retry once. If it keeps failing, the feed may be down or blocking this site.'
            });
        if (attempt === 0) { lastError = mapped; continue; }
        throw mapped;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError || failure('The feed did not respond.', { retryable: true });
  }

  async function load(id, { force = false } = {}) {
    const source = sourceById(id);
    if (!source) throw failure(`There is no feed called ${id}.`, { retryable: false });
    const entry = cache.get(id);
    if (!force && entry && now() - entry.at < config.cacheTtlMs) {
      return { source: id, label: source.label, jobs: entry.jobs, fetchedAt: new Date(entry.at).toISOString(), cached: true };
    }
    const jobs = await request(source);
    const at = now();
    cache.set(id, { at, jobs });
    return { source: id, label: source.label, jobs, fetchedAt: new Date(at).toISOString(), cached: false };
  }

  async function loadAll({ force = false } = {}) {
    const settled = await Promise.all(FEED_SOURCES.map(async (source) => {
      try {
        return { result: await load(source.id, { force }) };
      } catch (error) {
        return { source: source.id, label: source.label, error: toUserError(error) };
      }
    }));
    return {
      results: settled.filter((entry) => entry.result).map((entry) => entry.result),
      errors: settled.filter((entry) => entry.error)
    };
  }

  function clear() {
    cache.clear();
  }

  return { load, loadAll, clear };
}

let shared = null;

export function getFeedClient() {
  if (!shared) shared = createFeedClient();
  return shared;
}

export function clearFeedCache() {
  shared?.clear();
}
```

- [ ] **Step 4: Run the client tests**

Run: `node --test client/src/web/feeds.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/web/feeds.js client/src/web/feeds.test.js
git commit -m "feat(web): bounded feed client with retry, cache and per-source errors" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Web API status and notes validation

**Files:**
- Modify: `client/src/web/api.js` (`updateJob`, around lines 172-179)
- Test: `client/src/web/api.test.js`

**Interfaces:**
- Consumes: `ERROR_CODES.VALIDATION`, `limit`.
- Produces: `updateJob` accepting only `status`, `notes`, `applyUrl`, `description`; invalid status is `VALIDATION`; unknown fields are ignored.

- [ ] **Step 1: Write the failing API tests**

Add to `client/src/web/api.test.js` (reuse the existing harness that builds `createWebApi` with a memory vault; follow the file's current helpers):

```js
test('a tracker update accepts a known status and notes', async () => {
  const { handle, vault } = harness();
  const job = await seedJob(vault);
  const res = await handle(`http://localhost:5000/api/jobs/${job.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'interviewing', notes: 'Call on Tuesday' })
  });
  assert.equal(res.status, 200);
  const saved = await vault.get('jobs', job.id);
  assert.equal(saved.status, 'interviewing');
  assert.equal(saved.notes, 'Call on Tuesday');
});

test('an unknown status is rejected and nothing is written', async () => {
  const { handle, vault } = harness();
  const job = await seedJob(vault);
  const res = await handle(`http://localhost:5000/api/jobs/${job.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'hired' })
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.code, 'VALIDATION');
  assert.match(body.hint, /found/);
  assert.equal((await vault.get('jobs', job.id)).status, 'found');
});

test('notes are bounded and unknown fields are ignored', async () => {
  const { handle, vault } = harness();
  const job = await seedJob(vault);
  const res = await handle(`http://localhost:5000/api/jobs/${job.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ notes: 'x'.repeat(25000), matchScore: 1, id: 'other' })
  });
  assert.equal(res.status, 200);
  const saved = await vault.get('jobs', job.id);
  assert.equal(saved.notes.length, 20000);
  assert.equal(saved.matchScore, job.matchScore);
  assert.equal(saved.id, job.id);
});
```

If the file has no `harness`/`seedJob` helpers, add them next to the existing helpers:

```js
function harness() {
  const vault = createVault(createMemoryAdapter());
  const keyStore = createKeyStore({ vault });
  const activity = createActivity();
  const api = createWebApi({ apiBase: 'http://localhost:5000/api', vault, keyStore, activity });
  return { vault, keyStore, activity, handle: api.handle };
}

async function seedJob(vault) {
  const job = {
    id: 'job-1', title: 'Dev', company: 'Acme', location: 'Cape Town', description: '',
    applyUrl: '', source: 'Manual', matchScore: 75, status: 'found', notes: '',
    dateAdded: '2026-10-20', datePosted: '2026-10-20'
  };
  await vault.put('jobs', job.id, job);
  return job;
}
```

Import `createVault`, `createMemoryAdapter`, `createKeyStore`, `createActivity`, and `createWebApi` if the file does not already.

- [ ] **Step 2: Run the API tests and watch the new ones fail**

Run: `node --test client/src/web/api.test.js`
Expected: the new status and notes tests fail (the current `updateJob` accepts anything).

- [ ] **Step 3: Align `addJob` with the shared fingerprint and feed fields**

At the top of `client/src/web/api.js`, import the matcher:

```js
import { fingerprint } from '@sajas/core/feeds';
```

In `addJob`:

1. Destructure two more fields: `const { title, company, location, description, applyUrl, source, matchScore, datePosted } = await bodyOf(input, init);`
2. Replace the exact-match duplicate check with the shared fingerprint:

```js
const wanted = fingerprint(title, company);
const same = jobs.find((job) => fingerprint(job.title, job.company) === wanted);
```

3. Store a caller-supplied score and date, bounded, and always create `notes`:

```js
const score = Number(matchScore);
const posted = String(datePosted || '');
const job = {
  id: crypto.randomUUID(),
  title: limit(title, 300),
  company: limit(company, 200),
  location: limit(location || 'South Africa', 200),
  description: limit(description, MAX_TEXT),
  applyUrl: limit(applyUrl, 2000),
  datePosted: /^\d{4}-\d{2}-\d{2}$/.test(posted) ? posted : now().toISOString().slice(0, 10),
  matchScore: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 75,
  status: 'found',
  notes: '',
  source: limit(source || 'Manual', 80),
  tailoredCvText: '',
  tailoredCoverLetterText: '',
  dateAdded: now().toISOString().slice(0, 10)
};
```

- [ ] **Step 4: Implement the update validation**

Replace `updateJob` in `client/src/web/api.js` with:

```js
const TRACKER_STATUSES = ['found', 'tailored', 'applied', 'interviewing', 'offer', 'rejected', 'tailoring'];

async function updateJob(input, init, id) {
  const current = await vault.get(STORES.jobs, id);
  if (!current) throw new AppError(ERROR_CODES.NOT_FOUND, 'Job not found.');
  const patch = await bodyOf(input, init);
  const next = { ...current };
  if (patch.status !== undefined) {
    if (!TRACKER_STATUSES.includes(patch.status)) {
      throw new AppError(ERROR_CODES.VALIDATION, 'That is not a status this tracker uses.', {
        retryable: false,
        hint: 'Use one of: found, tailored, applied, interviewing, offer, rejected.'
      });
    }
    next.status = patch.status;
  }
  if (patch.notes !== undefined) {
    if (typeof patch.notes !== 'string') {
      throw new AppError(ERROR_CODES.VALIDATION, 'Notes must be text.');
    }
    next.notes = limit(patch.notes, MAX_TEXT);
  }
  if (patch.applyUrl !== undefined) next.applyUrl = limit(patch.applyUrl, 2000);
  if (patch.description !== undefined) next.description = limit(patch.description, MAX_TEXT);
  await vault.put(STORES.jobs, id, next);
  return ok({ success: true, job: next });
}
```

Add `notes: ''` to the object created by `addJob` so new jobs always have the field.

- [ ] **Step 4: Run the API tests**

Run: `node --test client/src/web/api.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/web/api.js client/src/web/api.test.js
git commit -m "feat(web): validate tracker status and notes in the web port" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Job Feeds tab

**Files:**
- Create: `client/src/JobFeeds.jsx`
- Modify: `client/src/App.jsx` (import, sidebar link, header title, render block, dashboard empty copy)

**Interfaces:**
- Consumes: `FEED_SOURCES`, `sourceLabel`, `dedupeJobs`, `filterJobs`, `fingerprint`, `splitList` from `@sajas/core/feeds`; `getFeedClient` from `./web/feeds.js`; `readResponseError`, `recordError` from `./errors.js`.
- Produces: `<JobFeeds profile jobs toasts onJobsChanged onProfileSaved />`.

- [ ] **Step 1: Create the component**

```jsx
// client/src/JobFeeds.jsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, ExternalLink, Loader2, MapPin, Plus, RefreshCw, Rss } from 'lucide-react';
import {
  FEED_SOURCES, dedupeJobs, filterJobs, fingerprint, sourceLabel, splitList
} from '@sajas/core/feeds';
import { getFeedClient } from './web/feeds.js';
import { readResponseError, recordError } from './errors.js';

const API_BASE = import.meta.env.VITE_SAJAS_API_BASE || 'http://localhost:5000/api';

const rowKey = (job) => fingerprint(job.title, job.company);

export default function JobFeeds({ profile, jobs, toasts, onJobsChanged, onProfileSaved }) {
  const [keywords, setKeywords] = useState(profile?.keywords || '');
  const [locations, setLocations] = useState(profile?.locations || '');
  const [onlyMatches, setOnlyMatches] = useState(true);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [errors, setErrors] = useState([]);
  const [meta, setMeta] = useState({});
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [tracked, setTracked] = useState(() => new Set());

  useEffect(() => {
    setTracked(new Set(jobs.map((job) => fingerprint(job.title, job.company))));
  }, [jobs]);

  const load = useCallback(async ({ force = false } = {}) => {
    setLoading(true);
    try {
      const outcome = await getFeedClient().loadAll({ force });
      setResults(dedupeJobs(outcome.results.flatMap((entry) => entry.jobs)));
      setErrors(outcome.errors);
      setMeta(Object.fromEntries(outcome.results.map((entry) => [entry.source, entry.fetchedAt])));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => filterJobs(results, {
    keywords: splitList(keywords),
    locations: splitList(locations),
    onlyMatches
  }), [results, keywords, locations, onlyMatches]);

  async function addOne(job) {
    const key = rowKey(job);
    setBusy(key);
    try {
      const response = await fetch(`${API_BASE}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: job.title,
          company: job.company,
          location: job.location || 'South Africa',
          description: job.description,
          applyUrl: job.applyUrl,
          source: sourceLabel(job.source),
          matchScore: job.matchScore,
          datePosted: job.datePosted
        })
      });
      if (response.status === 409) {
        setTracked((current) => new Set(current).add(key));
        return 'exists';
      }
      if (!response.ok) throw await readResponseError(response, 'Could not add this job to your tracker.');
      setTracked((current) => new Set(current).add(key));
      onJobsChanged?.();
      return 'added';
    } catch (error) {
      const info = recordError(error, { where: 'add feed job' });
      setNotice(`${job.title}: ${info.hint || info.message}`);
      return 'failed';
    } finally {
      setBusy('');
    }
  }

  async function addVisible() {
    const targets = visible.filter((job) => !tracked.has(rowKey(job)));
    let added = 0;
    let exists = 0;
    let failed = 0;
    for (const job of targets) {
      const outcome = await addOne(job);
      if (outcome === 'added') added += 1;
      else if (outcome === 'exists') exists += 1;
      else failed += 1;
    }
    setNotice(`${added} added, ${exists} already in your tracker, ${failed} failed.`);
    if (added) toasts.success(`${added} job${added === 1 ? '' : 's'} added to your tracker.`);
  }

  async function retryOne(id) {
    setLoading(true);
    try {
      const result = await getFeedClient().load(id, { force: true });
      setMeta((current) => ({ ...current, [id]: result.fetchedAt }));
      setErrors((current) => current.filter((entry) => entry.source !== id));
      setResults((current) => dedupeJobs([
        ...current.filter((job) => !(job.source === id || job.sources?.includes(id))),
        ...result.jobs
      ]));
    } catch (error) {
      const info = recordError(error, { where: `feed ${id}` });
      setErrors((current) => [
        ...current.filter((entry) => entry.source !== id),
        { source: id, label: sourceLabel(id), error: info }
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function saveDefaults() {
    try {
      const response = await fetch(`${API_BASE}/profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords, locations })
      });
      if (!response.ok) throw await readResponseError(response, 'Could not save these filters.');
      toasts.success('Feed filters saved as your defaults.');
      onProfileSaved?.();
    } catch (error) {
      const info = recordError(error, { where: 'save feed filters' });
      setNotice(`${info.message} ${info.hint || ''}`.trim());
    }
  }

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div className="glass-panel" style={{ padding: 20 }}>
        <div className="flex-between" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h3 style={{ fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Rss size={16} /> Public job feeds
            </h3>
            <p className="tiny" style={{ marginTop: 4 }}>
              Fetched by this browser from three public feeds. No key, no profile data, and no account are sent.
            </p>
          </div>
          <div className="flex-gap">
            <button className="btn-secondary btn-sm" onClick={() => load({ force: true })} disabled={loading}>
              {loading ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} Refresh all
            </button>
            <button className="btn-primary btn-sm" onClick={addVisible} disabled={loading || visible.length === 0}>
              <Plus size={14} /> Add all matches
            </button>
          </div>
        </div>

        <div className="grid-2" style={{ marginTop: 16 }}>
          <div>
            <label>Keywords</label>
            <input value={keywords} onChange={(event) => setKeywords(event.target.value)} placeholder="React, Node.js, Data" />
          </div>
          <div>
            <label>Locations</label>
            <input value={locations} onChange={(event) => setLocations(event.target.value)} placeholder="Johannesburg, Remote" />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 12, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
            <input type="checkbox" checked={onlyMatches} onChange={(event) => setOnlyMatches(event.target.checked)} style={{ width: 16, height: 16 }} />
            <span style={{ fontSize: 13 }}>Only show matches</span>
          </label>
          <button className="btn-ghost btn-sm" onClick={saveDefaults}>Save as defaults</button>
          {notice && <span className="tiny">{notice}</span>}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 14 }}>
        {FEED_SOURCES.map((source) => {
          const failure = errors.find((entry) => entry.source === source.id);
          const count = results.filter((job) => (job.sources || [job.source]).includes(source.id)).length;
          return (
            <div key={source.id} className="glass-panel" style={{ padding: 16 }} data-testid={`feed-source-${source.id}`}>
              <div className="flex-between">
                <h4 style={{ fontSize: 14 }}>{source.label}</h4>
                <a href={source.home} target="_blank" rel="noopener noreferrer" className="tiny">Source</a>
              </div>
              {failure ? (
                <div style={{ marginTop: 8 }}>
                  <p className="tiny" style={{ color: 'var(--color-error)', display: 'flex', gap: 6 }}>
                    <AlertTriangle size={12} /> {failure.error.message}
                  </p>
                  <p className="tiny" style={{ marginTop: 4 }}>{failure.error.hint}</p>
                  <button className="btn-secondary btn-xs" style={{ marginTop: 8 }} onClick={() => retryOne(source.id)}>
                    Retry this feed
                  </button>
                </div>
              ) : (
                <p className="tiny" style={{ marginTop: 6 }}>
                  {loading ? 'Loading...' : `${count} jobs`}
                  {meta[source.id] ? `, fetched ${new Date(meta[source.id]).toLocaleTimeString()}` : ''}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="glass-panel" style={{ padding: 20 }}>
        <h3 style={{ fontSize: 15, marginBottom: 12 }}>
          {visible.length} matching {visible.length === 1 ? 'job' : 'jobs'}
        </h3>
        {visible.length === 0 ? (
          <p className="tiny" style={{ padding: '24px 0', textAlign: 'center' }}>
            {loading ? 'Fetching feeds...' : results.length === 0
              ? 'No feeds returned jobs. Retry above, or check your connection.'
              : 'No jobs match these filters. Loosen the keywords, add a location, or turn off Only show matches.'}
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Role and company</th>
                  <th>Location</th>
                  <th>Source</th>
                  <th>Posted</th>
                  <th>Match</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.slice(0, 100).map((job, index) => {
                  const key = rowKey(job);
                  const isTracked = tracked.has(key);
                  return (
                    <tr key={key} data-testid={`feed-row-${index}`}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{job.title}</div>
                        <div className="tiny">{job.company}</div>
                      </td>
                      <td>
                        <span className="tiny" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <MapPin size={12} /> {job.location || 'Not stated'}
                          {job.remote && <span className="badge badge-info">Remote</span>}
                        </span>
                      </td>
                      <td><span className="badge badge-info">{(job.sources || [job.source]).map(sourceLabel).join(', ')}</span></td>
                      <td className="tiny">{job.datePosted || 'Unknown'}</td>
                      <td style={{ color: job.matchScore >= 80 ? 'var(--color-success)' : 'var(--color-accent)', fontWeight: 700 }}>
                        {job.matchScore}%
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          {job.applyUrl && (
                            <a href={job.applyUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary btn-xs" style={{ textDecoration: 'none' }}>
                              <ExternalLink size={12} /> Open
                            </a>
                          )}
                          <button
                            className={isTracked ? 'btn-ghost btn-xs' : 'btn-primary btn-xs'}
                            disabled={isTracked || busy === key}
                            onClick={() => addOne(job)}
                            data-testid={`add-job-${index}`}
                          >
                            {busy === key ? <Loader2 size={12} className="spin" /> : isTracked ? <Check size={12} /> : <Plus size={12} />}
                            {isTracked ? 'In tracker' : 'Add'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {visible.length > 100 && (
              <p className="tiny" style={{ marginTop: 10 }}>
                Showing the top 100 of {visible.length}. Narrow the filters to see more.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire the tab in `App.jsx`**

1. Add `Rss` and `StickyNote` to the `lucide-react` import list.
2. Add `import JobFeeds from './JobFeeds.jsx';`.
3. Add to `headerTitles`:

```js
feeds: { title: 'Job Feeds', subtitle: 'Public job feeds fetched by your browser. Filter them, then add the ones worth tracking. No key needed.' },
```

4. Add the sidebar link directly after the Job Hunter link, wrapped in `{IS_WEB && (...)}`:

```jsx
<SidebarLink active={activeTab === 'feeds'} onClick={() => setActiveTab('feeds')} icon={<Rss size={16} />}>Job Feeds</SidebarLink>
```

5. Render the tab between the hunter and tailor blocks:

```jsx
{IS_WEB && activeTab === 'feeds' && (
  <JobFeeds
    profile={profile}
    jobs={jobs}
    toasts={toasts}
    onJobsChanged={fetchJobs}
    onProfileSaved={fetchProfile}
  />
)}
```

6. Update the dashboard empty state copy for web:

```jsx
body={IS_WEB ? 'Open Job Feeds to pull public jobs, or add one manually.' : 'Configure your keywords in Profile & Settings, then click Run Hunter.'}
```

- [ ] **Step 3: Build the client to catch syntax errors**

Run: `npm run build:client`
Expected: build succeeds. Behaviour is covered in Task 8.

- [ ] **Step 4: Commit**

```bash
git add client/src/JobFeeds.jsx client/src/App.jsx
git commit -m "feat(web): job feeds tab with filters, source cards and add-to-tracker" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Tracker status and notes

**Files:**
- Modify: `client/src/App.jsx` (`StatusBadge`, tracker table, filter select, web gating)

**Interfaces:**
- Consumes: `PATCH /jobs/:id` with `{ status }` or `{ notes }`.
- Produces: `updateJobFields(id, patch)` inside `App`, which refreshes `jobs` on success and records failures.

- [ ] **Step 1: Extend the status badge**

```jsx
const map = {
  found:        { cls: 'badge',          label: 'Discovered' },
  tailoring:    { cls: 'badge-warning',  label: 'Tailoring...' },
  tailored:     { cls: 'badge-accent',   label: 'Tailored' },
  applied:      { cls: 'badge-success',  label: 'Applied' },
  interviewing: { cls: 'badge-info',     label: 'Interviewing' },
  offer:        { cls: 'badge-success',  label: 'Offer' },
  rejected:     { cls: 'badge-error',    label: 'Rejected' }
};
```

- [ ] **Step 2: Add the update helper next to `handleDeleteJob`**

```jsx
const TRACKER_STATUS_OPTIONS = [
  { value: 'found', label: 'Discovered' },
  { value: 'tailored', label: 'Tailored' },
  { value: 'applied', label: 'Applied' },
  { value: 'interviewing', label: 'Interviewing' },
  { value: 'offer', label: 'Offer' },
  { value: 'rejected', label: 'Rejected' }
];

const updateJobFields = useCallback(async (id, patch) => {
  try {
    const response = await fetch(`${API_BASE}/jobs/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch)
    });
    if (!response.ok) throw await readResponseError(response, 'Could not update this job.');
    await fetchJobs();
    return true;
  } catch (error) {
    const info = recordError(error, { where: 'update job' });
    toasts.error(`${info.message} ${info.hint || ''}`.trim());
    return false;
  }
}, [fetchJobs, toasts]);
```

Place the constant at module scope, outside `App`.

- [ ] **Step 3: Add notes state and editor**

Near the other tracker state:

```jsx
const [notesJobId, setNotesJobId] = useState(null);
const [notesDraft, setNotesDraft] = useState('');
```

In the tracker row, next to the Tailor button:

```jsx
<button
  className="btn-secondary btn-xs"
  title={job.notes ? 'Edit notes' : 'Add a note'}
  onClick={() => { setNotesJobId(job.id); setNotesDraft(job.notes || ''); }}
>
  <StickyNote size={12} /> {job.notes ? 'Note' : 'Add note'}
</button>
```

After the mapped row, render an editor row when `notesJobId === job.id`:

```jsx
{notesJobId === job.id && (
  <tr>
    <td colSpan="6" style={{ background: 'var(--bg-surface-2)' }}>
      <label htmlFor={`notes-${job.id}`}>Notes</label>
      <textarea
        id={`notes-${job.id}`}
        value={notesDraft}
        onChange={(event) => setNotesDraft(event.target.value)}
        rows={4}
        maxLength={20000}
        data-testid="job-notes"
      />
      <div className="flex-gap" style={{ marginTop: 8 }}>
        <button
          className="btn-primary btn-xs"
          data-testid="save-notes"
          onClick={async () => {
            if (await updateJobFields(job.id, { notes: notesDraft })) {
              setNotesJobId(null);
              toasts.success('Notes saved.');
            }
          }}
        >
          Save
        </button>
        <button className="btn-ghost btn-xs" onClick={() => setNotesJobId(null)}>Cancel</button>
      </div>
    </td>
  </tr>
)}
```

Use a React fragment around the row and the editor row so the table stays valid.

- [ ] **Step 4: Replace the status badge in the tracker row with a select**

In the tracker table body, replace:

```jsx
<StatusBadge status={job.status} />
<LinkBadge status={job.linkStatus} />
```

with:

```jsx
<select
  value={TRACKER_STATUS_OPTIONS.some((option) => option.value === job.status) ? job.status : 'found'}
  onChange={(event) => updateJobFields(job.id, { status: event.target.value })}
  style={{ width: 130, fontSize: 12 }}
  data-testid="job-status"
>
  {TRACKER_STATUS_OPTIONS.map((option) => (
    <option key={option.value} value={option.value}>{option.label}</option>
  ))}
</select>
<LinkBadge status={job.linkStatus} />
```

Do not change `StatusBadge` usages outside the tracker table.

- [ ] **Step 5: Extend the filter select**

```jsx
<option value="interviewing">Interviewing</option>
<option value="offer">Offer</option>
<option value="rejected">Rejected</option>
```

- [ ] **Step 6: Hide crawler-only controls in web mode**

Wrap the three controls in `{!IS_WEB && (...)}`:

- the "Tailor all found" button,
- the "Re-check links" button,
- the entire `hunterRunning ? ... : ...` crawler button block at the end of the header row.

Keep "Clear all" and "Add manually" visible.

- [ ] **Step 7: Build and test**

Run: `npm run build:client`
Run: `npm test --workspace=client`
Expected: both pass.

- [ ] **Step 8: Commit**

```bash
git add client/src/App.jsx
git commit -m "feat(tracker): inline status, notes and web-mode controls" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Web backup tab

**Files:**
- Create: `client/src/SettingsBackup.jsx`
- Modify: `client/src/App.jsx` (tab entry and render)
- Modify: `client/src/web/mode.js` (`WEB_ONLY_SETTINGS`)
- Modify: `client/src/web/mode.test.js`
- Modify: `client/src/web/WebKeyPanel.jsx` (clear feed cache on panic wipe)

**Interfaces:**
- Consumes: `webRuntime.vault.exportAll()` and `.importAll(payload)`.
- Produces: `<SettingsBackup vault toasts onImported />`.

- [ ] **Step 1: Write the failing mode test**

Add to `client/src/web/mode.test.js`:

```js
test('the backup tab is hidden on desktop and shown on web', () => {
  const tabs = [{ id: 'ai' }, { id: 'data' }, { id: 'backup' }];
  assert.deepEqual(filterSettingsTabs(tabs, false).map((tab) => tab.id), ['ai', 'data']);
  assert.deepEqual(filterSettingsTabs(tabs, true).map((tab) => tab.id), ['ai', 'backup']);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test client/src/web/mode.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement the filtering**

```js
export const SERVER_ONLY_SETTINGS = Object.freeze(['answers', 'data']);
export const WEB_ONLY_SETTINGS = Object.freeze(['backup']);

export function filterSettingsTabs(tabs, isWeb) {
  if (isWeb) return tabs.filter((tab) => !SERVER_ONLY_SETTINGS.includes(tab.id));
  return tabs.filter((tab) => !WEB_ONLY_SETTINGS.includes(tab.id));
}
```

- [ ] **Step 4: Create the backup component**

```jsx
// client/src/SettingsBackup.jsx
import React, { useRef, useState } from 'react';
import { AlertTriangle, Download, Loader2, Upload } from 'lucide-react';
import { recordError } from './errors.js';

function countOf(map) {
  return map && typeof map === 'object' ? Object.keys(map).length : 0;
}

export default function SettingsBackup({ vault, toasts, onImported }) {
  const inputRef = useRef(null);
  const [pending, setPending] = useState(null);
  const [summary, setSummary] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function exportAll() {
    setBusy(true);
    setError(null);
    try {
      const payload = await vault.exportAll();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `sajas-backup-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      toasts.success('Backup downloaded. It contains no API key.');
    } catch (issue) {
      setError(recordError(issue, { where: 'export backup' }));
    } finally {
      setBusy(false);
    }
  }

  async function pickFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    setPending(null);
    setConfirmText('');
    try {
      const payload = JSON.parse(await file.text());
      const rows = payload?.data || {};
      setSummary([
        payload?.exportedAt ? `Exported ${new Date(payload.exportedAt).toLocaleString()}.` : 'No export date.',
        `${countOf(rows.profile)} profile, ${countOf(rows.jobs)} jobs, ${countOf(rows.memory)} memory, ${countOf(rows.answers)} answers, ${countOf(rows.usage)} usage records.`
      ].join(' '));
      setPending(payload);
    } catch (issue) {
      setError(recordError(issue, { where: 'read backup' }));
    } finally {
      event.target.value = '';
    }
  }

  async function importAll() {
    if (!pending || confirmText.trim().toLowerCase() !== 'import') return;
    setBusy(true);
    setError(null);
    try {
      await vault.importAll(pending);
      setPending(null);
      setConfirmText('');
      setSummary('');
      toasts.success('Backup restored.');
      onImported?.();
    } catch (issue) {
      setError(recordError(issue, { where: 'import backup' }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h3 style={{ fontSize: 16 }}>Backup and restore</h3>
      <p className="tiny" style={{ marginTop: 4 }}>
        Your data lives only in this browser. Export a JSON backup before clearing site data or moving to another device.
        The file never contains your API key.
      </p>

      {error && (
        <div className="error-card" role="alert" style={{ marginTop: 12 }}>
          <div className="error-card-head">
            <AlertTriangle size={18} color="var(--color-error)" />
            <div>
              <div className="error-card-title">{error.message}</div>
              <div className="error-card-code">{error.code}</div>
            </div>
          </div>
          {error.hint && <p className="error-card-message">{error.hint}</p>}
        </div>
      )}

      <div className="flex-gap" style={{ marginTop: 16, flexWrap: 'wrap' }}>
        <button className="btn-primary" onClick={exportAll} disabled={busy} data-testid="export-backup">
          {busy ? <Loader2 size={14} className="spin" /> : <Download size={14} />} Export backup
        </button>
        <button className="btn-secondary" onClick={() => inputRef.current?.click()} disabled={busy} data-testid="import-backup">
          <Upload size={14} /> Choose backup file
        </button>
        <input ref={inputRef} type="file" accept="application/json,.json" hidden onChange={pickFile} data-testid="import-file" />
      </div>

      {pending && (
        <div style={{ marginTop: 18, padding: 14, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-surface-2)' }}>
          <p style={{ fontSize: 13 }}>{summary}</p>
          <p className="tiny" style={{ marginTop: 8, color: 'var(--color-warning)' }}>
            Restoring replaces every profile, job, note, and answer currently in this browser. Export first if you are unsure.
          </p>
          <label style={{ marginTop: 12 }}>Type import to confirm</label>
          <input value={confirmText} onChange={(event) => setConfirmText(event.target.value)} placeholder="import" data-testid="import-confirm-text" />
          <div className="flex-gap" style={{ marginTop: 10 }}>
            <button className="btn-danger" onClick={importAll} disabled={busy || confirmText.trim().toLowerCase() !== 'import'} data-testid="import-confirm">
              {busy ? <Loader2 size={14} className="spin" /> : null} Replace this browser's data
            </button>
            <button className="btn-ghost" onClick={() => { setPending(null); setSummary(''); setConfirmText(''); }}>Cancel</button>
          </div>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 5: Wire the tab**

In `App.jsx`:

1. `import SettingsBackup from './SettingsBackup.jsx';`
2. Add to the settings tabs array: `{ id: 'backup', label: 'Backup', icon: <ShieldCheck size={13} /> }`.
3. Render after the `data` block:

```jsx
{IS_WEB && settingsTab === 'backup' && (
  <SettingsBackup vault={webRuntime.vault} toasts={toasts} onImported={refreshAll} />
)}
```

- [ ] **Step 6: Clear the feed cache on panic wipe**

In `WebKeyPanel.jsx`, import `clearFeedCache` from `./feeds.js` and call it after `await runtime.keyStore.panicWipe();`:

```js
clearFeedCache();
```

- [ ] **Step 7: Run client tests and build**

Run: `npm test --workspace=client`
Run: `npm run build:web`
Expected: both pass.

- [ ] **Step 8: Commit**

```bash
git add client/src/SettingsBackup.jsx client/src/App.jsx client/src/web/mode.js client/src/web/mode.test.js client/src/web/WebKeyPanel.jsx
git commit -m "feat(web): backup tab and feed cache clear on panic wipe" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Offline E2E, docs, and gates

**Files:**
- Create: `scripts/web-feeds.mjs`
- Modify: `package.json` (`test:web`)
- Modify: `README.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: the built `client/dist` and `scripts/lib/staticServer.mjs`.
- Produces: an offline Playwright test that proves the feed, tracker, and backup flows.

- [ ] **Step 1: Read the existing canary setup**

Read `scripts/web-canary.mjs` lines 1 to 260. Reuse its `startStaticServer`, its built-dist check, and its Playwright launch pattern. The new script must not import from the canary.

- [ ] **Step 2: Create `scripts/web-feeds.mjs`**

The script must:

1. Fail with a clear message if `client/dist/index.html` is missing.
2. Start the static server.
3. Launch Chromium.
4. Route all requests with `page.route('**/*', ...)`:
   - local server: `continue`;
   - `https://remotive.com/api/remote-jobs`: fulfill with the Remotive fixture;
   - `https://www.arbeitnow.com/api/job-board-api`: fulfill with the Arbeitnow fixture;
   - `https://jobicy.com/api/v2/remote-jobs`: fulfill with the Jobicy fixture;
   - everything else: `abort('blockedbyclient')` and record it.
5. Complete onboarding without a key. Read `client/src/web/WebStartup.jsx` for the exact test ids; if it requires a key choice, choose the skip or continue-without-key path.
6. Open Job Feeds and assert:
   - the three cards are visible (`feed-source-remotive`, `feed-source-arbeitnow`, `feed-source-jobicy`);
   - `feed-row-0` exists.
7. Click `add-job-0`, wait for the button to read `In tracker`, open the tracker tab, and assert the job title is present.
8. Change `job-status` to `interviewing`, reload, open the tracker, and assert the select still reads `interviewing`.
9. Add a note, save it, reload, reopen the editor, and assert the text is still there.
10. Export the backup and assert the download contains the job and no `keyVault`.
11. Panic wipe, import the downloaded file, and assert the job is back.
12. Assert no request reached an origin outside the local server and the three mocked feeds.
13. Print `web-feeds: PASS` and exit 0.

Use `assert` from `node:assert/strict` and a single `try/finally` that closes the browser and the server.

- [ ] **Step 3: Wire the script into `test:web`**

```json
"test:web": "node scripts/web-canary.mjs && node scripts/web-feeds.mjs"
```

- [ ] **Step 4: Run it**

Run: `npm run build:web && npm run test:web`
Expected: both scripts print PASS. Fix the script only when the script itself is wrong. Any app failure is a real bug.

- [ ] **Step 5: Update the docs**

`README.md`, under `## Hosted web app (alpha)`, add a `### Job feeds and tracker` subsection:

- The three feeds are public and keyless.
- Jobs are filtered in the browser; no profile data is sent.
- Up to 300 rows per feed, refreshed at most every 15 minutes unless you press Refresh.
- Statuses and notes are local; export a backup before clearing site data.
- The backup file never contains the API key.

`CLAUDE.md`, under `## Web mode`, add:

- Feed code lives in `packages/core/src/feeds/` (pure) and `client/src/web/feeds.js` (network).
- The job feeds tab and the backup tab are web-only.
- `clearFeedCache()` must run on panic wipe.
- The web port accepts only `status`, `notes`, `applyUrl`, and `description` on job updates.

- [ ] **Step 6: Run every gate from `sa-job-agent-suite/`**

```bash
npm test
npm run test:demo
npm run build:client
npm run build:web
npm run test:web
node tools/check-secrets.mjs --all
```

Expected: all exit 0, both E2E scripts PASS, no key-shaped strings.

- [ ] **Step 7: Commit**

```bash
git add scripts/web-feeds.mjs package.json README.md CLAUDE.md
git commit -m "test(web): offline feeds, tracker and backup E2E; document web feeds" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 8: Open the PR and merge when green**

```bash
git push -u origin feat/m3a3-feeds-tracker
gh pr create --title "feat(web): job feeds, dedupe and tracker upgrades" --body "<summary, test plan, screenshots if available>"
gh pr checks --watch
gh pr merge --squash
```

- [ ] **Step 9: Deploy and verify once by hand**

After the merge, deploy the merged `main` to Cloudflare Pages, then open the live URL and fetch the real feeds once. Add one real job. This is the spec's manual acceptance criterion. Do not add live feeds to CI.

