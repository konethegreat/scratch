# M3a-1 Error Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship one typed, actionable error contract — codes, hint, retryable, requestId, scrubbed details — through `@sajas/core`, every Express route, and the desktop client, so a failure always says what broke and what to do next.

**Architecture:** `packages/core/src/errors.js` owns the code union, the catalog of user-facing messages/hints/statuses, `AppError`, and `toUserError()`. A new `server/src/httpErrors.js` turns that contract into HTTP (`requestContext`, `sendError`, 4xx helpers, terminal `errorHandler`), and every route in `server/src/index.js` uses it. The client imports the pure contract through the `@sajas/core/errors` subpath (no SDK in the bundle), records the last 20 errors in memory, and renders `ErrorCard`, `ErrorBoundary` and a Recent errors panel.

**Tech Stack:** Node ≥ 22.12 ESM, Express 4, React 18 + Vite, `node:test` + `node:assert/strict`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-27-m3-hosted-web-alpha-design.md` (§4.6 Error contract)

## Global Constraints

- Node ≥ 22.12, ESM only. Tests use `node:test` and `node:assert/strict`; no Jest, no supertest, no new npm package.
- All tests are offline. Never set `ANTHROPIC_API_KEY`; never run `npm run smoke:live`, `node evals/run.mjs --live`, a live hunt, or live scraping.
- Key-shaped strings in source and tests are assembled from fragments (for example `'sk-' + 'ant-api03-' + 'A'.repeat(40)`). Never write a complete key.
- No model-ID literals outside `packages/core/src/models.js` and `*.test.js`. No retired provider names outside `server/src/db/migrations.js`.
- The desktop API stays bound to `127.0.0.1`; `localGuard` keeps requiring `X-SAJAS-Client: 1` on non-GET requests.
- Every error response keeps the legacy `error` string and adds `message`, `code`, `hint`, `retryable`, `requestId`, and optionally `details`.
- Secrets are scrubbed before anything is displayed, stored or copied. Server `details` never contains a stack trace.
- Do not bypass the pre-commit hook (`--no-verify` is forbidden). If it fails, fix the cause.
- Run test commands from `sa-job-agent-suite/`. Create git commits from the worktree root.
- Commit trailer on every commit: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Rulings (decisions this plan makes)

- **R1 — three codes beyond the spec's list.** The spec's union is the minimum; the existing HTTP API already distinguishes 403/404/409. Add `FORBIDDEN`, `NOT_FOUND`, `CONFLICT` rather than mislabel them `UNKNOWN`. No new behaviour: only the payload gets truthful codes.
- **R2 — dual field names.** `error` remains the legacy machine string and equals `message`. New code reads `message`; old UI keeps working.
- **R3 — requestId is always present.** A server request gets `local-<12 hex>` from `requestContext` and the same value in `X-Request-Id`. When a caller has none, `toUserError` generates one.
- **R4 — details are scrubbed, never a stack.** The server sends `err.details` only when a route supplies it; otherwise the field is absent. The client's memory log stores exactly the contract payload plus `at`/`where`.
- **R5 — client imports the subpath.** Add `"./errors": "./src/errors.js"` to `@sajas/core` exports and import `@sajas/core/errors` in the client, so M3a-1 does not pull the Anthropic SDK into the web bundle.
- **R6 — no new dependencies.** Clipboard uses `navigator.clipboard` with a `document.execCommand('copy')` fallback.
- **R7 — retryable defaults.** `RATE_LIMITED`, `OVERLOADED`, `NETWORK_OFFLINE`, `CORS_BLOCKED`, `FEED_FAILED`, `CONFLICT`, `UNKNOWN` → true. Every other code → false.
- **R8 — demo and guard refusals.** The synthetic demo's 403 and `localGuard`'s 403 both become `FORBIDDEN` with the contract fields.
- **R9 — client sweep scope.** M3a-1 converts every existing error-toasting `catch`/`!res.ok` branch in `App.jsx`, the three initial-load fetchers, and adds the boundary/card/panel. Plain validation notices (e.g. "Nothing to copy yet.") stay simple toasts.
- **R10 — `/api/health` is not an error endpoint.** It stays `{ status: 'ok', timestamp }`.
- **R11 — object `details` serialise (post-review amendment).** The first reference implementation stringified `ClaudeRefusalError.details` (an object from the SDK) to `"[object Object]"`, defeating R4. `text()` now JSON-serialises non-string values before scrubbing, and `toUserError` tolerates a `null` context. Two tests were added (object details, null context), so Task 1's suite is 16 tests, not 14.
- **R12 — the terminal handler logs (post-review amendment).** The three-line `errorHandler` turned every unexpected throw into an untraceable 500 once Task 3 wired it. It now answers through `errorBody`, emits one flat scrubbed `[requestId] message` line for status ≥ 500, and mirrors `X-Request-Id` on both `sendError` and the handler path. Task 2's suite is 14 tests, not 9.

---

## File Structure

**Create**
- `sa-job-agent-suite/packages/core/src/errors.test.js` — contract mapping + scrubbing tests.
- `sa-job-agent-suite/server/src/httpErrors.js` — HTTP adapter for the contract.
- `sa-job-agent-suite/server/src/httpErrors.test.js` — adapter tests, including a real Express error-handler run.
- `sa-job-agent-suite/client/src/errors.js` — client contract helpers, memory-only error log, HTTP-body parser.
- `sa-job-agent-suite/client/src/errors.test.js` — parser, ring buffer, diagnostics tests.
- `sa-job-agent-suite/client/src/ErrorCard.jsx` — inline persistent error card.
- `sa-job-agent-suite/client/src/ErrorBoundary.jsx` — render-crash boundary.
- `sa-job-agent-suite/client/src/RecentErrors.jsx` — last-20 panel for the Logs tab.

**Modify**
- `sa-job-agent-suite/packages/core/src/errors.js` — codes, catalog, `AppError`, `toUserError`.
- `sa-job-agent-suite/packages/core/package.json` — add the `./errors` export.
- `sa-job-agent-suite/server/src/index.js` — mount middleware; every error response uses the adapter.
- `sa-job-agent-suite/server/src/localGuard.js` — 403 via the adapter.
- `sa-job-agent-suite/server/src/localGuard.test.js` — new body/header assertions.
- `sa-job-agent-suite/server/src/demo.js` — demo 403 via the adapter.
- `sa-job-agent-suite/scripts/demo.test.mjs` — assert the wire contract on the real app.
- `sa-job-agent-suite/client/package.json` — `@sajas/core` dependency + test script.
- `sa-job-agent-suite/client/src/main.jsx` — wrap `<App />` in `ErrorBoundary`.
- `sa-job-agent-suite/client/src/App.jsx` — load error card, `fail()` adoption, Recent errors panel.
- `sa-job-agent-suite/client/src/index.css` — error card/row styles.
- `CLAUDE.md`, `README.md` — document the contract and troubleshooting.

---

### Task 1: Core error contract

**Files:**
- Modify: `sa-job-agent-suite/packages/core/src/errors.js`
- Modify: `sa-job-agent-suite/packages/core/package.json`
- Test: `sa-job-agent-suite/packages/core/src/errors.test.js`

**Interfaces:**
- Consumes: `scrubSecrets(s)` from `./secrets.js`.
- Produces:
  - `ERROR_CODES` — frozen object of the 17 code strings.
  - `AppError` — `new AppError(code, message, { hint?, retryable?, status?, details?, cause? })`; `.code`, `.status`, `.retryable`.
  - `toUserError(err, context?)` → `{ code, message, hint, retryable, requestId, details? }`. `context` accepts `{ requestId?, fallback?, online?, crossOrigin?, where? }`.
  - `statusForCode(code)` → integer HTTP status.
  - Existing `ClaudeAuthError`, `ClaudeRefusalError`, `ClaudeKeyError` stay exported unchanged.

- [ ] **Step 1: Write the failing test file**

Create `sa-job-agent-suite/packages/core/src/errors.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ERROR_CODES,
  AppError,
  toUserError,
  statusForCode,
  ClaudeAuthError,
  ClaudeKeyError,
  ClaudeRefusalError
} from './errors.js';

const fakeKey = () => 'sk-' + 'ant-api03-' + 'A'.repeat(40);

test('the code union contains the spec codes and the three HTTP extensions', () => {
  for (const code of [
    'KEY_INVALID', 'KEY_ADMIN', 'AUTH_REJECTED', 'RATE_LIMITED', 'OVERLOADED',
    'BUDGET_EXCEEDED', 'NETWORK_OFFLINE', 'CORS_BLOCKED', 'STORAGE_FULL',
    'STORAGE_UNAVAILABLE', 'FEED_FAILED', 'VALIDATION', 'NOT_SUPPORTED_IN_WEB',
    'UNKNOWN', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT'
  ]) {
    assert.equal(ERROR_CODES[code], code);
  }
  assert.equal(Object.isFrozen(ERROR_CODES), true);
});

test('statusForCode maps every code to its HTTP status', () => {
  assert.equal(statusForCode('KEY_INVALID'), 400);
  assert.equal(statusForCode('KEY_ADMIN'), 400);
  assert.equal(statusForCode('AUTH_REJECTED'), 401);
  assert.equal(statusForCode('VALIDATION'), 400);
  assert.equal(statusForCode('FORBIDDEN'), 403);
  assert.equal(statusForCode('NOT_FOUND'), 404);
  assert.equal(statusForCode('CONFLICT'), 409);
  assert.equal(statusForCode('BUDGET_EXCEEDED'), 402);
  assert.equal(statusForCode('RATE_LIMITED'), 429);
  assert.equal(statusForCode('NOT_SUPPORTED_IN_WEB'), 501);
  assert.equal(statusForCode('OVERLOADED'), 503);
  assert.equal(statusForCode('UNKNOWN'), 500);
  assert.equal(statusForCode('NOT_A_CODE'), 500);
});

test('an auth failure is AUTH_REJECTED, not retryable, with a hint and request id', () => {
  const out = toUserError(new ClaudeAuthError(undefined, 401));
  assert.equal(out.code, ERROR_CODES.AUTH_REJECTED);
  assert.equal(out.retryable, false);
  assert.match(out.requestId, /^local-[a-z0-9]{1,12}$/);
  assert.ok(out.hint.length > 0);
  assert.equal(Object.hasOwn(out, 'details'), false);
});

test('status codes map to the right family', () => {
  const status = (n) => toUserError(Object.assign(new Error(`http ${n}`), { status: n })).code;
  assert.equal(status(401), ERROR_CODES.AUTH_REJECTED);
  assert.equal(status(403), ERROR_CODES.AUTH_REJECTED);
  assert.equal(status(429), ERROR_CODES.RATE_LIMITED);
  assert.equal(status(529), ERROR_CODES.OVERLOADED);
  assert.equal(status(500), ERROR_CODES.OVERLOADED);
  assert.equal(status(400), ERROR_CODES.VALIDATION);
  assert.equal(status(404), ERROR_CODES.NOT_FOUND);
  assert.equal(status(409), ERROR_CODES.CONFLICT);
});

test('rate limits and overloads are retryable; budget and validation are not', () => {
  assert.equal(toUserError(Object.assign(new Error('slow'), { status: 429 })).retryable, true);
  assert.equal(toUserError(Object.assign(new Error('busy'), { status: 529 })).retryable, true);
  const budget = Object.assign(new Error('paused'), { code: 'BUDGET_EXCEEDED' });
  const out = toUserError(budget);
  assert.equal(out.code, ERROR_CODES.BUDGET_EXCEEDED);
  assert.equal(out.retryable, false);
  assert.equal(toUserError(Object.assign(new Error('bad'), { status: 400 })).retryable, false);
});

test('local key errors split into KEY_ADMIN and KEY_INVALID', () => {
  const admin = toUserError(new ClaudeKeyError('That is an Admin key. Create a standard API key.'));
  assert.equal(admin.code, ERROR_CODES.KEY_ADMIN);
  const invalid = toUserError(new ClaudeKeyError('That does not look like an Anthropic API key.'));
  assert.equal(invalid.code, ERROR_CODES.KEY_INVALID);
  assert.equal(invalid.retryable, false);
});

test('a refusal stays user-readable and is not offered as a retry', () => {
  const out = toUserError(new ClaudeRefusalError('Claude declined this request.', 'policy'));
  assert.equal(out.code, ERROR_CODES.UNKNOWN);
  assert.equal(out.retryable, false);
  assert.equal(out.message, 'Claude declined this request.');
  assert.match(out.hint, /different job|shorter request/i);
});

test('connection failures split offline from CORS', () => {
  const failure = new TypeError('Failed to fetch');
  assert.equal(toUserError(failure, { online: false }).code, ERROR_CODES.NETWORK_OFFLINE);
  assert.equal(toUserError(failure, { crossOrigin: true }).code, ERROR_CODES.CORS_BLOCKED);
  assert.equal(toUserError(failure).code, ERROR_CODES.NETWORK_OFFLINE);
  assert.equal(toUserError(failure, { crossOrigin: true }).retryable, true);
});

test('storage failures are typed and not retryable', () => {
  const quota = Object.assign(new Error('full'), { name: 'QuotaExceededError' });
  const blocked = Object.assign(new Error('blocked'), { name: 'InvalidStateError' });
  assert.equal(toUserError(quota).code, ERROR_CODES.STORAGE_FULL);
  assert.equal(toUserError(blocked).code, ERROR_CODES.STORAGE_UNAVAILABLE);
  assert.equal(toUserError(quota).retryable, false);
});

test('an HTTP body already in the contract shape is normalised, not re-wrapped', () => {
  const out = toUserError({ code: 'FEED_FAILED', message: 'Remotive did not respond.' });
  assert.equal(out.code, ERROR_CODES.FEED_FAILED);
  assert.equal(out.message, 'Remotive did not respond.');
  assert.equal(out.retryable, true);
  assert.ok(out.hint.length > 0);
});

test('context.fallback supplies the message when the error has none', () => {
  const out = toUserError(new Error(''), { fallback: 'Could not save profile.' });
  assert.equal(out.code, ERROR_CODES.UNKNOWN);
  assert.equal(out.message, 'Could not save profile.');
});

test('request ids are honoured from context or from an existing payload', () => {
  assert.equal(toUserError(new Error('x'), { requestId: 'local-abc123' }).requestId, 'local-abc123');
  assert.equal(
    toUserError({ code: 'FEED_FAILED', message: 'x', requestId: 'local-frombody' }).requestId,
    'local-frombody'
  );
});

test('key-shaped text is scrubbed from message, hint and details', () => {
  const key = fakeKey();
  const out = toUserError(new AppError('UNKNOWN', `bad key ${key}`, { details: `trace ${key}` }));
  assert.ok(!out.message.includes(key));
  assert.ok(out.message.includes('redacted-key'));
  assert.ok(!out.details.includes(key));
});

test('AppError fills defaults from the catalog and falls back on unknown codes', () => {
  const rate = new AppError('RATE_LIMITED', 'slow down');
  assert.equal(rate.status, 429);
  assert.equal(rate.retryable, true);
  const unknown = new AppError('NOT_A_CODE', 'x');
  assert.equal(unknown.code, ERROR_CODES.UNKNOWN);
  assert.equal(unknown.status, 500);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd sa-job-agent-suite/packages/core && node --test src/errors.test.js`
Expected: FAIL — `ERROR_CODES`/`AppError`/`toUserError`/`statusForCode` are not exported.

- [ ] **Step 3: Implement the contract in `errors.js`**

Replace `sa-job-agent-suite/packages/core/src/errors.js` with:

```js
// Typed errors and the one user-facing error contract shared by the desktop
// server, the web port and the client. Every message is scrubbed on the way out.

import { scrubSecrets } from './secrets.js';

export const ERROR_CODES = Object.freeze({
  KEY_INVALID: 'KEY_INVALID',
  KEY_ADMIN: 'KEY_ADMIN',
  AUTH_REJECTED: 'AUTH_REJECTED',
  RATE_LIMITED: 'RATE_LIMITED',
  OVERLOADED: 'OVERLOADED',
  BUDGET_EXCEEDED: 'BUDGET_EXCEEDED',
  NETWORK_OFFLINE: 'NETWORK_OFFLINE',
  CORS_BLOCKED: 'CORS_BLOCKED',
  STORAGE_FULL: 'STORAGE_FULL',
  STORAGE_UNAVAILABLE: 'STORAGE_UNAVAILABLE',
  FEED_FAILED: 'FEED_FAILED',
  VALIDATION: 'VALIDATION',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  FORBIDDEN: 'FORBIDDEN',
  NOT_SUPPORTED_IN_WEB: 'NOT_SUPPORTED_IN_WEB',
  UNKNOWN: 'UNKNOWN'
});

const CATALOG = {
  KEY_INVALID: {
    message: 'The Anthropic API key is missing or not valid.',
    hint: 'Open Profile & Settings and paste a standard API key (it starts with sk-ant-api).',
    retryable: false,
    status: 400
  },
  KEY_ADMIN: {
    message: 'Anthropic admin keys cannot make model calls.',
    hint: 'Create a standard API key in the Anthropic Console and use that instead.',
    retryable: false,
    status: 400
  },
  AUTH_REJECTED: {
    message: 'Anthropic rejected this API key.',
    hint: 'Check the key in Profile & Settings, or create a new one in the Anthropic Console.',
    retryable: false,
    status: 401
  },
  RATE_LIMITED: {
    message: 'Anthropic is rate-limiting this key.',
    hint: 'Wait about a minute, then retry.',
    retryable: true,
    status: 429
  },
  OVERLOADED: {
    message: 'Anthropic is temporarily busy.',
    hint: 'Retry in a moment.',
    retryable: true,
    status: 503
  },
  BUDGET_EXCEEDED: {
    message: 'The daily AI budget has been reached.',
    hint: 'Raise the daily budget in Settings, or wait until tomorrow.',
    retryable: false,
    status: 402
  },
  NETWORK_OFFLINE: {
    message: 'Could not reach the service.',
    hint: 'Check your connection, then retry. Nothing was saved.',
    retryable: true,
    status: 502
  },
  CORS_BLOCKED: {
    message: 'The browser blocked the request to the service.',
    hint: 'Allow the API host in your browser or proxy, then retry.',
    retryable: true,
    status: 502
  },
  STORAGE_FULL: {
    message: 'This browser is out of space for your data.',
    hint: 'Export your data, then delete old applications or documents.',
    retryable: false,
    status: 507
  },
  STORAGE_UNAVAILABLE: {
    message: 'Local storage is unavailable.',
    hint: 'Allow site data for this page (private windows block it), then reload.',
    retryable: false,
    status: 503
  },
  FEED_FAILED: {
    message: 'A job feed did not respond.',
    hint: 'Retry this feed; the other feeds still work.',
    retryable: true,
    status: 502
  },
  VALIDATION: {
    message: 'Some details were rejected.',
    hint: 'Check the highlighted values and try again.',
    retryable: false,
    status: 400
  },
  NOT_FOUND: {
    message: 'That item could not be found.',
    hint: 'Refresh the page — it may have been deleted.',
    retryable: false,
    status: 404
  },
  CONFLICT: {
    message: 'That action is already in progress.',
    hint: 'Wait for the current run to finish, then try again.',
    retryable: true,
    status: 409
  },
  FORBIDDEN: {
    message: 'That action is not allowed here.',
    hint: 'Use SA-JAS Desktop for this action.',
    retryable: false,
    status: 403
  },
  NOT_SUPPORTED_IN_WEB: {
    message: 'This action is not available in the web app.',
    hint: 'Open SA-JAS Desktop (the Runner) to use it.',
    retryable: false,
    status: 501
  },
  UNKNOWN: {
    message: 'Something went wrong.',
    hint: 'Retry. If it keeps happening, copy the diagnostics from the error and check the Activity Logs.',
    retryable: true,
    status: 500
  }
};

export class ClaudeAuthError extends Error {
  constructor(message = 'Anthropic rejected the API key. Check it in Settings.', status) {
    super(message);
    this.name = 'ClaudeAuthError';
    if (status != null) this.status = status;
  }
}

export class ClaudeRefusalError extends Error {
  constructor(message = 'Claude declined this request.', details) {
    super(message);
    this.name = 'ClaudeRefusalError';
    if (details !== undefined) this.details = details;
  }
}

/** The supplied key is malformed or the wrong kind (rejected before any request). */
export class ClaudeKeyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ClaudeKeyError';
  }
}

/** An error that already carries a contract code. */
export class AppError extends Error {
  constructor(code, message, { hint, retryable, status, details, cause } = {}) {
    super(message || undefined, cause ? { cause } : undefined);
    this.name = 'AppError';
    this.code = Object.hasOwn(ERROR_CODES, code) ? code : ERROR_CODES.UNKNOWN;
    const entry = CATALOG[this.code];
    if (hint !== undefined) this.hint = hint;
    this.retryable = retryable ?? entry.retryable;
    this.status = status ?? entry.status;
    if (details !== undefined) this.details = details;
  }
}

export function statusForCode(code) {
  return CATALOG[code]?.status ?? CATALOG.UNKNOWN.status;
}

function newRequestId() {
  const uuid = globalThis.crypto?.randomUUID?.();
  const raw = uuid || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `local-${raw.replace(/-/g, '').slice(0, 12)}`;
}

function text(value, fallback = '') {
  const source = typeof value === 'string' || value == null ? value : stringify(value);
  return scrubSecrets(String(source ?? fallback)).trim();
}

function stringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function finalize(code, message, opts, context) {
  const safeCode = Object.hasOwn(ERROR_CODES, code) ? code : ERROR_CODES.UNKNOWN;
  const entry = CATALOG[safeCode];
  const payload = {
    code: safeCode,
    message: text(message) || text(context.fallback) || entry.message,
    hint: text(opts.hint) || entry.hint,
    retryable: opts.retryable ?? entry.retryable,
    requestId: String(context.requestId || opts.requestId || newRequestId())
  };
  const details = text(opts.details);
  if (details) payload.details = details.slice(0, 2000);
  return payload;
}

function isConnectionError(err, message) {
  if (err?.name === 'APIConnectionError') return true;
  if (/ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|fetch failed|Failed to fetch|Load failed|network error/i.test(message)) return true;
  return err instanceof TypeError && /fetch|network|load failed/i.test(message);
}

function offline(context) {
  if (context.online === false) return true;
  return context.online === undefined
    && typeof navigator !== 'undefined'
    && navigator.onLine === false;
}

/**
 * Map any thrown value or already-shaped error object to the user-facing
 * contract. Idempotent: a payload that already carries one of our codes is
 * normalised with defaults, not wrapped again.
 */
export function toUserError(err, context = {}) {
  context = context ?? {};
  if (err instanceof AppError) return finalize(err.code, err.message, err, context);

  if (err && typeof err === 'object' && typeof err.code === 'string' && Object.hasOwn(ERROR_CODES, err.code)) {
    return finalize(err.code, err.message || err.error, err, context);
  }

  const message = err?.message || '';
  const status = err?.status ?? err?.statusCode ?? null;

  if (err instanceof ClaudeKeyError) {
    const code = /admin/i.test(message) ? ERROR_CODES.KEY_ADMIN : ERROR_CODES.KEY_INVALID;
    return finalize(code, message, {}, context);
  }
  if (err instanceof ClaudeAuthError) return finalize(ERROR_CODES.AUTH_REJECTED, message, {}, context);
  if (err instanceof ClaudeRefusalError) {
    return finalize(ERROR_CODES.UNKNOWN, message, {
      hint: 'Try again, or choose a different job or a shorter request.',
      retryable: false,
      details: err.details
    }, context);
  }
  if (err?.name === 'APIConnectionTimeoutError') {
    return finalize(ERROR_CODES.OVERLOADED, 'The AI service did not respond in time.', {}, context);
  }
  if (err?.name === 'QuotaExceededError') return finalize(ERROR_CODES.STORAGE_FULL, message, {}, context);
  if (err?.name === 'InvalidStateError') return finalize(ERROR_CODES.STORAGE_UNAVAILABLE, message, {}, context);

  if (isConnectionError(err, message)) {
    if (!offline(context) && context.crossOrigin === true) {
      return finalize(ERROR_CODES.CORS_BLOCKED, message, {}, context);
    }
    return finalize(ERROR_CODES.NETWORK_OFFLINE, message, {}, context);
  }

  if (status === 401 || status === 403) return finalize(ERROR_CODES.AUTH_REJECTED, message, {}, context);
  if (status === 429) return finalize(ERROR_CODES.RATE_LIMITED, message, {}, context);
  if (status === 529 || (typeof status === 'number' && status >= 500)) {
    return finalize(ERROR_CODES.OVERLOADED, message, {}, context);
  }
  if (status === 404) return finalize(ERROR_CODES.NOT_FOUND, message, {}, context);
  if (status === 409) return finalize(ERROR_CODES.CONFLICT, message, {}, context);
  if (status === 400 || status === 422) return finalize(ERROR_CODES.VALIDATION, message, {}, context);

  return finalize(ERROR_CODES.UNKNOWN, message, {}, context);
}
```

- [ ] **Step 4: Add the subpath export**

In `sa-job-agent-suite/packages/core/package.json`, change `exports` to:

```json
  "exports": {
    ".": "./src/index.js",
    "./errors": "./src/errors.js",
    "./testing": "./src/testing.js"
  },
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd sa-job-agent-suite/packages/core && node --test src/errors.test.js`
Expected: PASS — 16 tests, 0 failures (two added by R11).

Then run the whole core suite: `npm test --workspace=@sajas/core`
Expected: PASS, including the pre-existing `ai`, `secrets`, `costs`, `json`, `models`, `tools` suites.

- [ ] **Step 6: Commit**

```bash
git add sa-job-agent-suite/packages/core/src/errors.js sa-job-agent-suite/packages/core/src/errors.test.js sa-job-agent-suite/packages/core/package.json
git commit -m "feat(core): typed error contract with codes, hints and scrubbing

Add AppError, the 17-code union, status/retryable defaults and toUserError,
which maps SDK statuses, connection failures, storage errors and existing
contract payloads to one scrubbed user-facing shape. Expose it on the
@sajas/core/errors subpath so the web client can import it without the SDK."
```

---

### Task 2: Server HTTP adapter

**Files:**
- Create: `sa-job-agent-suite/server/src/httpErrors.js`
- Test: `sa-job-agent-suite/server/src/httpErrors.test.js`

**Interfaces:**
- Consumes: `AppError`, `ERROR_CODES`, `statusForCode`, `toUserError` from `@sajas/core/errors`.
- Produces:
  - `requestContext(req, res, next)` — sets `req.id = 'local-…'` and `X-Request-Id`.
  - `errorBody(err, requestId, { success? })` → `{ status, body }`.
  - `sendError(res, err, { status?, success? })` → sends `{ error, code, message, hint, retryable, requestId, details?, success? }`.
  - `badRequest`, `notFound`, `conflict`, `forbidden` — `(res, message, { success?, ...appErrorOptions })`.
  - `errorHandler(err, req, res, next)` — terminal Express error middleware.

- [ ] **Step 1: Write the failing test file**

Create `sa-job-agent-suite/server/src/httpErrors.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { AppError, ERROR_CODES } from '@sajas/core/errors';
import {
  requestContext,
  errorBody,
  sendError,
  badRequest,
  notFound,
  conflict,
  forbidden,
  errorHandler
} from './httpErrors.js';

function fakeRes(id = 'local-test1234') {
  return {
    req: { id },
    statusCode: null,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    headersSent: false
  };
}

test('requestContext calls next', () => {
  const res = fakeRes();
  let called = false;
  requestContext({}, res, () => { called = true; });
  assert.equal(called, true);
});

test('requestContext generates a local-… id and exposes it as X-Request-Id', () => {
  const req = {};
  const res = fakeRes();
  requestContext(req, res, () => {});
  assert.match(req.id, /^local-[0-9a-f]{12}$/);
  assert.equal(res.headers['X-Request-Id'], req.id);
});

test('sendError derives status and the full wire shape from an AppError', () => {
  const res = fakeRes('local-abc');
  sendError(res, new AppError(ERROR_CODES.NOT_FOUND, 'Job not found.'));
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, 'Job not found.');
  assert.equal(res.body.message, 'Job not found.');
  assert.equal(res.body.code, 'NOT_FOUND');
  assert.equal(res.body.retryable, false);
  assert.equal(res.body.requestId, 'local-abc');
  assert.ok(res.body.hint.length > 0);
  assert.equal(Object.hasOwn(res.body, 'details'), false);
});

test('sendError maps a plain error to 500 UNKNOWN with no stack', () => {
  const res = fakeRes();
  sendError(res, new Error('boom'));
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.code, 'UNKNOWN');
  assert.equal(res.body.message, 'boom');
  assert.equal(Object.hasOwn(res.body, 'details'), false);
  assert.ok(!JSON.stringify(res.body).includes('    at '));
});

test('sendError honours an explicit status and the legacy success flag', () => {
  const res = fakeRes();
  sendError(res, new AppError(ERROR_CODES.CONFLICT, 'busy'), { status: 423, success: false });
  assert.equal(res.statusCode, 423);
  assert.equal(res.body.success, false);
  assert.equal(res.body.code, 'CONFLICT');
});

test('the 4xx helpers map to the right status and code', () => {
  for (const [helper, status, code] of [
    [badRequest, 400, 'VALIDATION'],
    [notFound, 404, 'NOT_FOUND'],
    [conflict, 409, 'CONFLICT'],
    [forbidden, 403, 'FORBIDDEN']
  ]) {
    const res = fakeRes();
    helper(res, 'nope');
    assert.equal(res.statusCode, status, code);
    assert.equal(res.body.code, code);
    assert.equal(res.body.error, 'nope');
  }
});

test('a helper passes AppError options through and keeps success:false', () => {
  const res = fakeRes();
  conflict(res, 'busy', { success: false, hint: 'Wait.', details: 'owner=hunt' });
  assert.equal(res.body.success, false);
  assert.equal(res.body.hint, 'Wait.');
  assert.equal(res.body.details, 'owner=hunt');
});

test('key-shaped text never reaches the response body', () => {
  const key = 'sk-' + 'ant-api03-' + 'B'.repeat(40);
  const { body } = errorBody(new AppError('UNKNOWN', `bad ${key}`), 'local-x');
  assert.ok(!JSON.stringify(body).includes(key));
  assert.ok(body.message.includes('redacted-key'));
});

test('errorHandler answers a thrown route error with the contract', async () => {
  const app = express();
  app.use(requestContext);
  app.get('/boom', () => { throw new AppError(ERROR_CODES.RATE_LIMITED, 'slow down'); });
  app.use(errorHandler);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/boom`);
    const body = await response.json();
    assert.equal(response.status, 429);
    assert.equal(body.code, 'RATE_LIMITED');
    assert.match(body.requestId, /^local-/);
    assert.equal(response.headers.get('x-request-id'), body.requestId);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd sa-job-agent-suite/server && node --test src/httpErrors.test.js`
Expected: FAIL — `Cannot find module './httpErrors.js'`.

- [ ] **Step 3: Implement `httpErrors.js`**

Create `sa-job-agent-suite/server/src/httpErrors.js`:

```js
// HTTP adapter for the shared error contract (packages/core/src/errors.js).
// Every route answers failures through sendError so the desktop UI, the demo
// and the future web port all read the same fields.

import { randomUUID } from 'node:crypto';
import { AppError, ERROR_CODES, statusForCode, toUserError } from '@sajas/core/errors';

export const REQUEST_ID_HEADER = 'X-Request-Id';

/** Give every request an id that appears in the body and the response header. */
export function requestContext(req, res, next) {
  req.id = `local-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  res.setHeader(REQUEST_ID_HEADER, req.id);
  next();
}

export function errorBody(err, requestId, { success = true } = {}) {
  const payload = toUserError(err, { requestId });
  const status = err instanceof AppError ? err.status : statusForCode(payload.code);
  const body = { error: payload.message, ...payload };
  if (success === false) body.success = false;
  return { status, body };
}

function mirrorRequestId(res, requestId) {
  if (!res.headersSent && typeof res.setHeader === 'function') {
    res.setHeader(REQUEST_ID_HEADER, requestId);
  }
}

export function sendError(res, err, { status, success = true } = {}) {
  const derived = errorBody(err, res.req?.id ?? null, { success });
  mirrorRequestId(res, derived.body.requestId);
  return res.status(status ?? derived.status).json(derived.body);
}

function helper(code) {
  return (res, message, { success = true, ...opts } = {}) =>
    sendError(res, new AppError(code, message, opts), { success });
}

export const badRequest = helper(ERROR_CODES.VALIDATION);
export const notFound = helper(ERROR_CODES.NOT_FOUND);
export const conflict = helper(ERROR_CODES.CONFLICT);
export const forbidden = helper(ERROR_CODES.FORBIDDEN);

/** Terminal middleware: a thrown route error becomes a contract response. */
export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  const { status, body } = errorBody(err, res.req?.id ?? req?.id ?? null);
  if (status >= 500) console.error(`[${body.requestId}] ${body.message.replace(/\s+/g, ' ')}`);
  mirrorRequestId(res, body.requestId);
  return res.status(status).json(body);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd sa-job-agent-suite/server && node --test src/httpErrors.test.js`
Expected: PASS — 14 tests. One test starts a real loopback Express server; it is still offline.

- [ ] **Step 5: Commit**

```bash
git add sa-job-agent-suite/server/src/httpErrors.js sa-job-agent-suite/server/src/httpErrors.test.js
git commit -m "feat(server): HTTP adapter for the typed error contract

sendError and the 4xx helpers emit error/message/code/hint/retryable/
requestId (+details) and set X-Request-Id; the terminal errorHandler turns a
thrown route error into the same shape without leaking a stack."
```

---

### Task 3: Adopt the contract across the API

**Files:**
- Modify: `sa-job-agent-suite/server/src/index.js`
- Modify: `sa-job-agent-suite/server/src/localGuard.js`
- Modify: `sa-job-agent-suite/server/src/localGuard.test.js`
- Modify: `sa-job-agent-suite/server/src/demo.js`
- Test: `sa-job-agent-suite/scripts/demo.test.mjs` (extend existing subtests)

**Interfaces:**
- Consumes: `requestContext`, `sendError`, `badRequest`, `notFound`, `conflict`, `errorHandler` from `./httpErrors.js`; `forbidden` in `localGuard.js` and `demo.js`; `AppError`, `ERROR_CODES` from `@sajas/core`.
- Produces: every non-2xx JSON response from the desktop API carries the contract; `X-Request-Id` is on every response.

- [ ] **Step 1: Add the imports and middleware mounts**

In `sa-job-agent-suite/server/src/index.js`:

1. Change `import { MODELS } from '@sajas/core';` to:

```js
import { MODELS, AppError, ERROR_CODES } from '@sajas/core';
```

2. Add after the `localGuard` import:

```js
import { requestContext, sendError, badRequest, notFound, conflict, errorHandler } from './httpErrors.js';
```

3. Insert `app.use(requestContext);` immediately after `const app = express();` (before the CORS middleware), so every response — including guard and demo refusals — carries the header.

4. Insert `app.use(errorHandler);` immediately after the `/api/health` route and before the `// -------------------- Startup --------------------` comment.

- [ ] **Step 2: Replace every 500 and 400-with-message site**

Apply these exact replacements in `server/src/index.js` (use replace-all; every occurrence is an error response):

| Replace exactly (all occurrences) | With |
|---|---|
| `res.status(500).json({ error: error.message });` | `sendError(res, error);` |
| `res.status(500).json({ error: err.message });` | `sendError(res, err);` |
| `res.status(500).json({ success: false, error: err.message });` | `sendError(res, err, { success: false });` |
| `res.status(400).json({ error: error.message });` | `badRequest(res, error.message);` |
| `res.status(400).json({ error: \`Could not restore: ${error.message}\` });` | `badRequest(res, \`Could not restore: ${error.message}\`);` |
| `res.status(400).json({ error: \`Unknown performance mode: ${mode}\` });` | `badRequest(res, \`Unknown performance mode: ${mode}\`);` |
| `res.status(400).json({ error: 'Both question and answer are required.' });` | `badRequest(res, 'Both question and answer are required.');` |
| `res.status(400).json({ error: 'An answer is required.' });` | `badRequest(res, 'An answer is required.');` |
| `res.status(400).json({ error: 'docType and the file are required.' });` | `badRequest(res, 'docType and the file are required.');` |
| `res.status(400).json({ error: 'Insight text is required.' });` | `badRequest(res, 'Insight text is required.');` |
| `res.status(400).json({ error: 'Company is required.' });` | `badRequest(res, 'Company is required.');` |
| `res.status(400).json({ error: 'An outcome is required.' });` | `badRequest(res, 'An outcome is required.');` |
| `res.status(400).json({ error: 'No AI provider key is set — add one in Profile & Settings.' });` | `badRequest(res, 'No AI provider key is set — add one in Profile & Settings.');` |
| `res.status(400).json({ error: 'Dreaming is turned off in Settings.' });` | `badRequest(res, 'Dreaming is turned off in Settings.');` |
| `res.status(400).json({ error: 'Title and company are required.' });` | `badRequest(res, 'Title and company are required.');` |
| `res.status(400).json({ error: 'No jobs to tailor. Find some jobs first.' });` | `badRequest(res, 'No jobs to tailor. Find some jobs first.');` |
| `res.status(400).json({ error: 'ids must be an array of source ids.' });` | `badRequest(res, 'ids must be an array of source ids.');` |

- [ ] **Step 3: Replace every 404, 409 and the canary refusal**

| Replace exactly (all occurrences) | With |
|---|---|
| `res.status(404).json({ error: 'Unknown provider' })` | `notFound(res, 'Unknown provider')` |
| `res.status(404).json({ error: 'Pending question not found.' })` | `notFound(res, 'Pending question not found.')` |
| `res.status(404).json({ error: 'Application not found in memory.' })` | `notFound(res, 'Application not found in memory.')` |
| `res.status(404).json({ error: 'Job not found' })` | `notFound(res, 'Job not found')` |
| `res.status(404).json({ error: 'Job not found.' })` | `notFound(res, 'Job not found.')` |
| `res.status(404).json({ error: 'Routine not found.' })` | `notFound(res, 'Routine not found.')` |
| `res.status(404).json({ error: \`Unknown source: ${String(requested[bad])}.\` })` | `notFound(res, \`Unknown source: ${String(requested[bad])}.\`)` |
| `res.status(404).json({ error: 'Unknown source.' })` | `notFound(res, 'Unknown source.')` |
| `res.status(409).json({ error: 'That insight already exists.' })` | `conflict(res, 'That insight already exists.')` |
| `res.status(409).json({ error: 'A similar job already exists.' })` | `conflict(res, 'A similar job already exists.')` |
| `res.status(409).json({ error: 'A link re-check is already running.' })` | `conflict(res, 'A link re-check is already running.')` |
| `res.status(409).json({ error: \`A browser job is already running (${browserOwner()}).\` })` | `conflict(res, \`A browser job is already running (${browserOwner()}).\`)` |
| `res.status(409).json({ error: 'Job hunter is not currently running.' })` | `conflict(res, 'Job hunter is not currently running.')` |
| `res.status(409).json({ error: 'Already tailoring this job.' })` | `conflict(res, 'Already tailoring this job.')` |
| `res.status(409).json({ error: 'Another run is already in progress. Try again once it finishes.' })` | `conflict(res, 'Another run is already in progress. Try again once it finishes.')` |
| `res.status(409).json({ success: false, error: \`A browser job is already running (${browserOwner()}).\` })` | `conflict(res, \`A browser job is already running (${browserOwner()}).\`, { success: false })` |
| `res.status(409).json({ success: false, error: 'A login check is already running.' })` | `conflict(res, 'A login check is already running.', { success: false })` |

The two multi-line 409 bodies have no single-line form. Replace:

```js
    return res.status(409).json({
      error: 'Job hunter is already running. Please wait for the current scrape to finish.'
    });
```

with:

```js
    return conflict(res, 'Job hunter is already running. Please wait for the current scrape to finish.');
```

and:

```js
    return res.status(409).json({
      error: `An apply session is already open for another job. Close it first.`
    });
```

with:

```js
    return conflict(res, `An apply session is already open for another job. Close it first.`);
```

Replace the canary refusal line:

```js
  if (refusal) return res.status(refusal.status).json({ error: refusal.error });
```

with:

```js
  if (refusal) return sendError(res, new AppError(ERROR_CODES.CONFLICT, refusal.error), { status: refusal.status });
```

Leave every 2xx response untouched — including the `202` bodies (`started: false, …`) and `/api/health`.

- [ ] **Step 4: Adopt the contract in `localGuard` and the demo**

In `sa-job-agent-suite/server/src/localGuard.js`, add the import:

```js
import { forbidden } from './httpErrors.js';
```

and change:

```js
    if (!verdict.ok) return res.status(403).json({ error: verdict.error });
```

to:

```js
    if (!verdict.ok) return forbidden(res, verdict.error);
```

In `sa-job-agent-suite/server/src/demo.js`, add the import at the top:

```js
import { forbidden } from './httpErrors.js';
```

and change:

```js
    res.status(403).json({ error: 'Synthetic demo: live searches, AI calls, profile changes and other actions are disabled. Use the fictional copilot and answer manager.' });
```

to:

```js
    forbidden(res, 'Synthetic demo: live searches, AI calls, profile changes and other actions are disabled. Use the fictional copilot and answer manager.');
```

- [ ] **Step 5: Update the localGuard middleware test**

In `sa-job-agent-suite/server/src/localGuard.test.js`:

1. Import the request context middleware:

```js
import { requestContext } from './httpErrors.js';
```

2. Change the test helper's resolve to include response headers:

```js
res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
```

3. In the middleware test, mount the context first:

```js
  app.use(requestContext);
  app.use(localGuard({ port }));
```

4. Replace the two `deepEqual` body assertions with contract assertions:

```js
    const blockedBody = JSON.parse(blocked.body);
    assert.equal(blockedBody.error, 'Missing X-SAJAS-Client header');
    assert.equal(blockedBody.code, 'FORBIDDEN');
    assert.equal(blockedBody.retryable, false);
    assert.match(blockedBody.requestId, /^local-/);
    assert.equal(blocked.headers['x-request-id'], blockedBody.requestId);
```

```js
    const rebindingBody = JSON.parse(rebinding.body);
    assert.equal(rebindingBody.error, 'Host not allowed');
    assert.equal(rebindingBody.code, 'FORBIDDEN');
```

- [ ] **Step 6: Extend the demo HTTP test**

In `sa-job-agent-suite/scripts/demo.test.mjs`, inside the subtest `'API blocks live work, credentials, backup restore and arbitrary applications'`, replace the loop body's final assertion block so each refusal is checked against the contract. The loop currently ends with a status assertion; make it:

```js
        const response = await fetch(runtime.origin + route, { method, headers: { 'X-SAJAS-Client': '1' } });
        assert.equal(response.status, 403, `${method} ${route}`);
        const body = await response.json();
        assert.equal(body.code, 'FORBIDDEN', `${method} ${route} code`);
        assert.equal(body.retryable, false, `${method} ${route} retryable`);
        assert.match(body.requestId, /^local-/, `${method} ${route} requestId`);
        assert.equal(response.headers.get('x-request-id'), body.requestId, `${method} ${route} header`);
```

Add one new subtest immediately after it:

```js
    await t.test('every response carries an X-Request-Id and errors carry the contract fields', async () => {
      const ok = await fetch(runtime.origin + '/api/health');
      assert.equal(ok.status, 200);
      assert.match(ok.headers.get('x-request-id'), /^local-/);
      const profile = await json('/api/profile');
      assert.ok(!('code' in profile), 'success bodies are not error-shaped');
    });
```

- [ ] **Step 7: Run the affected suites**

Run: `cd sa-job-agent-suite/server && node --test src/localGuard.test.js`
Expected: PASS.

Run: `cd sa-job-agent-suite/server && node --test src/httpErrors.test.js`
Expected: PASS.

Run: `cd sa-job-agent-suite && npm run test:demo`
Expected: PASS — all walkthrough subtests, including the new contract assertions.

Run: `cd sa-job-agent-suite && npm test`
Expected: PASS, same counts as before plus the new tests.

- [ ] **Step 8: Commit**

```bash
git add sa-job-agent-suite/server/src/index.js sa-job-agent-suite/server/src/localGuard.js sa-job-agent-suite/server/src/localGuard.test.js sa-job-agent-suite/server/src/demo.js sa-job-agent-suite/scripts/demo.test.mjs
git commit -m "feat(server): every API failure answers with the error contract

Mount requestContext and the terminal errorHandler, route every 4xx/5xx
through sendError and the status helpers, and give localGuard and the
synthetic demo FORBIDDEN responses the same fields and X-Request-Id."
```

---

### Task 4: Client error surface

**Files:**
- Modify: `sa-job-agent-suite/client/package.json`
- Create: `sa-job-agent-suite/client/src/errors.js`
- Create: `sa-job-agent-suite/client/src/errors.test.js`
- Create: `sa-job-agent-suite/client/src/ErrorCard.jsx`
- Create: `sa-job-agent-suite/client/src/ErrorBoundary.jsx`
- Create: `sa-job-agent-suite/client/src/RecentErrors.jsx`
- Modify: `sa-job-agent-suite/client/src/main.jsx`
- Modify: `sa-job-agent-suite/client/src/App.jsx`
- Modify: `sa-job-agent-suite/client/src/index.css`

**Interfaces:**
- Consumes: `ERROR_CODES`, `AppError`, `toUserError` from `@sajas/core/errors`; `diagnosticsText`/`recordError` from `./errors.js`; `ErrorCard` in both the boundary and App.
- Produces:
  - `errors.js`: `contractFromBody(body, status, fallback)`, `readResponseError(res, fallback)`, `describeUserError(info)`, `recordError(err, { where?, fallback? })`, `getRecentErrors()`, `subscribeErrors(fn)`, `clearRecentErrors()`, `diagnosticsText(entry)`.
  - `ErrorCard` props `{ error, title?, onRetry?, onDismiss? }`.
  - `RecentErrors` — self-subscribing panel, no props.

- [ ] **Step 1: Add the client dependency and test script**

In `sa-job-agent-suite/client/package.json`:

1. Add to `dependencies`: `"@sajas/core": "*",`
2. Add to `scripts`: `"test": "node --test src/errors.test.js",`

- [ ] **Step 2: Write the failing client test**

Create `sa-job-agent-suite/client/src/errors.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  contractFromBody,
  describeUserError,
  recordError,
  getRecentErrors,
  clearRecentErrors,
  subscribeErrors,
  diagnosticsText
} from './errors.js';

const fakeKey = () => 'sk-' + 'ant-api03-' + 'C'.repeat(40);

test('contractFromBody trusts a server contract payload', () => {
  const info = contractFromBody({
    code: 'KEY_INVALID',
    message: 'The API key is not valid.',
    hint: 'Paste a standard key.',
    retryable: false,
    requestId: 'local-server123'
  }, 400, 'fallback');
  assert.equal(info.code, 'KEY_INVALID');
  assert.equal(info.message, 'The API key is not valid.');
  assert.equal(info.hint, 'Paste a standard key.');
  assert.equal(info.retryable, false);
  assert.equal(info.requestId, 'local-server123');
});

test('contractFromBody derives the family from a legacy status', () => {
  const info = contractFromBody({ error: 'Job not found.' }, 404, 'Could not load.');
  assert.equal(info.code, 'NOT_FOUND');
  assert.equal(info.message, 'Job not found.');
  assert.equal(info.retryable, false);
});

test('contractFromBody uses the caller fallback for an empty body', () => {
  const info = contractFromBody(null, 500, 'Could not save profile.');
  assert.equal(info.code, 'UNKNOWN');
  assert.equal(info.message, 'Could not save profile.');
  assert.equal(info.retryable, true);
});

test('describeUserError adds the hint once', () => {
  assert.equal(describeUserError({ message: 'Nope.', hint: 'Fix it.' }), 'Nope. Fix it.');
  assert.equal(describeUserError({ message: 'Nope.', hint: '' }), 'Nope.');
});

test('recordError keeps the newest 20 entries, newest first', () => {
  clearRecentErrors();
  for (let i = 0; i < 25; i += 1) recordError(new Error(`failure ${i}`), { where: 'test' });
  const entries = getRecentErrors();
  assert.equal(entries.length, 20);
  assert.equal(entries[0].message, 'failure 24');
  assert.equal(entries[19].message, 'failure 5');
  assert.equal(entries[0].where, 'test');
  assert.match(entries[0].at, /^\d{4}-\d{2}-\d{2}T/);
});

test('subscribers see new entries and stop after unsubscribing', () => {
  clearRecentErrors();
  const seen = [];
  const unsubscribe = subscribeErrors((entries) => seen.push(entries.length));
  recordError(new Error('one'));
  unsubscribe();
  recordError(new Error('two'));
  assert.deepEqual(seen, [1]);
});

test('diagnosticsText contains the contract fields and no raw key', () => {
  clearRecentErrors();
  const key = fakeKey();
  const entry = recordError(new Error(`bad key ${key}`), { where: 'save profile' });
  const text = diagnosticsText(entry);
  assert.match(text, /code: UNKNOWN/);
  assert.match(text, new RegExp(`requestId: ${entry.requestId}`));
  assert.match(text, /where: save profile/);
  assert.ok(!text.includes(key));
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd sa-job-agent-suite/client && node --test src/errors.test.js`
Expected: FAIL — `Cannot find module './errors.js'`.

- [ ] **Step 4: Implement `client/src/errors.js`**

Create `sa-job-agent-suite/client/src/errors.js`:

```js
// Client-side error helpers: parse the server contract, keep the last 20
// failures in memory, and turn any entry into copyable diagnostics. Nothing
// here writes to disk or to the server.

import { AppError, ERROR_CODES, toUserError } from '@sajas/core/errors';

const MAX_RECENT = 20;

let recent = [];
const listeners = new Set();

function emit() {
  const snapshot = recent.slice();
  for (const fn of [...listeners]) fn(snapshot);
}

/**
 * Normalise a server response body. A body that already carries one of our
 * codes is kept; a legacy `{ error }` body gets a family from its status; an
 * empty body uses the caller's fallback.
 */
function codeForStatus(status) {
  if (status === 400 || status === 422) return ERROR_CODES.VALIDATION;
  if (status === 403) return ERROR_CODES.FORBIDDEN;
  if (status === 404) return ERROR_CODES.NOT_FOUND;
  if (status === 409) return ERROR_CODES.CONFLICT;
  if (status === 429) return ERROR_CODES.RATE_LIMITED;
  return ERROR_CODES.UNKNOWN;
}

export function contractFromBody(body, status, fallback) {
  const source = body && typeof body === 'object' ? body : {};
  if (source.code && ERROR_CODES[source.code]) {
    return toUserError({
      code: source.code,
      message: source.message || source.error,
      hint: source.hint,
      retryable: source.retryable,
      details: source.details,
      requestId: source.requestId
    }, { requestId: source.requestId, fallback });
  }
  return toUserError(new AppError(codeForStatus(status), source.error || '', {
    retryable: Number.isFinite(status) && (status >= 500 || status === 429)
  }), { fallback });
}

/** Read a non-2xx response once and return its contract payload. */
export async function readResponseError(res, fallback) {
  const body = await res.json().catch(() => null);
  return contractFromBody(body, res.status, fallback);
}

/** One line for a toast: cause plus the fix. */
export function describeUserError(info) {
  const hint = String(info?.hint || '').trim();
  if (!hint || hint === info.message) return info.message;
  return `${info.message} ${hint}`;
}

/** Map any thrown value and put it at the front of the memory-only log. */
export function recordError(err, context = {}) {
  const entry = {
    ...toUserError(err, context),
    at: new Date().toISOString(),
    where: context.where || null
  };
  recent = [entry, ...recent].slice(0, MAX_RECENT);
  emit();
  return entry;
}

export function getRecentErrors() {
  return recent.slice();
}

export function subscribeErrors(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function clearRecentErrors() {
  recent = [];
  emit();
}

export function diagnosticsText(entry) {
  const lines = [
    'SA-JAS error diagnostics',
    `code: ${entry.code}`,
    `message: ${entry.message}`,
    `hint: ${entry.hint}`,
    `retryable: ${entry.retryable}`,
    `requestId: ${entry.requestId}`,
    `at: ${entry.at || new Date().toISOString()}`,
    `where: ${entry.where || 'unknown'}`
  ];
  if (entry.details) lines.push(`details: ${entry.details}`);
  return lines.join('\n');
}
```

- [ ] **Step 5: Run the client tests to verify they pass**

Run: `cd sa-job-agent-suite/client && node --test src/errors.test.js`
Expected: PASS — 7 tests.

- [ ] **Step 6: Add `ErrorCard.jsx`**

Create `sa-job-agent-suite/client/src/ErrorCard.jsx`:

```jsx
import React, { useState } from 'react';
import { AlertTriangle, Copy, ChevronDown } from 'lucide-react';
import { describeUserError, diagnosticsText } from './errors.js';

async function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  document.execCommand('copy');
  area.remove();
}

export default function ErrorCard({ error, title = 'Something went wrong', onRetry, onDismiss }) {
  const [copied, setCopied] = useState(false);
  if (!error) return null;
  const copy = async () => {
    await copyToClipboard(diagnosticsText({ ...error, at: error.at || new Date().toISOString() }));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="error-card" role="alert">
      <div className="error-card-head">
        <AlertTriangle size={18} color="var(--color-error)" />
        <div>
          <div className="error-card-title">{title}</div>
          <div className="error-card-code">
            {error.code}{error.requestId ? ` · ${error.requestId}` : ''}
          </div>
        </div>
      </div>
      <p className="error-card-message">{describeUserError(error)}</p>
      {error.details && (
        <details className="error-card-details">
          <summary><ChevronDown size={12} /> Details</summary>
          <pre>{error.details}</pre>
        </details>
      )}
      <div className="error-card-actions">
        {onRetry && error.retryable && (
          <button type="button" className="btn-secondary btn-sm" onClick={onRetry}>Retry</button>
        )}
        <button type="button" className="btn-ghost btn-sm" onClick={copy}>
          <Copy size={12} /> {copied ? 'Copied' : 'Copy diagnostics'}
        </button>
        {onDismiss && (
          <button type="button" className="btn-ghost btn-sm" onClick={onDismiss}>Dismiss</button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Add `ErrorBoundary.jsx`**

Create `sa-job-agent-suite/client/src/ErrorBoundary.jsx`:

```jsx
import React from 'react';
import ErrorCard from './ErrorCard.jsx';
import { recordError } from './errors.js';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { mapped: null };
  }

  static getDerivedStateFromError() {
    return { crashed: true };
  }

  componentDidCatch(error, info) {
    const where = info?.componentStack?.split('\n')[1]?.trim();
    this.setState({ mapped: recordError(error, { where: where ? `render: ${where}` : 'render' }) });
  }

  render() {
    if (!this.state.crashed) return this.props.children;
    return (
      <div style={{ maxWidth: 720, margin: '10vh auto', padding: 24 }}>
        <ErrorCard
          title="The interface hit an unexpected error"
          error={this.state.mapped || {
            code: 'UNKNOWN',
            message: 'The interface hit an unexpected error.',
            hint: 'Reload the page. Your saved jobs and settings are untouched.',
            retryable: true,
            requestId: null
          }}
          onRetry={() => window.location.reload()}
        />
      </div>
    );
  }
}
```

- [ ] **Step 8: Add `RecentErrors.jsx`**

Create `sa-job-agent-suite/client/src/RecentErrors.jsx`:

```jsx
import React, { useEffect, useState } from 'react';
import { Copy, Trash2 } from 'lucide-react';
import {
  clearRecentErrors,
  diagnosticsText,
  getRecentErrors,
  subscribeErrors
} from './errors.js';

export default function RecentErrors() {
  const [entries, setEntries] = useState(() => getRecentErrors());
  useEffect(() => subscribeErrors(setEntries), []);
  const copy = (entry) => {
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(diagnosticsText(entry));
  };
  return (
    <div>
      <div className="flex-between" style={{ marginBottom: 10 }}>
        <div>
          <h4 style={{ fontSize: 14 }}>Recent errors ({entries.length})</h4>
          <p className="hint">Memory-only. Cleared when the app reloads.</p>
        </div>
        {entries.length > 0 && (
          <button type="button" className="btn-ghost btn-sm" onClick={clearRecentErrors}>
            <Trash2 size={12} /> Clear
          </button>
        )}
      </div>
      {entries.length === 0 && <p className="hint">No errors this session.</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {entries.map((entry, index) => (
          <div key={`${entry.at}-${index}`} className="error-row">
            <div className="flex-between" style={{ gap: 8, flexWrap: 'wrap' }}>
              <span className="badge badge-error">{entry.code}</span>
              <span className="tiny muted">
                {entry.at}{entry.where ? ` · ${entry.where}` : ''}
              </span>
            </div>
            <p style={{ margin: '6px 0 0', fontSize: 12 }}>{entry.message}</p>
            {entry.hint && <p className="hint">{entry.hint}</p>}
            <button type="button" className="btn-ghost btn-xs" onClick={() => copy(entry)}>
              <Copy size={11} /> Copy diagnostics
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 9: Wrap the app in the boundary**

Replace `sa-job-agent-suite/client/src/main.jsx` with:

```jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';
import './index.css';

// The local API refuses state-changing requests that lack this header (see
// server/src/localGuard.js). Add it to every call to the API base here so each
// fetch in the app carries it; headers, Request objects and init are preserved.
const API_BASE = import.meta.env.VITE_SAJAS_API_BASE || 'http://localhost:5000/api';
const nativeFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
  if (typeof url !== 'string' || !url.startsWith(API_BASE)) return nativeFetch(input, init);
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
  headers.set('X-SAJAS-Client', '1');
  return nativeFetch(input, { ...init, headers });
};

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
```

- [ ] **Step 10: Adopt the contract in `App.jsx`**

1. Add imports after the `SourceHealth` import:

```js
import ErrorCard from './ErrorCard.jsx';
import RecentErrors from './RecentErrors.jsx';
import {
  contractFromBody,
  describeUserError,
  readResponseError,
  recordError
} from './errors.js';
```

2. Inside the `App` component, after the `toasts` declaration, add the failure helper and load-error state:

```js
  const [loadError, setLoadError] = useState(null);
  const bootedRef = useRef(false);

  // One path for every user-visible failure: map it, keep it in the memory log,
  // and toast the cause plus the fix. `input` may be an Error or an HTTP body.
  const fail = (input, where, fallback) => {
    const info = recordError(
      input instanceof Error || (input && typeof input.code === 'string')
        ? input
        : contractFromBody(input, undefined, fallback),
      { where, fallback }
    );
    toasts.error(describeUserError(info), info.code);
    return info;
  };
```

Note: the `contractFromBody(input, undefined, fallback)` branch covers a legacy `{ error }` body passed directly; `recordError` maps it through `toUserError`'s plain-object branch, which needs one of our codes — `contractFromBody` guarantees that.

3. Update the three initial fetchers:

```js
  const fetchProfile = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/profile`, { cache: 'no-store' });
      if (!res.ok) throw await readResponseError(res, 'Could not load your profile.');
      const data = await res.json();
      setProfile((p) => ({
        ...p,
        ...data,
        anthropicApiKey: revealKey ? p.anthropicApiKey : ''
      }));
      setLoadError(null);
    } catch (err) {
      const info = recordError(err, { where: 'load profile' });
      if (!bootedRef.current) setLoadError(info);
    }
  }, [revealKey]);

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/jobs`, { cache: 'no-store' });
      if (!res.ok) throw await readResponseError(res, 'Could not load jobs.');
      const data = await res.json();
      setJobs(data);
      setLoadError(null);
    } catch (err) {
      const info = recordError(err, { where: 'load jobs' });
      if (!bootedRef.current) setLoadError(info);
    }
  }, []);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/logs`, { cache: 'no-store' });
      if (!res.ok) throw await readResponseError(res, 'Could not load the activity log.');
      const data = await res.json();
      setLogs(data);
    } catch (err) {
      const info = recordError(err, { where: 'load logs' });
      if (!bootedRef.current) setLoadError(info);
    }
  }, []);
```

4. Mark the first load complete. Replace the initial-load effect body's tail:

```js
    fetchProfile();
    fetchJobs();
    fetchLogs();
    fetchStatus();
    fetchDocuments();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
```

with:

```js
    Promise.all([fetchProfile(), fetchJobs(), fetchLogs(), fetchStatus(), fetchDocuments()])
      .finally(() => { bootedRef.current = true; });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
```

5. Insert the load card as the first child of `<main className="app-main" …>`:

```jsx
        {loadError && (
          <ErrorCard
            title="Could not load the app"
            error={loadError}
            onRetry={() => { setLoadError(null); refreshAll(); }}
            onDismiss={() => setLoadError(null)}
          />
        )}
```

6. Convert every error-toasting site. Two rules:

**Rule A — non-OK response with a parsed `data` object.** Replace the line
`toasts.error(data.error || '<FALLBACK>');`
with
`fail(contractFromBody(data, res.status, '<FALLBACK>'), '<WHERE>');`

**Rule B — `catch` block.** Replace the line
`toasts.error(err.message || '<FALLBACK>');`
with
`fail(err, '<WHERE>', '<FALLBACK>');`

Use this table for `<WHERE>` (the fallback text identifies the site; where two sites share "Network error." the enclosing function disambiguates):

| Enclosing function / site | `<WHERE>` |
|---|---|
| `handleSaveProfile` | `save profile` |
| `triggerJobHunter` | `start hunter` |
| `stopJobHunter` | `stop hunter` |
| `revalidateLinks` | `revalidate links` |
| `triggerTailor` | `tailor job` |
| `triggerBatchTailor` | `batch tailor` |
| `triggerApplyCopilot` | `open copilot` |
| `markApplied` (job update catch) | `update job` |
| delete-job confirm callback | `delete job` |
| add-job catch | `add job` |
| clear-jobs confirm callback | `clear jobs` |
| `clearSystemLogs` | `clear logs` |
| `setupBrowserLogins` | `browser setup` |
| `fetchLoginStatuses` | `login status` |
| `clearApiKey` | `clear key` |
| `handleDocUpload` | `upload document` |
| document delete callback | `delete document` |
| clear-single-data callback | `clear data` |
| clear-all-data callback | `clear all data` |
| `applyPreset` | `apply preset` |
| backup restore callback | `restore backup` |
| usage clear callback | `clear usage` |
| `build` (referral outreach, lines near the end) | `build outreach` |

Do not convert plain validation notices such as `toasts.error('Nothing to copy yet.')`, `'Please upload a PDF file. …'`, or `'Nothing to download yet.'`.

7. Add the Recent errors panel to the Logs tab. Import is already added. Inside the Logs tab panel, after the closing `</div>` of `.terminal-console` and before the panel's closing `</div>`, insert:

```jsx
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
              <RecentErrors />
            </div>
```

- [ ] **Step 11: Add the styles**

Append to `sa-job-agent-suite/client/src/index.css`:

```css
.error-card {
  border: 1px solid rgba(251, 113, 133, 0.35);
  background: rgba(251, 113, 133, 0.07);
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 20px;
}
.error-card-head { display: flex; gap: 10px; align-items: flex-start; }
.error-card-title { font-weight: 700; font-size: 14px; }
.error-card-code {
  font-size: 11px;
  color: var(--text-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  margin-top: 2px;
}
.error-card-message { font-size: 13px; margin: 10px 0; line-height: 1.55; }
.error-card-details summary {
  cursor: pointer;
  font-size: 11px;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  gap: 4px;
}
.error-card-details pre {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 11px;
  background: var(--bg-surface-2);
  padding: 10px;
  border-radius: 8px;
  margin-top: 8px;
  max-height: 220px;
  overflow: auto;
}
.error-card-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.error-row {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px 12px;
  background: var(--bg-surface-2);
}
```

- [ ] **Step 12: Verify the client**

Run: `cd sa-job-agent-suite && npm test --workspace=client`
Expected: PASS — 7 tests.

Run: `cd sa-job-agent-suite && npm run build:client`
Expected: PASS. The bundle must not gain the Anthropic SDK; no import may reference `@sajas/core` (the package root), only `@sajas/core/errors`.

Run: `cd sa-job-agent-suite && npm test`
Expected: PASS across server, core, evals, client and the sanitiser suite.

- [ ] **Step 13: Commit**

```bash
git add sa-job-agent-suite/client/package.json sa-job-agent-suite/client/src/errors.js sa-job-agent-suite/client/src/errors.test.js sa-job-agent-suite/client/src/ErrorCard.jsx sa-job-agent-suite/client/src/ErrorBoundary.jsx sa-job-agent-suite/client/src/RecentErrors.jsx sa-job-agent-suite/client/src/main.jsx sa-job-agent-suite/client/src/App.jsx sa-job-agent-suite/client/src/index.css
git commit -m "feat(client): persistent error card, boundary and diagnostics log

Parse the server contract (including legacy { error } bodies), toast the
cause with the fix, show a load-failure card, catch render crashes, and keep
the last 20 errors in memory with copyable, scrubbed diagnostics."
```

---

### Task 5: Document the contract

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: the code union and fields from Tasks 1–4.
- Produces: nothing executable; the docs must match the code exactly.

- [ ] **Step 1: Add the contract section to `CLAUDE.md`**

Insert a new section immediately before `## API endpoints (Express on port 5000)`:

```markdown
## Error contract (M3a-1)

Every failure — the desktop API, the core AI layer, and the client — uses one
shape:

```js
{ error, message, code, hint, retryable, requestId, details? }
```

`error` is the legacy alias and equals `message`. `requestId` is `local-…`:
the server generates it in `server/src/httpErrors.js` and returns the same value
in `X-Request-Id`; the client generates one when it maps a local failure.

Codes: `KEY_INVALID`, `KEY_ADMIN`, `AUTH_REJECTED`, `RATE_LIMITED`,
`OVERLOADED`, `BUDGET_EXCEEDED`, `NETWORK_OFFLINE`, `CORS_BLOCKED`,
`STORAGE_FULL`, `STORAGE_UNAVAILABLE`, `FEED_FAILED`, `VALIDATION`,
`NOT_FOUND`, `CONFLICT`, `FORBIDDEN`, `NOT_SUPPORTED_IN_WEB`, `UNKNOWN`.

- `packages/core/src/errors.js` owns `ERROR_CODES`, `AppError`, the catalog of
  user-facing messages/hints/statuses, `statusForCode` and `toUserError`. It
  maps SDK statuses (401/403/429/529/5xx), key errors, connection failures
  (offline vs CORS), storage errors, budget refusals and already-shaped bodies.
  Import it in the browser via the `@sajas/core/errors` subpath — never the
  package root, which pulls in the SDK.
- `server/src/httpErrors.js` owns `requestContext`, `sendError`, the
  `badRequest`/`notFound`/`conflict`/`forbidden` helpers and the terminal
  `errorHandler`. Every route failure goes through it; do not hand-write
  `res.status(...).json({ error })` in a route again.
- `client/src/errors.js` parses responses (`readResponseError`,
  `contractFromBody`), keeps the last 20 failures in memory and builds
  copyable diagnostics. `ErrorCard` shows cause, hint, Retry when the code is
  retryable, Details and Copy diagnostics; `ErrorBoundary` catches render
  crashes; the Logs tab lists recent errors.
- Messages, hints and details are scrubbed with `scrubSecrets` before they
  leave the core, the server or the client. Server `details` never contains a
  stack trace.
```

- [ ] **Step 2: Add troubleshooting guidance to `README.md`**

Replace the `## Tips & troubleshooting` body's opening with the following subsection directly under the heading (keep the existing bullets after it):

```markdown
### When something goes wrong

Every error card and toast names a code, the cause and a fix. The most common:

| Code | What happened | What to do |
|---|---|---|
| `KEY_INVALID` / `KEY_ADMIN` | No key, a malformed key, or an Anthropic admin key | Paste a standard API key (`sk-ant-api…`) in Profile & Settings |
| `AUTH_REJECTED` | Anthropic rejected the key | Check or replace the key in Profile & Settings |
| `RATE_LIMITED` | Too many requests for this key | Wait about a minute, then Retry |
| `OVERLOADED` | Anthropic is busy or the request timed out | Retry in a moment |
| `BUDGET_EXCEEDED` | The daily AI budget is spent | Raise the cap in Settings → AI & Cost, or wait until tomorrow |
| `NETWORK_OFFLINE` / `CORS_BLOCKED` | The request never reached the service | Check the connection/proxy, then Retry |
| `STORAGE_FULL` / `STORAGE_UNAVAILABLE` | The browser blocked or filled local storage | Allow site data, free space, then reload |
| `CONFLICT` | Another hunt/tailor/apply run owns the browser | Wait for it to finish, then Retry |

Click **Copy diagnostics** on any error card (or in Activity Logs → Recent
errors) to copy the code, request id and scrubbed detail. The log is memory-only
and disappears on reload.
```

- [ ] **Step 3: Run the full verification and commit**

Run from `sa-job-agent-suite/`:

```bash
npm test
npm run test:demo
npm run build:client
```

Then from the worktree root:

```bash
node tools/check-secrets.mjs --all
```

Expected: every command exits 0; `check-secrets` reports clean.

```bash
git add CLAUDE.md README.md
git commit -m "docs: document the typed error contract and troubleshooting

Describe the shared payload, the code union, the core/server/client owners,
the scrubbing rule and the user-facing recovery steps."
```

---

## Self-Review

- **Spec coverage:** The §4.6 payload, the 14 named codes (plus 3 documented HTTP extensions), `toUserError` mappings (401/403/429/529, fetch TypeError offline vs CORS, `QuotaExceededError`), server adoption with the legacy `error` field, `ErrorBoundary`, `ErrorCard` with Retry/Details/Copy, the in-memory last-20 log, scrubbing, and the six example situations in docs are all covered by Tasks 1–5.
- **Placeholders:** every code step contains the literal code; the only table-driven steps are the mechanical route replacements, and each row shows the exact before/after string.
- **Type consistency:** `toUserError` returns `{ code, message, hint, retryable, requestId, details? }` and is consumed unchanged by `errorBody`/`sendError` (Task 2), `contractFromBody`/`recordError` (Task 4) and the docs (Task 5). `statusForCode` is defined in Task 1 and used in Task 2. `AppError` is created in Task 1, sent in Task 2 and parsed in Task 4.
- **Known limits (documented, not hidden):** `ErrorBoundary`'s fallback relies on `UNKNOWN` being retryable so the Reload button appears; the client error log is memory-only by design; the demo and guard refusals gain fields but keep their existing status/messages.
