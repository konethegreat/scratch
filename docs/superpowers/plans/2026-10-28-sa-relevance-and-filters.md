# South Africa Relevance and Search Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every job the candidate sees is South African or clearly labelled as unconfirmed, and the job list can be narrowed by province, source, status, match score, link health, remote, and date added, with filters that persist.

**Architecture:** One pure location classifier and one pure view-filter module in `packages/core/src/jobs/`, consumed by the hunter, the feeds, and both job views. The client only stores filter state and renders controls. Foreign jobs already stored are hidden, counted, and revealable; nothing is deleted.

**Tech Stack:** Node >= 22.12 ESM, `node:test`, React 18 + Vite 7, Express 4, Playwright E2E, IndexedDB web vault, localStorage for view filters.

**Spec:** [`docs/superpowers/specs/2026-10-28-sa-relevance-and-filters-design.md`](../specs/2026-10-28-sa-relevance-and-filters-design.md)

## Global Constraints

- Run every npm command from `sa-job-agent-suite/` unless the step says otherwise.
- Never set or need `ANTHROPIC_API_KEY`; every test is offline with fixtures or `fakeClient`.
- Never run `npm run smoke:live` or `evals/run.mjs --live`.
- No provider names outside `server/src/db/migrations.js`; no model-ID literals outside `packages/core/src/models.js` and `*.test.js`.
- `X-SAJAS-Client: 1` on every non-GET desktop request (the existing `postJson` helper already does this).
- No em dashes in copy, docs, or commit messages.
- Never use `--no-verify`; the secret scanner must pass.
- One branch (`arc-6-sa-relevance-filters`), one PR, one deploy, one live check.
- Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

---

## File Structure

Create:

- `sa-job-agent-suite/packages/core/src/text.js`: shared normalization used by feeds and jobs.
- `sa-job-agent-suite/packages/core/src/jobs/location.js`: SA location classifier and job helpers.
- `sa-job-agent-suite/packages/core/src/jobs/location.test.js`: 40+ classifier cases.
- `sa-job-agent-suite/packages/core/src/jobs/viewFilters.js`: filter state contract and pure filtering.
- `sa-job-agent-suite/packages/core/src/jobs/viewFilters.test.js`: filter matrix and malformed input.
- `sa-job-agent-suite/packages/core/src/jobs/index.js`: subpath barrel.
- `sa-job-agent-suite/server/src/agents/jobLocationGate.js`: hunter gate.
- `sa-job-agent-suite/server/src/agents/jobLocationGate.test.js`: strict/soft/none matrix.
- `sa-job-agent-suite/client/src/jobFilters.js`: localStorage load/save.
- `sa-job-agent-suite/client/src/JobFilters.jsx`: filter bar.
- `sa-job-agent-suite/scripts/web-filters.mjs`: browser proof.

Modify:

- `sa-job-agent-suite/packages/core/package.json`: add `./jobs` export.
- `sa-job-agent-suite/packages/core/src/feeds/match.js`: import shared normalize, add `saOnly`.
- `sa-job-agent-suite/packages/core/src/feeds/match.test.js`: new default.
- `sa-job-agent-suite/server/src/agents/agent1-hunter.js`: remove old location list, gate AI and source jobs.
- `sa-job-agent-suite/server/src/db/helper.js`: `feedSaOnly: true`.
- `sa-job-agent-suite/server/src/index.js`: profile whitelist.
- `sa-job-agent-suite/server/src/errorRoutes.test.js`: profile round trip.
- `sa-job-agent-suite/client/src/App.jsx`: filter state, table, empty state.
- `sa-job-agent-suite/client/src/index.css`: filter bar styles.
- `sa-job-agent-suite/client/src/JobFeeds.jsx`: SA only control and count.
- `sa-job-agent-suite/scripts/web-feeds.mjs`: new default assertions.
- `sa-job-agent-suite/package.json`: add `web-filters` to `test:web`.
- `README.md`: feature bullet.
- `docs/superpowers/specs/2026-10-27-post-m3a3-pipeline.md`: insert Arc 6 and 7, renumber.
- `docs/superpowers/specs/2026-10-28-sa-relevance-and-filters-design.md`: status to shipped after deploy.

---

### Task 1: Core location classifier

**Files:**
- Create: `packages/core/src/text.js`
- Create: `packages/core/src/jobs/location.js`
- Create: `packages/core/src/jobs/location.test.js`
- Modify: `packages/core/src/feeds/match.js:1-12`

**Interfaces:**
- Consumes: nothing.
- Produces: `normalizeText(value)` from `../text.js`; `PROVINCES`, `classifyLocation(raw)`, `isSouthAfrican(raw, { strict })`, `jobLocationVerdict(job)`, `jobProvince(job)`, `jobRemote(job)`, `countForeignJobs(jobs)` from `./location.js`.

- [ ] **Step 1: Write the failing classifier test**

Create `packages/core/src/jobs/location.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROVINCES, classifyLocation, isSouthAfrican, jobLocationVerdict,
  jobProvince, jobRemote, countForeignJobs
} from './location.js';

const verdict = (raw) => classifyLocation(raw).verdict;

test('PROVINCES lists the nine provinces', () => {
  assert.equal(PROVINCES.length, 9);
  assert.ok(PROVINCES.includes('Gauteng'));
  assert.ok(PROVINCES.includes('North West'));
});

test('blank and malformed input is unknown and never throws', () => {
  for (const raw of ['', '   ', null, undefined, 42, {}, []]) {
    assert.equal(verdict(raw), 'unknown');
  }
  assert.equal(classifyLocation('').reason, 'blank');
});

test('South Africa country signals win outright', () => {
  assert.equal(verdict('South Africa'), 'sa');
  assert.equal(classifyLocation('South Africa').reason, 'country');
  assert.equal(verdict('south african'), 'sa');
  assert.equal(verdict('RSA'), 'sa');
  assert.equal(verdict('Cape Town, ZA'), 'sa');
  assert.equal(verdict('Remote, SA'), 'sa');
  assert.equal(verdict('Johannesburg or London'), 'sa');
  assert.equal(verdict('Gauteng, London'), 'sa');
});

test('unique provinces and their cities classify as SA', () => {
  assert.equal(verdict('Gauteng'), 'sa');
  assert.equal(verdict('Western Cape'), 'sa');
  assert.equal(verdict('KwaZulu-Natal'), 'sa');
  assert.equal(verdict('KZN'), 'sa');
  assert.equal(verdict('Free State'), 'sa');
  assert.equal(verdict('Limpopo'), 'sa');
  assert.equal(verdict('Mpumalanga'), 'sa');
  assert.equal(verdict('Northern Cape'), 'sa');
  assert.equal(verdict('Eastern Cape'), 'sa');
  for (const city of ['Johannesburg', 'Cape Town', 'Durban', 'Pretoria', 'Gqeberha',
    'Bloemfontein', 'Polokwane', 'Mbombela', 'Nelspruit', 'Port Elizabeth',
    'Pietermaritzburg', 'Rustenburg', 'Potchefstroom', 'Soweto', 'Sandton',
    'Midrand', 'Centurion', 'Stellenbosch', 'Paarl', 'Welkom', 'Mthatha',
    'Thohoyandou', 'Vereeniging', 'Vanderbijlpark', 'Alberton', 'Benoni',
    'Boksburg', 'Germiston', 'Randburg', 'Roodepoort', 'Tembisa', 'Edenvale',
    'Kempton Park']) {
    assert.equal(verdict(city), 'sa', city);
  }
  assert.equal(classifyLocation('Cape Town').province, 'Western Cape');
  assert.equal(classifyLocation('Cape Town').place, 'Cape Town');
});

test('a strong foreign signal beats a unique SA city', () => {
  assert.equal(verdict('East London, UK'), 'foreign');
  assert.equal(verdict('Durban, France'), 'foreign');
  assert.equal(verdict('Cape Town, US'), 'foreign');
  assert.equal(verdict('Johannesburg, United States'), 'foreign');
});

test('a unique SA city beats a foreign city', () => {
  assert.equal(verdict('East London'), 'sa');
  assert.equal(verdict('East London, Eastern Cape'), 'sa');
  assert.equal(verdict('Cape Town, London'), 'sa');
});

test('foreign countries, regions, states and cities are foreign', () => {
  for (const raw of ['London', 'Berlin', 'Lagos', 'Dubai', 'New York', 'Paris',
    'Nairobi, Kenya', 'Mumbai', 'Manila', 'Toronto', 'Sydney', 'Austin',
    'Remote - Europe', 'EMEA', 'APAC', 'California', 'Texas', 'Virginia',
    'British Columbia', 'New South Wales', 'Georgia', 'Washington']) {
    assert.equal(verdict(raw), 'foreign', raw);
  }
  assert.equal(verdict('US'), 'foreign');
  assert.equal(verdict('Lagos, Nigeria'), 'foreign');
});

test('ambiguous SA names are SA without a foreign signal and foreign with one', () => {
  for (const name of ['Springs', 'George', 'Worcester', 'Kimberley', 'Middelburg',
    'Queenstown', 'Newcastle', 'Ladysmith', 'Richmond', 'Phoenix', 'Wellington',
    'Bethlehem', 'Heidelberg', 'North West']) {
    assert.equal(verdict(name), 'sa', name);
  }
  assert.equal(classifyLocation('Springs').reason, 'ambiguous');
  assert.equal(verdict('Springs, Gauteng'), 'sa');
  assert.equal(verdict('North West'), 'sa');
  for (const raw of ['Springs, California', 'Palm Springs', 'Richmond, Virginia',
    'Phoenix, Arizona', 'Newcastle, Australia', 'Queenstown, New Zealand',
    'Wellington, New Zealand', 'Worcester, UK', 'Kimberley, British Columbia',
    'Middelburg, Netherlands', 'George, Washington', 'Heidelberg, Germany',
    'Bethlehem, Pennsylvania', 'Ladysmith, British Columbia',
    'North West England']) {
    assert.equal(verdict(raw), 'foreign', raw);
  }
});

test('worldwide is foreign and bare remote is unknown', () => {
  assert.equal(verdict('Remote (Worldwide)'), 'foreign');
  assert.equal(classifyLocation('Remote (Worldwide)').reason, 'worldwide');
  assert.equal(verdict('Anywhere'), 'foreign');
  assert.equal(verdict('Global'), 'foreign');
  assert.equal(verdict('Remote'), 'unknown');
  assert.equal(classifyLocation('Remote').reason, 'remote-unstated');
  assert.equal(verdict('Hybrid'), 'unknown');
  assert.equal(verdict('Work from home'), 'unknown');
});

test('token matching never fires inside an unrelated word', () => {
  assert.equal(verdict('Business Analyst'), 'unknown');
  assert.equal(verdict('Customer Success'), 'unknown');
  assert.equal(verdict('Auditor'), 'unknown');
  assert.equal(classifyLocation('Business Analyst').reason, 'unrecognised');
});

test('remote is reported independently of the verdict', () => {
  assert.equal(classifyLocation('Remote (Worldwide)').remote, true);
  assert.equal(classifyLocation('Cape Town, remote').remote, true);
  assert.equal(classifyLocation('Cape Town').remote, false);
});

test('isSouthAfrican applies strict and lenient policy', () => {
  assert.equal(isSouthAfrican('Cape Town'), true);
  assert.equal(isSouthAfrican('Cape Town', { strict: true }), true);
  assert.equal(isSouthAfrican('Somewhereville'), true);
  assert.equal(isSouthAfrican('Somewhereville', { strict: true }), false);
  assert.equal(isSouthAfrican('London'), false);
  assert.equal(isSouthAfrican('London', { strict: true }), false);
});

test('job helpers trust stored fields and classify when absent', () => {
  assert.equal(jobLocationVerdict({ location: 'Cape Town' }), 'sa');
  assert.equal(jobLocationVerdict({ locationVerdict: 'foreign', location: 'Cape Town' }), 'foreign');
  assert.equal(jobLocationVerdict({ locationVerdict: 'bogus', location: 'Cape Town' }), 'sa');
  assert.equal(jobProvince({ province: 'Gauteng', location: 'London' }), 'Gauteng');
  assert.equal(jobProvince({ location: 'Durban' }), 'KwaZulu-Natal');
  assert.equal(jobRemote({ remote: true, location: 'Cape Town' }), true);
  assert.equal(jobRemote({ location: 'Remote' }), true);
  assert.equal(countForeignJobs([
    { location: 'Cape Town' }, { location: 'London' }, { location: 'Remote' }, { location: 'Berlin' }
  ]), 2);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd sa-job-agent-suite
npm test --workspace=@sajas/core
```

Expected: FAIL with `Cannot find module './location.js'`.

- [ ] **Step 3: Create the shared text helper and point the feed matcher at it**

Create `packages/core/src/text.js`:

```js
export function normalizeText(value) {
  return String(value == null ? '' : value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
```

In `packages/core/src/feeds/match.js`, replace the existing `export function normalizeText` block with:

```js
import { normalizeText } from '../text.js';

export { normalizeText };
```

Keep the rest of the file unchanged for now.

- [ ] **Step 4: Create the classifier**

Create `packages/core/src/jobs/location.js`:

```js
// South Africa location classification for the hunter, the feeds and both job
// views. Pure and total: it never throws and it never touches the network.
import { normalizeText } from '../text.js';

export const PROVINCES = Object.freeze([
  'Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal', 'Limpopo',
  'Mpumalanga', 'Northern Cape', 'North West', 'Western Cape'
]);

const SA_COUNTRY_TERMS = Object.freeze(['south africa', 'south african', 'rsa']);

const UNIQUE_PROVINCES = Object.freeze([
  ['gauteng', 'Gauteng'],
  ['western cape', 'Western Cape'],
  ['eastern cape', 'Eastern Cape'],
  ['kwazulu natal', 'KwaZulu-Natal'],
  ['kzn', 'KwaZulu-Natal'],
  ['free state', 'Free State'],
  ['limpopo', 'Limpopo'],
  ['mpumalanga', 'Mpumalanga'],
  ['northern cape', 'Northern Cape']
]);

const AMBIGUOUS_PROVINCES = Object.freeze([
  ['north west', 'North West']
]);

const UNIQUE_CITIES = Object.freeze([
  ['johannesburg', 'Johannesburg', 'Gauteng'],
  ['sandton', 'Sandton', 'Gauteng'],
  ['midrand', 'Midrand', 'Gauteng'],
  ['centurion', 'Centurion', 'Gauteng'],
  ['soweto', 'Soweto', 'Gauteng'],
  ['roodepoort', 'Roodepoort', 'Gauteng'],
  ['boksburg', 'Boksburg', 'Gauteng'],
  ['germiston', 'Germiston', 'Gauteng'],
  ['benoni', 'Benoni', 'Gauteng'],
  ['randburg', 'Randburg', 'Gauteng'],
  ['tembisa', 'Tembisa', 'Gauteng'],
  ['edenvale', 'Edenvale', 'Gauteng'],
  ['kempton park', 'Kempton Park', 'Gauteng'],
  ['pretoria', 'Pretoria', 'Gauteng'],
  ['vereeniging', 'Vereeniging', 'Gauteng'],
  ['vanderbijlpark', 'Vanderbijlpark', 'Gauteng'],
  ['alberton', 'Alberton', 'Gauteng'],
  ['cape town', 'Cape Town', 'Western Cape'],
  ['stellenbosch', 'Stellenbosch', 'Western Cape'],
  ['paarl', 'Paarl', 'Western Cape'],
  ['durban', 'Durban', 'KwaZulu-Natal'],
  ['pietermaritzburg', 'Pietermaritzburg', 'KwaZulu-Natal'],
  ['port elizabeth', 'Port Elizabeth', 'Eastern Cape'],
  ['gqeberha', 'Gqeberha', 'Eastern Cape'],
  ['east london', 'East London', 'Eastern Cape'],
  ['mthatha', 'Mthatha', 'Eastern Cape'],
  ['bloemfontein', 'Bloemfontein', 'Free State'],
  ['welkom', 'Welkom', 'Free State'],
  ['polokwane', 'Polokwane', 'Limpopo'],
  ['thohoyandou', 'Thohoyandou', 'Limpopo'],
  ['nelspruit', 'Nelspruit', 'Mpumalanga'],
  ['mbombela', 'Mbombela', 'Mpumalanga'],
  ['rustenburg', 'Rustenburg', 'North West'],
  ['potchefstroom', 'Potchefstroom', 'North West']
]);

// Real SA places whose names are also well-known places elsewhere. They are
// checked only after every foreign signal, so "Richmond, Virginia" is foreign
// while bare "Richmond" is SA.
const AMBIGUOUS_CITIES = Object.freeze([
  ['springs', 'Springs', 'Gauteng'],
  ['george', 'George', 'Western Cape'],
  ['worcester', 'Worcester', 'Western Cape'],
  ['kimberley', 'Kimberley', 'Northern Cape'],
  ['middelburg', 'Middelburg', 'Mpumalanga'],
  ['queenstown', 'Queenstown', 'Eastern Cape'],
  ['newcastle', 'Newcastle', 'KwaZulu-Natal'],
  ['ladysmith', 'Ladysmith', 'KwaZulu-Natal'],
  ['richmond', 'Richmond', 'KwaZulu-Natal'],
  ['phoenix', 'Phoenix', 'KwaZulu-Natal'],
  ['wellington', 'Wellington', 'Western Cape'],
  ['bethlehem', 'Bethlehem', 'Free State'],
  ['heidelberg', 'Heidelberg', 'Gauteng']
]);

const FOREIGN_STRONG = Object.freeze([
  'united states', 'usa', 'america', 'united kingdom', 'uk', 'england',
  'scotland', 'wales', 'northern ireland', 'ireland', 'canada', 'australia',
  'new zealand', 'germany', 'france', 'netherlands', 'belgium', 'spain',
  'portugal', 'italy', 'switzerland', 'austria', 'poland', 'sweden', 'norway',
  'denmark', 'finland', 'india', 'pakistan', 'bangladesh', 'sri lanka', 'china',
  'japan', 'south korea', 'korea', 'singapore', 'malaysia', 'indonesia',
  'philippines', 'vietnam', 'thailand', 'nigeria', 'kenya', 'ghana', 'egypt',
  'morocco', 'tunisia', 'zimbabwe', 'zambia', 'botswana', 'namibia',
  'mozambique', 'mauritius', 'uganda', 'tanzania', 'rwanda', 'ethiopia',
  'senegal', 'cameroon', 'brazil', 'argentina', 'chile', 'colombia', 'peru',
  'mexico', 'israel', 'turkey', 'saudi arabia', 'qatar', 'kuwait', 'bahrain',
  'oman', 'united arab emirates', 'uae', 'europe', 'emea', 'apac', 'asia',
  'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado',
  'connecticut', 'delaware', 'florida', 'hawaii', 'idaho', 'illinois',
  'indiana', 'iowa', 'kansas', 'kentucky', 'louisiana', 'maine', 'maryland',
  'massachusetts', 'michigan', 'minnesota', 'mississippi', 'missouri',
  'montana', 'nebraska', 'nevada', 'new hampshire', 'new jersey', 'new mexico',
  'new york', 'north carolina', 'north dakota', 'ohio', 'oklahoma', 'oregon',
  'pennsylvania', 'rhode island', 'south carolina', 'south dakota', 'tennessee',
  'texas', 'utah', 'vermont', 'virginia', 'washington', 'west virginia',
  'wisconsin', 'wyoming', 'georgia', 'alberta', 'british columbia', 'manitoba',
  'new brunswick', 'newfoundland', 'nova scotia', 'ontario',
  'prince edward island', 'quebec', 'saskatchewan', 'new south wales',
  'queensland', 'south australia', 'tasmania', 'western australia'
]);

const FOREIGN_CITIES = Object.freeze([
  'london', 'manchester', 'birmingham', 'leeds', 'glasgow', 'edinburgh',
  'dublin', 'berlin', 'munich', 'hamburg', 'frankfurt', 'paris', 'lyon',
  'amsterdam', 'rotterdam', 'brussels', 'madrid', 'barcelona', 'lisbon',
  'rome', 'milan', 'zurich', 'geneva', 'vienna', 'warsaw', 'prague',
  'budapest', 'stockholm', 'oslo', 'copenhagen', 'helsinki', 'moscow',
  'istanbul', 'athens', 'dubai', 'abu dhabi', 'doha', 'riyadh', 'tel aviv',
  'mumbai', 'delhi', 'new delhi', 'bangalore', 'bengaluru', 'hyderabad',
  'chennai', 'pune', 'kolkata', 'karachi', 'lahore', 'dhaka', 'colombo',
  'kuala lumpur', 'jakarta', 'manila', 'bangkok', 'hanoi', 'ho chi minh',
  'beijing', 'shanghai', 'shenzhen', 'hong kong', 'tokyo', 'osaka', 'seoul',
  'sydney', 'melbourne', 'brisbane', 'perth', 'adelaide', 'auckland',
  'toronto', 'vancouver', 'montreal', 'ottawa', 'calgary', 'edmonton',
  'new york city', 'los angeles', 'san francisco', 'chicago', 'boston',
  'seattle', 'austin', 'dallas', 'houston', 'miami', 'atlanta', 'denver',
  'palm springs', 'lagos', 'abuja', 'nairobi', 'accra', 'cairo', 'casablanca',
  'tunis', 'kampala', 'kigali', 'dar es salaam', 'lusaka', 'harare',
  'gaborone', 'windhoek', 'maputo', 'port louis', 'sao paulo',
  'rio de janeiro', 'buenos aires', 'santiago', 'bogota', 'lima', 'mexico city'
]);

const WORLDWIDE_TERMS = Object.freeze(['worldwide', 'anywhere', 'global']);
const REMOTE_TERMS = Object.freeze([
  'remote', 'work from home', 'wfh', 'hybrid', 'telecommute', 'home based'
]);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function phrasePattern(phrase) {
  const parts = normalizeText(phrase).split(' ').filter(Boolean);
  if (!parts.length) return null;
  return new RegExp(`(?:^|\\s)${parts.map(escapeRegExp).join('\\s+')}(?:\\s|$)`);
}

function hasPhrase(text, phrase) {
  const pattern = phrasePattern(phrase);
  return Boolean(pattern && pattern.test(text));
}

function hasAny(text, terms) {
  return terms.some((term) => hasPhrase(text, term));
}

function hasTrailingCode(raw, code) {
  const parts = String(raw == null ? '' : raw).split(',');
  if (parts.length < 2) return false;
  return normalizeText(parts[parts.length - 1]) === code;
}

function firstMatch(text, entries) {
  for (const entry of entries) {
    if (hasPhrase(text, entry[0])) return entry;
  }
  return null;
}

function uniqueProvinceOf(text) {
  const hit = firstMatch(text, UNIQUE_PROVINCES);
  return hit ? hit[1] : null;
}

function uniqueCityOf(text) {
  const hit = firstMatch(text, UNIQUE_CITIES);
  return hit ? { place: hit[1], province: hit[2] } : null;
}

function ambiguousPlaceOf(text) {
  const provinceHit = firstMatch(text, AMBIGUOUS_PROVINCES);
  if (provinceHit) return { place: null, province: provinceHit[1] };
  const cityHit = firstMatch(text, AMBIGUOUS_CITIES);
  if (cityHit) return { place: cityHit[1], province: cityHit[2] };
  return null;
}

function strongForeign(text, raw) {
  return text === 'us' || hasAny(text, FOREIGN_STRONG) || hasTrailingCode(raw, 'us');
}

function anyForeign(text, raw) {
  return strongForeign(text, raw) || hasAny(text, FOREIGN_CITIES);
}

function make(verdict, province, place, remote, reason) {
  return { verdict, province: province || null, place: place || null, remote, reason };
}

export function classifyLocation(raw) {
  const text = normalizeText(raw);
  const remote = hasAny(text, REMOTE_TERMS);
  if (!text) return make('unknown', null, null, remote, 'blank');

  if (hasAny(text, SA_COUNTRY_TERMS) || hasPhrase(text, 'sa') || hasPhrase(text, 'za')) {
    const ambiguous = ambiguousPlaceOf(text);
    const city = uniqueCityOf(text);
    return make(
      'sa',
      uniqueProvinceOf(text) || ambiguous?.province || null,
      city?.place || ambiguous?.place || null,
      remote,
      'country'
    );
  }

  const province = uniqueProvinceOf(text);
  if (province) {
    return make('sa', province, uniqueCityOf(text)?.place || null, remote, 'province');
  }

  const city = uniqueCityOf(text);
  if (city && strongForeign(text, raw)) return make('foreign', null, null, remote, 'foreign');
  if (city) return make('sa', city.province, city.place, remote, 'city');

  if (anyForeign(text, raw)) return make('foreign', null, null, remote, 'foreign');

  const ambiguous = ambiguousPlaceOf(text);
  if (ambiguous) return make('sa', ambiguous.province, ambiguous.place, remote, 'ambiguous');

  if (hasAny(text, WORLDWIDE_TERMS)) return make('foreign', null, null, remote, 'worldwide');
  if (remote) return make('unknown', null, null, remote, 'remote-unstated');
  return make('unknown', null, null, remote, 'unrecognised');
}

export function isSouthAfrican(raw, { strict = false } = {}) {
  const value = classifyLocation(raw).verdict;
  return value === 'sa' || (!strict && value === 'unknown');
}

const VERDICTS = new Set(['sa', 'foreign', 'unknown']);

export function jobLocationVerdict(job) {
  if (job && VERDICTS.has(job.locationVerdict)) return job.locationVerdict;
  return classifyLocation(job?.location).verdict;
}

export function jobProvince(job) {
  if (job?.province) return job.province;
  return classifyLocation(job?.location).province;
}

export function jobRemote(job) {
  if (typeof job?.remote === 'boolean') return job.remote;
  return classifyLocation(job?.location).remote;
}

export function countForeignJobs(jobs = []) {
  return jobs.reduce((count, job) => count + (jobLocationVerdict(job) === 'foreign' ? 1 : 0), 0);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd sa-job-agent-suite
npm test --workspace=@sajas/core
```

Expected: PASS, including every existing feeds test.

- [ ] **Step 6: Commit**

```bash
git add sa-job-agent-suite/packages/core/src/text.js \
  sa-job-agent-suite/packages/core/src/jobs/location.js \
  sa-job-agent-suite/packages/core/src/jobs/location.test.js \
  sa-job-agent-suite/packages/core/src/feeds/match.js
git commit -m "$(cat <<'EOF'
feat(core): add the South Africa location classifier

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: View filters and the `@sajas/core/jobs` export

**Files:**
- Create: `packages/core/src/jobs/viewFilters.js`
- Create: `packages/core/src/jobs/viewFilters.test.js`
- Create: `packages/core/src/jobs/index.js`
- Modify: `packages/core/package.json:15`

**Interfaces:**
- Consumes: `jobLocationVerdict`, `jobProvince`, `jobRemote` from `./location.js`.
- Produces: `DEFAULT_VIEW_FILTERS`, `normalizeViewFilters(input)`, `filterJobsForView(jobs, filters, now)`, `activeFilterCount(filters)` from `@sajas/core/jobs`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/jobs/viewFilters.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_VIEW_FILTERS, normalizeViewFilters, filterJobsForView, activeFilterCount
} from './viewFilters.js';

const NOW = Date.parse('2026-10-28T12:00:00.000Z');

const job = (over = {}) => ({
  id: 'j1', title: 'Backend Developer', company: 'Acme', location: 'Cape Town',
  source: 'PNet', status: 'found', matchScore: 90, linkStatus: 'live',
  dateAdded: '2026-10-27', ...over
});

test('defaults are South Africa only and otherwise open', () => {
  assert.equal(DEFAULT_VIEW_FILTERS.saOnly, true);
  assert.deepEqual(normalizeViewFilters(undefined), { ...DEFAULT_VIEW_FILTERS });
});

test('normalizeViewFilters is total and rejects bad input', () => {
  assert.deepEqual(normalizeViewFilters(null), { ...DEFAULT_VIEW_FILTERS });
  assert.deepEqual(normalizeViewFilters('nonsense'), { ...DEFAULT_VIEW_FILTERS });
  assert.equal(normalizeViewFilters({ q: 42 }).q, '');
  assert.equal(normalizeViewFilters({ status: 'ghost' }).status, 'all');
  assert.equal(normalizeViewFilters({ province: 'Ghost' }).province, 'all');
  assert.equal(normalizeViewFilters({ province: 'Gauteng' }).province, 'Gauteng');
  assert.equal(normalizeViewFilters({ minScore: 'high' }).minScore, 0);
  assert.equal(normalizeViewFilters({ minScore: 240 }).minScore, 100);
  assert.equal(normalizeViewFilters({ minScore: -8 }).minScore, 0);
  assert.equal(normalizeViewFilters({ addedWithin: '99' }).addedWithin, 'any');
  assert.equal(normalizeViewFilters({ link: 'maybe' }).link, 'all');
  assert.equal(normalizeViewFilters({ remoteOnly: 'yes' }).remoteOnly, false);
  assert.equal(normalizeViewFilters({ saOnly: 'no' }).saOnly, true);
  assert.equal(normalizeViewFilters({ saOnly: false }).saOnly, false);
  assert.equal(normalizeViewFilters({ q: 'x'.repeat(500) }).q.length, 200);
});

test('foreign jobs are hidden and counted by default', () => {
  const rows = [job(), job({ id: 'j2', location: 'London, UK' })];
  const result = filterJobsForView(rows, DEFAULT_VIEW_FILTERS, NOW);
  assert.equal(result.visible.length, 1);
  assert.equal(result.hiddenForeign, 1);
  assert.equal(result.total, 2);
});

test('saOnly false reveals foreign jobs', () => {
  const rows = [job(), job({ id: 'j2', location: 'London, UK' })];
  const result = filterJobsForView(rows, { ...DEFAULT_VIEW_FILTERS, saOnly: false }, NOW);
  assert.equal(result.visible.length, 2);
  assert.equal(result.hiddenForeign, 0);
});

test('unknown locations stay visible', () => {
  const result = filterJobsForView([job({ location: 'Somewhereville' })], DEFAULT_VIEW_FILTERS, NOW);
  assert.equal(result.visible.length, 1);
});

test('search matches title, company, location and source', () => {
  const rows = [job(), job({ id: 'j2', title: 'Data Analyst', company: 'Beta', location: 'Durban', source: 'Indeed' })];
  assert.equal(filterJobsForView(rows, { q: 'analyst' }, NOW).visible.length, 1);
  assert.equal(filterJobsForView(rows, { q: 'beta' }, NOW).visible.length, 1);
  assert.equal(filterJobsForView(rows, { q: 'durban' }, NOW).visible.length, 1);
  assert.equal(filterJobsForView(rows, { q: 'indeed' }, NOW).visible.length, 1);
  assert.equal(filterJobsForView(rows, { q: 'zzz' }, NOW).visible.length, 0);
});

test('status, province and source filters combine', () => {
  const rows = [
    job(),
    job({ id: 'j2', location: 'Johannesburg', status: 'applied', source: 'Indeed' }),
    job({ id: 'j3', location: 'Durban', status: 'applied', source: 'PNet' })
  ];
  assert.equal(filterJobsForView(rows, { status: 'applied' }, NOW).visible.length, 2);
  assert.equal(filterJobsForView(rows, { province: 'Gauteng' }, NOW).visible.length, 1);
  assert.equal(filterJobsForView(rows, { province: 'KwaZulu-Natal' }, NOW).visible.length, 1);
  assert.equal(filterJobsForView(rows, { source: 'Indeed' }, NOW).visible.length, 1);
  assert.equal(filterJobsForView(rows, { status: 'applied', source: 'PNet' }, NOW).visible.length, 1);
});

test('stored province is trusted over the location text', () => {
  const result = filterJobsForView(
    [job({ location: 'London', province: 'Gauteng', locationVerdict: 'sa' })],
    { province: 'Gauteng' },
    NOW
  );
  assert.equal(result.visible.length, 1);
});

test('score, link, remote and date filters work', () => {
  const rows = [
    job(),
    job({ id: 'j2', matchScore: 55, linkStatus: 'dead', location: 'Durban' }),
    job({ id: 'j3', matchScore: 80, linkStatus: undefined, location: 'Remote', remote: true, dateAdded: '2026-10-10' })
  ];
  assert.equal(filterJobsForView(rows, { minScore: 80 }, NOW).visible.length, 2);
  assert.equal(filterJobsForView(rows, { link: 'live' }, NOW).visible.length, 1);
  assert.equal(filterJobsForView(rows, { link: 'no-link' }, NOW).visible.length, 2);
  assert.equal(filterJobsForView(rows, { remoteOnly: true }, NOW).visible.length, 1);
  assert.equal(filterJobsForView(rows, { addedWithin: '7' }, NOW).visible.length, 2);
  assert.equal(filterJobsForView(rows, { addedWithin: '30' }, NOW).visible.length, 3);
});

test('missing or invalid dates are kept only when the date filter is any', () => {
  const rows = [job({ dateAdded: undefined }), job({ id: 'j2', dateAdded: 'not-a-date' })];
  assert.equal(filterJobsForView(rows, { addedWithin: 'any' }, NOW).visible.length, 2);
  assert.equal(filterJobsForView(rows, { addedWithin: '7' }, NOW).visible.length, 0);
});

test('results keep the input order', () => {
  const rows = [job({ id: 'a', matchScore: 10 }), job({ id: 'b', matchScore: 90 })];
  assert.deepEqual(filterJobsForView(rows, {}, NOW).visible.map((row) => row.id), ['a', 'b']);
});

test('activeFilterCount counts deviations from the defaults', () => {
  assert.equal(activeFilterCount(DEFAULT_VIEW_FILTERS), 0);
  assert.equal(activeFilterCount({ q: 'dev' }), 1);
  assert.equal(activeFilterCount({ q: 'dev', minScore: 80, saOnly: false }), 3);
  assert.equal(activeFilterCount({ status: 'all', saOnly: true }), 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd sa-job-agent-suite
npm test --workspace=@sajas/core
```

Expected: FAIL with `Cannot find module './viewFilters.js'`.

- [ ] **Step 3: Implement the module**

Create `packages/core/src/jobs/viewFilters.js`:

```js
// Pure filter contract for both job views. The client stores and renders; this
// module decides what is visible and never mutates a job.
import { PROVINCES, jobLocationVerdict, jobProvince, jobRemote } from './location.js';

export const DEFAULT_VIEW_FILTERS = Object.freeze({
  q: '',
  status: 'all',
  province: 'all',
  source: 'all',
  minScore: 0,
  link: 'all',
  remoteOnly: false,
  addedWithin: 'any',
  saOnly: true
});

const STATUSES = new Set(['all', 'found', 'tailored', 'applied', 'interviewing', 'offer', 'rejected']);
const LINKS = new Set(['all', 'live', 'no-link']);
const WINDOWS = new Set(['any', '7', '30']);

function boundedScore(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

export function normalizeViewFilters(input) {
  const raw = input && typeof input === 'object' ? input : {};
  return {
    q: typeof raw.q === 'string' ? raw.q.slice(0, 200) : '',
    status: STATUSES.has(raw.status) ? raw.status : 'all',
    province: PROVINCES.includes(raw.province) ? raw.province : 'all',
    source: typeof raw.source === 'string' && raw.source ? raw.source : 'all',
    minScore: boundedScore(raw.minScore),
    link: LINKS.has(raw.link) ? raw.link : 'all',
    remoteOnly: raw.remoteOnly === true,
    addedWithin: WINDOWS.has(raw.addedWithin) ? raw.addedWithin : 'any',
    saOnly: raw.saOnly !== false
  };
}

function daysSince(dateAdded, now) {
  const time = Date.parse(dateAdded);
  if (!Number.isFinite(time)) return null;
  return (now - time) / 86_400_000;
}

function matchesLink(job, link) {
  if (link === 'live') return job.linkStatus === 'live';
  if (link === 'no-link') return job.linkStatus !== 'live';
  return true;
}

export function filterJobsForView(jobs = [], input = {}, now = Date.now()) {
  const filters = normalizeViewFilters(input);
  const query = filters.q.trim().toLowerCase();
  const visible = [];
  let hiddenForeign = 0;
  let total = 0;

  for (const job of jobs) {
    total += 1;
    if (filters.saOnly && jobLocationVerdict(job) === 'foreign') {
      hiddenForeign += 1;
      continue;
    }
    if (filters.status !== 'all' && job.status !== filters.status) continue;
    if (filters.province !== 'all' && jobProvince(job) !== filters.province) continue;
    if (filters.source !== 'all' && job.source !== filters.source) continue;
    if ((Number(job.matchScore) || 0) < filters.minScore) continue;
    if (!matchesLink(job, filters.link)) continue;
    if (filters.remoteOnly && !jobRemote(job)) continue;
    if (filters.addedWithin !== 'any') {
      const days = daysSince(job.dateAdded, now);
      if (days === null || days > Number(filters.addedWithin)) continue;
    }
    if (query) {
      const haystack = `${job.title || ''} ${job.company || ''} ${job.location || ''} ${job.source || ''}`.toLowerCase();
      if (!haystack.includes(query)) continue;
    }
    visible.push(job);
  }

  return { visible, hiddenForeign, total };
}

export function activeFilterCount(input) {
  const filters = normalizeViewFilters(input);
  let count = 0;
  if (filters.q.trim()) count += 1;
  if (filters.status !== 'all') count += 1;
  if (filters.province !== 'all') count += 1;
  if (filters.source !== 'all') count += 1;
  if (filters.minScore > 0) count += 1;
  if (filters.link !== 'all') count += 1;
  if (filters.remoteOnly) count += 1;
  if (filters.addedWithin !== 'any') count += 1;
  if (filters.saOnly !== DEFAULT_VIEW_FILTERS.saOnly) count += 1;
  return count;
}
```

Create `packages/core/src/jobs/index.js`:

```js
export * from './location.js';
export * from './viewFilters.js';
```

In `packages/core/package.json`, add the subpath export after `"./rag"`:

```json
    "./rag": "./src/rag/index.js",
    "./jobs": "./src/jobs/index.js"
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd sa-job-agent-suite
npm test --workspace=@sajas/core
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sa-job-agent-suite/packages/core/src/jobs/viewFilters.js \
  sa-job-agent-suite/packages/core/src/jobs/viewFilters.test.js \
  sa-job-agent-suite/packages/core/src/jobs/index.js \
  sa-job-agent-suite/packages/core/package.json
git commit -m "$(cat <<'EOF'
feat(core): add the job view filter contract

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Feed South Africa gate

**Files:**
- Modify: `packages/core/src/feeds/match.js` (`filterJobs`)
- Modify: `packages/core/src/feeds/match.test.js:44-52`

**Interfaces:**
- Consumes: `isSouthAfrican` from `../jobs/location.js`.
- Produces: `filterJobs(jobs, { keywords, locations, onlyMatches, saOnly })`, with `saOnly` defaulting to true.

- [ ] **Step 1: Update the test to pin the new default**

Replace the `filters match keywords and locations, including remote` test in `packages/core/src/feeds/match.test.js` with:

```js
test('filters match keywords and locations, including remote', () => {
  const rows = [job(), job({ title: 'Chef', company: 'Bistro', location: 'Durban', description: 'food' })];
  assert.equal(filterJobs(rows, { keywords: ['react'], locations: [] }).length, 1);
  assert.equal(filterJobs(rows, { keywords: [], locations: ['Cape Town'] }).length, 1);
  const remote = job({ location: 'Worldwide', remote: true });
  assert.equal(filterJobs([remote], { locations: ['remote'] }).length, 0);
  assert.equal(filterJobs([remote], { locations: ['remote'], saOnly: false }).length, 1);
  assert.equal(filterJobs(rows, { keywords: ['react'], locations: [], onlyMatches: false }).length, 2);
  assert.equal(filterJobs(rows, { keywords: [], locations: [], onlyMatches: false, saOnly: false }).length, 2);
});

test('the South Africa gate drops foreign rows and keeps unknown rows', () => {
  const rows = [
    job({ location: 'Cape Town' }),
    job({ title: 'Designer', company: 'Berlin Co', location: 'Berlin' }),
    job({ title: 'Analyst', company: 'Nowhere Co', location: 'Somewhereville' })
  ];
  const kept = filterJobs(rows, { keywords: [], locations: [] });
  assert.deepEqual(kept.map((row) => row.company), ['Acme Labs', 'Nowhere Co']);
  assert.equal(kept[1].company, 'Nowhere Co');
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd sa-job-agent-suite
npm test --workspace=@sajas/core
```

Expected: FAIL, because `Worldwide` still passes and `Berlin` is still kept.

- [ ] **Step 3: Add the gate**

In `packages/core/src/feeds/match.js`, add the import at the top:

```js
import { isSouthAfrican } from '../jobs/location.js';
```

Replace `filterJobs` with:

```js
export function filterJobs(jobs = [], { keywords = [], locations = [], onlyMatches = true, saOnly = true } = {}) {
  const keywordList = keywords.map((value) => String(value).trim()).filter(Boolean);
  const locationList = locations.map((value) => String(value).trim()).filter(Boolean);
  const scoped = saOnly ? jobs.filter((job) => isSouthAfrican(job.location)) : jobs;
  const scored = scoped.map((job) => ({ ...job, matchScore: scoreJob(job, keywordList) }));
  const kept = onlyMatches
    ? scored.filter((job) => matchesKeywords(job, keywordList) && matchesLocations(job, locationList))
    : scored;
  return kept.sort(byScore);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd sa-job-agent-suite
npm test --workspace=@sajas/core
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sa-job-agent-suite/packages/core/src/feeds/match.js \
  sa-job-agent-suite/packages/core/src/feeds/match.test.js
git commit -m "$(cat <<'EOF'
feat(feeds): drop foreign feed rows by default

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Hunter and AI search enforcement

**Files:**
- Create: `server/src/agents/jobLocationGate.js`
- Create: `server/src/agents/jobLocationGate.test.js`
- Modify: `server/src/agents/agent1-hunter.js:1-20` (imports)
- Modify: `server/src/agents/agent1-hunter.js:152-189` (delete old terms and helper)
- Modify: `server/src/agents/agent1-hunter.js` (AI search candidate loop)
- Modify: `server/src/agents/agent1-hunter.js` (source loop)

**Interfaces:**
- Consumes: `classifyLocation` from `@sajas/core/jobs`.
- Produces: `gateJobsByLocation(jobs, saCheck)` returning `{ kept, rejected }`, with `locationVerdict` and `province` attached to every entry.

- [ ] **Step 1: Write the failing gate test**

Create `server/src/agents/jobLocationGate.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { gateJobsByLocation } from './jobLocationGate.js';

const job = (location, over = {}) => ({ title: 'Engineer', company: 'Acme', location, ...over });

test('every policy rejects a foreign location', () => {
  for (const mode of ['strict', 'soft', 'none']) {
    const { kept, rejected } = gateJobsByLocation([job('London, UK')], mode);
    assert.equal(kept.length, 0, mode);
    assert.equal(rejected.length, 1, mode);
    assert.equal(rejected[0].locationVerdict, 'foreign', mode);
  }
});

test('strict rejects an unknown location and labels it', () => {
  const { kept, rejected } = gateJobsByLocation([job('Somewhereville')], 'strict');
  assert.equal(kept.length, 0);
  assert.equal(rejected[0].locationVerdict, 'unknown');
});

test('soft and none keep unknown locations and label them', () => {
  for (const mode of ['soft', 'none']) {
    const { kept } = gateJobsByLocation([job('Somewhereville')], mode);
    assert.equal(kept.length, 1, mode);
    assert.equal(kept[0].locationVerdict, 'unknown', mode);
  }
});

test('SA jobs pass every policy with a province when known', () => {
  for (const mode of ['strict', 'soft', 'none']) {
    const { kept } = gateJobsByLocation([job('Cape Town')], mode);
    assert.equal(kept.length, 1, mode);
    assert.equal(kept[0].locationVerdict, 'sa', mode);
    assert.equal(kept[0].province, 'Western Cape', mode);
  }
});

test('the gate does not mutate the input', () => {
  const input = job('Cape Town');
  gateJobsByLocation([input], 'strict');
  assert.equal('locationVerdict' in input, false);
});

test('an omitted or unknown policy behaves like soft', () => {
  assert.equal(gateJobsByLocation([job('Somewhereville')], undefined).kept.length, 1);
  assert.equal(gateJobsByLocation([job('Somewhereville')], 'weird').kept.length, 1);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd sa-job-agent-suite
npm test --workspace=server
```

Expected: FAIL with `Cannot find module './jobLocationGate.js'`.

- [ ] **Step 3: Implement the gate**

Create `server/src/agents/jobLocationGate.js`:

```js
import { classifyLocation } from '@sajas/core/jobs';

// one gate for every hunter path: foreign is rejected for every source, unknown
// only for strict sources. The policy is the source's, never a hard-coded flag.
export function gateJobsByLocation(jobs = [], saCheck = 'soft') {
  const strict = saCheck === 'strict';
  const kept = [];
  const rejected = [];
  for (const job of jobs) {
    const info = classifyLocation(job?.location);
    const allowed = info.verdict === 'sa' || (!strict && info.verdict === 'unknown');
    const entry = { ...job, locationVerdict: info.verdict, province: info.province };
    (allowed ? kept : rejected).push(entry);
  }
  return { kept, rejected };
}
```

- [ ] **Step 4: Run the gate test to verify it passes**

```bash
cd sa-job-agent-suite
npm test --workspace=server
```

Expected: PASS.

- [ ] **Step 5: Replace the hunter's old location helper**

At the top of `server/src/agents/agent1-hunter.js`, after the `browserLock` import, add:

```js
import { gateJobsByLocation } from './jobLocationGate.js';
```

Delete the entire block from the `const SA_LOCATION_TERMS = [` line through the closing brace of `isSouthAfricanLocation` (the old list plus helper). Nothing else in the file may reference those names after this step.

- [ ] **Step 6: Gate AI search results before scoring**

In the AI search loop, replace:

```js
        const aiJobs = await huntViaClaudeSearch(profile, keyword, aiLocations);
        totalFound += aiJobs.length;

        // Build scored candidates first, then validate their links as a batch.
        const candidates = [];
        for (const job of aiJobs) {
```

with:

```js
        const aiJobs = await huntViaClaudeSearch(profile, keyword, aiLocations);
        totalFound += aiJobs.length;

        // The prompt asks for South Africa; this gate is the guarantee.
        const { kept: aiKept, rejected: aiRejected } = gateJobsByLocation(aiJobs, 'soft');
        if (aiRejected.length > 0) {
          const sample = aiRejected.slice(0, 2).map((job) => `"${job.title}" (${job.location})`).join(', ');
          addLog(`[AI Search] Rejected ${aiRejected.length} job(s) outside South Africa. Samples: ${sample}`, 'agent1');
        }

        // Build scored candidates first, then validate their links as a batch.
        const candidates = [];
        for (const job of aiKept) {
```

- [ ] **Step 7: Gate source jobs with the source policy**

In the source loop, replace:

```js
          let belowThreshold = 0;
          let notSA = 0;
          const belowSamples = [];
          const candidates = [];
          for (const job of crawl.items) {
            if (!job.title || job.title.length < 4) continue;

            // Both 'strict' and 'soft' use today's lenient check: reject only
            // when a foreign place is EXPLICITLY named. 'none' skips it.
            if (source.saCheck && source.saCheck !== 'none' && !isSouthAfricanLocation(job.location, false)) {
              notSA++;
              continue;
            }

            const matchScore = calculateMatchScore(job.title, job.description, profile.keywords);
```

with:

```js
          let belowThreshold = 0;
          const belowSamples = [];
          const candidates = [];
          const { kept: located, rejected: notSA } = gateJobsByLocation(crawl.items, source.saCheck || 'soft');
          for (const job of located) {
            if (!job.title || job.title.length < 4) continue;

            const matchScore = calculateMatchScore(job.title, job.description, profile.keywords);
```

Then in the candidate object add the two fields after `source: job.source,`:

```js
              source: job.source,
              locationVerdict: job.locationVerdict,
              province: job.province,
```

Finally replace the rejection log:

```js
          if (notSA > 0) addLog(`[${source.name}] Rejected ${notSA} non-SA location job(s)`, 'agent1');
```

with:

```js
          if (notSA.length > 0) {
            const sample = notSA.slice(0, 2).map((job) => `"${job.title}" (${job.location})`).join(', ');
            addLog(`[${source.name}] Rejected ${notSA.length} job(s) outside South Africa. Samples: ${sample}`, 'agent1');
          }
```

There are two candidate objects in this file. Add the same two fields to both, after each `source: job.source,` line: the object built from `aiKept` and the object built from `located`. The AI one uses this indentation:

```js
            source: job.source,
            locationVerdict: job.locationVerdict,
            province: job.province,
```

The source-loop one uses this indentation:

```js
              source: job.source,
              locationVerdict: job.locationVerdict,
              province: job.province,
```

- [ ] **Step 8: Run the server tests**

```bash
cd sa-job-agent-suite
npm test --workspace=server
```

Expected: PASS, including the existing strict/soft integration test at `agent1-hunter.test.js:560`.

- [ ] **Step 9: Commit**

```bash
git add sa-job-agent-suite/server/src/agents/jobLocationGate.js \
  sa-job-agent-suite/server/src/agents/jobLocationGate.test.js \
  sa-job-agent-suite/server/src/agents/agent1-hunter.js
git commit -m "$(cat <<'EOF'
feat(hunter): gate every source and AI search on the South Africa classifier

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Profile feed default

**Files:**
- Modify: `server/src/db/helper.js` (DEFAULT_DB.profile, after `locations`)
- Modify: `server/src/index.js` (POST /api/profile whitelist)
- Modify: `server/src/errorRoutes.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `profile.feedSaOnly` (boolean, default true) from `GET /api/profile` and accepted by `POST /api/profile`.

- [ ] **Step 1: Write the failing route test**

Open `server/src/errorRoutes.test.js`, find the profile round-trip test area, and add:

```js
test('profile stores the feed South Africa default as a boolean', async () => {
  const before = await fetch(runtime.origin + '/api/profile');
  assert.equal(before.status, 200);
  assert.equal((await before.json()).feedSaOnly, true);

  const off = await postJson('/api/profile', { feedSaOnly: false });
  assert.equal(off.status, 200);
  assert.equal((await off.json()).profile.feedSaOnly, false);

  const kept = await postJson('/api/profile', { feedSaOnly: 'yes' });
  assert.equal(kept.status, 200);
  assert.equal((await kept.json()).profile.feedSaOnly, false);

  const on = await postJson('/api/profile', { feedSaOnly: true });
  assert.equal((await on.json()).profile.feedSaOnly, true);
});
```

The file already exposes `runtime.origin` and a `postJson(route, body)` helper that returns the raw `Response`.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd sa-job-agent-suite
npm test --workspace=server
```

Expected: FAIL, because `feedSaOnly` is undefined.

- [ ] **Step 3: Add the default and the whitelist entry**

In `server/src/db/helper.js`, inside `DEFAULT_DB.profile`, after the `locations` line add:

```js
    feedSaOnly: true,
```

In `server/src/index.js`, inside the `saveProfile({ ... })` call in `POST /api/profile`, after the `locations` line add:

```js
      feedSaOnly:      typeof incoming.feedSaOnly === 'boolean' ? incoming.feedSaOnly : currentProfile.feedSaOnly,
```

- [ ] **Step 4: Run the server tests**

```bash
cd sa-job-agent-suite
npm test --workspace=server
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sa-job-agent-suite/server/src/db/helper.js \
  sa-job-agent-suite/server/src/index.js \
  sa-job-agent-suite/server/src/errorRoutes.test.js
git commit -m "$(cat <<'EOF'
feat(profile): persist the feed South Africa default

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Jobs filter bar in the desktop and web views

**Files:**
- Create: `client/src/jobFilters.js`
- Create: `client/src/JobFilters.jsx`
- Modify: `client/src/App.jsx` (imports, profile default, filter state, memo, JSX, table, empty state)
- Modify: `client/src/index.css` (append filter styles)

**Interfaces:**
- Consumes: `DEFAULT_VIEW_FILTERS`, `normalizeViewFilters`, `activeFilterCount`, `filterJobsForView`, `jobLocationVerdict`, `PROVINCES` from `@sajas/core/jobs`.
- Produces: `JOB_FILTERS_KEY`, `loadJobFilters()`, `saveJobFilters(filters)`; `<JobFilters filters onChange provinceOptions sourceOptions hiddenForeign activeCount />`; `data-testid` values `job-filter-*`, `job-chip-*`, `job-clear-filters`, `job-hidden-foreign`, `job-show-foreign`, `job-row`, `job-empty-clear`, `location-unconfirmed`.

- [ ] **Step 1: Create the storage helper**

Create `client/src/jobFilters.js`:

```js
import { DEFAULT_VIEW_FILTERS, normalizeViewFilters } from '@sajas/core/jobs';

export const JOB_FILTERS_KEY = 'sajas.jobFilters.v1';

export function loadJobFilters() {
  try {
    const raw = globalThis.localStorage?.getItem(JOB_FILTERS_KEY);
    if (!raw) return { ...DEFAULT_VIEW_FILTERS };
    return normalizeViewFilters(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_VIEW_FILTERS };
  }
}

export function saveJobFilters(filters) {
  try {
    globalThis.localStorage?.setItem(JOB_FILTERS_KEY, JSON.stringify(normalizeViewFilters(filters)));
  } catch {
    // Storage can be unavailable in private mode; the view still works.
  }
}
```

- [ ] **Step 2: Create the filter bar**

Create `client/src/JobFilters.jsx`:

```jsx
import React, { useState } from 'react';
import { Filter, Search } from 'lucide-react';
import { DEFAULT_VIEW_FILTERS } from '@sajas/core/jobs';

const STATUS_OPTIONS = [
  ['all', 'All statuses'], ['found', 'Discovered'], ['tailored', 'Tailored'],
  ['applied', 'Applied'], ['interviewing', 'Interviewing'], ['offer', 'Offer'],
  ['rejected', 'Rejected']
];

const LINK_OPTIONS = [
  ['all', 'Any link'], ['live', 'Verified live'], ['no-link', 'No verified link']
];

const DATE_OPTIONS = [
  ['any', 'Any date'], ['7', 'Added this week'], ['30', 'Added this month']
];

const SCORE_STEPS = [0, 50, 60, 70, 80, 90];

function Chip({ active, onClick, children, testid }) {
  return (
    <button
      type="button"
      className={active ? 'btn-primary btn-xs' : 'btn-secondary btn-xs'}
      onClick={onClick}
      data-testid={testid}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

export default function JobFilters({
  filters, onChange, provinceOptions = [], sourceOptions = [],
  hiddenForeign = 0, activeCount = 0
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="job-filters">
      <button
        type="button"
        className="btn-secondary btn-sm job-filters-toggle"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        data-testid="job-filters-toggle"
      >
        <Filter size={14} /> Filters{activeCount > 0 ? ` (${activeCount})` : ''}
      </button>

      <div className={`job-filters-body${open ? ' open' : ''}`}>
        <div className="job-filter-field job-filter-search">
          <label htmlFor="job-filter-search">Search</label>
          <div style={{ position: 'relative' }}>
            <Search size={12} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              id="job-filter-search"
              data-testid="job-filter-search"
              placeholder="Title, company, place"
              value={filters.q}
              onChange={(event) => onChange({ q: event.target.value })}
              style={{ paddingLeft: 28 }}
            />
          </div>
        </div>

        <div className="job-filter-field">
          <label htmlFor="job-filter-province">Province</label>
          <select id="job-filter-province" data-testid="job-filter-province" value={filters.province} onChange={(event) => onChange({ province: event.target.value })}>
            <option value="all">All provinces</option>
            {provinceOptions.map((province) => <option key={province} value={province}>{province}</option>)}
          </select>
        </div>

        <div className="job-filter-field">
          <label htmlFor="job-filter-source">Source</label>
          <select id="job-filter-source" data-testid="job-filter-source" value={filters.source} onChange={(event) => onChange({ source: event.target.value })}>
            <option value="all">All sources</option>
            {sourceOptions.map((source) => <option key={source} value={source}>{source}</option>)}
          </select>
        </div>

        <div className="job-filter-field">
          <label htmlFor="job-filter-status">Status</label>
          <select id="job-filter-status" data-testid="job-filter-status" value={filters.status} onChange={(event) => onChange({ status: event.target.value })}>
            {STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>

        <div className="job-filter-field">
          <label htmlFor="job-filter-score">Minimum match</label>
          <select id="job-filter-score" data-testid="job-filter-score" value={String(filters.minScore)} onChange={(event) => onChange({ minScore: Number(event.target.value) })}>
            {SCORE_STEPS.map((score) => <option key={score} value={score}>{score === 0 ? 'Any match' : `${score}% and up`}</option>)}
          </select>
        </div>

        <div className="job-filter-field">
          <label htmlFor="job-filter-link">Link</label>
          <select id="job-filter-link" data-testid="job-filter-link" value={filters.link} onChange={(event) => onChange({ link: event.target.value })}>
            {LINK_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>

        <div className="job-filter-field">
          <label htmlFor="job-filter-date">Added</label>
          <select id="job-filter-date" data-testid="job-filter-date" value={filters.addedWithin} onChange={(event) => onChange({ addedWithin: event.target.value })}>
            {DATE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>

        <div className="job-filter-field job-filter-check">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
            <input
              type="checkbox"
              data-testid="job-filter-sa-only"
              checked={filters.saOnly}
              onChange={(event) => onChange({ saOnly: event.target.checked })}
              style={{ width: 16, height: 16 }}
            />
            <span>South Africa only</span>
          </label>
        </div>
      </div>

      <div className="job-filter-chips">
        <Chip testid="job-chip-remote" active={filters.remoteOnly} onClick={() => onChange({ remoteOnly: !filters.remoteOnly })}>Remote</Chip>
        <Chip testid="job-chip-live" active={filters.link === 'live'} onClick={() => onChange({ link: filters.link === 'live' ? 'all' : 'live' })}>Live link</Chip>
        <Chip testid="job-chip-strong" active={filters.minScore >= 80} onClick={() => onChange({ minScore: filters.minScore >= 80 ? 0 : 80 })}>Strong match (80+)</Chip>
        <Chip testid="job-chip-week" active={filters.addedWithin === '7'} onClick={() => onChange({ addedWithin: filters.addedWithin === '7' ? 'any' : '7' })}>Added this week</Chip>
        <button type="button" className="btn-ghost btn-xs" data-testid="job-clear-filters" onClick={() => onChange({ ...DEFAULT_VIEW_FILTERS })}>Clear filters</button>
      </div>

      {hiddenForeign > 0 && (
        <p className="tiny job-filter-hidden" data-testid="job-hidden-foreign">
          {hiddenForeign} {hiddenForeign === 1 ? 'job' : 'jobs'} outside South Africa hidden.
          <button type="button" className="btn-ghost btn-xs" data-testid="job-show-foreign" onClick={() => onChange({ saOnly: false })}>Show them</button>
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Wire the shell**

In `client/src/App.jsx`:

1. After `import JobFeeds from './JobFeeds.jsx';` add:

```js
import JobFilters from './JobFilters.jsx';
```

2. After the last `import { webRuntime } from './web/runtime.js';` line add:

```js
import {
  DEFAULT_VIEW_FILTERS, PROVINCES, activeFilterCount, filterJobsForView, jobLocationVerdict
} from '@sajas/core/jobs';
import { loadJobFilters, saveJobFilters } from './jobFilters.js';
```

3. In the profile default object, after `locations: '',` add:

```js
    feedSaOnly: true,
```

4. Replace the filter state block:

```js
  const [jobQuery, setJobQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [visibleJobCount, setVisibleJobCount] = useState(50);
```

with:

```js
  const [viewFilters, setViewFilters] = useState(loadJobFilters);
  const [visibleJobCount, setVisibleJobCount] = useState(50);
```

5. Replace the `filteredJobs` memo with:

```js
  const updateViewFilters = useCallback((patch) => {
    setViewFilters((current) => ({ ...current, ...patch }));
    setVisibleJobCount(50);
  }, []);

  useEffect(() => {
    saveJobFilters(viewFilters);
  }, [viewFilters]);

  const { visible: filteredJobs, hiddenForeign } = useMemo(
    () => filterJobsForView(jobs, viewFilters),
    [jobs, viewFilters]
  );

  const sourceOptions = useMemo(
    () => [...new Set(jobs.map((job) => job.source).filter(Boolean))].sort(),
    [jobs]
  );
```

6. Replace the whole `{/* Filters */}` block (the `flex-between` div with the search input and status select) with:

```jsx
            {/* Filters */}
            <div className="flex-between" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
              <h3 style={{ fontSize: 15 }}>All discovered opportunities ({filteredJobs.length})</h3>
            </div>
            <JobFilters
              filters={viewFilters}
              onChange={updateViewFilters}
              provinceOptions={PROVINCES}
              sourceOptions={sourceOptions}
              hiddenForeign={hiddenForeign}
              activeCount={activeFilterCount(viewFilters)}
            />
```

7. In the jobs table, add `data-testid="job-row"` to the row:

```jsx
                      <tr data-testid="job-row">
```

8. Replace the location cell with:

```jsx
                        <td>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <MapPin size={12} color="var(--text-muted)" /> {job.location}
                          </span>
                          {jobLocationVerdict(job) === 'unknown' && (
                            <div>
                              <span className="badge badge-warning" data-testid="location-unconfirmed">Location not confirmed</span>
                            </div>
                          )}
                        </td>
```

9. Replace the empty-state row with:

```jsx
                  {filteredJobs.length === 0 && (
                    <tr><td colSpan="6" style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
                      {jobs.length === 0
                        ? (IS_WEB
                          ? 'No records yet. Add a job manually or pull one from Job Feeds.'
                          : 'No records harvested yet. Set parameters and start your crawler!')
                        : (
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                            <span>No jobs match these filters.</span>
                            <button
                              className="btn-secondary btn-sm"
                              data-testid="job-empty-clear"
                              onClick={() => updateViewFilters({ ...DEFAULT_VIEW_FILTERS })}
                            >
                              Clear filters
                            </button>
                          </div>
                        )}
                    </td></tr>
                  )}
```

- [ ] **Step 4: Add responsive styles**

Append to `client/src/index.css`:

```css
.job-filters { margin-bottom: 14px; }
.job-filters-toggle { display: none; }
.job-filters-body { display: flex; flex-wrap: wrap; gap: 10px; align-items: end; }
.job-filter-field { display: flex; flex-direction: column; gap: 4px; min-width: 130px; }
.job-filter-field label { font-size: 11px; color: var(--text-muted); }
.job-filter-search { flex: 1 1 200px; }
.job-filter-check { justify-content: flex-end; }
.job-filter-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.job-filter-hidden { margin-top: 8px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }

@media (max-width: 720px) {
  .job-filters-toggle { display: inline-flex; margin-bottom: 10px; }
  .job-filters-body { display: none; }
  .job-filters-body.open { display: flex; flex-direction: column; align-items: stretch; }
}
```

- [ ] **Step 5: Build the client and web bundles**

```bash
cd sa-job-agent-suite
npm run build:client
npm run build:web
```

Expected: both builds succeed with no unresolved `@sajas/core/jobs` import.

- [ ] **Step 6: Commit**

```bash
git add sa-job-agent-suite/client/src/jobFilters.js \
  sa-job-agent-suite/client/src/JobFilters.jsx \
  sa-job-agent-suite/client/src/App.jsx \
  sa-job-agent-suite/client/src/index.css
git commit -m "$(cat <<'EOF'
feat(ui): add the persistent job filter bar

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Job Feeds South Africa control

**Files:**
- Modify: `client/src/JobFeeds.jsx` (imports, state, memo, saveDefaults, controls, count, location cell, empty copy)

**Interfaces:**
- Consumes: `countForeignJobs`, `jobLocationVerdict` from `@sajas/core/jobs`.
- Produces: `data-testid` values `feed-sa-only`, `feed-hidden-foreign`, `feed-show-foreign`.

- [ ] **Step 1: Add the state and imports**

In `client/src/JobFeeds.jsx`, extend the core import:

```js
import {
  FEED_SOURCES, dedupeJobs, filterJobs, fingerprint, sourceLabel, splitList, trackerFingerprints
} from '@sajas/core/feeds';
import { countForeignJobs, jobLocationVerdict } from '@sajas/core/jobs';
```

After the `onlyMatches` state add:

```js
  const [saOnly, setSaOnly] = useState(profile?.feedSaOnly !== false);
```

- [ ] **Step 2: Apply the gate and count hidden rows**

Replace the `visible` memo with:

```js
  const visible = useMemo(() => filterJobs(results, {
    keywords: splitList(keywords),
    locations: splitList(locations),
    onlyMatches,
    saOnly
  }), [results, keywords, locations, onlyMatches, saOnly]);

  const hiddenForeign = useMemo(
    () => (saOnly ? countForeignJobs(results) : 0),
    [results, saOnly]
  );
```

- [ ] **Step 3: Save the default**

In `saveDefaults`, replace the request body:

```js
        body: JSON.stringify({ keywords, locations, feedSaOnly: saOnly })
```

- [ ] **Step 4: Add the control and the count**

In the controls row, after the `Only show matches` label block add:

```jsx
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
            <input
              type="checkbox"
              data-testid="feed-sa-only"
              checked={saOnly}
              onChange={(event) => setSaOnly(event.target.checked)}
              style={{ width: 16, height: 16 }}
            />
            <span style={{ fontSize: 13 }}>South Africa only</span>
          </label>
```

Under the `{visible.length} matching ...` heading, before the empty check, add:

```jsx
        {hiddenForeign > 0 && (
          <p className="tiny" data-testid="feed-hidden-foreign" style={{ marginBottom: 10 }}>
            {hiddenForeign} {hiddenForeign === 1 ? 'job' : 'jobs'} outside South Africa hidden.
            <button type="button" className="btn-ghost btn-xs" data-testid="feed-show-foreign" onClick={() => setSaOnly(false)}>Show them</button>
          </p>
        )}
```

- [ ] **Step 5: Label unknown locations and update the empty copy**

In the feed location cell, after the remote badge add:

```jsx
                          {jobLocationVerdict(job) === 'unknown' && (
                            <span className="badge badge-warning">Location not confirmed</span>
                          )}
```

Change the empty-state copy to:

```jsx
            {loading ? 'Fetching feeds...' : results.length === 0
              ? 'No feeds returned jobs. Retry above, or check your connection.'
              : 'No jobs match these filters. Loosen the keywords, add a location, turn off Only show matches, or turn off South Africa only.'}
```

- [ ] **Step 6: Build the web bundle**

```bash
cd sa-job-agent-suite
npm run build:web
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add sa-job-agent-suite/client/src/JobFeeds.jsx
git commit -m "$(cat <<'EOF'
feat(feeds): add the South Africa only control and hidden count

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Browser proof, regression updates, docs and gates

**Files:**
- Create: `scripts/web-filters.mjs`
- Modify: `scripts/web-feeds.mjs` (after the first row appears)
- Modify: `package.json:17` (`test:web`)
- Modify: `README.md` (feature bullet)
- Modify: `docs/superpowers/specs/2026-10-27-post-m3a3-pipeline.md` (order table and arc headings)
- Modify: `docs/superpowers/specs/2026-10-28-sa-relevance-and-filters-design.md` (status line)

**Interfaces:**
- Consumes: the built web bundle and the `data-testid` values from Tasks 6 and 7.
- Produces: offline browser evidence for the default hide, reveal, province, score, persistence, and clear behaviour.

- [ ] **Step 1: Write the browser proof**

Create `scripts/web-filters.mjs`:

```js
// Offline proof of the South Africa default and the job filter bar: seed SA,
// foreign and unknown jobs, then check the hide count, reveal, province and
// score filters, persistence across reload, and a full reset. No key.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { startStaticServer } from './lib/staticServer.mjs';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'client/dist');
const TODAY = new Date().toISOString().slice(0, 10);

const PROFILE = {
  fullName: 'Kone Tshivhinda',
  email: 'test@example.com',
  keywords: 'Developer',
  locations: 'Johannesburg, Cape Town',
  feedSaOnly: true,
  dailyBudgetUSD: 0
};

const JOBS = [
  {
    id: 'job-sa-live', title: 'Backend Developer', company: 'Cape Systems',
    location: 'Cape Town', description: 'Node.js services.',
    applyUrl: 'https://example.com/sa-live', datePosted: TODAY,
    matchScore: 90, status: 'found', notes: '', source: 'PNet',
    linkStatus: 'live', dateAdded: TODAY
  },
  {
    id: 'job-sa-gp', title: 'Data Analyst', company: 'Joburg Data',
    location: 'Johannesburg', description: 'SQL and reporting.',
    applyUrl: 'https://example.com/sa-gp', datePosted: TODAY,
    matchScore: 70, status: 'found', notes: '', source: 'Indeed',
    linkStatus: 'unverified', dateAdded: TODAY
  },
  {
    id: 'job-foreign', title: 'Frontend Developer', company: 'Thames Digital',
    location: 'London, UK', description: 'React applications.',
    applyUrl: 'https://example.com/foreign', datePosted: TODAY,
    matchScore: 95, status: 'found', notes: '', source: 'Manual',
    linkStatus: 'live', dateAdded: TODAY
  },
  {
    id: 'job-unknown', title: 'Support Engineer', company: 'Remote Works',
    location: 'Remote', description: 'Customer support.',
    applyUrl: 'https://example.com/unknown', datePosted: TODAY,
    matchScore: 60, status: 'found', notes: '', source: 'Manual',
    linkStatus: 'unverified', dateAdded: TODAY
  }
];

let step = 'start';

function at(name) {
  step = name;
}

async function enterSuite(page) {
  const enter = page.getByRole('button', { name: /Enter the Suite/i });
  if (await enter.isVisible().catch(() => false)) await enter.click();
  await page.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor({ timeout: 20_000 }).catch(() => {});
}

async function openTracker(page) {
  await page.getByRole('button', { name: 'Job Hunter', exact: true }).click();
  await page.locator('table.data-table tbody').waitFor({ timeout: 15_000 });
}

async function seed(page) {
  await page.evaluate(async ({ profile, jobs }) => {
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
      for (const job of jobs) tx.objectStore('jobs').put(job, job.id);
      tx.objectStore('meta').put({ onboarded: true }, 'app');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }, { profile: PROFILE, jobs: JOBS });
}

async function rowTitles(page) {
  return page.getByTestId('job-row').evaluateAll((rows) => rows.map((row) => row.querySelector('td div')?.textContent?.trim() || ''));
}

async function main() {
  try {
    await fs.access(path.join(dist, 'index.html'));
  } catch {
    throw new Error('client/dist/index.html is missing. Run npm run build:web first.');
  }

  const server = await startStaticServer({ root: dist });
  const origin = new URL(server.url).origin;
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', (error) => errors.push(String(error)));

    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith(origin)) return route.continue();
      return route.abort('blockedbyclient');
    });

    at('seed and enter');
    await page.goto(server.url, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('onboarding').waitFor({ timeout: 20_000 });
    await seed(page);
    await page.getByTestId('key-skip').click();
    await enterSuite(page);
    await openTracker(page);

    at('foreign job is hidden by default');
    await page.getByTestId('job-hidden-foreign').waitFor({ timeout: 15_000 });
    assert.match(await page.getByTestId('job-hidden-foreign').innerText(), /1 job outside South Africa hidden/);
    assert.deepEqual((await rowTitles(page)).sort(), ['Backend Developer', 'Data Analyst', 'Support Engineer'].sort());
    assert.equal(await page.getByText('Frontend Developer').count(), 0, 'the foreign job was visible by default');
    assert.equal(await page.getByTestId('location-unconfirmed').count(), 1, 'the unknown location was not labelled');

    at('show the hidden foreign job');
    await page.getByTestId('job-show-foreign').click();
    await page.getByText('Frontend Developer').first().waitFor({ timeout: 15_000 });
    assert.equal(await page.getByTestId('job-row').count(), 4);
    assert.equal(await page.getByTestId('job-hidden-foreign').count(), 0);

    at('province filter narrows the list');
    await page.getByTestId('job-filter-province').selectOption('Gauteng');
    assert.deepEqual(await rowTitles(page), ['Data Analyst']);
    await page.getByTestId('job-filter-province').selectOption('all');

    at('score filter narrows the list');
    await page.getByTestId('job-filter-score').selectOption('80');
    assert.deepEqual((await rowTitles(page)).sort(), ['Backend Developer', 'Frontend Developer'].sort());
    await page.getByTestId('job-filter-score').selectOption('0');

    at('search filter narrows the list');
    await page.getByTestId('job-filter-search').fill('support');
    assert.deepEqual(await rowTitles(page), ['Support Engineer']);

    at('filters survive a reload');
    await page.getByTestId('job-filter-search').fill('');
    await page.getByTestId('job-filter-score').selectOption('80');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await enterSuite(page);
    await openTracker(page);
    assert.equal(await page.getByTestId('job-filter-score').inputValue(), '80', 'the score filter did not persist');

    at('clear restores the defaults');
    await page.getByTestId('job-clear-filters').click();
    assert.equal(await page.getByTestId('job-filter-score').inputValue(), '0');
    await page.getByTestId('job-hidden-foreign').waitFor({ timeout: 15_000 });
    assert.deepEqual((await rowTitles(page)).sort(), ['Backend Developer', 'Data Analyst', 'Support Engineer'].sort());

    at('no console errors');
    assert.deepEqual(errors, [], `the page logged errors: ${errors.join(' | ')}`);
  } finally {
    await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }
}

main()
  .then(() => {
    console.log('web-filters: PASS');
  })
  .catch((error) => {
    console.error(`web-filters: FAIL at "${step}"`);
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
```

- [ ] **Step 2: Update the feed proof for the new default**

In `scripts/web-feeds.mjs`, after the first `feed-row-0` wait at `at('open Job Feeds')`, insert:

```js
    at('foreign feed rows are hidden by default');
    await page.getByTestId('feed-hidden-foreign').waitFor({ timeout: 15_000 });
    assert.match(await page.getByTestId('feed-hidden-foreign').innerText(), /2 jobs outside South Africa hidden/);
    await page.getByTestId('feed-show-foreign').click();
    await page.getByText('Remote (Worldwide)').first().waitFor({ timeout: 15_000 });
    await page.getByTestId('feed-sa-only').check();
    await page.getByText('Remote (Worldwide)').first().waitFor({ state: 'detached', timeout: 15_000 });
```

- [ ] **Step 3: Add the proof to `test:web`**

In `sa-job-agent-suite/package.json`, extend `test:web`:

```json
    "test:web": "node scripts/check-ui.mjs && node scripts/web-canary.mjs && node scripts/web-feeds.mjs && node scripts/web-filters.mjs && node scripts/web-isolation.mjs && node scripts/web-ui.mjs && node scripts/web-tailor.mjs && node scripts/web-rag.mjs",
```

- [ ] **Step 4: Build and run the web proofs**

```bash
cd sa-job-agent-suite
npm run build:web
node scripts/web-filters.mjs
node scripts/web-feeds.mjs
```

Expected: `web-filters: PASS` and `web-feeds: PASS`.

- [ ] **Step 5: Update the docs**

In `README.md`, replace the `AI job search (grounded)` feature bullet with:

```markdown
- **AI job search (grounded)**: Claude's live web search returns real vacancies with real apply links; the 13 scrapers run as a best-effort fallback. Token-aware scoring 0–100, saves ≥ 18, and a shared South Africa location classifier that rejects foreign jobs from every source and feed.
- **South Africa first, with real filters**: foreign jobs are hidden by default and counted, never deleted; filter the tracker by province, source, status, match score, link health, remote and date, and the choice persists across reloads.
```

In `docs/superpowers/specs/2026-10-27-post-m3a3-pipeline.md`:

- In the order table, replace rows 6 and 7 with:

```markdown
| 6 | South Africa relevance and search filters | In progress 2026-10-28 | Foreign jobs are hidden and counted, and the filter bar persists in the web and desktop views |
| 7 | Scraper resilience | Planned | API and hydration interception, resilient selectors, schema gates and anti-bot baseline land with a debugging guide |
| 8 | Real-browser auto-apply | Planned | A feasibility gate picks the delivery form, then the chosen form passes an end-to-end apply rehearsal |
| 9 | Inbox and MCP integration | Planned | A feasibility gate picks the delivery form, then the chosen form passes an offline integration test |
```

- Rename the heading `## Arc 6: Real-browser auto-apply` to `## Arc 8: Real-browser auto-apply` and `## Arc 7: Inbox and MCP integration` to `## Arc 9: Inbox and MCP integration`.

In `docs/superpowers/specs/2026-10-28-sa-relevance-and-filters-design.md`, change the status line to:

```markdown
**Status:** implemented 2026-10-28, shipped after the live check
```

- [ ] **Step 6: Run every gate**

```bash
cd sa-job-agent-suite
npm test
npm run test:web
npm run build:web
npm run build:client
cd ..
node tools/check-secrets.mjs --all
```

Expected: all pass and the scanner reports `clean`.

- [ ] **Step 7: Commit, push, open the PR**

```bash
git add sa-job-agent-suite/scripts/web-filters.mjs \
  sa-job-agent-suite/scripts/web-feeds.mjs \
  sa-job-agent-suite/package.json \
  README.md \
  docs/superpowers/specs/2026-10-27-post-m3a3-pipeline.md \
  docs/superpowers/specs/2026-10-28-sa-relevance-and-filters-design.md
git commit -m "$(cat <<'EOF'
test(web): prove the South Africa default and persistent filters

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
git push -u origin arc-6-sa-relevance-filters
gh pr create --title "feat: South Africa relevance and persistent job filters" --body "$(cat <<'EOF'
## Summary
- one shared SA location classifier used by the hunter, feeds, AI search and both job views
- foreign jobs hidden by default, counted and revealable, never deleted
- persistent job filters: province, source, status, score, link, remote, date

## Test plan
- [ ] npm test
- [ ] npm run test:web
- [ ] npm run build:web
- [ ] npm run build:client
- [ ] secret scanner
EOF
)"
```

- [ ] **Step 8: Merge when green, deploy, live check**

After CI is green, merge the PR, deploy the web build from merged `main`, and verify on the live site:

- The Job Hunter tab shows the filter bar with `South Africa only` checked.
- Seeded or existing foreign jobs show `N jobs outside South Africa hidden` and `Show them` reveals them.
- Choosing a province narrows the rows.
- Reloading keeps the chosen filters.
- `Clear filters` restores the default view.

Record the results in the PR and update the spec status to `shipped` with the PR number. Do not run live scraping and do not set an Anthropic key.

---

## Coverage check

- Spec classifier table: Task 1.
- Hunter enforcement, AI search and rejected counts: Task 4.
- Feed gate and `saOnly`: Tasks 3 and 7.
- Existing jobs hidden, counted, revealable: Tasks 2, 6 and 7.
- Filter contract, defaults, malformed input: Task 2.
- Filter bar, chips, responsive collapse, empty state, persistence: Task 6.
- Profile default: Task 5.
- Browser proof and regression updates: Task 8.
- Docs, gates, PR, deploy, live check: Task 8.
