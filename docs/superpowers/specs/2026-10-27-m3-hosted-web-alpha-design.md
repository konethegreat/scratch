# M3 — Hosted Web Alpha (zero-knowledge BYOK) — Design

Status: approved for implementation; M3a-1 (error contract) and M3a-2 (web shell, IndexedDB vault, key lifecycle) are complete. Supersedes nothing; implements milestone **M3** of
`docs/superpowers/specs/2026-10-24-sa-jas-v2-master-plan.md`.

## 1. Context

M2 made the local Hunter truthful and paginated. The next milestone in the
master plan is **M3 — Public alpha**: a free-hosted web app where a stranger can
paste their own Anthropic key and get value without installing anything, with
security strong enough that a key-compromise through our origin is not a
realistic outcome.

The user's decisions for this milestone:

- **Zero-knowledge web**: the host stores no personal data and never sees the
  key.
- **First release includes**: tracker + tailor + application kit, free job feeds,
  AI hunt in the browser, and browser apply.
- **Host**: Cloudflare Pages (free static hosting, edge headers).
- Error handling must show *what* went wrong in plain language, with a fix.

**Platform constraint:** browser apply needs Playwright and a persistent browser
profile. A free static host cannot run it. The hosted app therefore ships the
web-only capabilities and links to the **Runner** (the existing Electron app) as
a beta download for browser sessions and apply. This is the hybrid delivery the
master plan already chose.

## 2. Goals

1. A public URL where a user pastes a key, creates a profile, finds jobs, tailors
   a CV/cover letter, exports an application kit, and tracks applications.
2. The key never reaches our origin in plaintext or ciphertext. It travels only
   browser → `https://api.anthropic.com`.
3. No personal data on the host. Profile, jobs, letters, answers, memory, usage,
   and the optional encrypted key blob live in the browser (IndexedDB).
4. Every failure is a typed, actionable error: code, plain-language cause, what
   to do, retry where safe, and copyable diagnostics.
5. A strict CSP and a canary-key CI test make key exfiltration through script
   injection a tested, not assumed, property.
6. Free to host and free to use apart from the user's own Anthropic spend.

## 3. Non-goals

- Server-side accounts, storage, or multi-tenancy.
- Scrapers, login sessions, routines, or apply inside the hosted app.
- A rewrite of the desktop app. The Runner keeps its current feature set.
- MCP, agentic RAG, and auto-apply (M4–M6).
- Mobile-native shells.

## 4. Architecture

```
Cloudflare Pages (static, free)
  React app (existing client, VITE_SAJAS_WEB=1)
    • web data port  → IndexedDB vault (profile, jobs, letters, memory, usage)
    • key store      → memory by default; optional passphrase-encrypted blob
    • @sajas/core    → callClaude (browser mode), prompts, schemas, errors
    • free feeds     → Remotive / Arbeitnow / Jobicy (keyless, CORS enabled)
  _headers           → CSP, HSTS, frame-ancestors none, no third-party origins
        │
        ├── HTTPS direct: browser → api.anthropic.com   (key in auth header only)
        └── HTTPS: free job feeds (no key, public data)

Runner (Electron, beta download)
  Existing desktop app for Playwright scraping, sessions, routines, apply.
```

There is **no server** in the hosted path. Cloudflare serves immutable files and
headers; it never executes application logic and never receives user data.

### 4.1 One UI, two data ports

The existing `client/` UI stays. A `VITE_SAJAS_WEB=1` build turns on web mode:

- `client/src/web/api.js` implements the subset of the `/api/*` contract the UI
  already uses, backed by IndexedDB and `@sajas/core`. The existing fetch wrapper
  in `main.jsx` routes `API_BASE` calls to it before any network call.
- Server-only tabs (Apply Copilot, Direct Outreach, Routines, Activity Logs) are
  hidden in web mode. The Dashboard, Job Hunter, Document Tailor, Candidate
  Memory, and Settings tabs remain.
- Unsupported endpoints return a typed `NOT_SUPPORTED_IN_WEB` error rather than a
  silent failure, so a missed code path is visible.

The long-term target is the master plan's `DataPort` interface with
`BrowserVault` and `RunnerApi` implementations. This milestone delivers the web
port behind the existing contract; the interface extraction follows in M4 when the
Runner pairing lands.

### 4.2 Browser vault

IndexedDB database `sajas-web`, versioned. Stores:

| Store | Contents |
|---|---|
| `profile` | candidate profile, search settings, cost settings (no key) |
| `jobs` | saved jobs, statuses, tailored CV/letter text, notes |
| `answers` | answer bank + pending questions |
| `memory` | candidate insights, employer notes, application outcomes |
| `usage` | local AI usage ledger (tokens, estimated USD, by feature) |
| `meta` | schema version, export timestamp, preferences |
| `keyVault` | optional encrypted key blob only (salt, IV, iterations, ciphertext) |

Pure repository functions with an in-memory adapter for tests. Export/import is
a single JSON file (no key material). **Panic wipe** clears every store including
`keyVault`.

### 4.3 Key lifecycle (zero-knowledge)

| Stage | Behaviour |
|---|---|
| Entry | One field on onboarding; accepts `sk-ant-api…`; refuses admin keys; a `models.list`-style validation call confirms it works before saving to memory |
| Default storage | Tab memory only; gone on reload |
| Optional remember | Passphrase-encrypted AES-GCM blob in IndexedDB; key derived with PBKDF2-SHA-256 (600k iterations, random salt); never plaintext in localStorage, cookies, URLs, or telemetry |
| Idle forget | Configurable 15/30/60 min; default 30; forgetting drops memory references and any decrypted copy |
| Forget key | Wipes memory + `keyVault`; data remains unless the user chooses panic wipe |
| Panic wipe | Key + vault + sessions + cached feed data |
| Revoke | One-click link to the Anthropic Console; works even with no key loaded |

The key is passed only to `makeClient({ apiKey, dangerouslyAllowBrowser: true })`
in `@sajas/core`; the SDK adds the browser-access header. The API base stays
pinned to `https://api.anthropic.com`, as it is today.

### 4.4 Free job feeds

Three keyless, CORS-enabled feeds (verified 2026-10-27, `Access-Control-Allow-Origin: *`):

- Remotive — `https://remotive.com/api/remote-jobs`
- Arbeitnow — `https://www.arbeitnow.com/api/job-board-api`
- Jobicy — `https://jobicy.com/api/v2/remote-jobs`

Adapters are pure `normalize(raw) → RawJob[]` functions plus a bounded fetch
(20 s timeout, one retry, 15-minute in-memory cache). Results are deduped, filtered
by the user's keywords/locations (SA + remote), and shown with the feed name and a
link back to the source. A feed failure is a per-source error card; the other
feeds still work.

### 4.5 AI flows in the browser

**Tailor** reuses the pure prompt builder already used by the desktop app. That
module moves to `packages/core` (server imports it from there; no duplicate
prompts). The web port calls `callClaude` directly and stores the returned CV and
cover letter on the job. PDF is generated from a dedicated print view
(`window.print()` → Save as PDF) for the first release; no new PDF dependency.

**AI hunt** reuses the pure prompt/schema/parse pieces of `jobSearchAI.js`, moved
to `packages/core/src/jobSearch.js`. The browser orchestration issues the same
bounded `web_search` rounds, validates returned URLs, dedupes, and writes to the
local usage ledger. The daily budget guard runs locally before every call.

Both flows send a progress log to the Activity view without a server.

### 4.6 Error contract

All failures — web port, AI, storage, feeds, and the desktop server — use one
shape:

```js
{
  code: 'KEY_INVALID' | 'KEY_ADMIN' | 'AUTH_REJECTED' | 'RATE_LIMITED' |
        'OVERLOADED' | 'BUDGET_EXCEEDED' | 'NETWORK_OFFLINE' | 'CORS_BLOCKED' |
        'STORAGE_FULL' | 'STORAGE_UNAVAILABLE' | 'FEED_FAILED' | 'VALIDATION' |
        'NOT_SUPPORTED_IN_WEB' | 'UNKNOWN',
  message: 'Short plain-language cause.',
  hint: 'What the user should do next.',
  retryable: true | false,
  requestId: 'local-…',
  details?: 'Scrubbed technical detail for the Details expander.'
}
```

- `packages/core/src/errors.js` gains `toUserError(err, context)` mapping SDK
  statuses (401/403/429/529), fetch `TypeError` (offline vs CORS), and
  `QuotaExceededError`.
- Server routes return the same fields alongside the existing `error` string, so
  the desktop UI benefits immediately.
- The client gains `ErrorBoundary`, a persistent `ErrorCard` (title, cause, hint,
  Retry when safe, Details, Copy diagnostics), and an in-memory last-20 error log.
  Toasts remain for transient confirmations.
- Secrets are scrubbed before any error is displayed, stored, or copied. The error
  log is memory-only.

Examples shown to users:

| Situation | What they see |
|---|---|
| Wrong key | "Anthropic rejected this key. Check that it is a standard API key, not an admin key." + Open Console |
| Rate limit | "Anthropic is rate-limiting this key. Wait ~60 s, then retry." + Retry |
| Offline | "You are offline. Reconnect and retry — nothing was saved." + Retry |
| Storage full | "This browser is out of space for the vault. Export your data, then remove old applications." |
| Feed down | "Remotive did not respond. The other feeds still work." + Retry this feed |

### 4.7 Security model

Threat: script injection on the hosted origin reading the key from the tab.

Controls:

- Strict CSP in `_headers`: `default-src 'self'`; `script-src 'self'`;
  `connect-src 'self' https://api.anthropic.com https://remotive.com
  https://www.arbeitnow.com https://jobicy.com`; `img-src 'self' data: blob:`;
  `style-src 'self' 'unsafe-inline'`; `font-src 'self'`; `frame-ancestors 'none'`;
  `base-uri 'none'`; `form-action 'self'`; `object-src 'none'`;
  `upgrade-insecure-requests`. `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer`, `Permissions-Policy` deny by default,
  `Cross-Origin-Opener-Policy: same-origin`, HSTS.
- No third-party scripts, fonts, analytics, or iframes. No `eval`, no
  `new Function`, no `dangerouslySetInnerHTML` with model or feed text. Untrusted
  text renders as text; any future rich preview sits in a sandboxed iframe with
  no key access.
- All external URLs from feeds or model output are validated to `http(s)` before
  rendering as links. Job text is wrapped in the existing prompt-injection shield
  before it reaches a model.
- Canary-key test: Playwright builds the app with a runtime-assembled fake key,
  intercepts every request, and fails if the canary appears anywhere except the
  `x-api-key` header of a request to `api.anthropic.com` (not DOM, IndexedDB,
  localStorage, sessionStorage, URLs, console, or any other origin).
- Key-removal test: after Forget and after Panic wipe, IndexedDB and memory hold
  no blob; a reload finds no key.
- XSS suite: payloads in job titles/descriptions, CV text, memory notes, feed
  responses, and error messages; assert they render inert and never execute.
- `npm audit` + lockfile pinning + `check-secrets` in CI; bundle SHA-256 printed
  by the build and published so a user can verify the deployed files.

### 4.8 Deployment

- Build: `npm run build:web` → `VITE_SAJAS_WEB=1 vite build` → `client/dist`.
- Cloudflare Pages project `sajas`; build command `npm run build:web`, output
  `client/dist`; `_headers` and `_redirects` in `client/public`.
- Optional GitHub Action deploys on `main` when `CLOUDFLARE_API_TOKEN` and
  `CLOUDFLARE_ACCOUNT_ID` secrets exist; otherwise it skips with a clear notice.
- README documents the 5-minute setup (create a spend-limited workspace key, open
  the URL, paste, test) and self-hosting (`npx serve client/dist` with the same
  headers).

## 5. Delivery plan (increments)

Each increment is its own branch/PR, reviewed and merged green before the next.

| # | Increment | Contents | Exit criteria |
|---|---|---|---|
| M3a-1 | Error contract | core codes + mapper, server error middleware, client ErrorBoundary/ErrorCard/diagnostics, tests | Existing suites green; simulated 401/429/offline/storage errors show the right card |
| M3a-2 | Web shell + vault + key | web build mode, IndexedDB port, onboarding, key memory + encrypted option, forget/wipe, hidden server-only tabs, Cloudflare config | Build deploys; key survives only as chosen; canary test passes |
| M3a-3 | Feeds + tracker | three feed adapters, dedupe/filter, add-to-tracker, statuses, notes, export/import | Offline fixture tests pass; a real feed adds jobs in the browser |
| M3a-4 | Tailor + kit | shared prompts in core, browser tailor, application kit, print-to-PDF, local usage ledger + budget | Mocked tailor produces CV + letter; budget refusal is actionable |
| M3a-5 | AI hunt | shared job-search schema/parse, browser web-search hunt, progress log, dedupe/validation | Mocked hunt returns valid jobs; live run documented, not required in CI |
| M3a-6 | Hardening + launch | CSP/header tests, XSS suite, reproducible bundle hash, SECURITY/THREAT docs, README | M3 exit criteria met; public URL works for a stranger |
| M3b | Runner beta | Electron beta download page, version pin, Runner security doc, pairing groundwork | Download installs; desktop features unchanged |

## 6. Testing strategy

- Pure unit tests (`node:test`) for the vault, error mapper, feed normalizers,
  prompt builders, hunt parsing, budget guard, key crypto, and export/import.
- Playwright E2E against the built static app with `api.anthropic.com` and the
  three feeds mocked at the network layer. No live key, no live feeds in CI.
- Static-header tests assert `_headers` is served and the CSP contains no
  `unsafe-eval`, no third-party script origin, and no wildcard `connect-src`.
- Canary-key and key-removal tests are merge blockers.
- The desktop suites (`npm test`, `test:demo`, `build:client`, `test:desktop`)
  stay green; shared moves are behaviour-preserving.

## 7. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Anthropic changes browser CORS policy | Direct browser calls are the documented path; if it breaks, a stateless Worker relay is the fallback, with the key still only in transit and never logged. Decision recorded before implementing. |
| CSP breaks React inline styles | `style-src 'unsafe-inline'` is the only relaxation; scripts remain `'self'` only. Tested on the built bundle. |
| IndexedDB eviction or user clears storage | Export reminders, JSON export, and a clear "your data is on this device" message. No silent cloud backup. |
| Passphrase loss | The encrypted blob is unrecoverable by design; the UI warns before enabling remember. |
| AI cost surprise | Local budget guard, estimated cost before hunt, usage panel, and a spend-limited key recommendation. |
| Feed terms change or CORS closes | Each feed is independent and optional; failures are per-source, never fatal. Attribution is shown. |
| Large refactor of prompts to core | Move pure modules with tests first; server keeps importing the same functions, so behaviour is preserved. |

## 8. Open questions

None blocking. Two defaults chosen unless vetoed:

1. Remember-key default is **off** (memory only); passphrase encryption is opt-in.
2. Runner beta ships after the web alpha (M3b), because the hosted app is useful
   without it and the Runner needs packaging/signing work.
