# Apply Assistant Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Manifest V3 extension that fills an application page from a packet v2, shows a review panel, submits only on a user click, and syncs the result back into the app's tracker.

**Architecture:** The matcher and adapters are pure modules in `@sajas/core`. The extension bundles those modules with esbuild into `extension/dist`. The app talks to the extension through a nonce-guarded `postMessage` bridge that existed in Phase 2, extended with result pull/ack. The worker stores packets and results in the extension's own IndexedDB.

**Tech Stack:** Node 24, esbuild 0.28 (already in the tree through Vite), Chrome MV3, Playwright 1.63 for the offline proof.

**Spec:** [2026-11-01-extension-design.md](../specs/2026-11-01-extension-design.md)

## Global Constraints

- Every test is offline. No real portal, feed or Anthropic request.
- The extension has no `fetch`, `XMLHttpRequest`, `WebSocket`, remote script, `<all_urls>`, `externally_connectable` or permission beyond `storage`, `scripting`, `activeTab`, `tabs`.
- No key, key-shaped string or vault handle in the extension. Key-like fixtures are assembled at runtime.
- Demo mode never creates a bridge, never pulls results and never touches the extension queue.
- Desktop, `SYNTHETIC_DEMO`, `server/src/demo.js` and the desktop copilot are untouched.
- No em dashes in source, copy or docs. Light mode. Commit trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Run npm commands from `sa-job-agent-suite/`; run `node tools/check-secrets.mjs --all` from the worktree root.
- Do not deploy. Production deploys need explicit approval.

---

### Task 1: Core matcher

**Files:**
- Create: `packages/core/src/apply/matcher.js`
- Create: `packages/core/src/apply/matcher.test.js`
- Modify: `packages/core/src/apply/index.js`

**Interfaces:**
- Consumes: packet v2 `{ identity: [{key,label,value}], questions: [{key,label,value,source}], fields: [{key,label,value}], attachments: [{key,kind,label,fileName,mime,size,dataBase64}] }`.
- Produces: `normaliseLabel(value)`, `matchFields(packet, descriptors, { adapter })` returning `{ fills, skipped, attachments, captcha }`. Fill shape `{ fieldId, key, label, value, source }`, skip shape `{ fieldId, label, reason }`, attachment shape `{ fieldId, label, attachmentKey }`.

- [ ] **Step 1: Write the failing tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { matchFields, normaliseLabel } from './matcher.js';

const packet = {
  version: 2, packetId: 'p1', createdAt: '2026-11-01T10:00:00.000Z',
  job: { id: 'j1', title: 'Engineer', company: 'Acme', site: 'localhost', applyUrl: 'http://localhost/job' },
  identity: [],
  questions: [],
  fields: [
    { key: 'firstName', label: 'First name', value: 'Thandi', source: 'profile' },
    { key: 'lastName', label: 'Last name', value: 'Mokoena', source: 'profile' },
    { key: 'email', label: 'Email address', value: 'thandi@example.test', source: 'profile' },
    { key: 'noticePeriod', label: 'Notice period', value: '30 days', source: 'profile' },
    { key: 'expectedSalary', label: 'Expected salary', value: 'R 55 000 per month', source: 'profile' }
  ],
  attachments: [
    { key: 'tailored-cv', kind: 'tailored-cv', label: 'Tailored CV', fileName: 'thandi-cv.pdf', mime: 'application/pdf', size: 10, dataBase64: 'JVBERi0xLjQK' }
  ],
  checklist: [], warnings: []
};
const field = (over) => ({ id: '', name: '', label: '', placeholder: '', autocomplete: '', type: 'text', required: false, visible: true, disabled: false, options: [], ...over });

test('normaliseLabel folds case, punctuation and spacing', () => {
  assert.equal(normaliseLabel('  First   Name* '), 'first name');
  assert.equal(normaliseLabel('E-mail:'), 'e mail');
});

test('canonical labels and autocomplete tokens match, in priority order', () => {
  const result = matchFields(packet, [
    field({ id: 'f1', label: 'First name' }),
    field({ id: 'f2', label: 'Surname' }),
    field({ id: 'f3', name: 'email', label: 'Your email address', autocomplete: 'email' }),
    field({ id: 'f4', label: 'Notice period (days)' }),
    field({ id: 'f5', label: 'Expected salary', type: 'number' })
  ]);
  assert.deepEqual(result.fills.map((fill) => [fill.fieldId, fill.key]), [
    ['f1', 'firstName'], ['f2', 'lastName'], ['f3', 'email'], ['f4', 'noticePeriod'], ['f5', 'expectedSalary']
  ]);
  assert.equal(result.skipped.length, 0);
});

test('unknown, sensitive, disabled and invisible fields are skipped with reasons', () => {
  const result = matchFields(packet, [
    field({ id: 's1', label: 'Preferred pronouns' }),
    field({ id: 's2', label: 'Password', type: 'password' }),
    field({ id: 's3', label: 'First name', disabled: true }),
    field({ id: 's4', label: 'Email address', visible: false }),
    field({ id: 's5', label: 'Email address', name: '__hp_website' })
  ]);
  assert.deepEqual(result.fills, []);
  assert.deepEqual(result.skipped.map((skip) => [skip.fieldId, skip.reason]), [
    ['s1', 'unknown'], ['s2', 'sensitive'], ['s3', 'disabled'], ['s4', 'invisible'], ['s5', 'honeypot']
  ]);
});

test('selects and radios match by option label or value', () => {
  const result = matchFields(packet, [
    field({ id: 'r1', label: 'Do you have the right to work in South Africa?', type: 'select', options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] }),
    field({ id: 'r2', label: 'Gender', type: 'radio', options: [{ value: 'Female', label: 'Female' }, { value: 'Male', label: 'Male' }] })
  ]);
  assert.equal(result.fills.find((fill) => fill.fieldId === 'r1').value, 'yes');
  assert.equal(result.fills.find((fill) => fill.fieldId === 'r2').value, 'Female');
});

test('file inputs take the tailored CV and a matching document', () => {
  const withDoc = {
    ...packet,
    attachments: [
      ...packet.attachments,
      { key: 'doc-id', kind: 'document', label: 'Certified ID', fileName: 'id.pdf', mime: 'application/pdf', size: 4, dataBase64: 'JVBERi0=' }
    ]
  };
  const result = matchFields(withDoc, [
    field({ id: 'u1', label: 'Resume', type: 'file' }),
    field({ id: 'u2', label: 'Certified ID copy', type: 'file' })
  ]);
  assert.deepEqual(result.attachments, [
    { fieldId: 'u1', label: 'Resume', attachmentKey: 'tailored-cv' },
    { fieldId: 'u2', label: 'Certified ID copy', attachmentKey: 'doc-id' }
  ]);
});

test('a CAPTCHA is reported and never filled', () => {
  const result = matchFields(packet, [field({ id: 'c1', label: 'I am not a robot', type: 'checkbox' })], { captcha: true });
  assert.equal(result.captcha, true);
  assert.deepEqual(result.fills, []);
});
```

- [ ] **Step 2: Run to see it fail**

Run: `node --test packages/core/src/apply/matcher.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `matcher.js`**

```js
export const SENSITIVE = /password|passcode|pin\b|social security|credit card|cvv|csrf|token|secret/i;
const HONEYPOT = /^__|honeypot|^website_|^fax_|^company_website$/i;
const FILL_PRIORITY = { autocomplete: 0, name: 1, id: 2, label: 3, placeholder: 4 };

const SYNONYMS = new Map([
  ['first name', 'firstName'], ['given name', 'firstName'], ['forename', 'firstName'],
  ['last name', 'lastName'], ['surname', 'lastName'], ['family name', 'lastName'],
  ['full name', 'fullName'], ['name', 'fullName'],
  ['email', 'email'], ['email address', 'email'], ['e mail', 'email'],
  ['phone', 'phone'], ['phone number', 'phone'], ['mobile', 'phone'], ['cell', 'phone'],
  ['linkedin', 'linkedInUrl'], ['linkedin profile', 'linkedInUrl'],
  ['portfolio', 'portfolioUrl'], ['website', 'portfolioUrl'],
  ['github', 'githubUrl'],
  ['city', 'city'], ['town', 'city'],
  ['province', 'province'], ['postal code', 'postalCode'], ['zip code', 'postalCode'],
  ['country', 'country'],
  ['current employer', 'currentCompany'], ['current company', 'currentCompany'],
  ['current job title', 'currentTitle'], ['job title', 'currentTitle'],
  ['years of experience', 'yearsExperience'], ['years experience', 'yearsExperience'],
  ['highest qualification', 'highestQualification'], ['qualification', 'highestQualification'],
  ['notice period', 'noticePeriod'], ['notice period days', 'noticePeriod'], ['availability', 'availabilityDate'],
  ['current salary', 'currentSalary'], ['expected salary', 'expectedSalary'], ['salary expectation', 'expectedSalary'],
  ['right to work', 'rightToWorkSA'], ['right to work in south africa', 'rightToWorkSA'],
  ['willing to relocate', 'willingToRelocate'],
  ['drivers licence', 'driversLicense'], ["driver's licence", 'driversLicense'],
  ['own vehicle', 'ownVehicle'], ['do you own a vehicle', 'ownVehicle'],
  ['employment equity group', 'eeRace'], ['race', 'eeRace'], ['gender', 'gender'], ['disability', 'disability']
]);

const AUTOCOMPLETE = new Map([
  ['given-name', 'firstName'], ['family-name', 'lastName'], ['name', 'fullName'],
  ['email', 'email'], ['tel', 'phone'], ['tel-national', 'phone'], ['organization', 'currentCompany'],
  ['organization-title', 'currentTitle'], ['address-level2', 'city'],
  ['address-level1', 'province'], ['postal-code', 'postalCode'], ['country-name', 'country'],
  ['url', 'portfolioUrl']
]);

export function normaliseLabel(value) {
  return String(value == null ? '' : value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
```

Add `candidateKey(descriptor)`: try autocomplete token, name, id, label, placeholder, using exact synonym lookup or a canonical key list; return `{ key, score }` or null. Build a value map from `packet.fields`, `packet.identity`, `packet.questions` keyed by canonical key and by normalised label. For each descriptor:

1. If hidden/disabled → skip (`invisible`, `disabled`); honeypot → `honeypot`; sensitive → `sensitive`; captcha container outside descriptor.
2. File inputs → attachment match.
3. Otherwise resolve candidate key; if none → `unknown`; if no packet value → `no answer`.
4. Selects/radios pick an option; if none matches → `no answer` (do not guess).
5. Fill once per key and once per descriptor; two descriptors for the same packet key: keep the first, skip the rest as `duplicate`.

Return objects exactly as the tests.

- [ ] **Step 4: Export it**

Add `export * from './matcher.js';` to `packages/core/src/apply/index.js`.

- [ ] **Step 5: Run the tests, then the core suite**

Run: `node --test packages/core/src/apply/matcher.test.js` then `npm test --workspace=packages/core`.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/apply/matcher.js packages/core/src/apply/matcher.test.js packages/core/src/apply/index.js
git commit -m "feat(core): add the application field matcher"
```

---

### Task 2: Core adapters

**Files:**
- Create: `packages/core/src/apply/adapters.js`
- Create: `packages/core/src/apply/adapters.test.js`
- Modify: `packages/core/src/apply/index.js`

**Interfaces:**
- Produces: `adapters` (array), `adapterForHost(host)` returning `{ id, hosts, submitSelectors, successSelectors, successText, priority }`, never null (falls back to generic).

- [ ] **Step 1: Write the failing tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { adapterForHost } from './adapters.js';

test('known hosts get their adapter and everything else is generic', () => {
  assert.equal(adapterForHost('boards.greenhouse.io').id, 'greenhouse');
  assert.equal(adapterForHost('job-boards.greenhouse.io').id, 'greenhouse');
  assert.equal(adapterForHost('jobs.lever.co').id, 'lever');
  assert.equal(adapterForHost('careers.example.test').id, 'generic');
  assert.equal(adapterForHost('').id, 'generic');
});

test('each adapter names its submit control and success signals', () => {
  const greenhouse = adapterForHost('boards.greenhouse.io');
  assert.ok(greenhouse.submitSelectors.includes('#submit_app'));
  assert.match(greenhouse.successText.source, /thank you for applying/i);
  const lever = adapterForHost('jobs.lever.co');
  assert.ok(lever.submitSelectors.some((selector) => selector.includes('submit')));
  const generic = adapterForHost('localhost');
  assert.ok(generic.submitSelectors.length > 0);
  assert.equal(generic.hosts.length, 0);
});
```

- [ ] **Step 2: Run to see it fail**

Run: `node --test packages/core/src/apply/adapters.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `adapters.js`**

```js
const GENERIC = Object.freeze({
  id: 'generic',
  hosts: [],
  submitSelectors: ['button[type="submit"]', 'input[type="submit"]', 'button:not([type])'],
  successSelectors: [],
  successText: /thank you for applying|application (?:was )?(?:submitted|received)|we (?:have )?received your application/i,
  priority: ['autocomplete', 'name', 'label']
});

const GREENHOUSE = Object.freeze({
  id: 'greenhouse',
  hosts: ['boards.greenhouse.io', 'job-boards.greenhouse.io'],
  submitSelectors: ['#submit_app', 'button[type="submit"]'],
  successSelectors: ['.application-confirmation', '#application_confirmation'],
  successText: /thank you for applying|application submitted|we (?:have )?received your application/i,
  priority: ['id', 'name', 'label']
});

const LEVER = Object.freeze({
  id: 'lever',
  hosts: ['jobs.lever.co'],
  submitSelectors: ['.template-btn-submit', 'button[type="submit"]'],
  successSelectors: ['.application-confirmation', '.posting-confirmation'],
  successText: /thank you for applying|application submitted|we (?:have )?received your application/i,
  priority: ['name', 'label', 'id']
});

export const adapters = Object.freeze([GREENHOUSE, LEVER, GENERIC]);

export function adapterForHost(host) {
  const clean = String(host || '').toLowerCase().replace(/^www\./, '');
  return adapters.find((adapter) => adapter.hosts.includes(clean)) || GENERIC;
}
```

- [ ] **Step 4: Export and run**

Add to apply index; run the test then the core suite. Expected PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/apply/adapters.js packages/core/src/apply/adapters.test.js packages/core/src/apply/index.js
git commit -m "feat(core): add generic, Greenhouse and Lever adapters"
```

---

### Task 3: Extension protocol and store

**Files:**
- Create: `extension/src/protocol.js`
- Create: `extension/src/store.js`
- Create: `extension/src/store.test.js` (root `node --test` picks it up once the script is extended in Task 4)

**Interfaces:**
- `protocol.js`: `BRIDGE_VERSION`, `APP_SOURCE`, `EXTENSION_SOURCE`, `isAppMessage(data)`, `isWorkerMessage(data)`, `resultFrom({ packet, site, submittedAt, confirmation, fields, warnings })`.
- `store.js`: `createExtensionStore(storage, { now })` where `storage = { readAll(name), put(name, record), remove(name, key) }`, names `packets` and `results`. Methods: `savePacket(packet)`, `getPacket(id)`, `matchingPacket(host)`, `addResult(result)`, `takeResults()`, `ackResults(ids)`. Constants `PACKET_TTL_MS = 8h`, `MAX_PACKETS = 5`, `MAX_RESULTS = 50`.

- [ ] **Step 1: Write the failing tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createExtensionStore, MAX_PACKETS, MAX_RESULTS, PACKET_TTL_MS } from './store.js';

function memoryStorage() {
  const data = new Map([['packets', new Map()], ['results', new Map()]]);
  return {
    async readAll(name) { return [...data.get(name).values()]; },
    async put(name, record) { data.get(name).set(record.id, record); },
    async remove(name, key) { data.get(name).delete(key); }
  };
}
const packet = (id, site = 'localhost', over = {}) => ({
  version: 2, packetId: id, createdAt: '2026-11-01T10:00:00.000Z',
  job: { id: `job-${id}`, title: 'Engineer', company: 'Acme', site, applyUrl: `http://${site}/apply` },
  identity: [], questions: [], fields: [], attachments: [], checklist: [], warnings: [], ...over
});

test('a packet is validated, stored and found by site', async () => {
  const store = createExtensionStore(memoryStorage());
  await store.savePacket(packet('p1'));
  assert.equal((await store.getPacket('p1')).packetId, 'p1');
  assert.equal((await store.matchingPacket('localhost')).packetId, 'p1');
  assert.equal(await store.matchingPacket('other.test'), null);
  await assert.rejects(() => store.savePacket({ ...packet('bad'), version: 1 }), /version/);
});

test('packets expire and the cap evicts the oldest', async () => {
  let at = Date.parse('2026-11-01T10:00:00.000Z');
  const store = createExtensionStore(memoryStorage(), { now: () => at });
  for (let index = 0; index < MAX_PACKETS + 2; index += 1) await store.savePacket(packet(`p${index}`));
  const kept = await Promise.all(Array.from({ length: MAX_PACKETS + 2 }, (_, index) => store.getPacket(`p${index}`)));
  assert.equal(kept.filter(Boolean).length, MAX_PACKETS);
  assert.equal(await store.getPacket('p0'), null);
  at += PACKET_TTL_MS + 1;
  assert.equal(await store.getPacket(`p${MAX_PACKETS + 1}`), null);
});

test('results are capped and acknowledged by id', async () => {
  const store = createExtensionStore(memoryStorage());
  for (let index = 0; index < MAX_RESULTS + 5; index += 1) {
    await store.addResult({ id: `r${index}`, packetId: `p${index}`, jobId: 'j', site: 'localhost', submittedAt: '2026-11-01T10:00:00.000Z', fields: [], confirmation: null });
  }
  assert.equal((await store.takeResults()).length, MAX_RESULTS);
  await store.ackResults(['r4', 'r5']);
  assert.equal((await store.takeResults()).some((result) => result.id === 'r4'), false);
});
```

- [ ] **Step 2: Run to see it fail**

Run: `node --test extension/src/store.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`store.js` imports `sanitisePacketV2` from `@sajas/core/apply` (esbuild resolves the workspace path at build time; Node resolves it through the workspace symlink in tests). Records: `{ id: packet.packetId, storedAt, packet }` and results capped and cleaned with `cleanSubmission`. `savePacket` stores only the sanitised packet; `getPacket` re-sanitises on read and deletes on failure or expiry; `matchingPacket` picks the newest `job.site === host`. `addResult` requires `id`, `packetId`, `jobId`, `site`, `submittedAt`, caps fields at 80 and each value at 500 through `cleanSubmission`, drops base64. `takeResults` returns everything; `ackResults` removes each id.

`protocol.js` defines the message types and `resultFrom` which trims to `{ id: packetId, packetId, jobId, site, submittedAt, confirmation, fields, warnings }` with the same caps.

- [ ] **Step 4: Run tests and commit**

```bash
node --test extension/src/store.test.js
git add extension/src/protocol.js extension/src/store.js extension/src/store.test.js
git commit -m "feat(extension): add the message protocol and packet store"
```

---

### Task 4: Extension shell, build and static gates

**Files:**
- Create: `extension/manifest.json`
- Create: `extension/src/sw.js` (minimal, replaced in Task 5)
- Create: `extension/src/popup.html`, `extension/src/popup.js`, `extension/src/popup.css`
- Create: `extension/icons/icon-128.png` (a generated 128 px PNG, light background, teal ring)
- Create: `scripts/build-extension.mjs`
- Create: `scripts/check-extension.mjs`
- Modify: `sa-job-agent-suite/package.json` (scripts and devDependency `esbuild`), root lockfile

**Interfaces:**
- `npm run build:extension` writes `extension/dist/{manifest.json,sw.js,popup.html,popup.js,popup.css,appBridge.js,page.js,icons/}`.
- `npm run check:extension` exits non-zero on any rule in the spec.
- Popup DOM ids: `status`, `fill`, `close`.

- [ ] **Step 1: Add the manifest and popup**

```json
{
  "manifest_version": 3,
  "name": "SA-JAS Apply Assistant",
  "version": "0.1.0",
  "description": "Fills a job application from an SA-JAS packet you send from the app. You review and submit.",
  "permissions": ["storage", "scripting", "activeTab", "tabs"],
  "host_permissions": ["https://sajas.pages.dev/*", "http://localhost/*", "http://127.0.0.1/*"],
  "background": { "service_worker": "sw.js", "type": "module" },
  "action": { "default_popup": "popup.html", "default_title": "SA-JAS Apply Assistant", "default_icon": { "128": "icons/icon-128.png" } },
  "icons": { "128": "icons/icon-128.png" },
  "content_scripts": [{ "matches": ["https://sajas.pages.dev/*", "http://localhost/*", "http://127.0.0.1/*"], "js": ["appBridge.js"], "run_at": "document_start" }]
}
```

Popup shows the matched job, a Fill button and a status line; all text via `textContent`. No inline script (MV3 forbids it).

- [ ] **Step 2: Write `scripts/build-extension.mjs`**

```js
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'extension/dist');
await fs.rm(out, { recursive: true, force: true });
await fs.mkdir(path.join(out, 'icons'), { recursive: true });
for (const file of ['manifest.json']) await fs.copyFile(path.join(root, 'extension', file), path.join(out, file));
for (const file of ['popup.html', 'popup.css']) await fs.copyFile(path.join(root, 'extension/src', file), path.join(out, file));
await fs.copyFile(path.join(root, 'extension/icons/icon-128.png'), path.join(out, 'icons/icon-128.png'));
await build({
  entryPoints: {
    sw: path.join(root, 'extension/src/sw.js'),
    appBridge: path.join(root, 'extension/src/appBridge.js'),
    page: path.join(root, 'extension/src/page.js'),
    popup: path.join(root, 'extension/src/popup.js')
  },
  outdir: out, bundle: true, format: 'esm', target: 'chrome120', legalComments: 'none', logLevel: 'info'
});
```

`sw.js` is `"type": "module"`, so every bundle can be ESM; `page.js` and `appBridge.js` are injected as classic files, which means they must not use `import` at runtime, so bundle entry outputs must be self-contained (esbuild `bundle: true` produces that) and top-level `import` is removed. Check with the static gate that no output starts with `import ` or contains bare `from "`.

- [ ] **Step 3: Write `scripts/check-extension.mjs`**

Read `extension/dist` after a build and enforce:

```js
const failures = [];
if (manifest.manifest_version !== 3) failures.push('manifest is not v3');
for (const permission of manifest.permissions) if (!['storage', 'scripting', 'activeTab', 'tabs'].includes(permission)) failures.push(`unexpected permission: ${permission}`);
if (JSON.stringify(manifest).includes('<all_urls>')) failures.push('<all_urls> is not allowed');
if (manifest.externally_connectable) failures.push('externally_connectable is not allowed');
for (const file of ['sw.js', 'appBridge.js', 'page.js', 'popup.js']) {
  const source = await fs.readFile(path.join(dist, file), 'utf8');
  if (/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon/.test(source)) failures.push(`${file} reaches the network`);
  if (/anthropicApiKey|keyVault|sajas-web/.test(source)) failures.push(`${file} mentions app key or vault state`);
  if (/^\s*import\s/m.test(source)) failures.push(`${file} kept an import`);
}
const html = await fs.readFile(path.join(dist, 'popup.html'), 'utf8');
if (/<script(?![^>]*\bsrc=)/i.test(html)) failures.push('popup has an inline script');
if (!failures.length) console.log('check-extension: PASS');
else { for (const failure of failures) console.error(`check-extension: FAIL - ${failure}`); process.exit(1); }
```

- [ ] **Step 4: Wire scripts**

Root `package.json`:

```json
"build:extension": "node scripts/build-extension.mjs",
"test:extension": "node --test \"extension/src/*.test.js\"",
"check:extension": "node scripts/check-extension.mjs"
```

Add `node --test "extension/src/*.test.js"` to `test`, and `node scripts/build-extension.mjs && node scripts/check-extension.mjs` as the first two steps of `test:web`.

Add `"esbuild": "^0.28.2"` to root `devDependencies`, then `npm install --package-lock-only --offline`. If the offline install refuses, run `npm install --package-lock-only` once and confirm only dev flags changed.

- [ ] **Step 5: Build, check and commit**

```bash
npm run build:extension && npm run check:extension
git add extension scripts/build-extension.mjs scripts/check-extension.mjs package.json package-lock.json
git commit -m "feat(extension): add the MV3 shell, build and static gates"
```

---

### Task 5: Service worker

**Files:**
- Create: `extension/src/idb.js`
- Modify: `extension/src/sw.js`
- Create: `extension/src/sw.test.js` (tests the pure message handlers with a fake `chrome`)

**Interfaces:**
- Worker message handling: `sajas:store-packet` `{ packet }` -> `{ ok, packetId }`; `sajas:matching-packet` `{ host }` -> `{ match }`; `sajas:take-results` -> `{ results }`; `sajas:ack-results` `{ ids }` -> `{ ok }`; `sajas:inject` `{ tabId, packetId }` -> `{ ok, error? }`; `sajas:record-result` `{ result }` -> `{ ok }`.
- `idb.js`: `createIdbStorage()` returning the adapter from Task 3, database `sajas-extension` version 1, stores `packets` and `results`, keyPath `id`.

- [ ] **Step 1: Write the failing tests**

Extract handlers into `extension/src/worker.js` exporting `createWorkerHandlers({ store, chrome, now })`, then test:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkerHandlers } from './worker.js';

function fake(over = {}) {
  const store = over.store || { savePacket: async (p) => p, matchingPacket: async () => null, takeResults: async () => [], ackResults: async () => {}, addResult: async () => {} };
  const chrome = over.chrome || {};
  return createWorkerHandlers({ store, chrome, now: () => new Date('2026-11-01T10:00:00.000Z') });
}

test('the worker stores a packet only for the app script', async () => {
  const saved = [];
  const handlers = fake({ store: { savePacket: async (packet) => { saved.push(packet); return packet; } } });
  const denied = await handlers.onMessage({ type: 'sajas:store-packet', packet }, { url: 'https://evil.example/page' });
  assert.equal(denied.ok, false);
  const allowed = await handlers.onMessage({ type: 'sajas:store-packet', packet }, { url: 'https://sajas.pages.dev/', tab: { id: 1 } });
  assert.equal(allowed.ok, true);
  assert.equal(saved.length, 1);
});
```

Cover: unknown message refused; app host allow-list (sajas.pages.dev and localhost); result recorded only when `sender.tab.url` host equals `result.site`; ack removes ids; inject refuses when the tab host differs from the packet site; no handler returns key material.

- [ ] **Step 2: Run to see it fail**

Run: `node --test extension/src/sw.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `worker.js` and `sw.js`**

`worker.js` exports `createWorkerHandlers({ store, chrome, now })` with `onMessage(message, sender)`. `sw.js` creates the store over `createIdbStorage()`, registers `chrome.runtime.onMessage.addListener((message, sender, sendResponse) => { handlers.onMessage(message, sender).then(sendResponse); return true; })`, and implements injection:

```js
if (message.type === 'sajas:inject') {
  const packet = await store.getPacket(message.packetId);
  if (!packet) return { ok: false, error: 'That application is no longer waiting.' };
  const tab = await chrome.tabs.get(message.tabId);
  if (hostOf(tab.url) !== packet.job.site) return { ok: false, error: 'Open the application link for this job first.' };
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['page.js'] });
  await chrome.tabs.sendMessage(tab.id, { type: 'sajas:fill', packetId: packet.packetId });
  return { ok: true };
}
```

- [ ] **Step 4: Run tests, build, static gate, commit**

```bash
node --test extension/src/sw.test.js && npm run build:extension && npm run check:extension
git add extension/src/idb.js extension/src/worker.js extension/src/sw.js extension/src/sw.test.js
git commit -m "feat(extension): add the service worker and message guards"
```

---

### Task 6: App bridge and app-side pull/ack

**Files:**
- Create: `extension/src/appBridge.js`
- Modify: `client/src/web/extensionBridge.js`
- Modify: `client/src/web/extensionBridge.test.js`

**Interfaces:**
- Bridge additions: `pullResults({ timeoutMs = 1500 })` -> `Promise<Array>` (empty on timeout) and `ackResults(ids)` -> `Promise<boolean>`. Messages: `sajas:results-request` -> `sajas:results`, `sajas:results-ack` -> `sajas:results-acked`.
- `appBridge.js` accepts only `event.source === window`, `event.origin === location.origin`, `data.source === 'sajas-app'`, `data.version === 1`; remembers the nonce from `hello`; relays packet, results-request and results-ack to the worker; posts replies with `source: 'sajas-extension'`.

- [ ] **Step 1: Write the failing bridge tests**

```js
test('pullResults returns the queued results for this nonce', async () => {
  const win = fakeWindow();
  const bridge = createExtensionBridge({ window: win, nonce: 'n1', resultsTimeoutMs: 50 });
  const pending = bridge.pullResults();
  assert.deepEqual(win.sent.at(-1), {
    data: { source: 'sajas-app', type: 'sajas:results-request', version: 1, nonce: 'n1' },
    origin: 'https://sajas.pages.dev'
  });
  win.receive({ source: 'sajas-extension', type: 'sajas:results', version: 1, nonce: 'n1', results: [{ id: 'r1' }] });
  assert.deepEqual(await pending, [{ id: 'r1' }]);
  bridge.dispose();
});

test('ackResults posts the ids and waits for confirmation', async () => {
  const win = fakeWindow();
  const bridge = createExtensionBridge({ window: win, nonce: 'n1', resultsTimeoutMs: 50 });
  const pending = bridge.ackResults(['r1', 'r2']);
  win.receive({ source: 'sajas-extension', type: 'sajas:results-acked', version: 1, nonce: 'n1', ids: ['r1', 'r2'] });
  assert.equal(await pending, true);
  bridge.dispose();
});

test('pullResults gives up quietly when no extension answers', async () => {
  const win = fakeWindow();
  const bridge = createExtensionBridge({ window: win, nonce: 'n1', resultsTimeoutMs: 10 });
  assert.deepEqual(await bridge.pullResults(), []);
  bridge.dispose();
});
```

- [ ] **Step 2: Run to see it fail**

Run: `node --test client/src/web/extensionBridge.test.js`
Expected: new tests FAIL, `pullResults` is not a function.

- [ ] **Step 3: Implement bridge additions and `appBridge.js`**

Bridge: same `waitFor` pattern; `pullResults` posts and resolves `data.results` (array) or `[]`; `ackResults` posts and resolves Boolean. Keep existing probe/send behaviour.

`appBridge.js`:

```js
import { isAppMessage, EXTENSION_SOURCE, BRIDGE_VERSION } from './protocol.js';

const allowed = (url) => {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === 'https:' && hostname === 'sajas.pages.dev' || (protocol === 'http:' && ['localhost', '127.0.0.1'].includes(hostname));
  } catch { return false; }
};

let nonce = '';
window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  if (!isAppMessage(event.data)) return;
  if (event.data.type === 'sajas:hello') nonce = event.data.nonce;
  else if (event.data.nonce !== nonce) return;
  handle(event.data);
});
```

`handle` posts `reply(type, extra)` guarded by `allowed(location.href)`; on `results-request` reads from the worker and posts `sajas:results`; on `results-ack` posts to the worker then replies `sajas:results-acked`.

- [ ] **Step 4: Run tests, build, commit**

```bash
node --test client/src/web/extensionBridge.test.js && npm run build:extension && npm run check:extension
git add extension/src/appBridge.js client/src/web/extensionBridge.js client/src/web/extensionBridge.test.js
git commit -m "feat(web): pull and acknowledge extension results"
```

---

### Task 7: Page descriptor, fill and submit modules

**Files:**
- Create: `extension/src/dom.js`
- Create: `extension/src/fill.js`
- Create: `extension/src/submit.js`

**Interfaces:**
- `dom.js`: `describeFields(root)`, `hostOf(url)`, `hasCaptcha(root)`, `labelOf(element)`, `visible(element)`, `applyFileInput(input, bytes, fileName, mime)`.
- `fill.js`: `fillForm(packet, document, { adapter, host })` -> `{ result, applied }` where `result` is the matcher output and `applied` is a list of `{ fieldId, label, value }` actually set.
- `submit.js`: `findSubmit(document, adapter)`, `watchSuccess(document, adapter, { timeoutMs = 8000 })` -> `Promise<{ ok, confirmation }>`, `captchaText`.

- [ ] **Step 1: Write fixtures first (used by Task 11)**

Create `extension/fixtures/greenhouse.html`, `lever.html`, `generic.html`, `captcha.html`, `app.html`:
- greenhouse: `<form id="application_form">` with `#first_name`, `#last_name`, `#email`, `#phone`, a `select[name="job_application[location]"]` with Cape Town, a labelled "Notice period (days)" text input, a "Preferred pronouns" text input, `<input id="resume" type="file">`, `<button id="submit_app" type="submit">Submit application</button>`; submit handler swaps in `<div class="application-confirmation">Thank you for applying</div>`.
- lever: `input[name=name]`, `input[name=email]`, `input[name=phone]`, `input[name="urls[LinkedIn]"]`, `textarea[name=comments]` labelled "Anything else", file input labelled "Resume/CV", `.template-btn-submit`; success text in `.application-confirmation`.
- generic: `input[autocomplete=given-name]`, `input[autocomplete=family-name]`, `input[type=email]`, `select` labelled "Right to work in South Africa" with Yes/No, "Driver's licence" select, "Expected salary" input, file input labelled "CV", "Preferred pronouns" input; submit button; confirmation text.
- captcha: the generic form plus `<div class="g-recaptcha">`.
- app: a minimal page for tests that posts `sajas:hello`, waits 300 ms, posts `sajas:packet` with the packet from `window.__PACKET__` (set by `page.addInitScript`), and sets `window.__sajasAck` to the packet id after `sajas:ack`.

All fixtures are static HTML with a small inline script (fixtures are test files, not shipped; the static gate only scans `dist`).

- [ ] **Step 2: Implement `dom.js`, `fill.js`, `submit.js`**

Key rules:
- `describeFields` walks `input, select, textarea` in the document, skips `type` in `hidden,submit,button,reset,image,password` (password also surfaced as sensitive by the matcher), computes `visible` from rects, `display`, `visibility`, `opacity`.
- `labelOf` uses `aria-label`, `aria-labelledby`, `label[for]`, closest `label`, placeholder.
- `fill.js` uses the matcher output; for selects match option by value or normalised label; radios/checkboxes by value; text via the prototype setter and `input` plus `change` events; file inputs from packet attachment base64 through `Uint8Array` -> `File` -> `DataTransfer`.
- `submit.js` finds the first visible adapter submit selector, does not click; `watchSuccess` resolves on a success selector, success text in `body.innerText`, or a change in `location.href`, with a `MutationObserver` plus a timeout; the panel decides to click.
- `hasCaptcha` checks `iframe[src*="recaptcha"], iframe[src*="hcaptcha"], .g-recaptcha, .h-captcha, [data-sitekey]`.

- [ ] **Step 3: Build and smoke-check**

```bash
npm run build:extension && npm run check:extension
```

Expected: PASS. No unit tests here; Task 11 proves the DOM behaviour end to end.

- [ ] **Step 4: Commit**

```bash
git add extension/src/dom.js extension/src/fill.js extension/src/submit.js extension/fixtures
git commit -m "feat(extension): add page extraction, filling and submit detection"
```

---

### Task 8: Review panel and page script

**Files:**
- Create: `extension/src/panel.js`
- Create: `extension/src/page.js`

**Interfaces:**
- `page.js` listens for `sajas:fill` `{ packetId }` from the worker, asks the worker for the packet with `sajas:packet-by-id` (new worker message, same host guard as `record-result`), fills, then opens the panel.
- Panel controls: checkbox `I reviewed these details`, button `Submit application`, button `Fill again`, button `Close`; sections `Filled`, `Needs you`, `Attachments`, plus a status line.

- [ ] **Step 1: Add the worker message for page reads**

`worker.js` handles `sajas:packet-by-id` `{ packetId }` only when `sender.tab` and `hostOf(sender.tab.url) === packet.job.site`; returns `{ packet }` or `{ error }`. Add a worker test for both outcomes.

- [ ] **Step 2: Implement `panel.js`**

Shadow DOM host `#sajas-panel` attached to `document.documentElement`, styles inline in the shadow root, all dynamic text via `textContent`. The panel lists every fill, every skip with a readable reason, and every attachment. Submit stays disabled until the checkbox is checked. It never inserts HTML from the packet.

- [ ] **Step 3: Implement `page.js`**

```js
import { adapterForHost } from './adapters.js';
import { fillForm } from './fill.js';
import { findSubmit, watchSuccess, captchaText } from './submit.js';
import { openPanel } from './panel.js';

let current = null;
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== 'sajas:fill') return;
  run(message.packetId);
});

async function run(packetId) {
  const response = await chrome.runtime.sendMessage({ type: 'sajas:packet-by-id', packetId });
  if (!response?.packet) return;
  current?.destroy();
  const host = location.hostname;
  const adapter = adapterForHost(host);
  const { result, applied } = fillForm(response.packet, document, { adapter, host });
  current = openPanel({
    packet: response.packet,
    result,
    applied,
    captcha: captchaText(document),
    onSubmit: async (confirm) => {
      if (!confirm) return { ok: false, error: 'Tick the review box first.' };
      if (captchaText(document)) return { ok: false, error: 'This page has a CAPTCHA. Complete it yourself, then press Submit again.' };
      const button = findSubmit(document, adapter);
      if (!button) return { ok: false, error: 'Could not find the submit button on this page.' };
      const watch = watchSuccess(document, adapter, { timeoutMs: 8000 });
      button.click();
      const outcome = await watch;
      if (!outcome.ok) return { ok: false, error: 'Could not confirm the submission. Check the page, then press Mark applied in the app.' };
      await chrome.runtime.sendMessage({
        type: 'sajas:record-result',
        result: {
          id: response.packet.packetId, packetId: response.packet.packetId, jobId: response.packet.job.id,
          site: host, submittedAt: new Date().toISOString(), confirmation: outcome.confirmation,
          fields: applied.map(({ label, value }) => ({ label, value })), warnings: response.packet.warnings
        }
      });
      return { ok: true, confirmation: outcome.confirmation };
    }
  });
}
```

- [ ] **Step 4: Build, static gate, commit**

```bash
node --test extension/src/sw.test.js && npm run build:extension && npm run check:extension
git add extension/src/panel.js extension/src/page.js extension/src/worker.js extension/src/sw.test.js
git commit -m "feat(extension): add the review panel and page script"
```

---

### Task 9: Popup

**Files:**
- Modify: `extension/src/popup.js`

**Interfaces:**
- On open: query the active tab, take its host, ask the worker for `sajas:matching-packet`, show the job or an explanation, enable `#fill` only when there is a match, and on click send `sajas:inject` then close the popup with a status message.

- [ ] **Step 1: Implement the popup**

No inline script. Guard a missing `chrome.tabs` (when opened as a page in a test) with a plain explanation. Show the packet's site and job title; never show packet field values.

- [ ] **Step 2: Build and static gate**

```bash
npm run build:extension && npm run check:extension
```

- [ ] **Step 3: Commit**

```bash
git add extension/src/popup.js
git commit -m "feat(extension): add the action popup"
```

---

### Task 10: App result sync

**Files:**
- Create: `client/src/web/extensionSync.js`
- Create: `client/src/web/extensionSync.test.js`
- Modify: `client/src/App.jsx`
- Modify: `scripts/web-demo.mjs` (one assertion: no bridge and no results request in demo)

**Interfaces:**
- `syncExtensionResults({ bridge, record })` where `record(result)` returns `'synced' | 'gone' | 'failed'`. Returns `{ synced, dropped, left }` and calls `bridge.ackResults` with synced and gone ids.

- [ ] **Step 1: Write the failing tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { syncExtensionResults } from './extensionSync.js';

const result = (id) => ({ id, jobId: `job-${id}` });

test('synced and gone results are acknowledged, failed ones stay queued', async () => {
  const acked = [];
  const bridge = { pullResults: async () => [result('a'), result('b'), result('c')], ackResults: async (ids) => { acked.push(...ids); return true; } };
  const outcome = await syncExtensionResults({ bridge, record: async (entry) => ({ a: 'synced', b: 'gone', c: 'failed' }[entry.id]) });
  assert.deepEqual(outcome, { synced: 1, dropped: 1, left: 1 });
  assert.deepEqual(acked, ['a', 'b']);
});

test('a record that throws leaves the result queued', async () => {
  const bridge = { pullResults: async () => [result('a')], ackResults: async () => true };
  assert.deepEqual(await syncExtensionResults({ bridge, record: async () => { throw new Error('offline'); } }), { synced: 0, dropped: 0, left: 1 });
});

test('no extension means no ack and no work', async () => {
  const bridge = { pullResults: async () => [], ackResults: async () => { throw new Error('should not ack'); } };
  assert.deepEqual(await syncExtensionResults({ bridge, record: async () => 'synced' }), { synced: 0, dropped: 0, left: 0 });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `node --test client/src/web/extensionSync.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the sync and wire it into `App.jsx`**

`extensionSync.js` loops results, calls `record`, counts, then acks `synced` + `gone` ids. In `App.jsx`, add an effect after `fetchJobs` is defined:

```js
useEffect(() => {
  if (!IS_WEB || SYNTHETIC_DEMO || !webReady || demoMode) return undefined;
  const bridge = createExtensionBridge();
  let alive = true;
  syncExtensionResults({
    bridge,
    record: async (result) => {
      const res = await fetch(`${API_BASE}/jobs/${result.jobId}/applied`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delivery: 'extension', submitter: 'user', fields: result.fields, confirmation: result.confirmation })
      });
      if (res.status === 404) return 'gone';
      if (!res.ok) return 'failed';
      return 'synced';
    }
  }).then((outcome) => {
    if (!alive) return;
    if (outcome.synced) { toasts.success(`Synced ${outcome.synced} application${outcome.synced === 1 ? '' : 's'} from the extension.`); fetchJobs(); }
    if (outcome.dropped) toasts.info(`${outcome.dropped} extension result${outcome.dropped === 1 ? '' : 's'} pointed at a job that is no longer in the tracker.`);
  }).catch(() => {}).finally(() => bridge.dispose());
  return () => { alive = false; bridge.dispose(); };
}, [webReady, demoMode]); // eslint-disable-line react-hooks/exhaustive-deps
```

Import `createExtensionBridge` and `syncExtensionResults`. Keep the demo path untouched.

- [ ] **Step 4: Run client tests, build, demo proof**

```bash
npm test --workspace=client
npm run test:demo
npm run build:web
node scripts/web-demo.mjs
```

Expected: all pass. Add to `web-demo.mjs` an assertion that no request URL contains `sajas:results-request` is impossible (postMessage is not a request); instead assert `window.__sajasBridgeCreated` is undefined by a static scan? Keep the existing demo proof as the isolation evidence and add a comment in the spec that demo has no bridge because `!demo` guards every path.

- [ ] **Step 5: Commit**

```bash
git add client/src/web/extensionSync.js client/src/web/extensionSync.test.js client/src/App.jsx
git commit -m "feat(web): sync extension results into the tracker"
```

---

### Task 11: Browser proof

**Files:**
- Create: `scripts/web-extension.mjs`
- Modify: `sa-job-agent-suite/package.json` (`test:web` adds `node scripts/web-extension.mjs`)

**Interfaces:**
- Launch: `chromium.launchPersistentContext(userDataDir, { headless: true, args: ['--disable-extensions-except=' + dist, '--load-extension=' + dist] })`.
- Worker: `context.serviceWorkers()[0] || await context.waitForEvent('serviceworker')`.

- [ ] **Step 1: Write the proof**

Flow:

1. Build `extension/dist` and `client/dist` must exist.
2. Serve `extension/fixtures` on one static server and `client/dist` on another.
3. Launch the persistent context with the extension.
4. App fixture page: `page.addInitScript` sets `window.__PACKET__` to a packet v2 (site `localhost`, job id `ext-job-1`, fields firstName/lastName/email/noticePeriod, tailored-cv attachment with `JVBERi0xLjQK`). Open `/app.html`; wait for `window.__sajasAck === packetId`. This proves hello/ready/packet/ack and worker storage.
5. Resolve the tab id from the worker: `worker.evaluate(async () => (await chrome.tabs.query({})).find((tab) => tab.url.includes('greenhouse.html'))?.id)`.
6. Open greenhouse fixture, inject via the worker:

```js
await worker.evaluate(async ({ tabId, packetId }) => {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['page.js'] });
  await chrome.tabs.sendMessage(tabId, { type: 'sajas:fill', packetId });
}, { tabId, packetId });
```

7. Assert `#first_name` is `Thandi`, `#last_name` is `Mokoena`, `#email` is `thandi@example.test`, "Preferred pronouns" is empty, `#resume` has one file named `thandi-cv.pdf`, and the panel shows `Needs you` with "Preferred pronouns".
8. Tick `I reviewed these details`, click `Submit application`, wait for `Thank you for applying`, then read the results store through the worker (`indexedDB` in the SW) and assert one result with confirmation text and fields.
9. Repeat fill and submit for `lever.html` and `generic.html`, each with its own packet (post from three app fixture pages with `?job=` ids). For the generic page, assert the right-to-work select became `Yes` and the driver licence select was skipped as `unknown` unless the packet has an answer.
10. `captcha.html`: fill, tick, press Submit, assert the panel says CAPTCHA and the results count did not grow.
11. Result sync: seed `client/dist`'s `sajas-web` vault with `ext-job-1` (tailored) and open the app, skip the key, enter the suite; wait for the toast `Synced 1 application from the extension`; read the vault and assert the job is `applied` and the memory application has `delivery: 'extension'` and a confirmation. Assert the results store is empty (acked).
12. Assert no request URL is external to the two local origins; assert no console errors; report `web-extension: ok`.

- [ ] **Step 2: Run the proof**

```bash
npm run build:extension && npm run build:web && node scripts/web-extension.mjs
```

Expected: `web-extension: ok`. If Playwright's bundled Chromium refuses extensions in headless, record the failure, retry with `headless: false` once locally, and if that is the only way, keep the proof headless by using `channel: 'chromium'`; do not ship a test that needs a display in CI.

- [ ] **Step 3: Commit**

```bash
git add scripts/web-extension.mjs package.json
git commit -m "test(extension): prove fill, review, submit and result sync offline"
```

---

### Task 12: Docs, gates, review, PR

**Files:**
- Modify: `README.md` (a "Apply Assistant extension" section: build, load unpacked, what it does and does not do)
- Modify: `SECURITY.md`, `THREAT-MODEL.md`, `POLICY.md`, `OPERATIONS.md` if hosting notes change
- Modify: `docs/superpowers/specs/2026-11-01-extension-design.md` (status + Evidence)
- Modify: `ROADMAP.md`

- [ ] **Step 1: Update the docs**

- `SECURITY.md`: extension row: permissions, no network, packet and result stores, host permissions, injection only on action.
- `THREAT-MODEL.md`: boundary 7 extension page injection; threats: wrong-page fill, forged app message, forged page message, stale results, submitted without review; each with a control and a test.
- `POLICY.md`: six kinds of request; the extension adds none. Say that packets and results live in the extension's own storage, that the extension can read the page the user invokes it on, and that it never sees the key.
- `README.md`: install steps (`npm run build:extension`, `chrome://extensions`, Load unpacked, select `extension/dist`), the review step, and the removal path.

- [ ] **Step 2: Run every gate**

```bash
npm test
npm run test:demo
npm run build:extension
npm run check:extension
npm run build:web
npm run test:web
```

From the worktree root: `node tools/check-secrets.mjs --all`.

- [ ] **Step 3: Independent review**

Dispatch a general-purpose reviewer with the diff, the spec and the plan, asking for HIGH and MEDIUM findings only with file:line evidence. Fix every finding with a test and rerun the gates.

- [ ] **Step 4: Evidence, commit, PR**

Add to the spec:

```markdown
## Evidence

- Gates: `npm test`, `npm run test:demo`, `npm run build:extension`, `npm run check:extension`, `npm run build:web`, `npm run test:web` and `node tools/check-secrets.mjs --all`, all green.
- Proofs: matcher, adapter, protocol, store and worker tests; `scripts/web-extension.mjs` for handshake, three adapters, CAPTCHA refusal, review, submit and result sync.
- Docs: README install steps; `SECURITY.md`, `THREAT-MODEL.md` and `POLICY.md` describe the extension.
```

Set the status line to `shipped 2026-11-01 (PR #<number>)` once the PR exists, commit, push, open the PR, watch checks, merge with `--merge --delete-branch`, and do not deploy.
