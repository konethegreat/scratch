# Live-scale hardening and isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the hosted web alpha's isolation, key handling, feed failure behaviour and storage pressure behaviour proven by offline tests, and document the free-tier model and residual risks honestly.

**Architecture:** No new subsystem. Two small production changes (spend-cap classification in the browser key probe, quota translation in the IndexedDB adapter), two response headers, three offline E2E extensions, one new two-context isolation E2E, and documentation. All browser tests run against the real built bundle with every network call answered locally.

**Tech Stack:** React 18 + Vite 7, Node 22 `node:test`, Playwright (Chromium), IndexedDB, Cloudflare Pages static hosting.

**Spec:** [`docs/superpowers/specs/2026-10-27-live-scale-isolation-design.md`](../specs/2026-10-27-live-scale-isolation-design.md)

## Global Constraints

- Work happens in the existing worktree `C:\Users\Kone\.gemini\antigravity\scratch\.claude\worktrees\api-compliance` on branch `feat/live-scale-isolation`.
- Run app commands from `sa-job-agent-suite/`. Run `node tools/check-secrets.mjs --all` from the worktree root.
- Every test is offline. Never run `npm run smoke:live`, `node evals/run.mjs --live`, or anything that needs `ANTHROPIC_API_KEY`. Never set that variable.
- Never write a key-shaped literal. Test keys are assembled at runtime, as the existing tests do.
- No live job feed requests. Playwright routes answer every feed from `packages/core/src/feeds/fixtures/`.
- Anthropic is the only AI provider. Do not introduce provider names in code outside `server/src/db/migrations.js`.
- No model ID literals outside `packages/core/src/models.js` and `*.test.js`.
- No em dashes in new UI copy or documentation. Use commas, semicolons or full stops.
- Light mode remains the default; this plan adds no colour or layout changes.
- Every commit ends with the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Never bypass the pre-commit hook. Never use `--no-verify`.
- Push and merge only this branch. Merge only after every CI check is green.
- Build before every browser test: `npm run build:web`.

## File Map

| File | Responsibility |
|---|---|
| `sa-job-agent-suite/client/src/web/validateKey.js` | Map 402 and billing 429 to `SPEND_CAP`; keep plain 429 as `RATE_LIMITED`. |
| `sa-job-agent-suite/client/src/web/validateKey.test.js` | Status table plus billing, plain 429, and single-request assertions. |
| `sa-job-agent-suite/client/src/web/idbAdapter.js` | Translate `QuotaExceededError` into `STORAGE_FULL` with web copy. |
| `sa-job-agent-suite/client/src/web/idbAdapter.test.js` | New. Quota translation for sync and async IndexedDB failures. |
| `sa-job-agent-suite/client/public/_headers` | Add `X-Frame-Options` and `Cross-Origin-Resource-Policy`. |
| `sa-job-agent-suite/scripts/web-canary.mjs` | Header assertions, backup export scan, third-party script CSP assertion. |
| `sa-job-agent-suite/scripts/web-feeds.mjs` | One-feed HTTP 503 pass with retry recovery. |
| `sa-job-agent-suite/scripts/web-isolation.mjs` | New. Two-context isolation plus quota failure pass. |
| `sa-job-agent-suite/package.json` | Add `web-isolation.mjs` to `test:web`. |
| `SECURITY.md` | Hosted web isolation model, free-tier facts, residual risks, stale provider fixes. |
| `CLAUDE.md` | Web isolation invariants and the test that protects each. |
| `docs/superpowers/specs/2026-10-27-post-m3a3-pipeline.md` | Mark Arc 1 and Arc 2 shipped with real PR links. |

---

### Task 1: Distinguish a spend cap from a rate limit

**Files:**
- Modify: `sa-job-agent-suite/client/src/web/validateKey.js:2,47-58`
- Test: `sa-job-agent-suite/client/src/web/validateKey.test.js:36-42` and new tests

**Interfaces:**
- Consumes: `isSpendCapError` from `@sajas/core/errors` (already exported; returns true for `billing_error` and for messages matching spend, credit balance or billing).
- Produces: `validateAnthropicKey` throws `AppError` with `code === 'SPEND_CAP'` for 402 and billing 429; `'RATE_LIMITED'` for every other 429. No new exports.

- [ ] **Step 1: Extend the failing status table and add the spend-cap tests**

In `sa-job-agent-suite/client/src/web/validateKey.test.js`, replace the table test with:

```js
test('SDK-style statuses map to typed errors', async () => {
  for (const [status, code] of [[401, 'AUTH_REJECTED'], [402, 'SPEND_CAP'], [403, 'KEY_PERMISSION'], [429, 'RATE_LIMITED'], [529, 'OVERLOADED'], [500, 'OVERLOADED']]) {
    await assert.rejects(() => validateAnthropicKey(API_KEY, { fetchImpl: fakeFetch(status) }), (e) => e.code === code, String(status));
  }
});

test('a 402 and a billing 429 are spend caps, not rate limits', async () => {
  const billing = JSON.stringify({
    type: 'error',
    error: { type: 'billing_error', message: 'Your credit balance is too low to access the API.' }
  });
  for (const fetchImpl of [fakeFetch(402), fakeFetch(429, billing)]) {
    await assert.rejects(
      () => validateAnthropicKey(API_KEY, { fetchImpl }),
      (e) => e.code === 'SPEND_CAP'
    );
    assert.equal(fetchImpl.calls.length, 1, 'the key probe retried a spend cap');
  }
});

test('a plain 429 stays a rate limit and is not retried', async () => {
  const limited = JSON.stringify({
    type: 'error',
    error: { type: 'rate_limit_error', message: 'Number of requests has exceeded your rate limit.' }
  });
  const fetchImpl = fakeFetch(429, limited);
  await assert.rejects(
    () => validateAnthropicKey(API_KEY, { fetchImpl }),
    (e) => e.code === 'RATE_LIMITED'
  );
  assert.equal(fetchImpl.calls.length, 1, 'the key probe retried a rate limit');
});

test('an unreadable 429 body is treated as a rate limit', async () => {
  const fetchImpl = fakeFetch(429, 'not json');
  await assert.rejects(
    () => validateAnthropicKey(API_KEY, { fetchImpl }),
    (e) => e.code === 'RATE_LIMITED'
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `sa-job-agent-suite/`:

```bash
node --test client/src/web/validateKey.test.js
```

Expected: the new table entry and the spend-cap test fail because 402 and billing 429 currently produce `AUTH_REJECTED` or `RATE_LIMITED`.

- [ ] **Step 3: Implement the classification**

In `sa-job-agent-suite/client/src/web/validateKey.js`, change the import on line 3 to:

```js
import { AppError, ERROR_CODES, toUserError, isSpendCapError } from '@sajas/core/errors';
```

Add this helper above `validateAnthropicKey`:

```js
// A 429 is overloaded: it can be a transient rate limit or a permanent spend
// cap. Anthropic names the latter in the body, so read it once and classify.
async function bodyIsSpendCap(res) {
  try {
    return isSpendCapError(await res.json());
  } catch {
    return false;
  }
}
```

Replace the status block (from `if (res.ok) return true;` through the final `throw`) with:

```js
  if (res.ok) return true;
  if (res.status === 402) {
    throw new AppError(ERROR_CODES.SPEND_CAP, 'The Anthropic account behind this key has reached its spend or credit limit.');
  }
  if (res.status === 429) {
    if (await bodyIsSpendCap(res)) {
      throw new AppError(ERROR_CODES.SPEND_CAP, 'The Anthropic account behind this key has reached its spend or credit limit.');
    }
    throw new AppError(ERROR_CODES.RATE_LIMITED, 'Anthropic is rate-limiting this key right now.');
  }
  if (res.status >= 500) {
    throw new AppError(ERROR_CODES.OVERLOADED, 'Anthropic is temporarily unavailable. Try again in a moment.');
  }
  if (res.status === 403) {
    throw new AppError(ERROR_CODES.KEY_PERMISSION, 'This key is valid but is not allowed to list models. Check its permissions in the Anthropic Console.');
  }
  throw new AppError(ERROR_CODES.AUTH_REJECTED, 'Anthropic rejected this key. Check that it is a standard API key, not an admin key.');
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
node --test client/src/web/validateKey.test.js
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add sa-job-agent-suite/client/src/web/validateKey.js sa-job-agent-suite/client/src/web/validateKey.test.js
git commit -m "fix(web): classify a spend cap separately from a rate limit

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Translate IndexedDB quota failures into a web-specific storage error

**Files:**
- Modify: `sa-job-agent-suite/client/src/web/idbAdapter.js:1-98`
- Test: `sa-job-agent-suite/client/src/web/idbAdapter.test.js` (create)

**Interfaces:**
- Consumes: `AppError` and `ERROR_CODES.STORAGE_FULL` from `@sajas/core/errors`.
- Produces: exported `toStorageError(error)`, which returns an `AppError` with `code === 'STORAGE_FULL'` and the web hint when `error.name === 'QuotaExceededError'`, and returns the input unchanged otherwise. Every adapter rejection path passes through it.

- [ ] **Step 1: Write the failing test**

Create `sa-job-agent-suite/client/src/web/idbAdapter.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createIdbAdapter, toStorageError } from './idbAdapter.js';

function quotaError() {
  return Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' });
}

test('non-quota failures pass through unchanged', () => {
  const original = new Error('boom');
  assert.equal(toStorageError(original), original);
});

test('a quota failure becomes STORAGE_FULL with web recovery copy', () => {
  const error = toStorageError(quotaError());
  assert.equal(error.code, 'STORAGE_FULL');
  assert.match(error.message, /storage is full/i);
  assert.match(error.hint, /Export a backup/i);
  assert.match(error.hint, /clear site data/i);
});

// Minimal fake IDB: open succeeds, the transaction hands back one request, and
// that request fails the way IndexedDB reports a full disk.
function fakeFactory(put) {
  return {
    open() {
      const request = {};
      queueMicrotask(() => {
        request.result = {
          objectStoreNames: { contains: () => true },
          transaction() {
            return {
              objectStore: () => ({ put }),
              error: null
            };
          }
        };
        request.onsuccess();
      });
      return request;
    }
  };
}

test('an asynchronous quota hit on a write rejects as STORAGE_FULL', async () => {
  const factory = fakeFactory(() => {
    const request = {};
    queueMicrotask(() => {
      request.error = quotaError();
      request.onerror();
    });
    return request;
  });
  const adapter = createIdbAdapter({ factory });
  await assert.rejects(
    () => adapter.put('jobs', 'j1', { title: 'Test' }),
    (error) => error.code === 'STORAGE_FULL' && /clear site data/i.test(error.hint)
  );
});

test('a synchronous quota throw on a write rejects as STORAGE_FULL', async () => {
  const factory = fakeFactory(() => {
    throw quotaError();
  });
  const adapter = createIdbAdapter({ factory });
  await assert.rejects(
    () => adapter.put('jobs', 'j1', { title: 'Test' }),
    (error) => error.code === 'STORAGE_FULL'
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test client/src/web/idbAdapter.test.js
```

Expected: FAIL with an import error because `toStorageError` is not exported yet. After adding only the export, the quota assertions fail with a raw `QuotaExceededError`.

- [ ] **Step 3: Implement the translation**

In `sa-job-agent-suite/client/src/web/idbAdapter.js`, replace the header comment with:

```js
// IndexedDB adapter for the hosted app. One database, one object store per data
// area, created on the first open. Quota failures are translated here because
// the desktop recovery hint (delete documents) does not fit the web app, where
// documents are never stored locally.
```

Add this export after the constants:

```js
export function toStorageError(error) {
  if (error?.name !== 'QuotaExceededError') return error;
  return new AppError(ERROR_CODES.STORAGE_FULL, 'Your browser storage is full, so this change was not saved.', {
    hint: 'Export a backup from Profile & Settings, then delete jobs you no longer need, or clear site data for this page.'
  });
}
```

In `open()`, change the error handler to:

```js
      request.onerror = () => reject(toStorageError(request.error));
```

Replace `run` with:

```js
  function run(store, mode, action) {
    return open().then((db) => new Promise((resolve, reject) => {
      let tx;
      let request;
      try {
        tx = db.transaction(store, mode);
        request = action(tx.objectStore(store));
      } catch (error) {
        // A store can throw before any request exists, for example when the
        // browser rejects a write at the transaction boundary.
        reject(toStorageError(error));
        return;
      }
      let settled = false;
      let result;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        reject(toStorageError(error));
      };
      // A request success only means the request was processed; the write is
      // not durable until the transaction commits.
      request.onsuccess = () => {
        result = request.result;
      };
      request.onerror = () => fail(request.error);
      tx.oncomplete = () => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      tx.onerror = () => fail(tx.error || request.error);
      tx.onabort = () => fail(tx.error || request.error);
    }));
  }
```

In `entries`, change both transaction error handlers to:

```js
        tx.onerror = () => reject(toStorageError(tx.error));
        tx.onabort = () => reject(toStorageError(tx.error));
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node --test client/src/web/idbAdapter.test.js
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Run the client suite to check for regressions**

```bash
npm test --workspace=client
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add sa-job-agent-suite/client/src/web/idbAdapter.js sa-job-agent-suite/client/src/web/idbAdapter.test.js
git commit -m "fix(web): report storage quota failures with web recovery steps

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Add the two framing headers and extend the key canary

**Files:**
- Modify: `sa-job-agent-suite/client/public/_headers`
- Modify: `sa-job-agent-suite/scripts/web-canary.mjs`
- Test: `sa-job-agent-suite/scripts/web-canary.mjs` (the canary is the test)

**Interfaces:**
- Consumes: the existing `startStaticServer` header parser, which merges `/*` rules into every response.
- Produces: served `X-Frame-Options: DENY` and `Cross-Origin-Resource-Policy: same-origin`; canary assertions for `frame-ancestors 'none'`, XFO, COOP, CORP, a real backup export, and a blocked third-party script.

- [ ] **Step 1: Add the failing header assertions**

In `sa-job-agent-suite/scripts/web-canary.mjs`, directly after the existing `servedCsp` assertions (after the `wildcard connect-src` line), add:

```js
    assert.match(servedCsp, /frame-ancestors 'none'/, 'served CSP does not forbid framing');
    assert.equal(served.headers.get('x-frame-options'), 'DENY', 'X-Frame-Options is missing');
    assert.equal(served.headers.get('cross-origin-opener-policy'), 'same-origin', 'Cross-Origin-Opener-Policy is missing');
    assert.equal(served.headers.get('cross-origin-resource-policy'), 'same-origin', 'Cross-Origin-Resource-Policy is missing');
```

- [ ] **Step 2: Build and run the canary to watch it fail**

```bash
npm run build:web
npm run test:web
```

Expected: FAIL with `X-Frame-Options is missing`. The static server applies `_headers`, so this proves the assertion is live.

- [ ] **Step 3: Add the headers**

Append to the `/*` block in `sa-job-agent-suite/client/public/_headers`:

```
  X-Frame-Options: DENY
  Cross-Origin-Resource-Policy: same-origin
```

The full block becomes:

```
/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; connect-src 'self' https://api.anthropic.com https://remotive.com https://www.arbeitnow.com https://jobicy.com; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'; upgrade-insecure-requests
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Permissions-Policy: accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Resource-Policy: same-origin
  X-Frame-Options: DENY
```

- [ ] **Step 4: Rebuild and run the canary to verify the headers pass**

```bash
npm run build:web
npm run test:web
```

Expected: PASS for the canary and the feeds script.

- [ ] **Step 5: Extend the canary with the backup export scan**

At the top of `web-canary.mjs`, add `os` to the imports:

```js
import os from 'node:os';
```

Inside `main`, replace:

```js
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
```

with:

```js
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
```

Immediately before the existing `// Remember -> the blob must be ciphertext only.` block, insert:

```js
      // A real export with the key loaded must not contain it, and must not
      // carry the vault store at all.
      await page.getByRole('button', { name: /Profile & Settings/i }).click();
      await page.getByRole('button', { name: 'Backup', exact: true }).click();
      const [backupDownload] = await Promise.all([
        page.waitForEvent('download', { timeout: 20_000 }),
        page.getByTestId('export-backup').click()
      ]);
      backupFile = path.join(os.tmpdir(), `sajas-web-canary-${process.pid}-${Date.now()}.json`);
      await backupDownload.saveAs(backupFile);
      const backupText = await fs.readFile(backupFile, 'utf8');
      assert.equal(backupText.includes(canary), false, 'the backup export contains the plaintext key');
      const backup = JSON.parse(backupText);
      assert.equal('keyVault' in (backup.data || {}), false, 'the backup contains a keyVault store');
      await page.getByRole('button', { name: 'AI & Cost', exact: true }).click();
```

Add the state variable immediately after `const { chromium } = await import('playwright');` so the outer `finally` can see it:

```js
  let backupFile = null;
```

In the outer `finally` (currently `} finally { await browser.close(); }`), replace with:

```js
    } finally {
      if (backupFile) await fs.rm(backupFile, { force: true }).catch(() => {});
      await browser.close();
    }
```

The existing Remember step clicks `Profile & Settings` and then `remember-open`; it stays correct because the inserted block returns to the `AI & Cost` sub-tab.

- [ ] **Step 6: Add the third-party script assertion**

Immediately after the `assert.deepEqual(leaks, [], ...)` line that follows the first full leak scan, insert:

```js
      // CSP must stop a third-party script before any request leaves the page.
      const violation = await page.evaluate(() => new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), 3000);
        document.addEventListener('securitypolicyviolation', (event) => {
          if (!event.violatedDirective.startsWith('script-src')) return;
          clearTimeout(timer);
          resolve({ directive: event.violatedDirective, blockedURI: event.blockedURI });
        }, { once: true });
        const script = document.createElement('script');
        script.src = 'https://evil.example/canary.js';
        document.head.appendChild(script);
      }));
      assert.ok(violation, 'the CSP did not fire a script-src violation for a third-party script');
      assert.match(violation.blockedURI, /evil\.example/, `the CSP reported ${violation.blockedURI}`);
      assert.deepEqual(
        blocked.filter((url) => url.includes('evil.example')),
        [],
        'the third-party script left the page before CSP stopped it'
      );
```

- [ ] **Step 7: Run the extended canary**

```bash
npm run test:web
```

Expected: PASS. The run now also proves the backup has no key and no `keyVault`, and that the CSP blocks the injected script.

- [ ] **Step 8: Commit**

```bash
git add sa-job-agent-suite/client/public/_headers sa-job-agent-suite/scripts/web-canary.mjs
git commit -m "feat(web): add framing headers and extend the key canary

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Prove one failed feed never blanks the other two

**Files:**
- Modify: `sa-job-agent-suite/scripts/web-feeds.mjs`

**Interfaces:**
- Consumes: the existing per-source failure card in `JobFeeds.jsx`, the retry path `getFeedClient().load(id, { force: true })`, and the existing fixture map.
- Produces: a failure phase in the existing E2E; no production change.

- [ ] **Step 1: Add the controllable failure route**

In `web-feeds.mjs`, after the `NOTE` constant, add:

```js
const FAILED_FEED = 'https://jobicy.com/api/v2/remote-jobs';
```

Inside `main`, next to `let browser = null;` add:

```js
  let feedOutage = true;
```

In the route handler, before `const body = payloads.get(url);`, insert:

```js
      if (feedOutage && url === FAILED_FEED) {
        return route.fulfill({
          status: 503,
          headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
          body: JSON.stringify({ error: 'temporarily unavailable' })
        });
      }
```

- [ ] **Step 2: Add the failure and recovery phase**

After `await page.getByTestId('feed-row-0').waitFor({ timeout: 15_000 });` (the first one, before `at('every feed returned rows')`), insert:

```js
    at('one failed feed is isolated');
    const failedCard = page.getByTestId('feed-source-jobicy');
    await failedCard.getByText(/HTTP 503/).waitFor({ timeout: 20_000 });
    assert.ok(await waitForSourceCount(page, 'remotive') >= 1, 'remotive lost its rows when jobicy failed');
    assert.ok(await waitForSourceCount(page, 'arbeitnow') >= 1, 'arbeitnow lost its rows when jobicy failed');
    await page.getByTestId('feed-row-0').waitFor({ timeout: 15_000 });
    await failedCard.getByRole('button', { name: 'Retry this feed' }).click();
    feedOutage = false;
    const recovered = await waitForSourceCount(page, 'jobicy');
    assert.ok(recovered >= 1, `the recovered jobicy card reports ${recovered} jobs`);
    await failedCard.getByText(/HTTP 503/).waitFor({ state: 'detached', timeout: 15_000 });
```

- [ ] **Step 3: Run the extended feeds E2E**

```bash
npm run build:web
node scripts/web-feeds.mjs
```

Expected: PASS. The log reaches `web-feeds: PASS`; on failure the step name names the phase.

- [ ] **Step 4: Commit**

```bash
git add sa-job-agent-suite/scripts/web-feeds.mjs
git commit -m "test(web): prove one failed feed does not blank the others

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Add the two-context isolation E2E and wire it into the merge gate

**Files:**
- Create: `sa-job-agent-suite/scripts/web-isolation.mjs`
- Modify: `sa-job-agent-suite/package.json:17`
- Test: `sa-job-agent-suite/scripts/web-isolation.mjs`

**Interfaces:**
- Consumes: `startStaticServer`, the three feed fixtures, the `feed-source-*`, `feed-row-0`, `add-job-0`, `job-status` and onboarding test ids, and the `STORAGE_FULL` behaviour from Task 2.
- Produces: `npm run test:web` runs canary, feeds and isolation in that order; exit code is non-zero on any failure.

- [ ] **Step 1: Create the isolation script**

Create `sa-job-agent-suite/scripts/web-isolation.mjs`:

```js
// Merge-blocking offline proof that two browser contexts on the same origin do
// not share data, and that a storage quota failure is reported without
// persisting the failed write.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { startStaticServer } from './lib/staticServer.mjs';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'client/dist');
const fixtures = path.join(root, 'packages/core/src/feeds/fixtures');

const FEEDS = new Map([
  ['https://remotive.com/api/remote-jobs', 'remotive.json'],
  ['https://www.arbeitnow.com/api/job-board-api', 'arbeitnow.json'],
  ['https://jobicy.com/api/v2/remote-jobs', 'jobicy.json']
]);

let step = 'start';

function at(name) {
  step = name;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function assertBuiltDist() {
  try {
    await fs.access(path.join(dist, 'index.html'));
  } catch {
    throw new Error('client/dist/index.html is missing - run npm run build:web first.');
  }
}

async function enterSuite(page) {
  const enter = page.getByRole('button', { name: /Enter the Suite/i });
  await enter.waitFor({ timeout: 20_000 });
  await enter.click();
}

async function openTracker(page) {
  await page.getByRole('button', { name: 'Job Hunter', exact: true }).click();
  await page.locator('table.data-table tbody').waitFor({ timeout: 15_000 });
}

async function readJobs(page) {
  return page.evaluate(async () => {
    const info = (await indexedDB.databases()).find((entry) => entry.name === 'sajas-web');
    if (!info) return [];
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('sajas-web');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const rows = await new Promise((resolve, reject) => {
      const tx = db.transaction('jobs', 'readonly');
      const request = tx.objectStore('jobs').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return rows;
  });
}

async function waitForStoredJob(page, title, check, label) {
  const deadline = Date.now() + 15_000;
  let last = null;
  while (Date.now() < deadline) {
    const rows = await readJobs(page);
    last = rows.find((row) => row.title === title) || null;
    if (last && check(last)) return last;
    await delay(100);
  }
  assert.fail(`${label}: the vault never stored the expected record (last seen: ${JSON.stringify(last)})`);
}

function routePage(page, { serverOrigin, payloads, aborted }) {
  return page.route('**/*', async (route) => {
    const url = route.request().url();
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      parsed = null;
    }
    if (parsed && parsed.origin === serverOrigin) return route.continue();
    const body = payloads.get(url);
    if (body) {
      return route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
        body: JSON.stringify(body)
      });
    }
    aborted.push(url);
    return route.abort('blockedbyclient');
  });
}

async function skipKeyAndEnter(page) {
  await page.getByTestId('key-skip').click();
  await enterSuite(page);
  await page.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor({ timeout: 15_000 });
}

async function main() {
  await assertBuiltDist();
  const payloads = new Map();
  for (const [url, file] of FEEDS) {
    payloads.set(url, JSON.parse(await fs.readFile(path.join(fixtures, file), 'utf8')));
  }

  const server = await startStaticServer({ root: dist });
  const serverOrigin = new URL(server.url).origin;
  const abortedA = [];
  const abortedB = [];
  let browser = null;

  try {
    browser = await chromium.launch({ headless: true });
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    await routePage(pageA, { serverOrigin, payloads, aborted: abortedA });
    await routePage(pageB, { serverOrigin, payloads, aborted: abortedB });

    at('context A adds a job');
    await pageA.goto(server.url, { waitUntil: 'domcontentloaded' });
    await pageA.getByTestId('onboarding').waitFor({ timeout: 15_000 });
    await skipKeyAndEnter(pageA);
    await pageA.getByRole('button', { name: 'Job Feeds', exact: true }).click();
    await pageA.getByTestId('feed-row-0').waitFor({ timeout: 15_000 });
    const title = (await pageA.getByTestId('feed-row-0').locator('td').first().locator('div').first().innerText()).trim();
    assert.ok(title.length > 0, 'the feed row has no title');
    await pageA.getByTestId('add-job-0').click();
    await pageA.getByTestId('add-job-0').filter({ hasText: 'In tracker' }).waitFor({ timeout: 15_000 });
    await openTracker(pageA);
    await pageA.getByTestId('job-status').selectOption('applied');
    await waitForStoredJob(pageA, title, (job) => job.status === 'applied', 'context A status');

    at('context B starts empty');
    await pageB.goto(server.url, { waitUntil: 'domcontentloaded' });
    await pageB.getByTestId('onboarding').waitFor({ timeout: 15_000 });
    const browserStorage = await pageB.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
      cookie: document.cookie
    }));
    assert.equal(browserStorage.local, 0, 'context B inherited localStorage');
    assert.equal(browserStorage.session, 0, 'context B inherited sessionStorage');
    assert.equal(browserStorage.cookie, '', 'context B inherited a cookie');
    assert.deepEqual(await readJobs(pageB), [], 'context B can see context A jobs before onboarding');
    assert.deepEqual(await contextB.cookies(), [], 'context B received a cookie');

    at('context B has an empty tracker');
    await skipKeyAndEnter(pageB);
    await openTracker(pageB);
    await pageB.getByText('No records yet. Add a job manually or pull one from Job Feeds.').waitFor({ timeout: 15_000 });
    assert.deepEqual(await readJobs(pageB), [], 'context B can see context A jobs after onboarding');

    at('context A still sees its own job');
    assert.equal(await pageA.getByTestId('job-status').inputValue(), 'applied', 'context A lost its status');
    assert.equal(await readJobs(pageA).then((rows) => rows.length), 1, 'context A lost its job');

    at('a quota failure is reported and does not persist');
    await pageA.evaluate(() => {
      const original = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) {
        if (this.name === 'jobs') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        return original.apply(this, args);
      };
    });
    await pageA.getByTestId('job-status').selectOption('offer');
    const quotaToast = pageA.locator('.toast.toast-error .toast-msg').filter({ hasText: 'storage is full' });
    await quotaToast.waitFor({ timeout: 5000 });
    const quotaText = await quotaToast.innerText();
    assert.match(quotaText, /clear site data/i, 'the storage error does not explain how to recover');
    await delay(500);
    const unchanged = await readJobs(pageA).then((rows) => rows.find((row) => row.title === title));
    assert.equal(unchanged?.status, 'applied', 'the failed write changed the stored status');

    assert.deepEqual(abortedA, [], `context A tried to reach a blocked URL: ${abortedA.join(', ')}`);
    assert.deepEqual(abortedB, [], `context B tried to reach a blocked URL: ${abortedB.join(', ')}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }
}

main()
  .then(() => {
    console.log('web-isolation: PASS');
  })
  .catch((error) => {
    console.error(`web-isolation: FAIL at "${step}"`);
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
```

- [ ] **Step 2: Run the new script**

```bash
npm run build:web
node scripts/web-isolation.mjs
```

Expected: PASS. If the quota toast never appears, confirm Task 2 landed before debugging the script.

- [ ] **Step 3: Wire the script into the merge gate**

In `sa-job-agent-suite/package.json`, replace the `test:web` line with:

```json
    "test:web": "node scripts/web-canary.mjs && node scripts/web-feeds.mjs && node scripts/web-isolation.mjs",
```

- [ ] **Step 4: Run the full web gate**

```bash
npm run test:web
```

Expected: `web canary: PASS`, `web-feeds: PASS`, `web-isolation: PASS`, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add sa-job-agent-suite/scripts/web-isolation.mjs sa-job-agent-suite/package.json
git commit -m "test(web): prove cross-profile isolation and quota handling

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Document the isolation model, free-tier limits and residual risks

**Files:**
- Modify: `SECURITY.md` (full replacement)
- Modify: `CLAUDE.md:318-329` (merge gate and CSP bullets)

**Interfaces:**
- Consumes: the behaviour proven by Tasks 1 to 5.
- Produces: no runtime output. The docs must name the test that protects each claim.

- [ ] **Step 1: Replace SECURITY.md**

Write `SECURITY.md` with exactly this content:

````markdown
# Security Policy

SA-JAS runs in two shapes: a hosted web app at https://sajas.pages.dev with a bring-your-own Anthropic key, and a local-first desktop application. Neither shape sends your data to a SA-JAS server. There is no SA-JAS server holding user data.

---

## Hosted web app

The hosted app is a static Cloudflare Pages bundle. There are no Pages Functions, no accounts, and no server-side database.

| Layer | What protects it |
|---|---|
| Isolation | All data lives in the browser IndexedDB database `sajas-web`, partitioned by browser profile and origin. Another profile, browser, device or private window starts empty. |
| API key | The plaintext key exists only in a closure in `keyStore.js`. It is never written to localStorage, sessionStorage, cookies, URLs, logs or the backup. The optional Remember form stores only an AES-GCM blob in the `keyVault` store, unlocked by a passphrase that is never stored. |
| Key requests | Keyed requests go directly from the browser to `api.anthropic.com` in the `x-api-key` header. No request carries the key to our origin, and `connect-src` does not allow it. |
| Backup | The export contains `profile`, `jobs`, `answers`, `memory`, `usage` and `meta`. It never contains `keyVault`. |
| Response headers | Strict CSP (`script-src 'self'`, explicit `connect-src`, `frame-ancestors 'none'`, `base-uri 'none'`, `object-src 'none'`, `form-action 'self'`), `X-Frame-Options: DENY`, COOP and CORP `same-origin`, HSTS, `nosniff`, `no-referrer`, and a restrictive Permissions Policy. |
| Merge gate | `scripts/web-canary.mjs` fails the build if the key reaches the DOM, form values, iframes, URL, localStorage, sessionStorage, cookies, IndexedDB plaintext, the console, a backup export, or any request or header other than `x-api-key` to `api.anthropic.com`. It also proves CSP blocks a third-party script. `scripts/web-isolation.mjs` proves two browser contexts share nothing and that a quota failure is reported without persisting the failed write. |

What our origin sees: requests for static assets only. There is no analytics, no telemetry and no user data on the origin.

What the app never sends to our origin: the API key, the CV, profile details, application answers, jobs, tracker state or backups.

### Free-plan limits

Cloudflare Pages free plan, checked on 2026-10-27: 500 builds per month, 20,000 files per deployment, 25 MiB maximum file size, and unmetered requests for static assets. This deployment has no Functions. Requests that invoke Functions are billed as Workers, with a free daily request allowance, which is one reason the app has none.

### Residual risks

- **XSS on our origin.** A script injected into the app could read the in-memory key. The CSP forbids inline and third-party scripts, the client has no dangerous HTML sinks, React escapes rendered values, and the canary detects key leaks. This remains the main risk a static app cannot remove completely.
- **Malicious browser extensions and device access.** An extension, or anyone with access to the unlocked device, can read page state. Use a dedicated browser profile on a device you trust.
- **IndexedDB eviction.** The browser may evict storage under pressure. When the quota is reached the app reports `STORAGE_FULL`, tells you to export a backup, and does not persist the failed write. Export regularly.
- **No account recovery.** Clearing site data, using a different profile or losing the device loses the local data and any saved key blob. A backup file is the only recovery path.
- **Feeds see your IP address.** The three job feeds are fetched directly by your browser, so their operators see your IP and request headers, as they would for any website you visit.

---

## Desktop architecture security model

| Layer | What protects it |
|---|---|
| API keys | Stored in `keys.json`, never in `db.json`. Never returned raw from any API endpoint (boolean `hasAnthropicKey` flag only). Never sent to portal pages. |
| CV and personal data | Stored in `db.json` in your OS user-data directory. Never leaves your machine except as input to Anthropic when you use an AI feature. |
| Browser sessions | Persistent Playwright profile in `browser-profile/`. On Windows with real Chrome, cookies are DPAPI-encrypted and tied to your local Windows account. |
| AI prompts (Agent 2) | Every prompt begins with an injection shield. The job description is wrapped in `[BEGIN UNTRUSTED JOB DESCRIPTION]` / `[END UNTRUSTED JOB DESCRIPTION]` markers. Any directives found inside are treated as plain text, not instructions. |
| Apply portal pages (Agent 3) | The DOM injection scanner runs before HUD injection, looking for hidden elements (display:none, opacity<0.1, fontSize<2px) that match known manipulation patterns. Only `{ title, company, autofill, tailoredCvText, tailoredCoverLetterText }` enter `page.evaluate`; `baseCv` and API keys never touch the portal page context. Scraped strings are HTML-escaped before insertion into innerHTML. `applyUrl` is validated to `http://` or `https://` before navigation, so `javascript:`, `file://` and `data:` schemes are rejected. |
| Electron renderer | `contextIsolation: true`, `nodeIntegration: false`. External links open in the system browser via `shell.openExternal`, not inside the app window. |
| Git history | `keys.json`, `db.json` and `browser-profile/` are gitignored. `.env` carries `PORT` only, no secrets. |

---

## Reporting a vulnerability

SA-JAS is free, open-source software. The hosted app has no server-side user data to attack. Security bugs still matter: a malicious job listing could attempt to exploit the scraper or the Apply Copilot.

**To report a vulnerability:**

1. **Do not open a public GitHub issue** if the report contains a working exploit or sensitive details.
2. Email **erictshivhinda@gmail.com** with the subject line `[SA-JAS Security]`.
3. Include:
   - A description of the vulnerability
   - Steps to reproduce
   - The component affected (Agent 1 / 2 / 3, Electron shell, server API, hosted web app)
   - Potential impact

You will receive a response within **7 days**. If a fix is warranted, a patched release will follow with credit to you in the changelog (unless you prefer to remain anonymous).

---

## Scope

| In scope | Out of scope |
|---|---|
| Prompt injection via scraped job content | Attacks requiring physical access to the user's machine |
| XSS in the Apply Copilot HUD or the hosted app | Vulnerabilities in third-party job sites (report to them) |
| URL injection via `applyUrl` | Rate-limiting or scraping fairness on job sites |
| Electron context isolation bypass | Social engineering of the user |
| Local data exfiltration via crafted job listings | Denial of service against the local server |
| Cross-profile data leakage in the hosted app | Browser or operating system vulnerabilities |

---

## Known limitations

- **The injection scanner is heuristic.** The DOM scanner in Agent 3 matches text patterns and visibility styles. It can be bypassed by Unicode homoglyphs, zero-width characters or novel phrasing. It is a warning layer, not a block.
- **Anthropic is the only AI provider.** Your CV and the job description are sent to Anthropic when you use an AI feature. Review Anthropic's data retention and privacy policies before use.
- **The local API has no authentication.** The Express server listens on `localhost:5000` and trusts requests that pass the local guard. This is intentional for a single-user desktop app. Do not expose this port to a network.
- **`browser-profile/` contains live session cookies.** Treat this directory with the same sensitivity as saved passwords. The `.gitignore` excludes it, but be careful with backups and file-sharing tools.
- **The hosted app is only as strong as its origin.** A compromise of the Cloudflare deployment, or of a dependency that gains a script tag, bypasses the client-side isolation model. The CSP, the canary and the no-third-party rule are the controls that make this hard, and they are tested on every pull request.
````

- [ ] **Step 2: Update the web bullets in CLAUDE.md**

Replace the merge gate bullet (`- **Merge gate.**` through the end of that bullet) with:

```markdown
- **Merge gate.** `npm run test:web` serves the already-built `client/dist`
  with the production headers and runs three Playwright passes: the canary,
  the offline feeds, tracker and backup flow, and the two-context isolation
  pass. The `web` CI job treats it as merge-blocking (run `npm run build:web`
  first). The canary asserts the key appears only in the `x-api-key` header to
  `api.anthropic.com`, that no other origin is contacted, that a real backup
  export contains no key and no `keyVault`, that saved blobs are ciphertext,
  that Forget and panic wipe remove exactly what they claim, and that CSP
  stops a third-party script before any request leaves the page.
- **Isolation invariants.** Every store lives in `sajas-web` IndexedDB and is
  partitioned by browser profile and origin. Nothing is shared between
  profiles, and no request carries user data to our origin.
  `scripts/web-isolation.mjs` proves two contexts stay separate, and that a
  quota failure reports `STORAGE_FULL` with the web recovery copy while the
  stored value is unchanged. If it fails, treat it as a merge blocker, not a
  flaky test.
- **Storage pressure.** The IndexedDB adapter translates `QuotaExceededError`
  into `STORAGE_FULL` with web copy: export a backup, delete jobs you no
  longer need, or clear site data for this page. Writes still reject; never
  add optimistic persistence for a failed write.
```

Replace the CSP bullet (`- **CSP.**` through the end of that bullet) with:

```markdown
- **CSP and framing.** `client/public/_headers` is web-only: `script-src
  'self'` and `font-src 'self'` forbid third-party scripts and fonts,
  `connect-src` allows only our origin, `api.anthropic.com` and the three
  feeds, and `frame-ancestors 'none'` plus `X-Frame-Options: DENY`, COOP and
  CORP `same-origin` prevent framing and cross-origin embedding. Do not add
  analytics, remote fonts or any other third-party origin to the web build.
```

- [ ] **Step 3: Verify the docs have no stale names or em dashes**

From the worktree root:

```bash
grep -n "Gemini\|OpenRouter\|hasGeminiKey" SECURITY.md || true
git diff -U0 SECURITY.md CLAUDE.md | grep '^+' | grep '—' || true
```

Expected: no provider matches, and no added line containing an em dash.

- [ ] **Step 4: Commit**

```bash
git add SECURITY.md CLAUDE.md
git commit -m "docs: state the hosted web isolation model and its limits

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Run every gate, open the PR, merge green, deploy and verify live

**Files:**
- Modify: `docs/superpowers/specs/2026-10-27-post-m3a3-pipeline.md:15-20`
- Verify: the built bundle and the live origin.

**Interfaces:**
- Consumes: all previous tasks.
- Produces: a merged PR, a deployed bundle, a live evidence record in the PR, and an updated pipeline status.

- [ ] **Step 1: Run the full gate set**

From `sa-job-agent-suite/`:

```bash
npm test
npm run test:demo
npm run build:client
npm run build:web
npm run test:web
```

Then from the worktree root:

```bash
node tools/check-secrets.mjs --all
```

Expected: every command exits 0. If the client unit suite fails, fix it before continuing.

- [ ] **Step 2: Confirm the diff contains only the intended files**

```bash
git status --short
git diff --stat fd4863f..HEAD
```

Expected files: the two web modules and their tests, `_headers`, three scripts, `package.json`, `SECURITY.md`, `CLAUDE.md`, the spec, this plan and the pipeline document. No `client/dist`, no `keys.json`, no `db.json`, no `browser-profile/`.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin feat/live-scale-isolation
```

```bash
gh pr create --title "feat(web): live-scale hardening and per-browser isolation" --body "$(cat <<'EOF'
## Summary
- classify Anthropic spend caps separately from transient rate limits in the browser key probe
- translate IndexedDB quota failures into STORAGE_FULL with web recovery steps
- add X-Frame-Options and CORP to the hosted headers
- extend the key canary with a real backup export scan and a CSP third-party script block
- add a two-context isolation E2E and extend the feeds E2E with a one-feed outage
- document the hosted isolation model, free-plan limits and residual risks

## Evidence
- npm test
- npm run test:demo
- npm run build:client
- npm run build:web
- npm run test:web (canary, feeds, isolation)
- node tools/check-secrets.mjs --all

## Manual check after deploy
- open https://sajas.pages.dev in a fresh context, confirm onboarding, empty tracker, no key requests and the four framing headers
EOF
)"
```

Record the PR number for the next step:

```bash
gh pr view --json number --jq .number
```

- [ ] **Step 4: Mark Arc 1 and Arc 2 shipped in the pipeline document**

Open `docs/superpowers/specs/2026-10-27-post-m3a3-pipeline.md` and replace the order table rows with the real status. Use the PR number printed in Step 3 in place of `<number>`; do not leave the angle brackets in the file.

```markdown
| 1 | API compliance | Shipped 2026-10-27 (PR #8, `fd4863f`) | All offline tests pass and each changed API assumption cites the docs |
| 2 | Live-scale hardening and isolation | Shipped 2026-10-27 (PR #<number>) | Isolation, key-canary, spend-cap and feed-failure tests pass |
| 3 | UI/UX refresh | Next | Light mode, copy sweep and the new home page pass the acceptance list below |
```

Add this line immediately below the Arc 2 acceptance criteria block, again replacing `<number>`:

```markdown
**Shipped 2026-10-27 in PR #<number>.** Evidence: `npm run test:web` runs the canary, the feeds failure pass and the two-context isolation pass; `SECURITY.md` records the free-plan limits and residual risks.
```

Commit and push on the same branch so the statement ships with the code it describes:

```bash
git add docs/superpowers/specs/2026-10-27-post-m3a3-pipeline.md
git commit -m "docs: mark arcs 1 and 2 shipped

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git push
```

- [ ] **Step 5: Wait for green CI and merge**

```bash
gh pr checks --watch
```

Merge only when every check passes:

```bash
gh pr merge --squash --delete-branch
```

Record the merge commit:

```bash
git fetch origin main
git log origin/main -1 --oneline
```

The worktree stays on the feature branch. Do not switch this worktree to `main`; the primary checkout already owns that branch.

- [ ] **Step 6: Deploy to Cloudflare Pages**

Confirm the merged tree matches the branch that was just built:

```bash
git diff --stat origin/main HEAD
```

Expected: no output. If anything differs, stop and inspect before deploying.

Then rebuild and deploy from `sa-job-agent-suite/`:

```bash
npm run build:web
npx --yes wrangler@latest pages deploy client/dist --project-name sajas --branch main --commit-dirty=true
```

Expected: the deployment URL includes a hash preview and the production alias `sajas.pages.dev`.

- [ ] **Step 7: Verify the live headers**

```bash
curl -sI https://sajas.pages.dev | tr -d '\r' | grep -iE '^(content-security-policy|x-frame-options|cross-origin-opener-policy|cross-origin-resource-policy|strict-transport-security):'
```

Expected: all five headers present, CSP contains `frame-ancestors 'none'`, XFO is `DENY`, COOP and CORP are `same-origin`.

- [ ] **Step 8: Run a fresh-context live check**

Write the following to a temporary file outside the repository, fill nothing in, and run it. It uses a fresh Playwright context, never enters a key, and never opens the Job Feeds tab, so it makes no feed requests.

```js
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const URL = 'https://sajas.pages.dev';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const requests = [];
page.on('request', (req) => requests.push(req.url()));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.getByTestId('onboarding').waitFor({ timeout: 20_000 });
await page.getByTestId('key-skip').click();
await page.getByRole('button', { name: /Enter the Suite/i }).click();
await page.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor({ timeout: 20_000 });
await page.getByRole('button', { name: 'Job Hunter', exact: true }).click();
await page.getByText('No records yet. Add a job manually or pull one from Job Feeds.').waitFor({ timeout: 20_000 });
const offOrigin = requests.filter((url) => {
  try { return new URL(url).origin !== new URL(URL).origin; } catch { return true; }
});
assert.deepEqual(offOrigin, [], `live app requested off-origin URLs: ${offOrigin.join(', ')}`);
console.log(`live check: PASS (${requests.length} same-origin requests, empty tracker, onboarding)`);
await browser.close();
```

Run it with the repository's Playwright install, from `sa-job-agent-suite/`:

```bash
node /path/to/live-check.mjs
```

Expected: `live check: PASS`. Delete the temporary file afterwards.

- [ ] **Step 9: Update project memory**

Update `C:\Users\Kone\.qoder\projects\C--Users-Kone--gemini-antigravity-scratch\memory\post-m3a3-priorities.md` with the Arc 2 shipped facts: PR number, merge SHA, deploy timestamp, and that Arc 3 is next. Do not record ephemeral test counts.

---

## Self-Review

**Spec coverage**

| Spec item | Task |
|---|---|
| Spend-cap classification on 402 and billing 429, probe never retries | Task 1 |
| Quota to `STORAGE_FULL` with web copy, write rejects, previous value intact | Task 2 and Task 5 |
| `X-Frame-Options` and CORP headers | Task 3 |
| Cross-profile two-context proof | Task 5 |
| Canary backup export, header assertions, third-party script block | Task 3 |
| One failed feed does not blank the others, Retry recovers | Task 4 |
| SECURITY.md hosted section, free-tier facts, residual risks, stale provider fix | Task 6 |
| CLAUDE.md invariants and pipeline shipped status | Task 6 and Task 7 |
| All gates, PR, merge, deploy, live check | Task 7 |

**Placeholder scan:** the only angle-bracket token is `<number>` in Task 7 Step 4, with an explicit instruction to use the real PR number printed by `gh pr view`. No other placeholders.

**Type consistency:** `toStorageError` is exported in Task 2 and consumed only inside `idbAdapter.js`; the isolation script relies on the toast text produced by `describeUserError`, which joins `message` and `hint`, so it asserts on `storage is full` and `clear site data`, both present in Task 2. `SPEND_CAP` exists in `ERROR_CODES` and in the M3a-1 catalog. The canary download uses the existing `acceptDownloads` context option. The isolation script reads the same fixtures and test ids as the feeds script.
