# Apply Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the hosted app a canonical apply packet v2, a browser-generated tailored CV PDF, a guarded extension hand-off, and an extension delivery in the tracker.

**Architecture:** The app stays the system of record and generates everything locally. `@sajas/core` owns packet v2 and its sanitiser; the browser owns PDF generation and the `postMessage` bridge; the web API records an `extension` delivery through the existing applied route. The extension itself is Phase 3.

**Tech Stack:** React 18, Vite 7, Node test runner, pdf-lib (lazy), Playwright proofs, npm workspaces.

**Spec:** `docs/superpowers/specs/2026-11-01-apply-foundation-design.md`

## Global Constraints

- No server, no accounts, no key custody. No key may enter a packet, a bridge message, the extension bundle or a test fixture.
- Do not modify the desktop app, `server/src/demo.js`, `SYNTHETIC_DEMO`, the desktop copilot, `packages/core/src/apply/packet.js` behaviour, or `server/src/index.js`.
- Every test is offline: no Anthropic, feed or portal network call. Use fakes.
- Demo mode must not fetch documents, generate PDFs, open IndexedDB or show extension controls.
- Caps: 500 characters per value, 120 per label, 2,000 per URL, 10 attachments, 8 MB per attachment, 20 MB total, 120,000 PDF characters, 12 PDF pages.
- Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Never skip hooks.
- Run npm commands from `sa-job-agent-suite/`; run `node tools/check-secrets.mjs --all` from the worktree root.
- Branch: `arc-13-apply-foundation`, cut from `origin/main` in `.claude/worktrees/arc-9-live-demo`.

---

### Task 1: Packet v2 builder and sanitiser

**Files:**
- Create: `sa-job-agent-suite/packages/core/src/apply/packetV2.js`
- Create: `sa-job-agent-suite/packages/core/src/apply/packetV2.test.js`
- Modify: `sa-job-agent-suite/packages/core/src/apply/index.js`

**Interfaces:**
- Consumes: `buildApplyPacket`, `siteOf`, `VALUE_CAP`, `LABEL_CAP` from `./packet.js`.
- Produces: `PACKET_VERSION`, `MAX_ATTACHMENTS`, `MAX_ATTACHMENT_BYTES`, `MAX_TOTAL_ATTACHMENT_BYTES`, `buildApplyPacketV2({ profile, job, answerBank, attachments, documents, now, newId })`, `sanitisePacketV2(raw)`.

- [ ] **Step 1: Write the failing tests**

```js
// packetV2.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_ATTACHMENTS, PACKET_VERSION, buildApplyPacketV2, sanitisePacketV2
} from './packetV2.js';

const bytes = (text) => new TextEncoder().encode(text);
const profile = {
  v: 2,
  fullName: 'Thandi Mokoena',
  preferredName: 'Thandi',
  email: 'thandi@example.test',
  phone: '071 000 0000',
  linkedInUrl: 'https://linkedin.com/in/thandi',
  eeOptIn: false,
  yearsExperience: 8,
  highestQualification: 'BSc Computer Science',
  address: { city: 'Cape Town', province: 'Western Cape', postalCode: '8001' },
  salary: { currentAmount: 55000, currentPeriod: 'month', expectedAmount: 720000, expectedPeriod: 'year' },
  workHistory: [
    { company: 'Yoco', title: 'Senior Engineer', current: true },
    { company: 'Old Co', title: 'Engineer', current: false }
  ],
  applicationProfile: { noticePeriod: '30 days', eeRace: 'African', rightToWorkSA: 'Yes' }
};
const job = { id: 'j1', title: 'Backend Engineer', company: 'Acme', applyUrl: 'https://acme.example.test/jobs/1', tailoredCvText: '# CV' };

test('packet v2 carries version, id, canonical fields and formatted salaries', () => {
  const packet = buildApplyPacketV2({
    profile, job,
    now: () => new Date('2026-11-01T10:00:00.000Z'),
    newId: () => 'packet-1'
  });
  assert.equal(packet.version, PACKET_VERSION);
  assert.equal(packet.packetId, 'packet-1');
  assert.equal(packet.createdAt, '2026-11-01T10:00:00.000Z');
  assert.equal(packet.job.site, 'acme.example.test');
  assert.equal(packet.job.applyUrl, 'https://acme.example.test/jobs/1');
  const field = (key) => packet.fields.find((entry) => entry.key === key);
  assert.equal(field('firstName').value, 'Thandi');
  assert.equal(field('lastName').value, 'Mokoena');
  assert.equal(field('city').value, 'Cape Town');
  assert.equal(field('country').value, 'South Africa');
  assert.equal(field('currentCompany').value, 'Yoco');
  assert.equal(field('currentSalary').value, 'R 55 000 per month');
  assert.equal(field('expectedSalary').value, 'R 720 000 per year');
  assert.equal(field('noticePeriod').value, '30 days');
  assert.equal(field('rightToWorkSA').value, 'Yes');
  assert.equal(field('eeRace'), undefined, 'EE appeared without opt-in');
  assert.equal(JSON.stringify(packet).includes('anthropicApiKey'), false);
});

test('EE fields appear only after an explicit opt-in', () => {
  const packet = buildApplyPacketV2({ profile: { ...profile, eeOptIn: true }, job });
  assert.equal(packet.fields.find((entry) => entry.key === 'eeRace').value, 'African');
});

test('saved answers become canonical matcher fields once', () => {
  const packet = buildApplyPacketV2({
    profile, job,
    answerBank: [
      { question: 'Do you own a vehicle?', answer: 'Yes', normalized: 'own a vehicle' },
      { question: 'Notice period?', answer: 'Two weeks', normalized: 'notice period' }
    ]
  });
  assert.equal(packet.fields.filter((entry) => entry.key === 'bank:own a vehicle').length, 1);
  assert.equal(packet.fields.filter((entry) => entry.label.toLowerCase() === 'notice period?').length, 0);
});

test('attachments are validated, base64 encoded and capped', () => {
  const packet = buildApplyPacketV2({
    profile, job,
    attachments: [
      { key: 'tailored-cv', kind: 'tailored-cv', label: 'Tailored CV', fileName: 'cv.pdf', mime: 'application/pdf', bytes: bytes('%PDF-1.7\nCV') },
      { key: 'doc-1', kind: 'document', label: 'ID copy', fileName: 'id.pdf', mime: 'application/pdf', bytes: bytes('%PDF-1.7\nID') }
    ]
  });
  assert.equal(packet.attachments.length, 2);
  assert.equal(packet.attachments[0].size, 11);
  assert.equal(packet.attachments[0].dataBase64, Buffer.from('%PDF-1.7\nCV').toString('base64'));
  assert.equal(packet.attachments[0].kind, 'tailored-cv');
  assert.throws(
    () => buildApplyPacketV2({ profile, job, attachments: [{ key: 'x', kind: 'document', label: 'X', fileName: 'x.exe', mime: 'application/x-msdownload', bytes: bytes('MZ') }] }),
    /PDF, DOCX or text/
  );
  const many = Array.from({ length: MAX_ATTACHMENTS + 1 }, (_, index) => ({
    key: `d${index}`, kind: 'document', label: `D${index}`, fileName: 'd.txt', mime: 'text/plain', bytes: bytes('x')
  }));
  assert.throws(() => buildApplyPacketV2({ profile, job, attachments: many }), /up to 10/);
});

test('the sanitiser rebuilds a valid packet and drops unknown fields', () => {
  const packet = buildApplyPacketV2({ profile, job });
  const hostile = JSON.parse(JSON.stringify(packet));
  hostile.extra = 'x';
  hostile.identity[0].onClick = 'steal()';
  hostile.job.applyUrl = 'javascript:alert(1)';
  const clean = sanitisePacketV2(hostile);
  assert.equal('extra' in clean, false);
  assert.equal('onClick' in clean.identity[0], false);
  assert.equal(clean.job.applyUrl, '');
  assert.equal(clean.job.site, '');
});

test('the sanitiser rejects hostile attachments and versions', () => {
  const packet = buildApplyPacketV2({ profile, job });
  assert.throws(() => sanitisePacketV2({ ...packet, version: 1 }), /version/);
  assert.throws(
    () => sanitisePacketV2({ ...packet, attachments: [{ key: 'a', kind: 'document', label: 'A', fileName: 'a.pdf', mime: 'application/pdf', size: 99, dataBase64: 'AAAA' }] }),
    /size/
  );
  assert.throws(
    () => sanitisePacketV2({ ...packet, attachments: [{ key: 'a', kind: 'document', label: 'A', fileName: 'a.pdf', mime: 'application/pdf', size: 4, dataBase64: 'not base64!' }] }),
    /base64/
  );
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test --workspace=@sajas/core -- --test-name-pattern="packet v2|sanitiser|EE fields|saved answers|attachments are validated"`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `packetV2.js`**

```js
// Packet v2 for the extension hand-off. It extends v1 display data with a
// canonical matcher list and validated attachment bytes; the desktop keeps v1.
import { LABEL_CAP, MAX_DOCUMENTS, VALUE_CAP, buildApplyPacket, siteOf } from './packet.js';

export const PACKET_VERSION = 2;
export const MAX_ATTACHMENTS = 10;
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_PACKET_ID = 80;
const MAX_QUESTIONS = 200;
const MAX_FIELDS = 120;
const MAX_CHECKLIST = 30;
const MAX_WARNINGS = 30;
const MAX_BASE64 = Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const MIME_BY_KIND = {
  'tailored-cv': ['application/pdf'],
  document: ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain']
};

const text = (value, cap) => String(value == null ? '' : value).trim().slice(0, cap);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function money(amount, period) {
  const number = Number(amount);
  if (!Number.isFinite(number) || number <= 0) return '';
  const grouped = String(Math.round(number)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `R ${grouped} per ${period === 'year' ? 'year' : 'month'}`;
}

function toBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

function byteLength(dataBase64) {
  return atob(dataBase64).length;
}

function attachmentOf(raw, seen) {
  if (!isObject(raw)) throw new TypeError('An attachment was not a record.');
  const key = text(raw.key, 40);
  const kind = text(raw.kind, 20);
  const label = text(raw.label, LABEL_CAP);
  const fileName = text(raw.fileName, 200);
  const mime = text(raw.mime, 120);
  if (!key || !label || !fileName) throw new TypeError('An attachment was missing its name.');
  if (seen.has(key)) throw new TypeError('Two attachments used the same key.');
  seen.add(key);
  if (!MIME_BY_KIND[kind] || !MIME_BY_KIND[kind].includes(mime)) {
    throw new TypeError('Only PDF, DOCX and text files can be attached.');
  }
  const bytes = raw.bytes instanceof Uint8Array ? raw.bytes : new Uint8Array(raw.bytes || []);
  if (!bytes.length) throw new TypeError('An attachment was empty.');
  if (bytes.length > MAX_ATTACHMENT_BYTES) throw new TypeError('Each attachment must be 8 MB or smaller.');
  return { key, kind, label, fileName, mime, size: bytes.length, dataBase64: toBase64(bytes) };
}

export function buildApplyPacketV2({
  profile = {}, job = {}, answerBank = [], documents = [], attachments = [],
  now = () => new Date(), newId = () => crypto.randomUUID()
} = {}) {
  if (!Array.isArray(attachments)) throw new TypeError('Attachments must be a list.');
  if (attachments.length > MAX_ATTACHMENTS) throw new TypeError('You can attach up to 10 files.');
  const seen = new Set();
  const cleanAttachments = attachments.map((entry) => attachmentOf(entry, seen));
  const total = cleanAttachments.reduce((sum, entry) => sum + entry.size, 0);
  if (total > MAX_TOTAL_ATTACHMENT_BYTES) throw new TypeError('Attachments must total 20 MB or less.');

  const supportingDocs = (Array.isArray(documents) ? documents : []).map((doc) => ({
    key: text(doc.key, 40), label: text(doc.label, LABEL_CAP), fileName: text(doc.fileName, 200), available: Boolean(doc.available)
  }));
  const base = buildApplyPacket({ profile, job, answerBank, supportingDocs });

  const fields = [];
  const add = (key, label, value, source = 'profile') => {
    const clean = text(value, VALUE_CAP);
    if (clean) fields.push({ key, label, value: clean, source });
  };
  const name = text(profile.fullName, VALUE_CAP);
  const [firstName, ...rest] = name.split(' ').filter(Boolean);
  const address = isObject(profile.address) ? profile.address : {};
  const salary = isObject(profile.salary) ? profile.salary : {};
  const history = Array.isArray(profile.workHistory) ? profile.workHistory.filter(isObject) : [];
  const current = history.find((entry) => entry.current === true) || history[0] || {};
  const answers = isObject(profile.applicationProfile) ? profile.applicationProfile : profile;

  add('fullName', 'Full name', name);
  add('firstName', 'First name', firstName || '');
  add('lastName', 'Last name', rest.join(' '));
  add('preferredName', 'Preferred name', profile.preferredName);
  add('email', 'Email address', profile.email);
  add('phone', 'Phone number', profile.phone);
  add('linkedInUrl', 'LinkedIn profile', profile.linkedInUrl);
  add('portfolioUrl', 'Portfolio or website', profile.portfolioUrl);
  add('githubUrl', 'GitHub profile', profile.githubUrl);
  add('city', 'City', address.city);
  add('province', 'Province', address.province);
  add('postalCode', 'Postal code', address.postalCode);
  add('country', 'Country', 'South Africa');
  add('currentCompany', 'Current employer', current.company);
  add('currentTitle', 'Current job title', current.title);
  add('yearsExperience', 'Years of experience', profile.yearsExperience);
  add('highestQualification', 'Highest qualification', profile.highestQualification);
  add('noticePeriod', 'Notice period', answers.noticePeriod);
  add('currentSalary', 'Current salary', money(salary.currentAmount, salary.currentPeriod));
  add('expectedSalary', 'Expected salary', money(salary.expectedAmount, salary.expectedPeriod));
  add('rightToWorkSA', 'Right to work in South Africa', answers.rightToWorkSA);
  add('willingToRelocate', 'Willing to relocate', answers.willingToRelocate);
  add('driversLicense', "Driver's licence", answers.driversLicense);
  add('ownVehicle', 'Own vehicle', answers.ownVehicle);
  add('availabilityDate', 'Available from', answers.availabilityDate);
  if (profile.eeOptIn === true) {
    add('eeRace', 'Employment equity group', answers.eeRace);
    add('gender', 'Gender', answers.gender);
    add('disability', 'Disability', answers.disability);
  }
  for (const entry of base.questions.filter((question) => question.source === 'answer-bank')) {
    add(entry.key, entry.label, entry.value, 'answer-bank');
  }

  return {
    version: PACKET_VERSION,
    packetId: text(newId(), MAX_PACKET_ID),
    createdAt: now().toISOString(),
    job: { ...base.job, applyUrl: text(job && job.applyUrl, 2000) },
    identity: base.identity,
    questions: base.questions,
    fields: fields.slice(0, MAX_FIELDS),
    attachments: cleanAttachments,
    checklist: base.checklist,
    warnings: base.warnings
  };
}

export function sanitisePacketV2(raw) {
  if (!isObject(raw) || raw.version !== PACKET_VERSION) throw new TypeError('That is not a version 2 apply packet.');
  const packetId = text(raw.packetId, MAX_PACKET_ID);
  if (!packetId) throw new TypeError('That packet has no id.');
  if (typeof raw.createdAt !== 'string' || Number.isNaN(Date.parse(raw.createdAt))) {
    throw new TypeError('That packet has no valid creation time.');
  }
  if (!isObject(raw.job) || !text(raw.job.id, 80)) throw new TypeError('That packet has no job.');
  let applyUrl = text(raw.job.applyUrl, 2000);
  if (applyUrl && !/^https?:\/\//i.test(applyUrl)) applyUrl = '';
  const entries = (list, cap, withSource) => {
    if (!Array.isArray(list)) throw new TypeError('That packet has an invalid field list.');
    return list.slice(0, cap).map((entry) => {
      if (!isObject(entry)) throw new TypeError('That packet has an invalid field.');
      const key = text(entry.key, 80);
      const label = text(entry.label, LABEL_CAP);
      const value = text(entry.value, VALUE_CAP);
      if (!key || !label) throw new TypeError('That packet has an invalid field.');
      return withSource ? { key, label, value, source: text(entry.source, 20) || 'profile' } : { key, label, value };
    });
  };
  const seen = new Set();
  if (!Array.isArray(raw.attachments)) throw new TypeError('That packet has no attachment list.');
  if (raw.attachments.length > MAX_ATTACHMENTS) throw new TypeError('That packet has too many attachments.');
  let total = 0;
  const attachments = raw.attachments.map((entry) => {
    if (!isObject(entry)) throw new TypeError('That packet has an invalid attachment.');
    const key = text(entry.key, 40);
    const kind = text(entry.kind, 20);
    const label = text(entry.label, LABEL_CAP);
    const fileName = text(entry.fileName, 200);
    const mime = text(entry.mime, 120);
    if (!key || !label || !fileName || seen.has(key)) throw new TypeError('That packet has an invalid attachment.');
    seen.add(key);
    if (!MIME_BY_KIND[kind] || !MIME_BY_KIND[kind].includes(mime)) throw new TypeError('That packet has an unsupported attachment type.');
    const dataBase64 = typeof entry.dataBase64 === 'string' ? entry.dataBase64 : '';
    if (!dataBase64 || dataBase64.length > MAX_BASE64 || dataBase64.length % 4 !== 0 || !BASE64.test(dataBase64)) {
      throw new TypeError('That packet has invalid base64 data.');
    }
    let size;
    try {
      size = byteLength(dataBase64);
    } catch {
      throw new TypeError('That packet has invalid base64 data.');
    }
    if (size > MAX_ATTACHMENT_BYTES) throw new TypeError('That packet has an attachment over 8 MB.');
    if (Number(entry.size) !== size) throw new TypeError('That packet has an attachment whose size does not match its data.');
    total += size;
    if (total > MAX_TOTAL_ATTACHMENT_BYTES) throw new TypeError('That packet has attachments over 20 MB in total.');
    return { key, kind, label, fileName, mime, size, dataBase64 };
  });
  const checklist = Array.isArray(raw.checklist)
    ? raw.checklist.slice(0, MAX_CHECKLIST).map((entry) => ({ key: text(entry?.key, 80), label: text(entry?.label, LABEL_CAP), done: entry?.done === true }))
    : [];
  const warnings = Array.isArray(raw.warnings) ? raw.warnings.slice(0, MAX_WARNINGS).map((entry) => text(entry, LABEL_CAP)) : [];
  return {
    version: PACKET_VERSION,
    packetId,
    createdAt: raw.createdAt,
    job: { id: text(raw.job.id, 80), title: text(raw.job.title, LABEL_CAP), company: text(raw.job.company, LABEL_CAP), applyUrl, site: applyUrl ? siteOf(applyUrl) : '' },
    identity: entries(raw.identity || [], MAX_FIELDS, false),
    questions: entries(raw.questions || [], MAX_QUESTIONS, true),
    fields: entries(raw.fields || [], MAX_FIELDS, true),
    attachments,
    checklist,
    warnings
  };
}
```

Add `export * from './packetV2.js';` to `packages/core/src/apply/index.js`.

- [ ] **Step 4: Run the core tests**

Run: `npm test --workspace=@sajas/core`
Expected: all pass, including the new packet v2 tests.

- [ ] **Step 5: Commit**

```bash
git add sa-job-agent-suite/packages/core/src/apply/packetV2.js sa-job-agent-suite/packages/core/src/apply/packetV2.test.js sa-job-agent-suite/packages/core/src/apply/index.js
git commit -m "feat(core): add apply packet v2 with validated attachments"
```

---

### Task 2: Extension delivery in the submission contract

**Files:**
- Modify: `sa-job-agent-suite/packages/core/src/apply/submission.js`
- Test: `sa-job-agent-suite/packages/core/src/apply/submission.test.js`

**Interfaces:**
- Produces: `SUBMISSION_DELIVERIES` includes `extension`; `summariseSubmission(packet, { delivery: 'extension', fields, confirmation })` returns `{ delivery, submittedBy, site, documents, fields, confirmation }`.

- [ ] **Step 1: Write the failing test**

```js
test('an extension delivery is accepted and keeps the user as submitter', () => {
  const packet = {
    job: { site: 'acme.example.test' },
    documents: [{ key: 'cv', label: 'Tailored CV', fileName: 'cv.pdf', available: true }],
    identity: [], questions: []
  };
  const submission = summariseSubmission(packet, {
    delivery: 'extension',
    fields: [{ label: 'Email address', value: 'thandi@example.test' }],
    confirmation: { confirmedAt: '2026-11-01T10:00:00.000Z', text: 'Submit application' }
  });
  assert.equal(submission.delivery, 'extension');
  assert.equal(submission.submittedBy, 'user');
  assert.deepEqual(submission.fields, [{ label: 'Email address', value: 'thandi@example.test' }]);
  assert.equal(submission.confirmation.text, 'Submit application');
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test --workspace=@sajas/core -- --test-name-pattern="extension delivery"`
Expected: FAIL with "Unknown application delivery: extension".

- [ ] **Step 3: Add the delivery value**

Change line 3 of `submission.js` to:

```js
export const SUBMISSION_DELIVERIES = Object.freeze(['web-guided', 'desktop-copilot', 'extension']);
```

- [ ] **Step 4: Run the core tests**

Run: `npm test --workspace=@sajas/core`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add sa-job-agent-suite/packages/core/src/apply/submission.js sa-job-agent-suite/packages/core/src/apply/submission.test.js
git commit -m "feat(core): accept an extension delivery in submissions"
```

---

### Task 3: The applied route accepts an extension result

**Files:**
- Modify: `sa-job-agent-suite/client/src/web/api.js:421-440` (the `markApplied` function)
- Test: `sa-job-agent-suite/client/src/web/api.test.js`

**Interfaces:**
- Consumes: `bodyOf`, `summariseSubmission`, the existing vault.
- Produces: `POST /jobs/:id/applied` with an optional `{ delivery, fields, confirmation }` body; defaults to `web-guided`; rejects any other delivery with `VALIDATION`.

- [ ] **Step 1: Write the failing API tests**

```js
test('an extension result is recorded with its fields and confirmation', async () => {
  const { api, stored } = harness({
    jobs: { j1: { id: 'j1', title: 'Backend Engineer', company: 'Acme', status: 'tailored', tailoredCvText: '# CV', applyUrl: 'https://acme.example.test/1' } },
    profile: { current: { fullName: 'Thandi', email: 'thandi@example.test', v: 2 } }
  });
  const res = await api.handle(new Request('http://local/api/jobs/j1/applied', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      delivery: 'extension',
      fields: [{ label: 'Email address', value: 'thandi@example.test' }],
      confirmation: { confirmedAt: '2026-11-01T10:00:00.000Z', text: 'Submit application' }
    })
  }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.job.status, 'applied');
  assert.equal(body.application.delivery, 'extension');
  assert.deepEqual(body.application.fields, [{ label: 'Email address', value: 'thandi@example.test' }]);
  assert.equal(stored.jobs.j1.status, 'applied');
});

test('an unknown delivery is rejected without touching the job', async () => {
  const { api, stored } = harness({ jobs: { j1: { id: 'j1', title: 'T', company: 'C', status: 'tailored', tailoredCvText: '# CV' } } });
  const res = await api.handle(new Request('http://local/api/jobs/j1/applied', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ delivery: 'desktop-copilot' })
  }));
  assert.equal(res.status, 400);
  assert.equal(stored.jobs.j1.status, 'tailored');
});

test('an empty body still records a web-guided submission', async () => {
  const { api } = harness({ jobs: { j1: { id: 'j1', title: 'T', company: 'C', status: 'tailored', tailoredCvText: '# CV' } } });
  const res = await api.handle(new Request('http://local/api/jobs/j1/applied', { method: 'POST' }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).application.delivery, 'web-guided');
});
```

Use the existing `harness` helper and `stored` access in `api.test.js`; if it does not expose `stored`, read the same file first and extend the helper the way its other tests do.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test --workspace=client -- --test-name-pattern="extension result|unknown delivery|empty body still records"`
Expected: the extension test fails; the other two pass.

- [ ] **Step 3: Read the body and pass it through**

Replace the first lines of `markApplied` and the submission line:

```js
  async function markApplied(input, init, jobId) {
    const body = await bodyOf(input, init);
    const delivery = body.delivery === undefined ? 'web-guided' : body.delivery;
    if (delivery !== 'web-guided' && delivery !== 'extension') {
      throw new AppError(ERROR_CODES.VALIDATION, 'That application delivery is not supported in the web app.');
    }
    const job = await vault.get(STORES.jobs, jobId);
```

and

```js
    const submission = summariseSubmission(packet, {
      delivery,
      submittedBy: 'user',
      fields: Array.isArray(body.fields) ? body.fields : null,
      confirmation: body.confirmation || null
    });
```

- [ ] **Step 4: Run the client tests**

Run: `npm test --workspace=client`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add sa-job-agent-suite/client/src/web/api.js sa-job-agent-suite/client/src/web/api.test.js
git commit -m "feat(web): record extension deliveries through the applied route"
```

---

### Task 4: Tailored CV PDF

**Files:**
- Modify: `sa-job-agent-suite/client/package.json` (move `pdf-lib` from devDependencies to dependencies)
- Create: `sa-job-agent-suite/client/src/web/pdf/cvPdf.js`
- Create: `sa-job-agent-suite/client/src/web/pdf/cvPdf.test.js`

**Interfaces:**
- Produces: `createCvPdf({ text, title })` → `Promise<Uint8Array>`; `MAX_PDF_TEXT = 120000`, `MAX_PDF_PAGES = 12`; `safePdfFileName(title)`.

- [ ] **Step 1: Write the failing tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { createCvPdf, safePdfFileName } from './cvPdf.js';

test('a tailored CV becomes a valid multi-page PDF', async () => {
  const text = ['# Thandi Mokoena', 'Senior Backend Engineer', '', '## Experience', '- Built payment systems', ...Array.from({ length: 80 }, (_, i) => `Line ${i} of a long CV`)].join('\n');
  const bytes = await createCvPdf({ text, title: 'Backend Engineer CV' });
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-');
  const doc = await PDFDocument.load(bytes);
  assert.ok(doc.getPageCount() >= 2);
});

test('accented text and punctuation do not throw', async () => {
  const bytes = await createCvPdf({ text: '# André Mokoena — Engineer’s CV\nThe café cost R 50.', title: 'CV' });
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-');
});

test('empty and oversized text are refused with plain messages', async () => {
  await assert.rejects(() => createCvPdf({ text: '   ' }), /empty/);
  await assert.rejects(() => createCvPdf({ text: 'x'.repeat(120001) }), /too long/);
});

test('file names are safe and end in .pdf', () => {
  assert.equal(safePdfFileName('Backend / Engineer: CV?'), 'Backend-Engineer-CV.pdf');
  assert.equal(safePdfFileName(''), 'tailored-cv.pdf');
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test --workspace=client -- --test-name-pattern="tailored CV becomes|accented text|oversized text|file names are safe"`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `cvPdf.js`**

```js
// Tailored CV to PDF, entirely in the browser. pdf-lib is lazy so the main
// bundle stays small; the output is a plain A4 document with no images or links.
export const MAX_PDF_TEXT = 120000;
export const MAX_PDF_PAGES = 12;

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;
const BODY_SIZE = 10.5;
const HEADING_SIZE = 14;
const LINE_HEIGHT = 15;
const MAX_LINE_WIDTH = PAGE_WIDTH - MARGIN * 2;

const REPLACEMENTS = new Map([
  ['\u2018', "'"], ['\u2019', "'"], ['\u201c', '"'], ['\u201d', '"'],
  ['\u2013', '-'], ['\u2014', '-'], ['\u2026', '...'], ['\u00a0', ' '],
  ['\u2022', '-']
]);

function winAnsiSafe(value) {
  let out = '';
  for (const char of String(value)) {
    const mapped = REPLACEMENTS.get(char) ?? char;
    for (const piece of mapped) {
      const code = piece.codePointAt(0);
      if (code === 10 || code === 13 || code === 9 || (code >= 32 && code <= 255)) out += piece;
    }
  }
  return out;
}

function plain(value) {
  return winAnsiSafe(value).replace(/\*\*|__|`/g, '').replace(/^\s*#{1,6}\s*/, '').trimEnd();
}

export function safePdfFileName(title) {
  const base = String(title ?? '')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return `${base || 'tailored-cv'}.pdf`;
}

function wrap(line, font, size, width) {
  const words = line.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width || !current) current = next;
    else { lines.push(current); current = word; }
  }
  lines.push(current);
  return lines;
}

export async function createCvPdf({ text, title = 'Tailored CV' }) {
  const source = String(text ?? '').replace(/\r\n/g, '\n');
  if (!source.trim()) throw new Error('The tailored CV is empty, so there is nothing to make into a PDF.');
  if (source.length > MAX_PDF_TEXT) throw new Error('That CV is too long to make into a PDF. Trim it first.');
  const { PDFDocument, StandardFonts } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  doc.setTitle(plain(title).slice(0, 120) || 'Tailored CV');
  doc.setProducer('SA-JAS');
  doc.setCreator('SA-JAS');
  const body = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const newPage = () => {
    if (doc.getPageCount() >= MAX_PDF_PAGES) {
      throw new Error(`That CV needs more than ${MAX_PDF_PAGES} pages. Trim it first.`);
    }
    page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
  };

  for (const raw of source.split('\n')) {
    const heading = /^\s*#/.test(raw);
    const bullet = /^\s*[-*]\s+/.test(raw);
    const content = plain(raw.replace(/^\s*[-*]\s+/, ''));
    if (!content) { y -= LINE_HEIGHT * 0.6; continue; }
    const font = heading ? bold : body;
    const size = heading ? HEADING_SIZE : BODY_SIZE;
    const width = MAX_LINE_WIDTH - (bullet ? 14 : 0);
    const lines = wrap(content, font, size, width);
    for (const line of lines) {
      if (y < MARGIN + LINE_HEIGHT) newPage();
      page.drawText(bullet ? `- ${line}` : line, { x: MARGIN + (bullet ? 10 : 0), y, size, font });
      y -= LINE_HEIGHT;
    }
    if (heading) y -= 4;
  }
  return doc.save();
}
```

- [ ] **Step 4: Run the PDF tests**

Run: `npm test --workspace=client -- --test-name-pattern="tailored CV becomes|accented text|oversized text|file names are safe"`
Expected: PASS. If pdf-lib cannot encode a character, add it to `REPLACEMENTS`; do not use a font with a network dependency.

- [ ] **Step 5: Run the client suite and commit**

```bash
npm test --workspace=client
git add sa-job-agent-suite/client/package.json sa-job-agent-suite/client/package-lock.json sa-job-agent-suite/client/src/web/pdf/cvPdf.js sa-job-agent-suite/client/src/web/pdf/cvPdf.test.js
git commit -m "feat(web): generate a tailored CV PDF in the browser"
```

The lockfile lives at the repo root (`sa-job-agent-suite/package-lock.json`) in this workspace; stage the file that `git status` reports after the dependency move.

---

### Task 5: Extension bridge

**Files:**
- Create: `sa-job-agent-suite/client/src/web/extensionBridge.js`
- Create: `sa-job-agent-suite/client/src/web/extensionBridge.test.js`

**Interfaces:**
- Produces: `createExtensionBridge({ window: win, origin, nonce, timeoutMs = 1200, ackTimeoutMs = 3000 })` → `{ probe(), send(packet), dispose() }`.
- `send` resolves `{ ok: true }` or `{ ok: false, reason, message }`, never rejects.

- [ ] **Step 1: Write the failing tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createExtensionBridge } from './extensionBridge.js';

function fakeWindow() {
  const listeners = new Set();
  const sent = [];
  return {
    location: { origin: 'https://sajas.pages.dev' },
    sent,
    addEventListener(type, fn) { if (type === 'message') listeners.add(fn); },
    removeEventListener(type, fn) { if (type === 'message') listeners.delete(fn); },
    postMessage(data, origin) { sent.push({ data, origin }); },
    receive(data, { origin = 'https://sajas.pages.dev', source = this } = {}) {
      for (const fn of listeners) fn({ data, origin, source });
    }
  };
}

const packet = {
  version: 2, packetId: 'p1', createdAt: '2026-11-01T10:00:00.000Z',
  job: { id: 'j1', title: 'T', company: 'C', applyUrl: 'https://acme.example.test/1', site: 'acme.example.test' },
  identity: [{ key: 'fullName', label: 'Full name', value: 'Thandi' }],
  questions: [], fields: [], attachments: [], checklist: [], warnings: []
};

test('probe resolves true only for a ready message with the same nonce', async () => {
  const win = fakeWindow();
  const bridge = createExtensionBridge({ window: win, nonce: 'n1', timeoutMs: 30 });
  const ready = bridge.probe();
  win.receive({ source: 'sajas-extension', type: 'sajas:ready', version: 1, nonce: 'wrong' });
  win.receive({ source: 'sajas-extension', type: 'sajas:ready', version: 1, nonce: 'n1' });
  assert.equal(await ready, true);
  assert.deepEqual(win.sent[0], {
    data: { source: 'sajas-app', type: 'sajas:hello', version: 1, nonce: 'n1' },
    origin: 'https://sajas.pages.dev'
  });
  bridge.dispose();
});

test('probe resolves false when no extension answers', async () => {
  const win = fakeWindow();
  const bridge = createExtensionBridge({ window: win, nonce: 'n1', timeoutMs: 10 });
  assert.equal(await bridge.probe(), false);
  bridge.dispose();
});

test('send posts a validated packet once and waits for a matching ack', async () => {
  const win = fakeWindow();
  const bridge = createExtensionBridge({ window: win, nonce: 'n1', ackTimeoutMs: 50 });
  const result = bridge.send(packet);
  const posted = win.sent.find((entry) => entry.data.type === 'sajas:packet');
  assert.equal(posted.data.packet.packetId, 'p1');
  win.receive({ source: 'sajas-extension', type: 'sajas:ack', version: 1, nonce: 'n1', packetId: 'p1' });
  assert.deepEqual(await result, { ok: true });
  bridge.dispose();
});

test('foreign origins, wrong sources, wrong nonces and invalid packets are refused', async () => {
  const win = fakeWindow();
  const bridge = createExtensionBridge({ window: win, nonce: 'n1', ackTimeoutMs: 10 });
  const rejected = bridge.send({ ...packet, version: 1 });
  assert.equal(win.sent.filter((entry) => entry.data.type === 'sajas:packet').length, 0);
  assert.equal((await rejected).ok, false);

  const pending = bridge.send(packet);
  win.receive({ source: 'sajas-extension', type: 'sajas:ack', version: 1, nonce: 'n1', packetId: 'p1' }, { origin: 'https://evil.example' });
  win.receive({ source: {}, type: 'sajas:ack', version: 1, nonce: 'n1', packetId: 'p1' });
  win.receive({ source: 'sajas-extension', type: 'sajas:ack', version: 1, nonce: 'n1', packetId: 'p1' });
  assert.deepEqual(await pending, { ok: true });
  bridge.dispose();
  assert.equal(win.sent.filter((entry) => entry.data.type === 'sajas:packet').length, 1);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test --workspace=client -- --test-name-pattern="probe resolves|send posts|foreign origins"`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `extensionBridge.js`**

```js
// The app half of the extension hand-off. One window, one origin, one nonce per
// page load; a message that fails any of those checks is ignored.
import { sanitisePacketV2 } from '@sajas/core/apply';

export const BRIDGE_VERSION = 1;
const APP = 'sajas-app';
const EXTENSION = 'sajas-extension';

export function createExtensionBridge({
  window: win = globalThis.window,
  origin = win?.location?.origin || '',
  nonce = globalThis.crypto?.randomUUID?.() || String(Date.now()),
  timeoutMs = 1200,
  ackTimeoutMs = 3000
} = {}) {
  const listeners = new Set();
  let disposed = false;

  function accepts(event) {
    return !disposed
      && event?.source === win
      && event?.origin === origin
      && event?.data?.source === EXTENSION
      && event?.data?.version === BRIDGE_VERSION
      && event?.data?.nonce === nonce;
  }

  function onMessage(event) {
    if (!accepts(event)) return;
    for (const listener of [...listeners]) listener(event.data);
  }

  win?.addEventListener?.('message', onMessage);

  function post(data) {
    win?.postMessage?.(data, origin);
  }

  function waitFor(type, match, timeout) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { listeners.delete(listener); resolve(null); }, timeout);
      const listener = (data) => {
        if (data.type !== type || !match(data)) return;
        clearTimeout(timer);
        listeners.delete(listener);
        resolve(data);
      };
      listeners.add(listener);
    });
  }

  return {
    async probe() {
      const ready = waitFor('sajas:ready', () => true, timeoutMs);
      post({ source: APP, type: 'sajas:hello', version: BRIDGE_VERSION, nonce });
      return Boolean(await ready);
    },
    async send(rawPacket) {
      let packet;
      try {
        packet = sanitisePacketV2(rawPacket);
      } catch (error) {
        return { ok: false, reason: 'invalid', message: error.message };
      }
      const ack = waitFor('sajas:ack', (data) => data.packetId === packet.packetId, ackTimeoutMs);
      post({ source: APP, type: 'sajas:packet', version: BRIDGE_VERSION, nonce, packet });
      const received = await ack;
      if (received) return { ok: true };
      return { ok: false, reason: 'timeout', message: 'The extension did not confirm the packet. Check that it is installed and enabled, then try again.' };
    },
    dispose() {
      disposed = true;
      listeners.clear();
      win?.removeEventListener?.('message', onMessage);
    }
  };
}
```

- [ ] **Step 4: Run the bridge tests and commit**

```bash
npm test --workspace=client -- --test-name-pattern="probe resolves|send posts|foreign origins"
git add sa-job-agent-suite/client/src/web/extensionBridge.js sa-job-agent-suite/client/src/web/extensionBridge.test.js
git commit -m "feat(web): add a nonce-guarded extension bridge"
```

---

### Task 6: Apply mode with documents, PDF and send

**Files:**
- Modify: `sa-job-agent-suite/client/src/ApplyPacket.jsx`
- Modify: `sa-job-agent-suite/client/src/App.jsx:2038-2047`
- Create: `sa-job-agent-suite/client/src/web/download.js`
- Create: `sa-job-agent-suite/client/src/web/download.test.js`

**Interfaces:**
- Consumes: `buildApplyPacketV2`, `createCvPdf`, `safePdfFileName`, `createExtensionBridge`.
- Produces: `downloadBytes(bytes, fileName)` using a Blob URL and a temporary anchor, revoking the URL; ApplyPacket gains `apiBase` and `demo` props.

- [ ] **Step 1: Write the failing download test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadBytes } from './download.js';

test('a download creates one object URL, clicks one link and revokes it', () => {
  const created = [];
  const clicked = [];
  const revoked = [];
  const documentRef = {
    createElement: () => ({
      set href(value) { created.push(value); },
      set download(value) { this.fileName = value; },
      click() { clicked.push(this.fileName); }
    })
  };
  downloadBytes(new Uint8Array([1, 2, 3]), 'cv.pdf', {
    document: documentRef,
    url: { createObjectURL: () => 'blob:one', revokeObjectURL: (value) => revoked.push(value) },
    Blob,
    setTimeout: (fn) => fn()
  });
  assert.deepEqual(created, ['blob:one']);
  assert.deepEqual(clicked, ['cv.pdf']);
  assert.deepEqual(revoked, ['blob:one']);
});
```

- [ ] **Step 2: Write `download.js`**

```js
export function downloadBytes(bytes, fileName, {
  document: doc = globalThis.document,
  url = globalThis.URL,
  Blob: BlobCtor = globalThis.Blob,
  setTimeout: later = globalThis.setTimeout
} = {}) {
  const blobUrl = url.createObjectURL(new BlobCtor([bytes], { type: 'application/pdf' }));
  const link = doc.createElement('a');
  link.href = blobUrl;
  link.download = fileName;
  link.click();
  later(() => url.revokeObjectURL(blobUrl), 2000);
}
```

Run: `npm test --workspace=client -- --test-name-pattern="a download creates"` → PASS.

- [ ] **Step 3: Update `ApplyPacket.jsx`**

Keep every existing section and copy button. Add state and effects:

```js
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildApplyPacketV2 } from '@sajas/core/apply';
import { createCvPdf, safePdfFileName } from './web/pdf/cvPdf.js';
import { createExtensionBridge } from './web/extensionBridge.js';
import { downloadBytes } from './web/download.js';
```

```js
export default function ApplyPacket({ profile, jobs, answerBank = [], onMarkApplied, busyJobId = null, demo = false, onOpenPortal = null, apiBase = '' }) {
  const [documents, setDocuments] = useState([]);
  const [chosenDocs, setChosenDocs] = useState(() => new Set());
  const [bridgeReady, setBridgeReady] = useState(false);
  const [sending, setSending] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const bridgeRef = useRef(null);
```

```js
  useEffect(() => {
    if (demo || !apiBase) return;
    let live = true;
    fetch(`${apiBase}/documents`)
      .then((res) => (res.ok ? res.json() : []))
      .then((list) => {
        if (!live) return;
        const usable = Array.isArray(list) ? list.filter((doc) => ['cv', 'certified-id', 'qualification', 'cover-letter'].includes(doc.kind)) : [];
        setDocuments(usable);
        const defaults = usable.filter((doc) => doc.kind === 'cv' && doc.isDefault).map((doc) => doc.id);
        setChosenDocs(new Set(defaults));
      })
      .catch(() => {});
    const bridge = createExtensionBridge();
    bridgeRef.current = bridge;
    bridge.probe().then((ready) => { if (live) setBridgeReady(ready); });
    return () => { live = false; bridge.dispose(); bridgeRef.current = null; };
  }, [apiBase, demo]);
```

Add helpers:

```js
  const tailoredPdf = useCallback(async () => {
    if (!job?.tailoredCvText) return null;
    return createCvPdf({ text: job.tailoredCvText, title: `${job.title} CV` });
  }, [job]);

  const downloadTailored = async () => {
    setPdfBusy(true);
    try {
      downloadBytes(await tailoredPdf(), safePdfFileName(`${job.title}-cv`));
    } catch (error) {
      toasts?.error?.(error.message);
    } finally {
      setPdfBusy(false);
    }
  };

  const sendToExtension = async () => {
    if (!bridgeRef.current) return;
    setSending(true);
    try {
      const pdf = await tailoredPdf();
      const attachments = [];
      if (pdf) attachments.push({
        key: 'tailored-cv', kind: 'tailored-cv', label: 'Tailored CV',
        fileName: safePdfFileName(`${job.title}-cv`), mime: 'application/pdf', bytes: pdf
      });
      for (const doc of documents.filter((entry) => chosenDocs.has(entry.id))) {
        const res = await fetch(`${apiBase}/documents/${doc.id}/file`);
        if (!res.ok) throw new Error('Could not read one of your documents.');
        const body = await res.json();
        const binary = atob(body.dataBase64);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        attachments.push({
          key: doc.id, kind: 'document', label: doc.label, fileName: body.fileName,
          mime: body.mime, bytes
        });
      }
      const packet = buildApplyPacketV2({
        profile, job, answerBank, attachments,
        documents: [
          ...(pdf ? [{ key: 'tailored-cv', label: 'Tailored CV', fileName: safePdfFileName(`${job.title}-cv`), available: true }] : []),
          ...documents.map((doc) => ({ key: doc.id, label: doc.label, fileName: doc.fileName, available: chosenDocs.has(doc.id) }))
        ]
      });
      const result = await bridgeRef.current.send(packet);
      if (result.ok) toasts?.success?.('Packet sent to the extension. It will not submit until you confirm on the job page.');
      else toasts?.error?.(result.message);
    } catch (error) {
      toasts?.error?.(error.message);
    } finally {
      setSending(false);
    }
  };
```

`ApplyPacket` needs a `toasts` prop; pass it from App (`toasts={toasts}`). Add UI below the Documents heading, hidden when `demo`:

- A line `Base CV: <fileName>` or "No CV is stored yet. Add one in Profile & Settings > Documents."
- A checkbox list of usable documents (`data-testid="apply-documents"`), default CV preselected.
- Buttons: Download tailored CV PDF (`data-testid="download-tailored-pdf"`), Send to extension (`data-testid="send-to-extension"`), with copy "The extension is not installed yet." when `bridgeReady` is false. Keep the "Open the job site" and "Mark applied" buttons.
- Do not show extension controls when `demo` is true.

- [ ] **Step 4: Wire App**

At `App.jsx:2039-2046`, pass `apiBase={API_BASE}` and `toasts={toasts}`.

- [ ] **Step 5: Run the build and tests**

```bash
npm test --workspace=client
npm run build:web
```

Expected: tests pass; the build succeeds with a separate lazy chunk for pdf-lib.

- [ ] **Step 6: Commit**

```bash
git add sa-job-agent-suite/client/src/ApplyPacket.jsx sa-job-agent-suite/client/src/App.jsx sa-job-agent-suite/client/src/web/download.js sa-job-agent-suite/client/src/web/download.test.js
git commit -m "feat(web): send packets, attachments and a tailored PDF from Apply mode"
```

---

### Task 7: Browser proof

**Files:**
- Modify: `sa-job-agent-suite/scripts/web-apply.mjs`

**Interfaces:**
- Consumes: the built web app and the local static server; no network.

- [ ] **Step 1: Read the current proof**

Read `scripts/web-apply.mjs` and `scripts/lib/staticServer.mjs`. It seeds a tailored job, opens Apply, checks the copy sheet and marks applied. Extend it without changing its existing assertions.

- [ ] **Step 2: Add the PDF download and absent-extension assertions**

After the copy sheet checks and before marking applied:

```js
const downloadEvent = page.waitForEvent('download');
await page.getByTestId('download-tailored-pdf').click();
const savedPdf = await downloadEvent;
assert.match(savedPdf.suggestedFilename(), /\.pdf$/);
const pdfPath = await savedPdf.path();
assert.ok(pdfPath, 'the browser reported no file for the PDF download');
const pdfBytes = await fs.readFile(pdfPath);
assert.equal(new TextDecoder().decode(pdfBytes.subarray(0, 5)), '%PDF-');
assert.ok(pdfBytes.byteLength > 500, 'the PDF was suspiciously small');

await page.getByTestId('send-to-extension').click();
await page.getByText(/extension is not installed/i).waitFor({ timeout: 5000 });
```

Use `import fs from 'node:fs/promises'`. The install message must be rendered after the probe timeout, so allow 5 seconds. If the current script has no tailored job seed or apply entry, follow the pattern already in the file (Enter the Suite, tracker, Apply tab).

- [ ] **Step 3: Run the proof**

```bash
npm run build:web
node scripts/web-apply.mjs
```

Expected: `web-apply: PASS` (or the script's existing pass line) and no foreign request.

- [ ] **Step 4: Commit**

```bash
git add sa-job-agent-suite/scripts/web-apply.mjs
git commit -m "test(web): prove tailored PDF download and extension absence"
```

---

### Task 8: Documentation, review, gates and pull request

**Files:**
- Modify: `SECURITY.md`, `THREAT-MODEL.md`, `POLICY.md`
- Modify: `docs/superpowers/specs/2026-11-01-apply-foundation-design.md` (status and evidence)

**Interfaces:** none.

- [ ] **Step 1: Update the docs**

- `SECURITY.md`: add an "Apply packet v2" row describing canonical fields, attachments caps, base64, the bridge nonce and that no key enters a packet; add `extension` to the submission delivery description.
- `THREAT-MODEL.md`: add a boundary for the extension hand-off: the job page and any page message are untrusted; controls are same-window/same-origin/nonce checks, `sanitisePacketV2`, no navigation instructions, and user confirmation before submit. State that a forged message without the live nonce is ignored.
- `POLICY.md`: state that the packet (profile answers and selected files) goes only to the installed extension on the same device when the user presses Send, and that the extension never receives the key.

- [ ] **Step 2: Run every gate**

From `sa-job-agent-suite/`:

```bash
npm test
npm run test:demo
npm run build:web
npm run test:web
```

From the worktree root:

```bash
node tools/check-secrets.mjs --all
```

Expected: all pass; `test:web` reports all 15 checks (or the new count if a proof was added); secrets clean.

- [ ] **Step 3: Independent review**

Dispatch a general-purpose review subagent (Windows rejects colons in agent-type file names; use `name: phase2-review`) with the diff of `origin/main..HEAD`, the spec and the plan. Ask for HIGH and MEDIUM findings only, with file:line evidence. Fix every HIGH and MEDIUM finding with tests, then rerun the gates.

- [ ] **Step 4: Update the spec evidence and commit**

Add:

```markdown
## Evidence

- Gates: `npm test`, `npm run test:demo`, `npm run build:web`, `npm run test:web` and `node tools/check-secrets.mjs --all`, all green.
- Proofs: packet v2 unit tests, submission and API extension tests, PDF tests, bridge tests and the extended `web-apply` browser proof.
- Docs: `SECURITY.md`, `THREAT-MODEL.md` and `POLICY.md` describe the packet, the bridge and the extension delivery.
```

Commit:

```bash
git add SECURITY.md THREAT-MODEL.md POLICY.md docs/superpowers/specs/2026-11-01-apply-foundation-design.md
git commit -m "docs: describe the apply packet, bridge and extension delivery"
```

- [ ] **Step 5: Push, open the PR, watch checks and merge**

```bash
git push -u origin arc-13-apply-foundation
gh pr create --title "Phase 2: apply packet v2, tailored PDF and extension hand-off" --body-file <(printf '%s\n' '## Summary' '' '- Packet v2 with canonical fields and validated attachments.' '- Browser-generated tailored CV PDF.' '- Nonce-guarded extension bridge and extension delivery contract.' '- Apply mode with document selection and a graceful absent-extension state.' '' '## Test plan' '' '- [x] npm test' '- [x] npm run test:demo' '- [x] npm run build:web' '- [x] npm run test:web' '- [x] node tools/check-secrets.mjs --all')
gh pr checks <number> --watch
gh pr merge <number> --merge --delete-branch
```

Update the spec status line to `shipped 2026-11-01 (PR #<number>)` before the final push. Do not deploy: production deploys need explicit approval.
