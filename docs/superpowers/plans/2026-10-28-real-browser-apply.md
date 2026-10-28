# Real-Browser Auto-Apply Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a shared application packet that the hosted app uses as a guided copy sheet and the desktop copilot uses to stop at final review, ask for explicit confirmation, then click Submit once and record exactly what was sent.

**Architecture:** A pure `@sajas/core/apply` packet builder feeds two adapters. The web adapter renders an Apply tab and records through the web API. The desktop adapter keeps Agent 3's browser automation, gates each site behind a per-domain consent record, and adds a confirmation handshake through `applyState.pendingConfirmation` and `POST /api/apply/confirm`. Both write the same submission shape into candidate memory.

**Tech Stack:** Node 22 ESM, React 18, Vite 7, Express 4, Playwright Chromium, node:test, Cloudflare Pages static hosting.

**Spec:** [docs/superpowers/specs/2026-10-28-real-browser-apply-design.md](../specs/2026-10-28-real-browser-apply-design.md)

## Global Constraints

- No Anthropic key exists and none may be set. Never run `npm run smoke:live`, `node evals/run.mjs --live`, or anything needing `ANTHROPIC_API_KEY`.
- Every test is offline: `fakeClient`, routed fixtures, or the synthetic demo origin. No live scraping or application.
- Key-shaped strings are assembled at runtime from fragments. Never commit a literal that looks like a key.
- Never bypass the pre-commit hook. `--no-verify` is forbidden.
- Provider names live only in `server/src/db/migrations.js`. Model-ID literals live only in `packages/core/src/models.js` and `*.test.js`.
- Non-GET desktop requests carry `X-SAJAS-Client: 1`.
- Run npm commands from `sa-job-agent-suite/`. Run `node tools/check-secrets.mjs` from the worktree root.
- Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- No em dashes in UI copy, docs, or chat.
- The copilot never submits without an explicit confirmation matching the current nonce, page origin and control label.
- Never store a password. Never store an ID or passport number.
- A failed or unconfirmed submit is never retried automatically.

---

## File Structure

**Core**
- Create `packages/core/src/apply/packet.js`: deterministic packet builder, site parsing, field allowlist.
- Create `packages/core/src/apply/submission.js`: submission cleaning and summarising.
- Create `packages/core/src/apply/index.js`: public re-exports.
- Modify `packages/core/package.json`: add the `./apply` subpath export.

**Server**
- Modify `server/src/db/helper.js`: submission fields on `recordApplication`, `siteConsent` store and accessors.
- Create `server/src/hunter/loginSites.js`: one registry for the five SA job sites.
- Create `server/src/hunter/siteSessions.js`: connect and disconnect.
- Modify `server/src/hunter/browser.js`: add `openEphemeralContext`.
- Modify `server/src/agents/agent1-hunter.js`: consume the registry.
- Create `server/src/agents/applyConfirmation.js`: pending confirmation state machine.
- Create `server/src/agents/submission.js`: final-submit scan, field snapshot, file names, confirmation excerpt.
- Modify `server/src/agents/controls.js`: `clickSubmitControl`.
- Modify `server/src/agents/agent3-applier.js`: consent-gated launch, final-review offer, confirmed click, wait, record.
- Modify `server/src/index.js`: `POST /api/jobs/:id/applied`, `GET /api/sites`, `POST /api/sites/:key/connect`, `POST /api/sites/:key/disconnect`, `POST /api/apply/confirm`.
- Modify `server/src/demo.js`: allow `POST /api/apply/confirm` on the synthetic demo.

**Client**
- Create `client/src/ApplyPacket.jsx`: the web copy sheet.
- Modify `client/src/web/mode.js`: `WEB_ONLY_TABS`.
- Modify `client/src/web/api.js`: `GET /application/bank`, `POST /jobs/:id/applied`.
- Modify `client/src/App.jsx`: Apply tab, Mark applied, site logins UI, submit confirmation modal and polling.

**Proof and docs**
- Create `scripts/web-apply.mjs`: web apply proof.
- Modify `sa-job-agent-suite/package.json`: add the proof to `test:web`.
- Modify `scripts/demo.test.mjs`: cancel, page-changed, and confirmed-submit rehearsal.
- Modify `README.md`, `docs/superpowers/specs/2026-10-28-real-browser-apply-design.md`, `docs/superpowers/specs/2026-10-27-post-m3a3-pipeline.md`.

---

### Task 1: Core apply packet and submission

**Files:**
- Create: `packages/core/src/apply/packet.js`
- Create: `packages/core/src/apply/submission.js`
- Create: `packages/core/src/apply/index.js`
- Create: `packages/core/src/apply/packet.test.js`
- Create: `packages/core/src/apply/submission.test.js`
- Modify: `packages/core/package.json:6-19`

**Interfaces:**
- Produces: `buildApplyPacket({ profile, job, answerBank, supportingDocs })`, `siteOf(url)`, `cleanSubmission({ documents, fields, confirmation })`, `summariseSubmission(packet, { delivery, submittedBy, fields, confirmation })`, `SUBMISSION_DELIVERIES`, `SUBMISSION_SUBMITTERS`.

- [ ] **Step 1: Write the failing packet test**

Create `packages/core/src/apply/packet.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApplyPacket, siteOf } from './packet.js';

const profile = {
  fullName: 'Thandi Mokoena',
  email: 'thandi@example.test',
  phone: '',
  linkedInUrl: 'https://www.linkedin.com/in/thandi',
  idNumber: '9001015000000',
  applicationProfile: {
    rightToWorkSA: 'Yes',
    currentSalary: 'R 45 000 per month',
    expectedSalary: '',
    noticePeriod: '30 days',
    eeRace: 'African'
  }
};

const job = { id: 'job-1', title: 'Developer', company: 'Example', applyUrl: 'https://ZA.Example.co.za/jobs/1' };

test('the packet carries declared identity and answers, never undeclared fields', () => {
  const packet = buildApplyPacket({ profile, job });
  assert.deepEqual(packet.identity.map((entry) => entry.key), ['fullName', 'email', 'linkedInUrl']);
  assert.deepEqual(packet.questions.map((entry) => entry.key), ['rightToWorkSA', 'eeRace', 'noticePeriod', 'currentSalary']);
  assert.equal(JSON.stringify(packet).includes('9001015000000'), false, 'an ID number reached the packet');
});

test('the packet names the site from the hostname, lowercased', () => {
  assert.equal(siteOf('https://ZA.Example.co.za/jobs/1'), 'za.example.co.za');
  assert.equal(siteOf('example.co.za/jobs/1'), 'example.co.za');
  assert.equal(siteOf(''), '');
  assert.equal(siteOf('not a url'), '');
  assert.equal(buildApplyPacket({ profile, job }).job.site, 'za.example.co.za');
});

test('saved answers are appended, deduplicated by question text, and labelled', () => {
  const packet = buildApplyPacket({
    profile,
    job,
    answerBank: [
      { question: 'Do you have a driver licence?', answer: 'Code B', normalized: 'driver licence' },
      { question: 'Notice period?', answer: 'Two weeks', normalized: 'notice period' },
      { question: 'Anything else?', answer: '', normalized: 'anything else' }
    ]
  });
  assert.deepEqual(packet.questions.slice(-1).map((entry) => entry.label), ['Do you have a driver licence?']);
  assert.equal(packet.questions.at(-1).source, 'answer-bank');
  assert.equal(packet.questions.filter((entry) => entry.label.toLowerCase().includes('notice')).length, 1);
});

test('missing essentials become plain-language warnings', () => {
  const packet = buildApplyPacket({ profile: {}, job: { id: 'j', title: 'T', company: 'C', applyUrl: '' } });
  assert.ok(packet.warnings.some((warning) => warning.includes('full name')));
  assert.ok(packet.warnings.some((warning) => warning.includes('email')));
  assert.ok(packet.warnings.some((warning) => warning.includes('current salary')));
  assert.ok(packet.warnings.some((warning) => warning.includes('No documents')));
  assert.ok(packet.warnings.some((warning) => warning.includes('no application link')));
});

test('values and labels are capped and documents list availability', () => {
  const packet = buildApplyPacket({
    profile: { fullName: 'N'.repeat(900), applicationProfile: { noticePeriod: 'V'.repeat(900) } },
    job,
    supportingDocs: [
      { key: 'cv', label: 'Tailored CV', fileName: 'cv.pdf', available: true },
      { key: 'id', label: 'ID Document / Passport', fileName: '', available: false }
    ]
  });
  assert.equal(packet.identity[0].value.length, 500);
  assert.equal(packet.questions[0].value.length, 500);
  assert.deepEqual(packet.documents.map((doc) => doc.available), [true, false]);
  assert.equal(packet.checklist.find((item) => item.key === 'documents-ready').done, false);
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run from `sa-job-agent-suite/`:

```bash
node --test "packages/core/src/apply/*.test.js"
```

Expected: FAIL with `Cannot find module .../packet.js`.

- [ ] **Step 3: Write the packet builder**

Create `packages/core/src/apply/packet.js`:

```js
export const VALUE_CAP = 500;
export const LABEL_CAP = 120;
const MAX_QUESTIONS = 200;
const MAX_DOCUMENTS = 20;

export const IDENTITY_FIELDS = Object.freeze([
  ['fullName', 'Full name'],
  ['email', 'Email address'],
  ['phone', 'Phone number'],
  ['linkedInUrl', 'LinkedIn profile'],
  ['portfolioUrl', 'Portfolio or website']
]);

export const QUESTION_FIELDS = Object.freeze([
  ['rightToWorkSA', 'Right to work in South Africa'],
  ['nationality', 'Nationality'],
  ['eeRace', 'Employment equity group'],
  ['gender', 'Gender'],
  ['disability', 'Disability'],
  ['noticePeriod', 'Notice period'],
  ['currentSalary', 'Current salary'],
  ['expectedSalary', 'Expected salary'],
  ['willingToRelocate', 'Willing to relocate'],
  ['driversLicense', "Driver's licence"],
  ['ownVehicle', 'Own vehicle'],
  ['highestQualification', 'Highest qualification'],
  ['yearsExperience', 'Years of experience'],
  ['criminalRecord', 'Criminal record'],
  ['creditCheckConsent', 'Credit check consent'],
  ['languages', 'Languages'],
  ['availabilityDate', 'Available from']
]);

export const HIGH_VALUE_ANSWERS = Object.freeze([
  'rightToWorkSA',
  'currentSalary',
  'expectedSalary',
  'noticePeriod'
]);

function text(value, cap) {
  return String(value == null ? '' : value).trim().slice(0, cap);
}

// Two questions that differ only by punctuation or spacing are the same
// question. Keeps "Notice period?" from repeating "Notice period".
function labelKey(value) {
  return String(value == null ? '' : value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function siteOf(url) {
  const raw = text(url, 2000);
  if (!raw) return '';
  try {
    return new URL(raw.includes('://') ? raw : `https://${raw}`).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function questionLabel(key) {
  const entry = QUESTION_FIELDS.find(([field]) => field === key);
  return entry ? entry[1] : key;
}

export function buildApplyPacket({ profile = {}, job = {}, answerBank = [], supportingDocs = [] } = {}) {
  const source = profile || {};
  const answers = source.applicationProfile || source;

  const identity = IDENTITY_FIELDS
    .map(([key, label]) => ({ key, label, value: text(source[key], VALUE_CAP) }))
    .filter((entry) => entry.value);

  const questions = [];
  for (const [key, label] of QUESTION_FIELDS) {
    const value = text(answers[key], VALUE_CAP);
    if (value) questions.push({ key, label, value, source: 'profile' });
  }
  const seen = new Set(questions.map((entry) => labelKey(entry.label)));
  for (const entry of Array.isArray(answerBank) ? answerBank : []) {
    if (questions.length >= MAX_QUESTIONS) break;
    const label = text(entry?.question, LABEL_CAP);
    const value = text(entry?.answer, VALUE_CAP);
    if (!label || !value) continue;
    const key = labelKey(label);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    questions.push({
      key: `bank-${text(entry.normalized, 80) || questions.length}`,
      label,
      value,
      source: 'answer-bank'
    });
  }

  const documents = (Array.isArray(supportingDocs) ? supportingDocs : [])
    .slice(0, MAX_DOCUMENTS)
    .map((doc) => ({
      key: text(doc?.key, 40),
      label: text(doc?.label, LABEL_CAP),
      fileName: text(doc?.fileName, 200),
      available: Boolean(doc?.available)
    }))
    .filter((doc) => doc.key && doc.label);

  const checklist = [
    { key: 'review-details', label: 'Read every detail below before you paste anything', done: true },
    {
      key: 'documents-ready',
      label: 'Have your CV and certified copies ready',
      done: documents.length > 0 && documents.every((doc) => doc.available)
    },
    { key: 'paste-id', label: 'Paste your ID or passport number straight from your own records', done: false }
  ];
  for (const key of HIGH_VALUE_ANSWERS) {
    if (questions.some((entry) => entry.key === key)) {
      checklist.push({ key: `answer-${key}`, label: `Copy: ${questionLabel(key)}`, done: false });
    }
  }
  checklist.push({
    key: 'open-portal',
    label: job && job.applyUrl ? 'Open the job site and start the form' : 'Add the application link in the tracker',
    done: false
  });
  checklist.push({ key: 'submit-on-portal', label: 'Submit on the job site, then press Mark applied', done: false });

  const warnings = [];
  if (!source.fullName) warnings.push('Add your full name in Settings so application forms are quicker to complete.');
  if (!source.email) warnings.push('Add your email address in Settings. Most portals ask for it first.');
  const missing = HIGH_VALUE_ANSWERS.filter((key) => !questions.some((entry) => entry.key === key));
  if (missing.length) {
    warnings.push(`Still missing: ${missing.map((key) => questionLabel(key).toLowerCase()).join(', ')}. Add them in Settings or type them from your own records.`);
  }
  if (!documents.some((doc) => doc.available)) {
    warnings.push('No documents are ready. You will need to upload your CV and certified copies by hand.');
  }
  if (!job || !job.applyUrl) {
    warnings.push('This job has no application link. Add one in the tracker before opening the portal.');
  }

  return {
    job: {
      id: text(job && job.id, 80),
      title: text(job && job.title, LABEL_CAP),
      company: text(job && job.company, LABEL_CAP),
      applyUrl: text(job && job.applyUrl, 2000),
      site: siteOf(job && job.applyUrl)
    },
    identity,
    questions,
    documents,
    checklist,
    warnings
  };
}
```

- [ ] **Step 4: Run the packet test**

```bash
node --test "packages/core/src/apply/packet.test.js"
```

Expected: PASS (5 tests).

- [ ] **Step 5: Write the failing submission test**

Create `packages/core/src/apply/submission.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanSubmission, summariseSubmission, SUBMISSION_DELIVERIES } from './submission.js';

const packet = {
  job: { site: 'za.example.co.za' },
  identity: [{ key: 'fullName', label: 'Full name', value: 'Thandi Mokoena' }],
  questions: [{ key: 'noticePeriod', label: 'Notice period', value: '30 days', source: 'profile' }],
  documents: [
    { key: 'cv', label: 'Tailored CV', fileName: 'cv.pdf', available: true },
    { key: 'id', label: 'ID', fileName: '', available: false }
  ]
};

test('a web submission keeps delivery, site, available documents and packet fields', () => {
  const submission = summariseSubmission(packet, { delivery: 'web-guided' });
  assert.equal(submission.delivery, 'web-guided');
  assert.equal(submission.submittedBy, 'user');
  assert.equal(submission.site, 'za.example.co.za');
  assert.deepEqual(submission.documents.map((doc) => doc.key), ['cv']);
  assert.deepEqual(submission.fields, [
    { label: 'Full name', value: 'Thandi Mokoena' },
    { label: 'Notice period', value: '30 days' }
  ]);
  assert.equal(submission.confirmation, null);
});

test('an unknown delivery or submitter is rejected', () => {
  assert.throws(() => summariseSubmission(packet, { delivery: 'magic' }), /delivery/);
  assert.throws(() => summariseSubmission(packet, { delivery: SUBMISSION_DELIVERIES[0], submittedBy: 'robot' }), /submitter/);
});

test('submission data is capped and empty rows are dropped', () => {
  const clean = cleanSubmission({
    documents: Array.from({ length: 30 }, (_, index) => ({ key: `d${index}`, label: 'Doc', fileName: 'f.pdf' })),
    fields: Array.from({ length: 100 }, (_, index) => ({ label: `Field ${index}`, value: 'V'.repeat(900) })),
    confirmation: { confirmedAt: '2026-10-28T10:00:00.000Z', text: 'T'.repeat(900) }
  });
  assert.equal(clean.documents.length, 20);
  assert.equal(clean.fields.length, 80);
  assert.equal(clean.fields[0].value.length, 500);
  assert.equal(clean.confirmation.text.length, 500);
  assert.deepEqual(cleanSubmission({ fields: [{ label: '', value: '' }] }).fields, []);
});
```

- [ ] **Step 6: Run the submission test to confirm it fails**

```bash
node --test "packages/core/src/apply/submission.test.js"
```

Expected: FAIL with `Cannot find module .../submission.js`.

- [ ] **Step 7: Write the submission module**

Create `packages/core/src/apply/submission.js`:

```js
import { VALUE_CAP, LABEL_CAP } from './packet.js';

export const SUBMISSION_DELIVERIES = Object.freeze(['web-guided', 'desktop-copilot']);
export const SUBMISSION_SUBMITTERS = Object.freeze(['user', 'copilot-confirmed']);
const MAX_FIELDS = 80;
const MAX_DOCUMENTS = 20;

function text(value, cap) {
  return String(value == null ? '' : value).trim().slice(0, cap);
}

export function cleanSubmission({ documents = [], fields = [], confirmation = null } = {}) {
  const cleanDocuments = (Array.isArray(documents) ? documents : [])
    .slice(0, MAX_DOCUMENTS)
    .map((doc) => ({
      key: text(doc?.key, 40),
      label: text(doc?.label, LABEL_CAP),
      fileName: text(doc?.fileName, 200)
    }))
    .filter((doc) => doc.key && doc.label);

  const cleanFields = (Array.isArray(fields) ? fields : [])
    .slice(0, MAX_FIELDS)
    .map((field) => ({
      label: text(field?.label, LABEL_CAP),
      value: text(field?.value, VALUE_CAP)
    }))
    .filter((field) => field.label && field.value);

  let cleanConfirmation = null;
  if (confirmation && typeof confirmation === 'object') {
    const confirmedAt = text(confirmation.confirmedAt, 40);
    const label = text(confirmation.text, VALUE_CAP);
    if (confirmedAt || label) cleanConfirmation = { confirmedAt, text: label };
  }

  return { documents: cleanDocuments, fields: cleanFields, confirmation: cleanConfirmation };
}

export function summariseSubmission(packet, { delivery, submittedBy = 'user', fields = null, confirmation = null } = {}) {
  if (!SUBMISSION_DELIVERIES.includes(delivery)) {
    throw new TypeError(`Unknown application delivery: ${delivery}`);
  }
  if (!SUBMISSION_SUBMITTERS.includes(submittedBy)) {
    throw new TypeError(`Unknown application submitter: ${submittedBy}`);
  }
  const available = (packet?.documents || []).filter((doc) => doc.available);
  const sourceFields = fields || [
    ...(packet?.identity || []),
    ...(packet?.questions || [])
  ].map(({ label, value }) => ({ label, value }));
  const clean = cleanSubmission({ documents: available, fields: sourceFields, confirmation });
  return {
    delivery,
    submittedBy,
    site: packet?.job?.site || '',
    ...clean
  };
}
```

- [ ] **Step 8: Add the public entry point and export**

Create `packages/core/src/apply/index.js`:

```js
export * from './packet.js';
export * from './submission.js';
```

Modify `packages/core/package.json` exports:

```json
    "./scrape": "./src/scrape/index.js",
    "./apply": "./src/apply/index.js"
```

- [ ] **Step 9: Run both core tests**

```bash
node --test "packages/core/src/apply/*.test.js"
```

Expected: PASS (8 tests).

- [ ] **Step 10: Commit**

```bash
git add packages/core/package.json packages/core/src/apply
git commit -m "feat(apply): shared application packet and submission clean-up"
```

---

### Task 2: Record applications through one submission shape

**Files:**
- Modify: `server/src/db/helper.js:737-775`
- Modify: `server/src/index.js` imports and routes near `server/src/index.js:787`
- Modify: `client/src/web/api.js:59-73`, `:256-287`, `:301-356`
- Modify: `client/src/App.jsx:738-755`
- Create: `server/src/db/applied.test.js`
- Modify: `server/src/errorRoutes.test.js`
- Modify: `client/src/web/api.test.js`

**Interfaces:**
- Consumes: `buildApplyPacket`, `summariseSubmission` from `@sajas/core/apply`.
- Produces: `recordApplication` accepts `delivery`, `submittedBy`, `site`, `documents`, `fields`, `confirmation`. Desktop route `POST /api/jobs/:id/applied`. Web route `POST /jobs/:id/applied` and `GET /application/bank`.

- [ ] **Step 1: Write the failing helper test**

Create `server/src/db/applied.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sajas-applied-'));
process.env.DB_PATH = path.join(dir, 'db.json');
process.env.KEYS_PATH = path.join(dir, 'keys.json');

const { recordApplication, readDb } = await import('./helper.js');

test('recordApplication keeps the submission shape and caps what it stores', () => {
  const rec = recordApplication({
    jobId: 'job-1',
    title: 'Developer',
    company: 'Example',
    delivery: 'web-guided',
    submittedBy: 'user',
    site: 'example.co.za',
    documents: [{ key: 'cv', label: 'Tailored CV', fileName: 'cv.pdf' }],
    fields: [{ label: 'Notice period', value: '30 days' }],
    confirmation: { confirmedAt: '2026-10-28T10:00:00.000Z', text: 'Application received' }
  });
  assert.equal(rec.delivery, 'web-guided');
  assert.equal(rec.site, 'example.co.za');
  assert.deepEqual(rec.documents, [{ key: 'cv', label: 'Tailored CV', fileName: 'cv.pdf' }]);
  assert.deepEqual(rec.fields, [{ label: 'Notice period', value: '30 days' }]);
  assert.equal(rec.confirmation.text, 'Application received');
  assert.equal(readDb().candidateMemory.applications.length, 1);
});

test('an existing application gains new submission details without losing its transcript', () => {
  recordApplication({ jobId: 'job-1', title: 'Developer', company: 'Example', transcript: [{ question: 'Q', answer: 'A' }] });
  const updated = recordApplication({
    jobId: 'job-1', title: 'Developer', company: 'Example',
    delivery: 'desktop-copilot', submittedBy: 'copilot-confirmed',
    site: 'example.co.za', fields: [{ label: 'Email', value: 'a@example.test' }]
  });
  assert.deepEqual(updated.transcript, [{ question: 'Q', answer: 'A' }]);
  assert.equal(updated.submittedBy, 'copilot-confirmed');
  assert.equal(readDb().candidateMemory.applications.length, 1);
});

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
node --test server/src/db/applied.test.js
```

Expected: FAIL because the first record has no `delivery` property.

- [ ] **Step 3: Extend `recordApplication`**

In `server/src/db/helper.js`, add to the imports at the top:

```js
import { cleanSubmission } from '@sajas/core/apply';
```

Replace the function signature and body region from `export function recordApplication({` to the end of that function with:

```js
export function recordApplication({
  jobId,
  title,
  company,
  salarySnapshot = null,
  transcript = [],
  outcome = 'applied',
  delivery = null,
  submittedBy = null,
  site = '',
  documents = [],
  fields = [],
  confirmation = null
}) {
  const db = readDb();
  const mem = db.candidateMemory;
  if (!Array.isArray(mem.applications)) mem.applications = [];
  const cleanTranscript = Array.isArray(transcript)
    ? transcript
        .filter((t) => t && t.question && t.answer)
        .map((t) => ({ question: String(t.question).slice(0, 300), answer: String(t.answer).slice(0, 1500) }))
    : [];
  const cleaned = cleanSubmission({ documents, fields, confirmation });
  const submission = {};
  if (delivery) submission.delivery = String(delivery).slice(0, 40);
  if (submittedBy) submission.submittedBy = String(submittedBy).slice(0, 40);
  if (site) submission.site = String(site).toLowerCase().slice(0, 200);
  if (cleaned.documents.length) submission.documents = cleaned.documents;
  if (cleaned.fields.length) submission.fields = cleaned.fields;
  if (cleaned.confirmation) submission.confirmation = cleaned.confirmation;

  let rec = jobId ? mem.applications.find((a) => a.jobId === jobId) : null;
  const isNew = !rec;
  if (!rec) {
    rec = {
      id: randomUUID(), jobId: jobId || null, title: title || '', company: company || '',
      appliedAt: new Date().toISOString(), outcome, salarySnapshot, transcript: cleanTranscript,
      ...submission
    };
    mem.applications.push(rec);
  } else {
    rec.title = title || rec.title;
    rec.company = company || rec.company;
    if (outcome) rec.outcome = outcome;
    if (salarySnapshot) rec.salarySnapshot = salarySnapshot;
    if (cleanTranscript.length) rec.transcript = cleanTranscript;
    Object.assign(rec, submission);
  }
  if (isNew && company && String(company).trim()) {
    const normalized = normalizeQuestion(company);
    if (!Array.isArray(mem.employers)) mem.employers = [];
    let emp = mem.employers.find((e) => e.normalized === normalized);
    if (!emp) {
      emp = { id: randomUUID(), company: String(company).trim(), normalized, notes: [], applications: 0, updatedAt: null };
      mem.employers.push(emp);
    }
    emp.applications = (emp.applications || 0) + 1;
    emp.updatedAt = new Date().toISOString();
  }
  touchMemory(mem);
  writeDb(db);
  return rec;
}
```

- [ ] **Step 4: Run the helper test**

```bash
node --test server/src/db/applied.test.js
```

Expected: PASS (2 tests).

- [ ] **Step 5: Add the desktop route and imports**

In `server/src/index.js`, add to the import from `./db/helper.js`: `recordApplication`, `getSupportingDocuments`.

Add to the core imports:

```js
import { buildApplyPacket, summariseSubmission } from '@sajas/core/apply';
```

Insert the route immediately before `app.post('/api/jobs/:id/apply', ...)`:

```js
app.post('/api/jobs/:id/applied', (req, res) => {
  try {
    const job = getJobs().find((entry) => entry.id === req.params.id);
    if (!job) return notFound(res, 'Job not found.');
    const profile = getProfile();
    const packet = buildApplyPacket({
      profile,
      job,
      answerBank: getAnswerBank(),
      // getSupportingDocuments() reports `uploaded`; the packet uses `available`.
      supportingDocs: [
        ...(job.tailoredCvPath
          ? [{ key: 'cv', label: 'Tailored CV', fileName: path.basename(job.tailoredCvPath), available: true }]
          : []),
        ...getSupportingDocuments()
          .filter((doc) => doc.uploaded)
          .map((doc) => ({ key: doc.key, label: doc.label, fileName: doc.fileName || '', available: true }))
      ]
    });
    const submission = summariseSubmission(packet, { delivery: 'web-guided', submittedBy: 'user' });
    const application = recordApplication({
      jobId: job.id,
      title: job.title,
      company: job.company,
      salarySnapshot: {
        current: (profile.applicationProfile || {}).currentSalary || '',
        expected: (profile.applicationProfile || {}).expectedSalary || ''
      },
      transcript: [],
      outcome: 'applied',
      ...submission
    });
    const updated = updateJob(job.id, { status: 'applied', appliedAt: application.appliedAt });
    addLog(`Marked "${job.title}" as applied.`, 'system');
    res.json({ success: true, application, job: updated });
  } catch (error) {
    sendError(res, error);
  }
});
```

- [ ] **Step 6: Add the route test to the real server suite**

Append to `server/src/errorRoutes.test.js`:

```js
test('marking a job applied records a web-guided submission without leaking undeclared profile fields', async () => {
  const created = await json(await postJson('/api/jobs', {
    title: 'Developer', company: 'Example', applyUrl: 'https://example.co.za/apply'
  }));
  await postJson('/api/profile', {
    fullName: 'Alex Example',
    email: 'alex@example.test',
    applicationProfile: { noticePeriod: '30 days', idNumber: '9001015000000' }
  });
  const res = await postJson(`/api/jobs/${created.job.id}/applied`, { delivery: 'web-guided' });
  assert.equal(res.status, 200);
  const body = await json(res);
  assert.equal(body.application.delivery, 'web-guided');
  assert.equal(body.application.site, 'example.co.za');
  assert.deepEqual(body.application.fields, [
    { label: 'Full name', value: 'Alex Example' },
    { label: 'Email address', value: 'alex@example.test' },
    { label: 'Notice period', value: '30 days' }
  ]);
  assert.equal(JSON.stringify(body).includes('9001015000000'), false, 'an ID number was recorded');

  const jobs = await json(await fetch(`${runtime.origin}/api/jobs`));
  const job = jobs.find((entry) => entry.id === created.job.id);
  assert.equal(job.status, 'applied');
});
```

Add `const json = (response) => response.json();` near `postJson` if the file does not already define it.

- [ ] **Step 7: Add the web API routes and test**

In `client/src/web/api.js`, import:

```js
import { buildApplyPacket, summariseSubmission } from '@sajas/core/apply';
```

Change the `SERVER_ONLY` entry from `/^\/application\/(?:bank|pending)(?:\/.*)?$/` to:

```js
  /^\/application\/pending(?:\/.*)?$/,
```

Add a `markApplied` function before `clearMemory`:

```js
  async function markApplied(input, init, jobId) {
    const job = await vault.get(STORES.jobs, jobId);
    if (!job) throw new AppError(ERROR_CODES.NOT_FOUND, 'Job not found.');
    const profile = (await vault.get(STORES.profile, 'current', {})) || {};
    const answerBank = await vault.getAll(STORES.answers);
    const packet = buildApplyPacket({
      profile,
      job,
      answerBank,
      supportingDocs: [
        ...(job.tailoredCvText ? [{ key: 'cv', label: 'Tailored CV', fileName: '', available: true }] : []),
        ...(job.tailoredCoverLetterText ? [{ key: 'cover-letter', label: 'Cover letter', fileName: '', available: true }] : [])
      ]
    });
    const submission = summariseSubmission(packet, { delivery: 'web-guided', submittedBy: 'user' });
    const appliedAt = now().toISOString();
    const updated = { ...job, status: 'applied', appliedAt };
    await vault.put(STORES.jobs, jobId, updated);

    const memory = await getMemory();
    let record = memory.applications.find((entry) => entry.jobId === jobId);
    if (!record) {
      record = {
        id: crypto.randomUUID(),
        jobId,
        title: job.title,
        company: job.company,
        appliedAt,
        outcome: 'applied',
        salarySnapshot: null,
        transcript: []
      };
      memory.applications.push(record);
      const normalized = String(job.company || '').trim().toLowerCase();
      let employer = memory.employers.find((entry) => String(entry.normalized || entry.company || '').toLowerCase() === normalized);
      if (!employer) {
        employer = { id: crypto.randomUUID(), company: job.company, normalized, notes: [], applications: 0, updatedAt: null };
        memory.employers.push(employer);
      }
      employer.applications = (Number(employer.applications) || 0) + 1;
      employer.updatedAt = now().toISOString();
    }
    Object.assign(record, submission);
    await saveMemory(memory);
    return ok({ success: true, application: record, job: updated });
  }
```

Add to `handle`, before the jobs routes:

```js
      if (path === '/application/bank' && method === 'GET') return ok(await vault.getAll(STORES.answers));
```

Add with the job routes:

```js
      if ((match = path.match(/^\/jobs\/([^/]+)\/applied$/)) && method === 'POST') return await markApplied(input, init, match[1]);
```

Ensure `crypto` is available in this module (it uses `crypto.randomUUID` already in `updateOutcome`, so no new import is needed).

In `client/src/web/api.test.js`, remove `['/application/bank', 'GET']` from the NOT_SUPPORTED loop, then add:

```js
test('bank answers are readable and marking applied records the packet', async () => {
  const { call, vault } = harness();
  const job = await seedJob(vault);
  await vault.put(STORES.profile, 'current', {
    fullName: 'Thandi Mokoena',
    email: 'thandi@example.test',
    applicationProfile: { noticePeriod: '30 days' }
  });
  await vault.put(STORES.answers, 'driver', { id: 'driver', question: 'Driver licence?', answer: 'Code B', normalized: 'driver licence' });

  const bank = await json(await call('/application/bank'));
  assert.equal(bank.length, 1);

  const res = await call(`/jobs/${job.id}/applied`, { method: 'POST', body: {} });
  assert.equal(res.status, 200);
  const body = await json(res);
  assert.equal(body.application.delivery, 'web-guided');
  assert.equal(body.application.site, 'example.co.za');
  assert.deepEqual(body.application.fields.map((field) => field.label), ['Full name', 'Email address', 'Notice period', 'Driver licence?']);
  assert.equal((await vault.get(STORES.jobs, job.id)).status, 'applied');

  const memory = await json(await call('/memory'));
  assert.equal(memory.applications.length, 1);
  assert.equal(memory.applications[0].delivery, 'web-guided');
});
```

`seedJob` currently sets `applyUrl: ''`; change it to `applyUrl: 'https://example.co.za/apply'` so the site assertion is meaningful.

- [ ] **Step 8: Point Mark applied at the new endpoint**

In `client/src/App.jsx`, replace the `markApplied` function body with:

```jsx
  const markApplied = async (jobId) => {
    try {
      const res = await fetch(`${API_BASE}/jobs/${jobId}/applied`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delivery: 'web-guided', submittedBy: 'user' })
      });
      if (!res.ok) throw await readResponseError(res, 'Could not mark this job as applied.');
      toasts.success('Marked as applied.');
      fetchJobs();
      if (selectedJob && selectedJob.id === jobId) {
        setSelectedJob({ ...selectedJob, status: 'applied' });
      }
    } catch (err) {
      fail(err, 'mark applied', 'Could not mark this job as applied.');
    }
  };
```

- [ ] **Step 9: Run the task tests**

```bash
node --test server/src/db/applied.test.js server/src/errorRoutes.test.js
npm --workspace client test
```

Expected: all PASS.

- [ ] **Step 10: Commit**

```bash
git add server/src/db/helper.js server/src/db/applied.test.js server/src/index.js server/src/errorRoutes.test.js client/src/web/api.js client/src/web/api.test.js client/src/App.jsx
git commit -m "feat(apply): record guided applications through one submission shape"
```

---

### Task 3: Web Apply tab and offline proof

**Files:**
- Create: `client/src/ApplyPacket.jsx`
- Modify: `client/src/web/mode.js`
- Modify: `client/src/web/mode.test.js`
- Modify: `client/src/App.jsx` imports, `headerTitles`, sidebar, tab render
- Create: `scripts/web-apply.mjs`
- Modify: `sa-job-agent-suite/package.json:17`

**Interfaces:**
- Consumes: `buildApplyPacket`, `markApplied` route, `copyToClipboard`, `printDocument`.
- Produces: a web-only `apply` tab.

- [ ] **Step 1: Update the failing mode test**

In `client/src/web/mode.test.js`, add `WEB_ONLY_TABS` to the existing import
from `./mode.js`, then append:

```js
test('the apply tab is web-only', () => {
  assert.deepEqual([...WEB_ONLY_TABS], ['apply']);
  assert.equal(isTabVisible('apply', true), true);
  assert.equal(isTabVisible('apply', false), false);
});
```

Modify `client/src/web/mode.js` by adding the new constant and changing only
`isTabVisible`; leave `SERVER_ONLY_SETTINGS`, `WEB_ONLY_SETTINGS` and
`filterSettingsTabs` untouched:

```js
export const SERVER_ONLY_TABS = Object.freeze(['copilot', 'referrals', 'routines', 'logs']);
// Tabs that only make sense in the hosted app, such as the Apply packet.
export const WEB_ONLY_TABS = Object.freeze(['apply']);

export function isTabVisible(tab, isWeb) {
  if (WEB_ONLY_TABS.includes(tab)) return Boolean(isWeb);
  return !isWeb || !SERVER_ONLY_TABS.includes(tab);
}
```

Run:

```bash
npm --workspace client test
```

Expected before the edit: FAIL with `WEB_ONLY_TABS is not defined`. After: PASS.

- [ ] **Step 2: Create the packet component**

Create `client/src/ApplyPacket.jsx` with the full component below:

```jsx
import { useMemo, useState } from 'react';
import { CheckCircle2, Circle, Copy, ExternalLink, Printer, ShieldCheck } from 'lucide-react';
import { buildApplyPacket } from '@sajas/core/apply';
import { copyToClipboard } from './clipboard.js';
import { printDocument } from './print.js';

function CopyButton({ text }) {
  const [state, setState] = useState('idle');
  return (
    <button
      type="button"
      className="btn-ghost btn-sm"
      onClick={async () => {
        const ok = await copyToClipboard(text);
        setState(ok ? 'copied' : 'failed');
        setTimeout(() => setState('idle'), 1600);
      }}
    >
      {state === 'copied' ? <CheckCircle2 size={13} /> : <Copy size={13} />}
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Select and copy' : 'Copy'}
    </button>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p className="tiny" style={{ marginBottom: 2 }}>{label}</p>
        <p style={{ margin: 0, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{value}</p>
      </div>
      <CopyButton text={value} />
    </div>
  );
}

export default function ApplyPacket({ profile, jobs, answerBank = [], onMarkApplied, busyJobId = null }) {
  const ready = useMemo(() => jobs.filter((job) => job.tailoredCvText), [jobs]);
  const [pickedId, setPickedId] = useState('');
  const job = ready.find((entry) => entry.id === pickedId) || ready[0] || null;
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

  if (!ready.length) {
    return (
      <section className="panel" style={{ padding: 24 }}>
        <h3 style={{ fontSize: 18, marginBottom: 8 }}>Apply with a packet</h3>
        <p className="muted">Nothing is ready to apply to yet. Tailor a CV first, then come back here for the copy sheet.</p>
      </section>
    );
  }

  return (
    <section className="panel" style={{ padding: 24 }}>
      <h3 style={{ fontSize: 18, marginBottom: 4 }}>Apply with a packet</h3>
      <p className="muted" style={{ marginBottom: 16 }}>
        The web app cannot type into another site's form. Copy each answer, paste it on the job site, and press Mark applied when the site confirms your submission.
      </p>

      <label className="tiny" htmlFor="apply-job" style={{ display: 'block', marginBottom: 6 }}>Job</label>
      <select id="apply-job" value={job.id} onChange={(event) => setPickedId(event.target.value)} style={{ maxWidth: 420, marginBottom: 20 }}>
        {ready.map((entry) => <option key={entry.id} value={entry.id}>{entry.title} at {entry.company}</option>)}
      </select>

      {packet.warnings.length > 0 && (
        <div role="status" style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginBottom: 20 }}>
          {packet.warnings.map((warning) => <p key={warning} className="tiny" style={{ margin: '2px 0' }}>{warning}</p>)}
        </div>
      )}

      <div style={{ display: 'grid', gap: 20 }}>
        <div>
          <h4 style={{ fontSize: 15, marginBottom: 6 }}>Your details</h4>
          {packet.identity.length
            ? packet.identity.map((entry) => <Row key={entry.key} label={entry.label} value={entry.value} />)
            : <p className="muted">Add your name and contact details in Settings.</p>}
        </div>

        <div>
          <h4 style={{ fontSize: 15, marginBottom: 6 }}>Application questions</h4>
          {packet.questions.length
            ? packet.questions.map((entry) => (
                <Row
                  key={entry.key}
                  label={`${entry.label} (${entry.source === 'answer-bank' ? 'saved answer' : 'from your profile'})`}
                  value={entry.value}
                />
              ))
            : <p className="muted">No saved answers yet. The job site will ask in its own words.</p>}
        </div>

        <div>
          <h4 style={{ fontSize: 15, marginBottom: 6 }}>Documents</h4>
          {packet.documents.map((doc) => (
            <p key={doc.key} className="tiny" style={{ margin: '4px 0' }}>
              {doc.available ? 'Ready: ' : 'Missing: '}{doc.label}{doc.fileName ? ` (${doc.fileName})` : ''}
            </p>
          ))}
          <div className="flex-gap" style={{ marginTop: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn-secondary btn-sm" onClick={() => printDocument({ title: `${job.title} CV`, text: job.tailoredCvText })}>
              <Printer size={13} /> Print CV
            </button>
            {job.tailoredCoverLetterText && (
              <button type="button" className="btn-secondary btn-sm" onClick={() => printDocument({ title: `${job.title} cover letter`, text: job.tailoredCoverLetterText })}>
                <Printer size={13} /> Print cover letter
              </button>
            )}
          </div>
        </div>

        <div>
          <h4 style={{ fontSize: 15, marginBottom: 6 }}>Before you apply</h4>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
            {packet.checklist.map((item) => (
              <li key={item.key} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                {item.done ? <CheckCircle2 size={15} color="var(--color-success)" /> : <Circle size={15} color="var(--text-muted)" />}
                <span className="tiny">{item.label}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex-gap" style={{ flexWrap: 'wrap' }}>
          {job.applyUrl ? (
            <a className="btn-primary" href={job.applyUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={15} /> Open the job site
            </a>
          ) : (
            <span className="tiny">Add the application link in the tracker first.</span>
          )}
          <button
            type="button"
            className="btn-secondary"
            disabled={job.status === 'applied' || busyJobId === job.id}
            onClick={() => onMarkApplied(job.id)}
          >
            <ShieldCheck size={15} /> {job.status === 'applied' ? 'Marked applied' : 'Mark applied'}
          </button>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Wire the tab into the shell**

In `client/src/App.jsx`:

Add `ClipboardList` to the lucide import list and import the component:

```jsx
import ApplyPacket from './ApplyPacket.jsx';
```

Add to `headerTitles`:

```jsx
    apply:     { title: 'Apply',               subtitle: 'A copy sheet for the job site, with your details, answers, documents and a checklist.' },
```

Add to the sidebar after the Document Tailor link:

```jsx
          {isTabVisible('apply', IS_WEB) && (
            <SidebarLink active={activeTab === 'apply'} onClick={() => setActiveTab('apply')} icon={<ClipboardList size={16} />}>Apply</SidebarLink>
          )}
```

Add saved answers to the web shell so the packet can include them. Near the
`jobs` state:

```jsx
  const [answerBank, setAnswerBank] = useState([]);
```

Add this loader next to `fetchJobs`:

```jsx
  const fetchAnswers = useCallback(async () => {
    if (!IS_WEB) return;
    try {
      const res = await fetch(`${API_BASE}/application/bank`);
      if (res.ok) setAnswerBank(await res.json());
    } catch {
      // The copy sheet still works without saved answers.
    }
  }, []);
```

Add `fetchAnswers()` to the first load call, so it reads:

```jsx
    Promise.all([fetchProfile(), fetchJobs(), fetchLogs(), fetchStatus(), fetchDocuments(), fetchAnswers()]);
```

Add the render block immediately before the COPILOT block:

```jsx
        {/* ============================== APPLY ============================== */}
        {IS_WEB && activeTab === 'apply' && (
          <ApplyPacket profile={profile} jobs={jobs} answerBank={answerBank} onMarkApplied={markApplied} />
        )}
```

- [ ] **Step 4: Write the browser proof**

Create `scripts/web-apply.mjs`:

```js
// Offline proof that the hosted Apply tab builds the packet, copies a field, and
// records Mark applied in the local vault. No request leaves the machine.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startStaticServer } from './lib/staticServer.mjs';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'client/dist');
const KEY = ['sk', 'ant', 'api03', 'E'.repeat(40)].join('-');

const PROFILE = {
  fullName: 'Thandi Mokoena',
  email: 'thandi@example.test',
  phone: '0000000000',
  applicationProfile: { rightToWorkSA: 'Yes', noticePeriod: '30 days', expectedSalary: 'R 55 000 per month' }
};

const JOB = {
  id: 'job-apply', title: 'Full Stack Developer', company: 'Acme',
  location: 'Cape Town', description: 'Build web applications.',
  applyUrl: 'https://example.com/apply', datePosted: '2026-10-20',
  matchScore: 88, status: 'tailored', notes: '', source: 'Manual',
  tailoredCvText: '# Tailored CV\n\nThandi Mokoena\n', tailoredCoverLetterText: '# Cover letter\n\nDear Acme\n',
  dateAdded: '2026-10-20'
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
      const tx = db.transaction(['profile', 'jobs', 'meta', 'answers'], 'readwrite');
      tx.objectStore('profile').put(profile, 'current');
      tx.objectStore('jobs').put(job, job.id);
      tx.objectStore('meta').put({ onboarded: true }, 'app');
      tx.objectStore('answers').put({ id: 'driver', question: 'Driver licence?', answer: 'Code B', normalized: 'driver licence' }, 'driver');
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
    return { jobs: await read('jobs'), memory: await read('memory') };
  });
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
    const errors = [];
    const requests = [];
    const page = await context.newPage();
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('request', (request) => requests.push(request.url()));

    await page.goto(server.url, { waitUntil: 'networkidle' });
    await page.getByTestId('onboarding').waitFor({ timeout: 20_000 });
    await seed(page);
    await page.getByTestId('key-input').fill(KEY);
    await page.getByTestId('key-submit').click();
    await page.getByRole('button', { name: /Enter the Suite/i }).click({ timeout: 20_000 });

    await page.getByRole('button', { name: /^Apply$/ }).click();
    await page.getByRole('heading', { name: 'Apply with a packet' }).waitFor();
    assert.equal(await page.getByText('Thandi Mokoena').count() > 0, true);
    assert.equal(await page.getByText('30 days').count() > 0, true);
    assert.equal(await page.getByText('R 55 000 per month').count() > 0, true);
    assert.equal(await page.getByText('Code B').count() > 0, true);

    const link = page.getByRole('link', { name: /Open the job site/i });
    assert.equal(await link.getAttribute('target'), '_blank');
    assert.match(await link.getAttribute('rel'), /noopener/);
    assert.equal(await link.getAttribute('href'), JOB.applyUrl);

    await page.getByRole('button', { name: /^Copy$/ }).first().click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'Thandi Mokoena');

    await page.getByRole('button', { name: /Mark applied/i }).click();
    await page.getByText('Marked as applied.').waitFor({ timeout: 10_000 });

    const vault = await readVault(page);
    assert.equal(vault.jobs.find((job) => job.id === JOB.id).status, 'applied');
    assert.equal(vault.memory.length, 1);
    const application = vault.memory[0].applications[0];
    assert.equal(application.delivery, 'web-guided');
    assert.equal(application.site, 'example.com');
    assert.ok(application.fields.some((field) => field.label === 'Notice period' && field.value === '30 days'));

    assert.equal((await page.content()).includes(KEY), false, 'the key appeared in the DOM');
    assert.deepEqual(errors, [], `console errors: ${errors.join(' | ')}`);
    for (const url of requests) assert.equal(url.includes(KEY), false, 'the key appeared in a request URL');

    console.log('web-apply: ok');
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

Add it to `test:web` in `sa-job-agent-suite/package.json`:

```json
    "test:web": "node scripts/check-ui.mjs && node scripts/web-canary.mjs && node scripts/web-feeds.mjs && node scripts/web-filters.mjs && node scripts/web-isolation.mjs && node scripts/web-ui.mjs && node scripts/web-tailor.mjs && node scripts/web-rag.mjs && node scripts/web-apply.mjs",
```

- [ ] **Step 5: Run the proof**

```bash
npm run build:web
node scripts/web-apply.mjs
```

Expected: `web-apply: ok`.

- [ ] **Step 6: Run client tests**

```bash
npm --workspace client test
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add client/src/ApplyPacket.jsx client/src/App.jsx client/src/web/mode.js client/src/web/mode.test.js scripts/web-apply.mjs package.json
git commit -m "feat(web): add the Apply packet tab with an offline proof"
```

---

### Task 4: Per-site login registry, consent and connect/disconnect

**Files:**
- Create: `server/src/hunter/loginSites.js`
- Create: `server/src/hunter/loginSites.test.js`
- Modify: `server/src/db/helper.js` defaults, `readDb`, accessors
- Create: `server/src/hunter/siteSessions.js`
- Create: `server/src/hunter/siteSessions.test.js`
- Modify: `server/src/agents/agent1-hunter.js:655-780`
- Modify: `server/src/index.js` routes
- Modify: `client/src/App.jsx` site login section
- Modify: `server/src/errorRoutes.test.js`

**Interfaces:**
- Consumes: `openProfileContext`.
- Produces: `LOGIN_SITES`, `loginSite(key)`, `siteForHost(host)`, `connectSite(key, opts)`, `disconnectSite(key, opts)`, `getSiteConsent()`, `setSiteConsent(entry)`, `clearSiteConsent(key)`.

- [ ] **Step 1: Write the failing registry test**

Create `server/src/hunter/loginSites.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { LOGIN_SITES, loginSite, siteForHost } from './loginSites.js';

test('the registry lists the five supported sites once each', () => {
  assert.deepEqual(LOGIN_SITES.map((site) => site.key), ['linkedin', 'indeedSa', 'pnet', 'careerJunction', 'gumtreeSa']);
  assert.equal(new Set(LOGIN_SITES.map((site) => site.key)).size, LOGIN_SITES.length);
  for (const site of LOGIN_SITES) {
    assert.match(site.origin, /^https:\/\//);
    assert.equal(typeof site.isLoggedIn, 'function');
  }
});

test('hosts match the site itself and its subdomains only', () => {
  assert.equal(siteForHost('www.linkedin.com').key, 'linkedin');
  assert.equal(siteForHost('za.indeed.com').key, 'indeedSa');
  assert.equal(siteForHost('www.pnet.co.za').key, 'pnet');
  assert.equal(siteForHost('careerjunction.co.za').key, 'careerJunction');
  assert.equal(siteForHost('evil-linkedin.com'), null);
  assert.equal(siteForHost(''), null);
  assert.equal(loginSite('missing'), null);
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
node --test server/src/hunter/loginSites.test.js
```

Expected: FAIL with `Cannot find module .../loginSites.js`.

- [ ] **Step 3: Write the registry**

Create `server/src/hunter/loginSites.js`:

```js
// One registry for the job sites that benefit from a saved login. Agent 1's
// setup/status checks, the consent store and the copilot's session gate all
// read this list, so a new site is added in exactly one place.
export const LOGIN_SITES = Object.freeze([
  {
    key: 'linkedin',
    label: 'LinkedIn',
    origin: 'https://www.linkedin.com',
    loginUrl: 'https://www.linkedin.com/login',
    checkUrl: 'https://www.linkedin.com/feed/',
    isLoggedIn: (page) => {
      const url = page.url();
      return !url.includes('/login') && !url.includes('/authwall') && !url.includes('/uas/');
    }
  },
  {
    key: 'indeedSa',
    label: 'Indeed SA',
    origin: 'https://za.indeed.com',
    loginUrl: 'https://za.indeed.com/account/login',
    checkUrl: 'https://za.indeed.com/account/view?hl=en',
    isLoggedIn: (page) => {
      const url = page.url();
      return !url.includes('/account/login') && !url.includes('/account/register');
    }
  },
  {
    key: 'pnet',
    label: 'PNet',
    origin: 'https://www.pnet.co.za',
    loginUrl: 'https://www.pnet.co.za',
    checkUrl: 'https://www.pnet.co.za',
    isLoggedIn: (page) => page.evaluate(() => {
      const header = document.querySelector('nav, header');
      if (!header) return true;
      return !Array.from(header.querySelectorAll('a, button'))
        .some((element) => /^(sign\s?in|log\s?in)$/i.test(element.textContent.trim()));
    })
  },
  {
    key: 'careerJunction',
    label: 'CareerJunction',
    origin: 'https://www.careerjunction.co.za',
    loginUrl: 'https://www.careerjunction.co.za',
    checkUrl: 'https://www.careerjunction.co.za',
    isLoggedIn: (page) => page.evaluate(() =>
      !Array.from(document.querySelectorAll('a, button'))
        .some((element) => /^(sign\s?in|log\s?in)$/i.test(element.textContent.trim()))
    )
  },
  {
    key: 'gumtreeSa',
    label: 'Gumtree SA',
    origin: 'https://www.gumtree.co.za',
    loginUrl: 'https://www.gumtree.co.za/t-login-register.html',
    checkUrl: 'https://www.gumtree.co.za/t-account.html',
    isLoggedIn: (page) => {
      const url = page.url();
      return !url.includes('login') && !url.includes('register');
    }
  }
]);

export function loginSite(key) {
  return LOGIN_SITES.find((site) => site.key === key) || null;
}

// A host matches a site when it is the site's own host or a subdomain of it,
// with a leading www. ignored on both sides (pnet.co.za == www.pnet.co.za).
export function siteForHost(host) {
  const target = String(host || '').toLowerCase().replace(/^www\./, '');
  if (!target) return null;
  return LOGIN_SITES.find((site) => {
    const base = new URL(site.origin).hostname.toLowerCase().replace(/^www\./, '');
    return target === base || target.endsWith(`.${base}`);
  }) || null;
}
```

- [ ] **Step 4: Run the registry test**

```bash
node --test server/src/hunter/loginSites.test.js
```

Expected: PASS.

- [ ] **Step 5: Add the consent store**

In `server/src/db/helper.js`, add `siteConsent: {}` to `DEFAULT_DB` next to `applyState`:

```js
  applyState: {
    isRunning: false,
    jobId: null,
    startedAt: null,
    pendingConfirmation: null
  },
  // Per-domain permission to reuse the persistent browser profile's saved login.
  // No passwords are stored; disconnecting clears the cookies and local storage
  // for that origin and removes this record.
  siteConsent: {},
```

Add `pendingConfirmation: null` because Task 6 uses it.

In `readDb` return object, add:

```js
      siteConsent: (parsed.siteConsent && typeof parsed.siteConsent === 'object' && !Array.isArray(parsed.siteConsent)) ? parsed.siteConsent : {},
```

Add after `clearCandidateMemory` (or near the apply-state helpers):

```js
export function getSiteConsent() {
  return readDb().siteConsent || {};
}

export function setSiteConsent({ siteKey, label, origin, method = 'login' }) {
  const db = readDb();
  db.siteConsent = db.siteConsent && typeof db.siteConsent === 'object' ? db.siteConsent : {};
  db.siteConsent[siteKey] = {
    siteKey,
    label,
    origin,
    connectedAt: new Date().toISOString(),
    method
  };
  writeDb(db);
  return db.siteConsent[siteKey];
}

export function clearSiteConsent(siteKey) {
  const db = readDb();
  if (db.siteConsent && db.siteConsent[siteKey]) {
    delete db.siteConsent[siteKey];
    writeDb(db);
  }
  return true;
}
```

- [ ] **Step 6: Write the failing session test**

Create `server/src/hunter/siteSessions.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sajas-sites-'));
process.env.DB_PATH = path.join(dir, 'db.json');
process.env.KEYS_PATH = path.join(dir, 'keys.json');

const { connectSite, disconnectSite } = await import('./siteSessions.js');
const { getSiteConsent } = await import('../db/helper.js');

const site = {
  key: 'example',
  label: 'Example Jobs',
  origin: 'https://jobs.example.test',
  loginUrl: 'https://jobs.example.test/login',
  checkUrl: 'https://jobs.example.test/account',
  isLoggedIn: (page) => page.isLoggedIn()
};

function fakeContext({ loggedIn = false } = {}) {
  const deleted = [];
  let state = loggedIn;
  const page = {
    isClosed: () => false,
    isLoggedIn: () => state,
    goto: async () => {},
    evaluate: async () => {},
    url: () => site.checkUrl
  };
  return {
    deleted,
    login: () => { state = true; },
    context: {
      pages: () => [page],
      newPage: async () => page,
      newCDPSession: async () => ({
        send: async (method, params) => {
          if (method === 'Network.getCookies') return { cookies: [{ name: 'session', domain: 'jobs.example.test', path: '/' }] };
          if (method === 'Network.deleteCookies') { deleted.push(params); return {}; }
          return {};
        },
        detach: async () => {}
      }),
      close: async () => {}
    }
  };
}

test('connect stores consent only after the site reports a signed-in page', async () => {
  const fake = fakeContext();
  const pending = connectSite('example', { site, openContext: async () => fake.context, timeoutMs: 900, pollMs: 10 });
  setTimeout(fake.login, 30);
  const entry = await pending;
  assert.equal(entry.siteKey, 'example');
  assert.equal(entry.origin, 'https://jobs.example.test');
  assert.equal(getSiteConsent().example.label, 'Example Jobs');
});

test('connect returns null when sign-in is never detected', async () => {
  assert.equal(await connectSite('example', { site, openContext: async () => fakeContext().context, timeoutMs: 120, pollMs: 10 }), null);
});

test('disconnect clears only that site cookies and removes consent', async () => {
  const fake = fakeContext({ loggedIn: true });
  await connectSite('example', { site, openContext: async () => fake.context, timeoutMs: 300, pollMs: 5 });
  await disconnectSite('example', { site, openContext: async () => fake.context });
  assert.deepEqual(fake.deleted, [{ name: 'session', domain: 'jobs.example.test', path: '/' }]);
  assert.equal(getSiteConsent().example, undefined);
});

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
```

- [ ] **Step 7: Run it to confirm it fails**

```bash
node --test server/src/hunter/siteSessions.test.js
```

Expected: FAIL with `Cannot find module .../siteSessions.js`.

- [ ] **Step 8: Write the session module**

Create `server/src/hunter/siteSessions.js`:

```js
import { openProfileContext } from './browser.js';
import { loginSite } from './loginSites.js';
import { setSiteConsent, clearSiteConsent } from '../db/helper.js';

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_POLL_MS = 3000;

export async function connectSite(siteKey, { site = loginSite(siteKey), openContext = openProfileContext, timeoutMs = DEFAULT_TIMEOUT_MS, pollMs = DEFAULT_POLL_MS } = {}) {
  if (!site) throw new Error('That job site is not supported yet.');
  let context;
  try {
    context = await openContext({ headless: false, viewport: null });
    const page = context.pages()[0] || await context.newPage();
    await page.goto(site.loginUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, pollMs));
      if (page.isClosed()) return null;
      try {
        if (await site.isLoggedIn(page)) {
          return setSiteConsent({ siteKey: site.key, label: site.label, origin: site.origin, method: 'login' });
        }
      } catch {
        // The page is mid-navigation; check again on the next poll.
      }
    }
    return null;
  } finally {
    if (context) await context.close().catch(() => {});
  }
}

export async function disconnectSite(siteKey, { site = loginSite(siteKey), openContext = openProfileContext } = {}) {
  if (!site) throw new Error('That job site is not supported yet.');
  let context;
  try {
    context = await openContext({ headless: true });
    const page = context.pages()[0] || await context.newPage();
    const cdp = await context.newCDPSession(page);
    try {
      const { cookies } = await cdp.send('Network.getCookies', { urls: [site.origin] });
      for (const cookie of cookies || []) {
        await cdp.send('Network.deleteCookies', {
          name: cookie.name,
          domain: cookie.domain,
          path: cookie.path
        });
      }
    } finally {
      await cdp.detach().catch(() => {});
    }
    await page.goto(site.origin, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    await page.evaluate(() => {
      try { localStorage.clear(); } catch {}
      try { sessionStorage.clear(); } catch {}
    }).catch(() => {});
  } finally {
    if (context) await context.close().catch(() => {});
  }
  clearSiteConsent(site.key);
  return true;
}
```

- [ ] **Step 9: Run the session tests**

```bash
node --test server/src/hunter/siteSessions.test.js
```

Expected: PASS (3 tests).

- [ ] **Step 10: Refactor Agent 1 onto the registry**

In `server/src/agents/agent1-hunter.js`:

Delete the local `loginSites` array inside `setupBrowserSession` and the whole `LOGIN_CHECK_SITES` constant. Import at the top:

```js
import { LOGIN_SITES } from '../hunter/loginSites.js';
```

Replace the tab-opening loop with:

```js
    for (const site of LOGIN_SITES) {
      try {
        const tab = await context.newPage();
        await tab.goto(site.loginUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        addLog(`Opened ${site.label} login tab.`, 'system');
      } catch (err) {
        addLog(`Could not open ${site.label}: ${err.message}`, 'error');
      }
    }
```

Replace the `LOGIN_CHECK_SITES.map` call in `checkLoginStatuses` with `LOGIN_SITES.map`, and replace `site.name`/`site.url` with `site.label`/`site.checkUrl`:

```js
    await Promise.all(LOGIN_SITES.map(async (site) => {
      const page = await context.newPage();
      try {
        await page.goto(site.checkUrl, { waitUntil: 'domcontentloaded', timeout: 12000 });
        statuses[site.key] = Boolean(await site.isLoggedIn(page));
      } catch {
        statuses[site.key] = false;
      } finally {
        await page.close().catch(() => {});
      }
    }));
```

- [ ] **Step 11: Add the site routes**

In `server/src/index.js`, import:

```js
import { LOGIN_SITES, loginSite } from './hunter/loginSites.js';
import { connectSite, disconnectSite } from './hunter/siteSessions.js';
```

and add `getSiteConsent` to the DB helper imports.

Add after the browser login-status route (`/api/browser/login-status`):

```js
app.get('/api/sites', (_req, res) => {
  try {
    const consent = getSiteConsent();
    res.json(LOGIN_SITES.map((site) => ({
      key: site.key,
      label: site.label,
      origin: site.origin,
      connected: Boolean(consent[site.key]),
      connectedAt: consent[site.key]?.connectedAt || null
    })));
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/sites/:key/connect', async (req, res) => {
  const site = loginSite(req.params.key);
  if (!site) return notFound(res, 'That job site is not supported.');
  const release = tryAcquireBrowser('site login');
  if (!release) return conflict(res, `A browser job is already running (${browserOwner()}).`);
  try {
    addLog(`Opening ${site.label} for sign-in. Sign in in the browser window.`, 'system');
    const entry = await connectSite(site.key);
    if (!entry) {
      return sendError(res, new AppError(ERROR_CODES.CONFLICT, 'Sign-in was not detected before the window closed.', {
        status: 408,
        retryable: true,
        hint: 'Connect again when you are ready to sign in. Nothing was saved.'
      }));
    }
    addLog(`${site.label} is connected. The copilot will reuse this login.`, 'system');
    res.json({ success: true, site: entry });
  } catch (error) {
    sendError(res, error);
  } finally {
    release();
  }
});

app.post('/api/sites/:key/disconnect', async (req, res) => {
  const site = loginSite(req.params.key);
  if (!site) return notFound(res, 'That job site is not supported.');
  const release = tryAcquireBrowser('site disconnect');
  if (!release) return conflict(res, `A browser job is already running (${browserOwner()}).`);
  try {
    await disconnectSite(site.key);
    addLog(`${site.label} disconnected. Its saved login was cleared.`, 'system');
    res.json({ success: true });
  } catch (error) {
    sendError(res, error);
  } finally {
    release();
  }
});
```

Ensure `AppError` and `ERROR_CODES` are already imported in `server/src/index.js` (they are used elsewhere). If not, import them from `@sajas/core/errors`.

The synthetic demo must still render the Profile section, so add `/api/sites` to
the demo read allowlist in `server/src/demo.js`:

```js
    '/api/hunter/sources', '/api/sites']);
```

- [ ] **Step 12: Add a route-level site test**

Append to `server/src/errorRoutes.test.js`:

```js
test('site consent starts empty and an unknown site is NOT_FOUND', async () => {
  const sites = await json(await fetch(`${runtime.origin}/api/sites`));
  assert.deepEqual(sites.map((site) => site.key), ['linkedin', 'indeedSa', 'pnet', 'careerJunction', 'gumtreeSa']);
  assert.equal(sites.every((site) => site.connected === false), true);

  const missing = await postJson('/api/sites/unknown/connect', {});
  assert.equal(missing.status, 404);
  assert.equal((await json(missing)).code, 'NOT_FOUND');
});
```

- [ ] **Step 13: Replace the Profile site logins UI**

In `client/src/App.jsx`, add state near `loginStatuses`:

```jsx
  const [sites, setSites] = useState(null);
  const [siteBusy, setSiteBusy] = useState('');
```

Add fetch and actions:

```jsx
  const fetchSites = useCallback(async () => {
    if (IS_WEB) return;
    try {
      const response = await fetch(`${API_BASE}/sites`);
      if (!response.ok) throw await readResponseError(response, 'Could not read your site logins.');
      setSites(await response.json());
    } catch (err) {
      fail(err, 'load site logins', 'Could not read your site logins.');
    }
  }, []);

  const connectSiteLogin = async (key) => {
    setSiteBusy(key);
    try {
      const response = await fetch(`${API_BASE}/sites/${key}/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      if (!response.ok) throw await readResponseError(response, 'Sign-in was not detected before the window closed.');
      toasts.success('Site connected.');
      await fetchSites();
      await fetchLoginStatuses();
    } catch (err) {
      fail(err, 'connect site', 'Could not connect this site.');
    } finally {
      setSiteBusy('');
    }
  };

  const disconnectSiteLogin = async (key) => {
    setSiteBusy(key);
    try {
      const response = await fetch(`${API_BASE}/sites/${key}/disconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      if (!response.ok) throw await readResponseError(response, 'Could not disconnect this site.');
      toasts.success('Site disconnected. Its saved login was cleared.');
      await fetchSites();
      await fetchLoginStatuses();
    } catch (err) {
      fail(err, 'disconnect site', 'Could not disconnect this site.');
    } finally {
      setSiteBusy('');
    }
  };
```

Call `fetchSites()` in the initial load (desktop only). Do not add it to the
3 second poll: consent changes only through this section, and a repeating
failed read would spam the toast area.

Replace the entire section from `{/* Browser session setup */}` through its closing `</section>` with the block below. The hosted app has no local browser, so wrap the whole block in `{!IS_WEB && (` ... `)}`:

```jsx
              <section>
                <SectionHeader
                  title="Job site logins"
                  subtitle="Connect one site at a time. The copilot reuses that site's saved login only while it is connected. Disconnecting clears that site's cookies and local storage. No passwords are stored by SA-JAS."
                />
                <div className="flex-gap" style={{ alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={fetchLoginStatuses}
                    disabled={isCheckingLogins}
                  >
                    {isCheckingLogins ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
                    {isCheckingLogins ? 'Checking...' : 'Check sign-in status'}
                  </button>
                  <span className="hint">A temporary browser session is used when a site is not connected.</span>
                </div>

                <div style={{ display: 'grid', gap: 8 }}>
                  {(sites || []).map((site) => {
                    const signedIn = loginStatuses ? loginStatuses[site.key] : null;
                    return (
                      <div key={site.key} className="panel" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px' }}>
                        <div style={{ flex: 1 }}>
                          <p style={{ margin: 0, fontWeight: 600 }}>{site.label}</p>
                          <p className="tiny" style={{ margin: 0 }}>
                            {site.connected ? 'Connected' : 'Not connected'}
                            {signedIn === true ? '. Signed in.' : signedIn === false ? '. Not signed in.' : '.'}
                          </p>
                        </div>
                        {site.connected ? (
                          <button
                            type="button"
                            className="btn-ghost btn-sm"
                            onClick={() => disconnectSiteLogin(site.key)}
                            disabled={siteBusy === site.key}
                          >
                            {siteBusy === site.key ? 'Disconnecting...' : 'Disconnect'}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            onClick={() => connectSiteLogin(site.key)}
                            disabled={Boolean(siteBusy)}
                          >
                            {siteBusy === site.key ? 'Waiting for sign-in...' : 'Connect'}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
```

Remove the now-unused `setupBrowserLogins` function and `isBrowserSetupOpen` state, plus any imports only they used (`ExternalLink` is still used by the Apply tab, so keep it).

- [ ] **Step 14: Run the task tests**

```bash
node --test server/src/hunter/loginSites.test.js server/src/hunter/siteSessions.test.js server/src/errorRoutes.test.js
npm --workspace client test
```

Expected: all PASS.

- [ ] **Step 15: Commit**

```bash
git add server/src/hunter/loginSites.js server/src/hunter/loginSites.test.js server/src/hunter/siteSessions.js server/src/hunter/siteSessions.test.js server/src/db/helper.js server/src/agents/agent1-hunter.js server/src/index.js server/src/errorRoutes.test.js client/src/App.jsx
git commit -m "feat(sites): per-domain login consent with connect and disconnect"
```

---

### Task 5: Confirmation state, submit control and field snapshots

**Files:**
- Create: `server/src/agents/applyConfirmation.js`
- Create: `server/src/agents/applyConfirmation.test.js`
- Create: `server/src/agents/submission.js`
- Create: `server/src/agents/submission.test.js`
- Modify: `server/src/agents/controls.js`
- Modify: `server/src/agents/controls.test.js`

**Interfaces:**
- Consumes: `listControls`, `classifyControl`.
- Produces: `createPendingConfirmation`, `confirmationDecision`, `pageOrigin`, `CONFIRM_TTL_MS`, `scanSubmitControls`, `captureFieldSnapshot`, `attachedFileNames`, `documentsFromFiles`, `confirmationExcerpt`, `clickSubmitControl`.

- [ ] **Step 1: Write the failing confirmation test**

Create `server/src/agents/applyConfirmation.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPendingConfirmation, confirmationDecision, pageOrigin, CONFIRM_TTL_MS } from './applyConfirmation.js';

const job = { id: 'job-1', title: 'Developer', company: 'Example' };
const control = { index: 3, text: 'Submit application' };
const now = Date.parse('2026-10-28T10:00:00.000Z');

function pending() {
  return createPendingConfirmation({
    job,
    pageUrl: 'https://jobs.example.co.za/apply/review',
    control,
    fieldsFilled: 7,
    fileNames: ['cv.pdf'],
    now,
    nonce: 'nonce-1'
  });
}

test('a pending confirmation names the job, site and counts but no field values', () => {
  const entry = pending();
  assert.equal(entry.jobTitle, 'Developer');
  assert.equal(entry.company, 'Example');
  assert.equal(entry.site, 'https://jobs.example.co.za');
  assert.equal(entry.controlText, 'Submit application');
  assert.equal(entry.controlIndex, 3);
  assert.equal(entry.fieldsFilled, 7);
  assert.deepEqual(entry.documents, ['cv.pdf']);
  assert.equal(entry.expiresAt, new Date(now + CONFIRM_TTL_MS).toISOString());
  assert.equal(JSON.stringify(entry).includes('Thandi'), false);
});

test('only a matching nonce may approve or cancel', () => {
  const entry = { ...pending(), status: 'pending' };
  assert.equal(confirmationDecision(entry, { nonce: 'other' }, now).action, 'ignore');
  assert.equal(confirmationDecision(entry, { nonce: 'nonce-1' }, now).action, 'approve');
  assert.equal(confirmationDecision(entry, { nonce: 'nonce-1', cancel: true }, now).action, 'cancel');
  assert.equal(confirmationDecision(entry, { nonce: 'nonce-1' }, now + CONFIRM_TTL_MS + 1).action, 'expired');
  assert.equal(confirmationDecision({ ...entry, status: 'approved' }, { nonce: 'nonce-1' }, now).action, 'ignore');
  assert.equal(confirmationDecision(null, { nonce: 'nonce-1' }, now).action, 'ignore');
});

test('pageOrigin survives malformed URLs by returning an empty origin', () => {
  assert.equal(pageOrigin('https://jobs.example.co.za/a'), 'https://jobs.example.co.za');
  assert.equal(pageOrigin(''), '');
  assert.equal(pageOrigin('not a url'), '');
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
node --test server/src/agents/applyConfirmation.test.js
```

Expected: FAIL with `Cannot find module .../applyConfirmation.js`.

- [ ] **Step 3: Write the confirmation module**

Create `server/src/agents/applyConfirmation.js`:

```js
import { randomUUID } from 'crypto';

export const CONFIRM_TTL_MS = 2 * 60 * 1000;

export function pageOrigin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

export function createPendingConfirmation({ job, pageUrl, control, fieldsFilled = 0, fileNames = [], now = Date.now(), nonce } = {}) {
  return {
    nonce: nonce || randomUUID(),
    jobId: job?.id || '',
    jobTitle: job?.title || '',
    company: job?.company || '',
    site: pageOrigin(pageUrl),
    pageUrl: String(pageUrl || ''),
    controlText: String(control?.text || ''),
    controlIndex: Number.isInteger(control?.index) ? control.index : null,
    fieldsFilled: Number(fieldsFilled) || 0,
    documents: (Array.isArray(fileNames) ? fileNames : []).slice(0, 20).map((name) => String(name).slice(0, 200)),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + CONFIRM_TTL_MS).toISOString(),
    status: 'pending'
  };
}

export function confirmationDecision(pending, { nonce, cancel = false } = {}, now = Date.now()) {
  if (!pending || pending.status !== 'pending') return { action: 'ignore' };
  if (!nonce || nonce !== pending.nonce) return { action: 'ignore' };
  const expiresAt = Date.parse(pending.expiresAt || '');
  if (Number.isFinite(expiresAt) && now > expiresAt) return { action: 'expired' };
  if (cancel) return { action: 'cancel' };
  return { action: 'approve' };
}
```

- [ ] **Step 4: Run the confirmation test**

```bash
node --test server/src/agents/applyConfirmation.test.js
```

Expected: PASS.

- [ ] **Step 5: Write the failing submission helper test**

Create `server/src/agents/submission.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { captureFieldSnapshot, attachedFileNames, documentsFromFiles, confirmationExcerpt } from './submission.js';

function fakePage({ fields = [], files = [], text = '' } = {}) {
  return {
    evaluate: async (fn) => {
      const source = String(fn);
      if (source.includes('querySelectorAll(\'input[type=file]\')')) return files;
      if (source.includes('document.body')) return text;
      return fields;
    }
  };
}

test('field snapshots are capped and blank values dropped before they reach the page', () => {
  const page = fakePage({
    fields: [
      { label: 'Full name', value: 'Thandi Mokoena' },
      { label: '', value: 'orphan' },
      { label: 'Notice', value: 'V'.repeat(900) }
    ]
  });
  return captureFieldSnapshot(page).then((snapshot) => {
    assert.deepEqual(snapshot.map((field) => field.label), ['Full name', 'Notice']);
    assert.equal(snapshot[1].value.length, 500);
  });
});

test('file inputs become named documents', () => {
  assert.deepEqual(documentsFromFiles(['cv.pdf', 'id.pdf']), [
    { key: 'attachment-1', label: 'Attached document', fileName: 'cv.pdf' },
    { key: 'attachment-2', label: 'Attached document', fileName: 'id.pdf' }
  ]);
  assert.deepEqual(documentsFromFiles([]), []);
});

test('the confirmation excerpt is trimmed to a readable line', async () => {
  const page = fakePage({ text: `  Application received.${'x'.repeat(900)}` });
  const text = await confirmationExcerpt(page);
  assert.equal(text.startsWith('Application received.'), true);
  assert.equal(text.length, 500);
});
```

- [ ] **Step 6: Run it to confirm it fails**

```bash
node --test server/src/agents/submission.test.js
```

Expected: FAIL with `Cannot find module .../submission.js`.

- [ ] **Step 7: Write the submission helper module**

Create `server/src/agents/submission.js`:

```js
import { listControls } from './controls.js';
import { classifyControl } from './submitGuard.js';

const MAX_FIELDS = 80;
const MAX_VALUE = 500;
const MAX_LABEL = 120;

export async function scanSubmitControls(page) {
  const controls = await listControls(page);
  const submit = controls.find((control) => classifyControl(control.text, { onFormPage: true }) === 'final-submit') || null;
  const advance = controls.find((control) => classifyControl(control.text, { onFormPage: true }) === 'advance') || null;
  return { submit, advance };
}

export async function captureFieldSnapshot(page) {
  let rows = [];
  try {
    rows = await page.evaluate(() => {
      const out = [];
      for (const element of document.querySelectorAll('input, textarea, select')) {
        if (['file', 'password', 'hidden'].includes(element.type)) continue;
        if (!element.value) continue;
        if (!element.getClientRects().length) continue;
        let label = element.getAttribute('aria-label') || '';
        if (!label && element.labels && element.labels[0]) label = element.labels[0].innerText || '';
        if (!label) label = element.getAttribute('name') || element.id || '';
        out.push({ label: String(label).replace(/\s+/g, ' ').trim(), value: String(element.value) });
      }
      return out;
    });
  } catch {
    return [];
  }
  return (Array.isArray(rows) ? rows : [])
    .slice(0, MAX_FIELDS)
    .map((row) => ({ label: String(row.label || '').slice(0, MAX_LABEL), value: String(row.value || '').slice(0, MAX_VALUE) }))
    .filter((row) => row.label && row.value);
}

export async function attachedFileNames(page) {
  try {
    const names = await page.evaluate(() => Array.from(document.querySelectorAll('input[type=file]'))
      .flatMap((element) => Array.from(element.files || []).map((file) => file.name)));
    return Array.isArray(names) ? names.slice(0, 20).map((name) => String(name).slice(0, 200)) : [];
  } catch {
    return [];
  }
}

export function documentsFromFiles(fileNames) {
  return (Array.isArray(fileNames) ? fileNames : []).slice(0, 20).map((fileName, index) => ({
    key: `attachment-${index + 1}`,
    label: 'Attached document',
    fileName: String(fileName).slice(0, 200)
  }));
}

export async function confirmationExcerpt(page) {
  try {
    const text = await page.evaluate(() => String(document.body?.innerText || ''));
    return String(text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_VALUE);
  } catch {
    return '';
  }
}
```

- [ ] **Step 8: Run the submission helper test**

```bash
node --test server/src/agents/submission.test.js
```

Expected: PASS.

- [ ] **Step 9: Add the failing control test**

Append to `server/src/agents/controls.test.js`:

```js
withBrowser('clickSubmitControl refuses without explicit confirmation and clicks once with it', async () => {
  await withPage(reviewPage({ finalLabel: 'Submit application' }), async (page) => {
    const controls = await listControls(page);
    const submit = controls.find((control) => control.text === 'Submit application');

    assert.equal((await clickSubmitControl(page, submit)).reason, 'not-confirmed');
    assert.deepEqual(await clicks(page), []);

    const result = await clickSubmitControl(page, submit, { confirmed: true });
    assert.deepEqual({ clicked: result.clicked, text: result.text }, { clicked: true, text: 'Submit application' });
    assert.deepEqual(await clicks(page), ['Submit application']);
  });
});

withBrowser('clickSubmitControl refuses a relabelled or moved final button', async () => {
  await withPage(reviewPage({ finalLabel: 'Submit application' }), async (page) => {
    const controls = await listControls(page);
    const submit = controls.find((control) => control.text === 'Submit application');
    await page.evaluate(() => {
      const button = Array.from(document.querySelectorAll('button')).find((entry) => entry.textContent.trim() === 'Submit application');
      button.textContent = 'Send application';
    });
    assert.equal((await clickSubmitControl(page, submit, { confirmed: true })).reason, 'changed');
    assert.deepEqual(await clicks(page), []);
  });
});

withBrowser('the copilot HUD is never treated as a page control', async () => {
  // The HUD's own "Mark Application as Submitted" button matches the
  // final-submit wording. If the control scan saw it, the copilot could
  // "submit" the HUD instead of the site's real button.
  const html = reviewPage({ finalLabel: 'Submit application' }).replace('</body>', `
    <div id="sajas-copilot-hud">
      <button id="sajas-btn-applied">✓ Mark Application as Submitted!</button>
      <button id="sajas-btn-autopilot">Next</button>
    </div>
  </body>`);
  await withPage(html, async (page) => {
    const controls = await listControls(page);
    assert.equal(controls.some((control) => control.text.includes('Mark Application')), false);
    assert.equal(controls.some((control) => control.text === 'Next'), false);

    const submit = controls.find((control) => control.text === 'Submit application');
    const result = await clickSubmitControl(page, submit, { confirmed: true });
    assert.deepEqual({ clicked: result.clicked, text: result.text }, { clicked: true, text: 'Submit application' });
    assert.deepEqual(await clicks(page), ['Submit application']);
    assert.equal((await page.evaluate(() => Boolean(window.sajasApplied))), false);
  });
});
```

Update the test import:

```js
import { listControls, findAdvanceControl, clickControl, clickSubmitControl } from './controls.js';
```

- [ ] **Step 10: Run it to confirm it fails**

```bash
node --test server/src/agents/controls.test.js
```

Expected: FAIL because `clickSubmitControl` is not exported.

- [ ] **Step 11: Exclude the HUD and implement `clickSubmitControl`**

The copilot's own HUD lives in `#sajas-copilot-hud` and includes the button
"✓ Mark Application as Submitted!", which matches the final-submit wording.
The scan must never see it. In `server/src/agents/controls.js`, skip HUD
descendants in `listControls` (the raw `index` is the position in
`querySelectorAll`, so skipping does not renumber the page's own controls):

```js
    return await page.evaluate(({ selector, limit }) => {
      const hud = document.getElementById('sajas-copilot-hud');
      const out = [];
      document.querySelectorAll(selector).forEach((el, index) => {
        if (hud && hud.contains(el)) return;
        const raw = el.innerText || el.value || el.getAttribute('aria-label') || '';
```

Do the same in the element lookup inside `clickControl`, so a hand-built
control can never land on the HUD:

```js
    handle = await page.evaluateHandle(({ selector, index, expected, limit }) => {
      const hud = document.getElementById('sajas-copilot-hud');
      const el = document.querySelectorAll(selector)[index];
      if (!el || (hud && hud.contains(el))) return null;
      const raw = el.innerText || el.value || el.getAttribute('aria-label') || '';
```

Then add after `clickControl`:

```js
export async function clickSubmitControl(page, control, { confirmed = false, timeout = 5000 } = {}) {
  if (!confirmed) return { clicked: false, reason: 'not-confirmed' };
  if (!control || !Number.isInteger(control.index)) return { clicked: false, reason: 'no-control' };
  const text = control.text ?? '';
  if (classifyControl(text, { onFormPage: true }) !== 'final-submit') {
    return { clicked: false, reason: 'refused', text };
  }

  const fresh = await listControls(page);
  const current = fresh.find((entry) => entry.index === control.index);
  if (!current || current.text !== text) return { clicked: false, reason: 'changed', text };

  let handle = null;
  try {
    handle = await page.evaluateHandle(({ selector, index, expected, limit }) => {
      const hud = document.getElementById('sajas-copilot-hud');
      const el = document.querySelectorAll(selector)[index];
      if (!el || (hud && hud.contains(el))) return null;
      const raw = el.innerText || el.value || el.getAttribute('aria-label') || '';
      const now = raw.replace(/\s+/g, ' ').trim().slice(0, limit);
      return now === expected ? el : null;
    }, { selector: CONTROL_SELECTOR, index: control.index, expected: text, limit: LABEL_LIMIT });
    const el = handle.asElement();
    if (!el) return { clicked: false, reason: 'changed', text };
    await el.click({ timeout });
    return { clicked: true, text };
  } catch (error) {
    return { clicked: false, reason: 'click-failed', text, error: error.message };
  } finally {
    if (handle) await handle.dispose().catch(() => {});
  }
}
```

- [ ] **Step 12: Run the control tests**

```bash
node --test server/src/agents/controls.test.js
```

Expected: PASS (all existing tests plus 3 new).

- [ ] **Step 13: Commit**

```bash
git add server/src/agents/applyConfirmation.js server/src/agents/applyConfirmation.test.js server/src/agents/submission.js server/src/agents/submission.test.js server/src/agents/controls.js server/src/agents/controls.test.js
git commit -m "feat(apply): confirmation state, field snapshots and a confirmed submit click"
```

---

### Task 6: Agent 3 final review, confirmation route and client modal

**Files:**
- Modify: `server/src/hunter/browser.js`
- Modify: `server/src/hunter/browser.test.js`
- Modify: `server/src/agents/agent3-applier.js`
- Modify: `server/src/index.js`
- Modify: `server/src/demo.js:70-72`
- Modify: `client/src/App.jsx`
- Modify: `server/src/errorRoutes.test.js`

**Interfaces:**
- Consumes: Task 5 helpers, `getSiteConsent`, `setApplyState`, `getApplyState`, `siteForHost`, `openEphemeralContext`.
- Produces: `POST /api/apply/confirm` and the in-app confirmation modal.

- [ ] **Step 1: Write the failing browser factory test**

Append to `server/src/hunter/browser.test.js`:

```js
test('openEphemeralContext creates a throwaway context without the persistent profile', async () => {
  const seen = [];
  const browser = {
    newContext: async (options) => { seen.push(options); return { kind: 'ephemeral' }; },
    close: async () => { seen.push('closed'); }
  };
  const { context, browser: started } = await openEphemeralContext({
    headless: false,
    launch: async (options) => { seen.push(options.headless); return browser; }
  });
  assert.deepEqual(context, { kind: 'ephemeral' });
  assert.equal(started, browser);
  assert.equal(seen[0], false);
  assert.equal(seen[1].locale, 'en-ZA');
});
```

Update the import:

```js
import { profileLaunchOptions, openProfileContext, openEphemeralContext, SCRAPE_LAUNCH_OPTS, LOGIN_LAUNCH_OPTS } from './browser.js';
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
node --test server/src/hunter/browser.test.js
```

Expected: FAIL because `openEphemeralContext` is not exported.

- [ ] **Step 3: Implement the ephemeral context**

In `server/src/hunter/browser.js`, append:

```js
/**
 * A throwaway browser for sites the user has not connected. It shares no
 * cookies or storage with the persistent profile, so a site without consent
 * can never see another site's saved login.
 */
export async function openEphemeralContext({ headless = false, args, viewport, serviceWorkers, launch } = {}) {
  const options = profileLaunchOptions({ headless, args, viewport });
  const start = launch || chromium.launch.bind(chromium);
  const browser = await start({ headless: options.headless, args: options.args });
  const context = await browser.newContext({
    ...(options.userAgent ? { userAgent: options.userAgent } : {}),
    viewport: options.viewport || { width: 1440, height: 1100 },
    locale: options.locale || 'en-ZA',
    timezoneId: options.timezoneId || 'Africa/Johannesburg',
    ...(serviceWorkers ? { serviceWorkers } : {})
  });
  return { context, browser };
}
```

The locale/timezone defaults matter because `LOGIN_LAUNCH_OPTS` does not set them,
and the ephemeral browser is the visible, non-headless one.

- [ ] **Step 4: Run the browser test**

```bash
node --test server/src/hunter/browser.test.js
```

Expected: PASS.

- [ ] **Step 5: Integrate the final-review flow into Agent 3**

In `server/src/agents/agent3-applier.js`:

Update imports:

```js
import { getProfile, updateJob, addLog, readDb, getAnswerBank, addPendingQuestion, normalizeQuestion, buildMemoryDigest, recordApplication, getSupportingDocuments, getSupportingDocPath, isRealPdfFile, SUPPORTING_DOC_TYPES, GENERATED_DOCS_PATH, getApplyState, setApplyState, getSiteConsent } from '../db/helper.js';
import { siteForHost } from '../hunter/loginSites.js';
import { openProfileContext, openEphemeralContext } from '../hunter/browser.js';
import { createPendingConfirmation, pageOrigin } from './applyConfirmation.js';
import { scanSubmitControls, captureFieldSnapshot, attachedFileNames, documentsFromFiles, confirmationExcerpt } from './submission.js';
```

Delete `import { chromium } from 'playwright';` on line 3. After the launch block
replacement below, neither `chromium` nor `BROWSER_PROFILE_PATH` is used in this
file; confirm with `rg "chromium|BROWSER_PROFILE_PATH" server/src/agents/agent3-applier.js`
before committing.

Replace the launch block (`let context; try { ... if (fixtureOrigin) { ... } }`) with:

```js
  let context;
  let ephemeralBrowser = null;
  let targetSite = null;
  let siteLabel = '';
  try {
    const host = new URL(job.applyUrl).hostname;
    siteLabel = host.toLowerCase();
    targetSite = siteForHost(host);
  } catch { /* no usable link */ }
  const consent = targetSite ? getSiteConsent()[targetSite.key] : null;
  const reuseSession = Boolean(targetSite && consent);
  if (!reuseSession && !fixtureOrigin) {
    addLog('This site is not connected. The copilot is using a temporary session; connect the site under Job site logins to reuse your login.', 'agent3');
  }

  try {
    const launchOpts = {
      headless,
      args: ['--start-maximized'],
      viewport: headless ? { width: 1440, height: 1100 } : null
    };
    if (reuseSession) {
      context = await openProfileContext(launchOpts);
    } else {
      const opened = await openEphemeralContext({
        ...launchOpts,
        ...(fixtureOrigin ? { serviceWorkers: 'block' } : {})
      });
      context = opened.context;
      ephemeralBrowser = opened.browser;
    }
    if (fixtureOrigin) {
      demoContexts.add(context);
      await context.route('**/*', (route) => {
        if (new URL(route.request().url()).origin === fixtureOrigin) return route.continue();
        return route.abort('blockedbyclient');
      });
    }
```

The factory already tries Chrome then Chromium, so there is no manual fallback here.

Update the pre-flight login-wall message to point at the new control:

```js
        addLog('⚠️ This portal looks like it needs you to sign in. Connect this site under Job site logins, or sign in on this window, then continue.', 'agent3');
```

Add to the state declarations around line 1142:

```js
    let confirmationText = '';
    let submittedSnapshot = null;
    // Review pages usually show the uploaded file name as text, not as a file
    // input, so remember every file the copilot attached earlier in the flow.
    const sessionFileNames = new Set();
```

Add a local screenshot helper before the loop:

```js
    const saveConfirmationShot = async (p) => {
      try {
        const target = path.join(GENERATED_DOCS_PATH, `${jobId}-confirmation.png`);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        await p.screenshot({ path: target, fullPage: true });
        return target;
      } catch (error) {
        addLog(`Could not save confirmation screenshot: ${error.message}`, 'error');
        return null;
      }
    };
```

Replace the screenshot block in the existing confirmation branch of the main
loop (the `try { confirmationShotPath = path.join(...); ... }` block around line
1295) with a single call:

```js
          confirmationShotPath = await saveConfirmationShot(p);
```

Add a local `confirmedSubmitOutcome` helper before the loop:

```js
    const rememberAttached = async (p) => {
      for (const name of await attachedFileNames(p)) sessionFileNames.add(name);
    };

    // A review step usually has no file input, so combine what is attached on
    // the current page with what was attached earlier in the same flow.
    const collectedFileNames = async (p) =>
      [...new Set([...sessionFileNames, ...(await attachedFileNames(p))])];

    const confirmedSubmitOutcome = async (p, pending, stored) => {
      if (pageOrigin(p.url()) !== pageOrigin(pending.pageUrl)) {
        return { status: 'changed', reason: 'The page changed before you confirmed. Nothing was submitted.' };
      }
      const { submit } = await scanSubmitControls(p);
      if (!submit || submit.text !== pending.controlText) {
        return { status: 'changed', reason: 'The final button changed before you confirmed. Nothing was submitted.' };
      }
      const fields = await captureFieldSnapshot(p);
      const files = await collectedFileNames(p);
      setApplyState({ pendingConfirmation: { ...stored, status: 'clicking' } });
      const result = await clickSubmitControl(p, { index: pending.controlIndex, text: pending.controlText }, { confirmed: true });
      if (!result.clicked) {
        return {
          status: 'failed',
          reason: `Nothing was submitted: the final button ${result.reason === 'changed' ? 'changed' : 'could not be clicked'}.`
        };
      }
      for (let wait = 0; wait < 30; wait++) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        if (await detectChallenge(p)) return { status: 'challenge', fields, files, pending };
        if (await detectSubmissionConfirmation(p)) return { status: 'confirmed', fields, files, pending };
      }
      return { status: 'timeout', fields, files, pending };
    };
```

Record attached files at each place the copilot attaches documents. In the manual attach block:

```js
        if (flags.attach) {
          const n = await attachCvFile(p, job.tailoredCvPath);
          const d = await attachSupportingDocs(p);
          const total = n + d;
          await rememberAttached(p);
          await p.evaluate((c) => window.sajasNotify && window.sajasNotify(
            c > 0 ? `Attached ${c} document(s). Review every upload before submitting.` : 'No matching upload field found - attach manually.'
          ), total).catch(() => {});
        }
```

In the `looksLikeForm` branch:

```js
            if (n > 0) {
              await attachCvFile(p, job.tailoredCvPath);
              await attachSupportingDocs(p);
              await rememberAttached(p);
              await p.evaluate((c) => window.sajasNotify && window.sajasNotify(
                `Auto-pilot filled ${c} field(s). Review before you submit.`
              ), n).catch(() => {});
            }
```

In the planner `fill` branch:

```js
                if (n > 0) {
                  await attachCvFile(p, job.tailoredCvPath);
                  await attachSupportingDocs(p);
                  await rememberAttached(p);
                  await p.evaluate((c) => window.sajasNotify && window.sajasNotify(
                    `Auto-pilot filled ${c} field(s). Review before you submit.`
                  ), n).catch(() => {});
                }
```

Import `clickSubmitControl` in the controls import line:

```js
import { findAdvanceControl, clickControl, clickSubmitControl } from './controls.js';
```

Add `let pendingSubmit = null;` and `const cancelledSubmitKeys = new Set();` to the per-session state near `advancedKeys`.

Inside the main loop, after the challenge handling and HUD flags, insert the pending lifecycle block before the autopilot block:

```js
        // ── Final review handshake ─────────────────────────────────────────
        if (pendingSubmit) {
          const stored = getApplyState().pendingConfirmation;
          if (!stored) {
            pendingSubmit = null;
          } else if (stored.status === 'cancelled') {
            cancelledSubmitKeys.add(`${pendingSubmit.pageUrl}::${pendingSubmit.controlText}`);
            addLog('Submit cancelled. The copilot will not offer that button again this session.', 'agent3');
            pendingSubmit = null;
            setApplyState({ pendingConfirmation: null });
          } else if (stored.status === 'approved' && !challenge.present) {
            // Wait for a verification wall to clear: clicking Submit through a
            // challenge would be both useless and unsafe.
            const outcome = await confirmedSubmitOutcome(p, pendingSubmit, stored);
            if (outcome.status === 'confirmed') {
              submittedSnapshot = {
                fields: outcome.fields,
                documents: documentsFromFiles(outcome.files),
                pending: outcome.pending
              };
              confirmationText = await confirmationExcerpt(p);
              confirmationShotPath = await saveConfirmationShot(p);
              autoConfirmed = true;
              isApplied = true;
              setApplyState({ pendingConfirmation: null });
              break;
            }
            if (outcome.status === 'timeout') {
              addLog('Submit was clicked but the site did not confirm it. Check the page yourself; nothing was recorded.', 'error');
            } else if (outcome.status === 'challenge') {
              addLog('Submit was clicked and the site showed a verification step. Check the page yourself; nothing was recorded.', 'error');
            } else {
              addLog(outcome.reason, 'error');
            }
            setApplyState({ pendingConfirmation: null });
            pendingSubmit = null;
            break;
          }
        }
```

Change the autopilot guard to include `&& !pendingSubmit`:

```js
        if (autopilot && !challenge.present && !isApplied && !pendingSubmit) {
```

Insert the offer block after the autopilot block and before the confirmation detection block:

```js
        // Offer the final button once, when the page has no step-forward control
        // left and the human has not cancelled this exact button on this URL.
        if (!isApplied && !pendingSubmit && !challenge.present) {
          const url = p.url();
          const inApplication = (await isApplicationForm(p)) || filledPages.size > 0;
          if (inApplication) {
            const { submit, advance } = await scanSubmitControls(p);
            const key = submit ? `${url}::${submit.text}` : '';
            if (submit && !advance && !cancelledSubmitKeys.has(key)) {
              const fields = await captureFieldSnapshot(p);
              const files = await collectedFileNames(p);
              pendingSubmit = createPendingConfirmation({
                job,
                pageUrl: url,
                control: submit,
                fieldsFilled: fields.length,
                fileNames: files
              });
              setApplyState({ pendingConfirmation: pendingSubmit });
              addLog('Final review reached. Confirm in SA-JAS to submit this application.', 'agent3');
              try { await p.bringToFront(); } catch {}
            }
          }
        }
```

Replace the recording block with:

```js
        recordApplication({
          jobId,
          title: job.title,
          company: job.company,
          salarySnapshot: {
            current: appProfile.currentSalary || '',
            expected: appProfile.expectedSalary || ''
          },
          transcript: sessionTranscript,
          outcome: 'applied',
          delivery: 'desktop-copilot',
          submittedBy: submittedSnapshot ? 'copilot-confirmed' : 'user',
          site: submittedSnapshot?.pending?.site || siteLabel,
          documents: submittedSnapshot?.documents || [],
          fields: submittedSnapshot?.fields || [],
          confirmation: autoConfirmed
            ? { confirmedAt: new Date().toISOString(), text: confirmationText }
            : null
        });
```

Update the final `finally` block:

```js
  } finally {
    // A pending offer belongs to this run. Clear it so a closed or finished
    // session cannot leave a confirmation dialog pointing at a dead page.
    try {
      const pending = getApplyState().pendingConfirmation;
      if (pending && pending.jobId === jobId) setApplyState({ pendingConfirmation: null });
    } catch {}
    if (context) {
      try { await context.close(); } catch {}
      demoContexts.delete(context);
      addLog('Browser session ended.', 'agent3');
    }
    if (ephemeralBrowser) {
      try { await ephemeralBrowser.close(); } catch {}
    }
  }
```

- [ ] **Step 6: Add the confirmation route**

In `server/src/index.js`, import `confirmationDecision` from `./agents/applyConfirmation.js`, and add `getApplyState`/`setApplyState` to the helper imports if not already present.

Place the route after `/api/jobs/:id/apply`:

```js
app.post('/api/apply/confirm', (req, res) => {
  const current = getApplyState().pendingConfirmation || null;
  const decision = confirmationDecision(current, req.body || {});
  if (decision.action === 'ignore') {
    if (!current) return conflict(res, 'There is nothing waiting to submit.', { hint: 'Open the copilot final review first.' });
    return conflict(res, 'That confirmation does not match the open application.', { hint: 'Use the confirmation shown in SA-JAS.' });
  }
  if (decision.action === 'expired') {
    setApplyState({ pendingConfirmation: null });
    return conflict(res, 'This confirmation expired. The copilot will offer the final button again if it is still on the page.', { retryable: true });
  }
  if (decision.action === 'cancel') {
    setApplyState({ pendingConfirmation: { ...current, status: 'cancelled' } });
    addLog('Submit cancelled in SA-JAS. Nothing was pressed.', 'agent3');
    return res.json({ success: true, cancelled: true });
  }
  setApplyState({ pendingConfirmation: { ...current, status: 'approved' } });
  addLog('Submit confirmed in SA-JAS. The copilot will press the final button once.', 'agent3');
  res.json({ success: true, approved: true });
});
```

- [ ] **Step 7: Allow the route in the synthetic demo and expose review fields**

In `server/src/demo.js`, extend the allowed POST list:

```js
    if (req.method === 'POST' && (fullPath === `/api/jobs/${DEMO_JOB_ID}/apply` ||
        fullPath === '/api/apply/confirm' ||
        /^\/api\/application\/pending\/[^/]+\/resolve$/.test(fullPath))) return next();
```

Also replace the `/demo/review` markup so the step shows the submitted values as
readonly fields. The copilot must see real field values at final review; a page
of plain text cannot prove what the submission recorded. Keep the `#details`
summary and the `#submit` button exactly as they are.

```js
  app.get('/demo/review', (_req, res) => res.send(shell('Review application', `
    <h1>Review your fictional application</h1><p>Step 2 of 2 · The copilot must leave the final button for you. Check the applicant details before proceeding.</p>
    <section><h2>Ready for your review</h2>
    <form onsubmit="return false">
      <label for="review-name">Full name</label><input id="review-name" name="fullName" readonly>
      <label for="review-email">Email address</label><input id="review-email" name="email" type="email" readonly>
      <label for="review-phone">Phone number</label><input id="review-phone" name="phone" readonly>
      <label for="review-notice">Notice period</label><input id="review-notice" name="notice" readonly>
      <label for="review-work">Right to work in South Africa</label><input id="review-work" name="work" readonly>
      <label for="review-project">${DEMO_QUESTION}</label><textarea id="review-project" name="project" readonly></textarea>
    </form>
    <pre id="details" style="white-space:pre-wrap"></pre>
    <button type="button" id="submit">Submit application</button><p id="result" role="status"></p></section>
    <script>const d=JSON.parse(sessionStorage.getItem('demoApplicant')||'{}');document.querySelector('#details').textContent=Object.entries(d).filter(([k])=>k!=='cv').map(([k,v])=>k+': '+v).join('\\n');
    document.querySelector('#review-name').value=d.fullName||'';document.querySelector('#review-email').value=d.email||'';document.querySelector('#review-phone').value=d.phone||'';document.querySelector('#review-notice').value=d.notice||'';document.querySelector('#review-work').value=d.work||'';document.querySelector('#review-project').value=d.project||'';
    document.querySelector('#submit').onclick=async()=>{const r=await fetch('/api/demo/submit',{method:'POST',headers:{'X-SAJAS-Client':'1'}});if(r.ok)location.href='/demo/confirmation';};</script>`)));
```

The fields are readonly and already filled, so `smartFillForm` skips them (it
ignores inputs with a value) and `captureFieldSnapshot` still reads them.

- [ ] **Step 8: Add the client confirmation modal and polling**

In `client/src/App.jsx`:

Add state near `hunterResult`:

```jsx
  const [pendingSubmit, setPendingSubmit] = useState(null);
  const [submitBusy, setSubmitBusy] = useState(false);
  const submitButtonRef = useRef(null);
```

In `fetchStatus`, after the hunter fields:

```jsx
      const pending = data?.apply?.pendingConfirmation || null;
      setPendingSubmit(pending && pending.status === 'pending' ? pending : null);
```

Only a `pending` entry opens the dialog. Once the user approves, the copilot
marks it `approved` and the next poll closes the dialog, so the same nonce
cannot be sent twice.

Add the resolver before `markApplied`:

```jsx
  const resolveSubmit = async (cancel) => {
    if (!pendingSubmit) return;
    setSubmitBusy(true);
    try {
      const response = await fetch(`${API_BASE}/apply/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nonce: pendingSubmit.nonce, ...(cancel ? { cancel: true } : {}) })
      });
      if (!response.ok) throw await readResponseError(response, 'Could not reach the copilot.');
      if (cancel) {
        toasts.info('Submission cancelled. The copilot will keep the page open.');
        setPendingSubmit(null);
      } else {
        toasts.success('Confirmed. The copilot is submitting now.');
        setPendingSubmit(null);
      }
    } catch (err) {
      fail(err, 'confirm submit', 'Could not confirm the submission.');
    } finally {
      setSubmitBusy(false);
    }
  };
```

Render the dialog next to `ConfirmModal`:

```jsx
      <Dialog
        open={Boolean(pendingSubmit)}
        labelledBy="submit-confirm-title"
        onClose={submitBusy ? () => {} : () => resolveSubmit(true)}
        initialFocus={submitButtonRef}
      >
        <h3 id="submit-confirm-title" style={{ fontSize: '18px', marginBottom: '8px' }}>Submit this application?</h3>
        <p className="muted" style={{ fontSize: '13px', marginBottom: '12px' }}>
          The copilot is at the final review. It will press one button, once, and record what was sent. Nothing else on the page is pressed.
        </p>
        {pendingSubmit && (
          <div className="tiny" style={{ display: 'grid', gap: 4, marginBottom: '16px' }}>
            <span><strong>{pendingSubmit.jobTitle}</strong> at {pendingSubmit.company}</span>
            <span>Site: {pendingSubmit.site}</span>
            <span>Button: {pendingSubmit.controlText}</span>
            <span>{pendingSubmit.fieldsFilled} field(s) filled. {pendingSubmit.documents.length} document(s) attached.</span>
            {pendingSubmit.documents.length > 0 && <span>{pendingSubmit.documents.join(', ')}</span>}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button type="button" className="btn-ghost" onClick={() => resolveSubmit(true)} disabled={submitBusy}>Keep reviewing</button>
          <button type="button" className="btn-primary" ref={submitButtonRef} onClick={() => resolveSubmit(false)} disabled={submitBusy}>
            {submitBusy ? 'Submitting...' : 'Submit application'}
          </button>
        </div>
      </Dialog>
```

`useRef` is already imported in App.jsx.

- [ ] **Step 9: Add the route-level confirmation test**

Append to `server/src/errorRoutes.test.js`:

```js
test('submit confirmation rejects a missing or mismatched nonce and accepts the open one', async () => {
  const empty = await postJson('/api/apply/confirm', { nonce: 'nope' });
  assert.equal(empty.status, 409);
  assert.equal((await json(empty)).code, 'CONFLICT');

  const created = await json(await postJson('/api/jobs', { title: 'Confirmation job', company: 'Example' }));
  const dbPath = path.join(runtime.directory, 'db.json');
  const db = JSON.parse(await fs.readFile(dbPath, 'utf8'));
  db.applyState = {
    isRunning: true,
    jobId: created.job.id,
    startedAt: new Date().toISOString(),
    pendingConfirmation: {
      nonce: 'nonce-open',
      jobId: created.job.id,
      jobTitle: 'Confirmation job',
      company: 'Example',
      site: 'https://example.co.za',
      pageUrl: 'https://example.co.za/review',
      controlText: 'Submit application',
      controlIndex: 1,
      fieldsFilled: 3,
      documents: [],
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 120000).toISOString(),
      status: 'pending'
    }
  };
  await fs.writeFile(dbPath, JSON.stringify(db, null, 2));

  const wrong = await postJson('/api/apply/confirm', { nonce: 'other' });
  assert.equal(wrong.status, 409);

  const approved = await postJson('/api/apply/confirm', { nonce: 'nonce-open' });
  assert.equal(approved.status, 200);
  assert.equal((await json(approved)).approved, true);

  const again = await postJson('/api/apply/confirm', { nonce: 'nonce-open' });
  assert.equal(again.status, 409);
});
```

Ensure `fs` and `path` imports exist in the test file (they do).

- [ ] **Step 10: Run the task tests**

```bash
node --test server/src/hunter/browser.test.js server/src/errorRoutes.test.js
npm --workspace client test
```

Expected: all PASS.

- [ ] **Step 11: Commit**

```bash
git add server/src/hunter/browser.js server/src/hunter/browser.test.js server/src/agents/agent3-applier.js server/src/index.js server/src/demo.js client/src/App.jsx server/src/errorRoutes.test.js
git commit -m "feat(copilot): stop at final review and submit once after confirmation"
```

---

### Task 7: Synthetic rehearsal for cancel, page change and confirmed submit

**Files:**
- Modify: `scripts/demo.test.mjs:91-179`

**Interfaces:**
- Consumes: the real Agent 3, the demo fixture, `POST /api/apply/confirm`, `/api/status`.

- [ ] **Step 1: Replace the single-session setup with a reusable opener**

In `scripts/demo.test.mjs`, replace the block from `let ready;` through `page.on('pageerror', ...)` with:

```js
    const openCopilot = async () => {
      let ready;
      const pageReady = new Promise((resolve) => { ready = resolve; });
      const session = runApplyAssistantAgent(DEMO_JOB_ID, {
        headless: true,
        pollIntervalMs: 300,
        onPageReady: (copilotPage) => { ready(copilotPage); }
      });
      const copilotPage = await Promise.race([
        pageReady,
        session.then(() => { throw new Error('Copilot ended before opening a page.'); })
      ]);
      copilotPage.on('pageerror', (error) => console.error('Fixture page error:', error.message));
      return { page: copilotPage, session };
    };

    // The existing post helper wraps its body as { answer } for the answer-bank
    // route. Confirmation calls carry their own body, so use a separate helper.
    const postJson = (payload) => ({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-SAJAS-Client': '1' },
      body: JSON.stringify(payload)
    });
    const confirm = (payload) => json('/api/apply/confirm', postJson(payload));

    const waitForPending = async (timeoutMs = 20000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const pending = (await json('/api/status')).apply.pendingConfirmation;
        if (pending && pending.status === 'pending') return pending;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      throw new Error('the copilot never offered the final review');
    };

    // Assign the outer `session` (it is awaited in the finally block): do not
    // shadow it with a new declaration.
    let page;
    ({ page, session } = await openCopilot());
```

- [ ] **Step 2: Replace the review and submission subtests**

Replace the subtests from `'review page retains the HUD and the copilot never presses the final Submit'` through `'explicit human fixture submission records a local receipt and candidate memory'` with:

```js
    await t.test('review page retains the HUD and offers a confirmation without pressing Submit', async () => {
      await page.locator('#sajas-copilot-hud').waitFor();
      const pending = await waitForPending();
      assert.equal(pending.jobTitle, 'Software Engineer');
      assert.equal(pending.company, 'Example Studio');
      assert.equal(pending.controlText, 'Submit application');
      assert.equal(pending.documents.length, 1);
      assert.equal((await json('/api/demo')).submissions, 0);
      assert.equal(readDb().jobs[0].status, 'tailored');
      assert.match(await page.locator('#details').innerText(), /Alex Example/);
      assert.match(await page.locator('#details').innerText(), /My fictional accessibility dashboard/);
      await capture(page, '03-human-review.png');
    });

    // Unchanged from the existing suite. It runs here, on the live page from the
    // first offer, before any cancel or approval.
    await t.test('copilot browser refuses requests outside the fixture origin', async () => {
      let requests = 0;
      const canary = http.createServer((_req, res) => { requests++; res.end('unexpected request'); });
      await new Promise((resolve) => canary.listen(0, '127.0.0.1', resolve));
      try {
        const result = await page.evaluate(async (url) => {
          try { await fetch(url); return 'allowed'; } catch { return 'blocked'; }
        }, `http://127.0.0.1:${canary.address().port}/canary`);
        assert.equal(result, 'blocked');
        assert.equal(requests, 0);
      } finally { await new Promise((resolve) => canary.close(resolve)); }
    });

    await t.test('cancelling leaves the page open and does not offer that button again', async () => {
      const pending = await waitForPending();
      const cancelled = await confirm({ nonce: pending.nonce, cancel: true });
      assert.equal(cancelled.cancelled, true);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const stored = (await json('/api/status')).apply.pendingConfirmation;
      assert.equal(stored, null);
      assert.equal((await json('/api/demo')).submissions, 0);
    });

    await t.test('a changed final button is not clicked even after approval', async () => {
      await page.goto(new URL('/demo/review?again=1', runtime.origin).href, { waitUntil: 'domcontentloaded' });
      const pending = await waitForPending();
      await page.locator('#submit').evaluate((button) => { button.textContent = 'Send application'; });
      const approved = await confirm({ nonce: pending.nonce });
      assert.equal(approved.approved, true);
      await session;
      assert.equal((await json('/api/demo')).submissions, 0);
      assert.equal(readDb().jobs[0].status, 'tailored');
      const memory = await json('/api/memory');
      assert.equal(memory.applications.length, 0);
    });

    await t.test('a confirmed submit is clicked once and recorded with its evidence', async () => {
      ({ page, session } = await openCopilot());
      await page.waitForURL('**/demo/review', { timeout: 20000 });
      const pending = await waitForPending();
      const approved = await confirm({ nonce: pending.nonce });
      assert.equal(approved.approved, true);
      await session;
      const job = readDb().jobs[0];
      assert.equal((await json('/api/demo')).submissions, 1);
      assert.equal(job.status, 'applied');
      assert.ok(job.appliedAt);
      assert.ok((await fs.stat(job.confirmationShotPath)).size > 0);

      const memory = await json('/api/memory');
      assert.equal(memory.applications.length, 1);
      const application = memory.applications[0];
      assert.equal(application.delivery, 'desktop-copilot');
      assert.equal(application.submittedBy, 'copilot-confirmed');
      assert.equal(application.site, runtime.origin);
      assert.ok(application.fields.some((field) => field.label === 'Full name' && field.value === 'Alex Example'));
      assert.equal(application.documents.length, 1);
      assert.match(application.confirmation.text, /received|submitted|thank you/i);
      if (evidence) await fs.copyFile(job.confirmationShotPath, path.join(evidence, '04-local-receipt.png'));

      const usage = await json('/api/usage');
      assert.equal(usage.today.calls, 0);
    });
```

The existing `post` helper stays for the answer-bank route; `postJson` and
`confirm` cover the confirmation route without wrapping the body in `{ answer }`.
Both send `X-SAJAS-Client: 1`, which the demo allows POSTs require.

- [ ] **Step 3: Confirm the canary subtest survived the replacement**

The canary subtest is included verbatim in the Step 2 block, between the review
offer and the cancel subtest. Check that it appears exactly once and still uses
the live `page` from the first offer. No other change is needed.

- [ ] **Step 4: Run the demo suite**

```bash
npm run test:demo
```

Expected: all subtests PASS, including the three new confirmation paths. If Chrome is missing locally, the suite uses the installed Chromium through `launchTestBrowser`; on CI the job installs Chromium.

- [ ] **Step 5: Commit**

```bash
git add scripts/demo.test.mjs
git commit -m "test(copilot): rehearse cancel, page change and confirmed submit"
```

---

### Task 8: Docs, gates, PR, deploy and live check

**Files:**
- Modify: `README.md` (add an "Applying from the web and desktop" section before deployment)
- Modify: `docs/superpowers/specs/2026-10-28-real-browser-apply-design.md` (status)
- Modify: `docs/superpowers/specs/2026-10-27-post-m3a3-pipeline.md` (Arc 8 row)

- [ ] **Step 1: Add the README section**

Insert before the deployment heading:

```markdown
## Applying from the web and desktop

The hosted app cannot type into another site's form. It gives you an Apply tab with a copy sheet: your details, saved answers, printable documents and a checklist. Open the job site in another tab, paste each answer, submit there, then press **Mark applied** in SA-JAS.

The desktop copilot can drive the form because it runs a real browser on your machine. It fills fields, attaches your PDFs and advances the form. At the final review it stops and asks you to confirm in SA-JAS. After you confirm, it presses the final button once, waits up to 60 seconds for the site's confirmation, and records the delivery, site, field labels and values, document names and confirmation text. If the site does not confirm, nothing is recorded and the copilot does not try again.

Job site logins are per domain. Connect a site under Profile and Settings, sign in in the window that opens, and the copilot reuses that session only while the site is connected. Disconnect clears that site's cookies and local storage. SA-JAS never stores a password, and a site without consent uses a temporary browser session that shares nothing with your other logins.
```

- [ ] **Step 2: Update the spec and pipeline status**

In `docs/superpowers/specs/2026-10-28-real-browser-apply-design.md`, change the status line to:

```markdown
**Status:** shipped 2026-10-28
```

Also make these five small spec corrections so it describes what ships:

```markdown
- Change `delivery: 'web-packet' | 'desktop-copilot'` to `delivery: 'web-guided' | 'desktop-copilot'`.
- Replace the sentence "The Profile settings section ... The old open-login-browser flow stays." with: "The Profile settings section 'Job site logins' replaces the old open-login-browser button with a row per site and Connect or Disconnect. The shared registry still powers the sign-in status check."
- Change `nonce, // 32 hex characters, one time` to `nonce, // one-time UUID`.
- Change `documents, // [{ key, fileName }]` to `documents, // file name strings`.
- Replace "A challenge that appears while a confirmation is pending clears the pending record and hands control back to the user." with "A challenge that appears while a confirmation is pending blocks the click. The copilot waits for the challenge to clear and never clicks through it."
```

In `docs/superpowers/specs/2026-10-27-post-m3a3-pipeline.md`, add the Arc 8 row to the arc table:

```markdown
| 8 | Real-browser auto-apply | Shipped 2026-10-28 (PR #19) | Guided web packet, per-site login consent, and a confirmed single-click submit |
```

Use the actual PR number after the PR is opened.

- [ ] **Step 3: Run every gate from `sa-job-agent-suite/`**

```bash
npm test
npm run test:web
npm run test:desktop
npm run test:demo
```

Expected: all pass.

From the worktree root:

```bash
node tools/check-secrets.mjs
```

Expected: no key-shaped strings, no provider names outside the allowlist.

- [ ] **Step 4: Commit the docs**

```bash
git add README.md docs/superpowers/specs/2026-10-28-real-browser-apply-design.md docs/superpowers/specs/2026-10-27-post-m3a3-pipeline.md
git commit -m "docs(arc-8): applying on web and desktop, per-site consent"
```

- [ ] **Step 5: Push, open the PR and wait for green CI**

```bash
git push -u origin arc-8-real-browser-apply
gh pr create --title "Arc 8: real-browser auto-apply with login consent" --body "$(cat <<'EOF'
## Summary
- Add a shared @sajas/core/apply packet used by a web copy sheet and the desktop copilot.
- Add per-domain login consent with connect and disconnect, and reuse the persistent profile only for connected sites.
- Stop the copilot at final review, require an explicit in-app confirmation, click Submit once, and record delivery, site, fields, documents and confirmation.

## Test plan
- [ ] npm test
- [ ] npm run test:web
- [ ] npm run test:desktop
- [ ] npm run test:demo
- [ ] node tools/check-secrets.mjs
EOF
)"
```

Wait for all six CI jobs. Merge only when every job is green:

```bash
gh pr merge --squash --delete-branch
```

- [ ] **Step 6: Deploy merged main and check the live site**

```bash
git checkout main
git pull
npm --workspace client run build:web
npx wrangler pages deploy client/dist --project-name sajas --branch main
```

Then verify with a cache-busting query, for example:

```bash
curl -s "https://sajas.pages.dev/?v=$(date +%s)" -o /dev/null -w "%{http_code}\n"
```

Expected: `200`. Open the live site and confirm the Apply tab is absent on desktop mode, present in the hosted app, and that the site still boots without an Anthropic key.

- [ ] **Step 7: Update project memory**

Update `C:\Users\Kone\.qoder\projects\C--Users-Kone--gemini-antigravity-scratch\memory\arc-8-real-browser-apply.md` with the shipped PR number, deploy time and live check result, and add the index line to `MEMORY.md`:

```markdown
- [Arc 8 real-browser apply](arc-8-real-browser-apply.md) — shipped 2026-10-28 (PR #19): shared packet, site consent, confirmed single-click submit
```

- [ ] **Step 8: Final verification**

```bash
git status --short
git log --oneline -3
```

Expected: clean worktree on `main`, with the Arc 8 merge and docs commits visible.
