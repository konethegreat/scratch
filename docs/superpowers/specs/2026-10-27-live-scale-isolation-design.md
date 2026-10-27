# Live-scale hardening and isolation design

**Status:** approved for implementation
**Owner:** Kone
**Created:** 2026-10-27
**Implements:** Arc 2 of [`2026-10-27-post-m3a3-pipeline.md`](2026-10-27-post-m3a3-pipeline.md)
**Related:** [`2026-10-27-m3-hosted-web-alpha-design.md`](2026-10-27-m3-hosted-web-alpha-design.md)

## Purpose

Make the claim "free, hosted, bring your own key, and isolated per browser" true under load and under attack. The hosted app is a static bundle with no origin server. The work is therefore mostly proof, two small behaviour fixes, and an honest security write-up, not a new subsystem.

## What already holds

These properties exist today and the new work must not regress them:

- The deployed app is a static Cloudflare Pages bundle with no Functions, so there is no server to exhaust and no server-side copy of user data.
- User data lives in the browser's IndexedDB database `sajas-web`, partitioned by browser profile and origin.
- A plaintext API key exists only in a closure inside `keyStore.js`. The optional remembered form is an AES-GCM blob in the `keyVault` store.
- The backup export includes `profile`, `jobs`, `answers`, `memory`, `usage` and `meta`, and never includes `keyVault`.
- Every outbound keyed request goes directly to `api.anthropic.com`. No request carries the key to our origin.
- `client/public/_headers` sets a strict CSP (`script-src 'self'`, explicit `connect-src`, `frame-ancestors 'none'`, `base-uri 'none'`, `object-src 'none'`, `form-action 'self'`), HSTS, `nosniff`, `no-referrer`, a restrictive Permissions Policy and COOP.
- `scripts/web-canary.mjs` already proves the canary key does not reach the DOM, form values, iframes, URL, localStorage, sessionStorage, cookies, IndexedDB, console, request bodies, request URLs, or any header other than `x-api-key` to `api.anthropic.com`. It also proves Remember stores ciphertext and that Forget and panic wipe remove the blob.
- `client/src/web/feeds.js` loads the three feeds independently through `loadAll`, and `JobFeeds.jsx` renders a per-source failure card with its own Retry.
- Storage failures already map through `toUserError` (`QuotaExceededError` to `STORAGE_FULL`, `InvalidStateError` to `STORAGE_UNAVAILABLE`) and every tracker write reports through the shared `fail()` toast path.

## Scope

### 1. Key validation distinguishes a spend cap

`validateAnthropicKey` currently maps every 429 to `RATE_LIMITED`. A spend cap is permanent until the account limit changes, so it must not read as "wait a minute".

- On 402, return `SPEND_CAP`.
- On 429, read the small JSON error body and reuse `isSpendCapError` from `@sajas/core/errors`. Billing and spend markers map to `SPEND_CAP`; a plain rate limit stays `RATE_LIMITED`.
- On 403, keep `KEY_PERMISSION`.
- The probe makes one request and never retries.

### 2. Storage pressure is explicit and lossless

A quota failure during a tracker write currently surfaces the desktop-oriented hint ("delete old applications or documents"). In the web app documents are not stored locally, so the fix text must match the app.

- Translate `QuotaExceededError` inside the IndexedDB adapter into `STORAGE_FULL` with web copy: export a backup, delete jobs you no longer need, or clear site data for this page.
- The write still rejects. No optimistic UI state is persisted, and the previous stored value survives. The existing `fail()` path shows the message and the fix in a toast.
- Keep the shared core mapping for every other storage consumer.

### 3. Response headers gain two older-browser defences

- Add `X-Frame-Options: DENY` alongside the existing `frame-ancestors 'none'`.
- Add `Cross-Origin-Resource-Policy: same-origin` so other origins cannot embed our assets.
- No CSP relaxation, no new origins, no third-party code.

### 4. Cross-profile isolation is proven

A new offline E2E, `scripts/web-isolation.mjs`, launches one browser and two independent contexts on the same local origin:

1. Context A skips the key, loads a fixture feed, adds one job to the tracker and sets a status.
2. Context B opens the same origin and must show onboarding, an empty tracker, empty localStorage, sessionStorage and cookies, and no `sajas-web` job rows.
3. Context A must still see its own job, proving the two stores are genuinely separate rather than both empty.

The same script injects a quota failure on the `jobs` store in context A, changes a status, and asserts that the `STORAGE_FULL` toast appears with the export-or-delete hint and that the previously stored status is unchanged.

### 5. The key canary covers the backup and framing surface

Extend `scripts/web-canary.mjs`:

- With the key loaded, export a backup and assert the canary appears nowhere in the downloaded JSON. The existing run only inspects IndexedDB, not a real export.
- Assert the served headers contain `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Resource-Policy: same-origin`.
- Inject a `<script src="https://evil.example/...">` into the page, assert a `securitypolicyviolation` event fires for `script-src`, and assert no request to that origin leaves the page. If CSP were removed, the router would abort the request, no violation would fire, and the test would fail.

### 6. One failed feed never blanks the others

Extend `scripts/web-feeds.mjs` with a failure pass:

- Serve two feeds normally and one as HTTP 503.
- Assert the two healthy cards still report job counts, the failed card names that feed and offers Retry, and the combined table still shows the healthy rows.
- Switch the failed route to the fixture, click Retry, and assert the recovered feed renders its rows and its count.

### 7. Documentation states the model and its limits

`SECURITY.md` gains a hosted web section covering:

- Origin, storage partition, key lifetime and backup contents.
- What our origin sees: static asset requests only, with no analytics and no user data.
- What the app never sends to our origin.
- Cloudflare Pages free-plan facts, verified on 2026-10-27: 500 builds per month, 20,000 files, 25 MiB maximum file size, unmetered static asset requests, and no Functions in this deployment. Requests that invoke Functions would count against the Workers free quota, which is one reason the app has none.
- Residual risks: XSS on our origin, malicious browser extensions and device access, IndexedDB eviction, no account recovery, and feeds seeing the user's IP address.
- Correction of stale text that still names deleted providers, Gemini and OpenRouter, and of the desktop-only API key row.

`CLAUDE.md` records the web isolation invariants and the test that protects each one. The pipeline document marks Arc 2 as shipped when it ships.

## Non-goals

- Any backend, accounts, server-side storage, or sync.
- Serving the web app through Pages Functions.
- A service worker. It would add a cache that can hold user data and a new update surface.
- Trusted Types. The web client has no `dangerouslySetInnerHTML` and no `innerHTML` write; React escaping plus the current CSP is the current boundary.
- Any change to the key lifecycle, crypto, or backup format.

## Threat model

| Risk | Position |
|---|---|
| XSS on our origin steals a key or profile | Strict CSP with no inline and no third-party script, no dangerous HTML sinks, React escaping, and a canary that fails on any leak. This is the main residual risk and is documented. |
| Another browser profile reads this user's data | IndexedDB and the vault are per browser profile and origin. A different profile, browser, device or private window starts empty. Proven by the two-context E2E. |
| A malicious page frames the app or reads it through a shared origin | `frame-ancestors 'none'`, `X-Frame-Options: DENY`, COOP and CORP. Proven by header assertions. |
| The key reaches our origin | The app is static; the canary asserts no key in any request to our origin, and `connect-src` does not permit it. |
| A backup leaks the key | `EXPORT_STORES` excludes `keyVault`; the canary now also scans a real exported file. |
| Feed outage or change blanks the app | Per-source isolation, bounded retries, a named failure card with its own Retry, and an E2E that fails one feed while two succeed. |
| Quota or eviction loses data silently | Quota maps to `STORAGE_FULL` with a concrete fix, writes reject, and the previous value is asserted intact. Panic wipe and export remain the recovery paths. |
| A user's key hits a rate limit or spend cap | Rate limits stay `RATE_LIMITED`; spend caps become `SPEND_CAP` with the Console fix. Neither is offered as a retry. |
| Deploy abuse or an accidental secret | GitHub CI and the pre-commit secrets scan gate every commit, GitGuardian runs on the PR, and the deployed bundle contains no secrets. Cloudflare's free plan includes automatic DDoS protection. |
| Our origin runs out of quota | There are no Functions and static requests are unmetered on the free plan. The only deploy quota is 500 builds per month. |

## Acceptance criteria

| Pipeline requirement | Evidence |
|---|---|
| Isolation model written down | `SECURITY.md` hosted web section and this document |
| Key canary covers DOM, storage, backup, analytics and our origin | `web-canary.mjs`, extended with the backup export |
| Cross-profile isolation | `web-isolation.mjs`, two contexts |
| CSP and frame assertions plus third-party script test | `web-canary.mjs`, extended |
| Feed failure isolation | `web-feeds.mjs`, failure pass |
| Storage pressure handling | `web-isolation.mjs` quota pass plus adapter unit test |
| Free-tier limits and residual risks documented | `SECURITY.md` |
| Spend-cap and rate-limit client tests | `validateKey.test.js` |
| A stranger on the live URL sees no other user's data | Post-deploy fresh-context check |
| Removing the key and clearing site data removes key artifacts | Existing canary Forget and panic-wipe phases |

## Testing

- Unit: `client/src/web/validateKey.test.js`, `client/src/web/idbAdapter.test.js` (new).
- E2E, offline: `scripts/web-canary.mjs`, `scripts/web-feeds.mjs`, `scripts/web-isolation.mjs` (new), all wired into `npm run test:web`.
- Gates: `npm test`, `npm run test:demo`, `npm run build:client`, `npm run build:web`, `npm run test:web`, `node tools/check-secrets.mjs --all`.
- Live: after deploy, open https://sajas.pages.dev in a fresh Playwright context with no key and assert onboarding, an empty tracker, the four security headers, and no requests outside our origin.

## Rollout

One PR on `feat/live-scale-isolation`, squash merged when CI is green, then deployed with `wrangler pages deploy`. The PR records the manual live check and what a reviewer should click.
