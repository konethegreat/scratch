# M0.5 — First-Key Safety Net and Local API Guard: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the M0 AI layer survive its three unverified API assumptions on the user's first real key (without any live test having been run), and close the open "any website can POST to the local API" security finding.

**Architecture:** (1) `callClaude` learns to degrade: when the API rejects an optional feature with a 400 (refusal-fallback beta, JSON schema together with server tools, web search on Haiku), it retries the same request once without that feature, remembers the lesson for the process, and reports it in the result. (2) A small pure `localGuard` module plus Express middleware enforces Host, Origin and a required custom header on all non-GET routes; the client adds the header to every API call.

**Tech Stack:** Node >= 22.12 ESM, `node:test`, `@sajas/core` (`fakeClient`), Express, React/Vite client.

**Spec:** `docs/superpowers/specs/2026-10-24-sa-jas-v2-master-plan.md` (sections 5.1, 11.4; THREAT-MODEL section 7). Context: M0 finished without the live smoke test (no API key available); `CAPABILITIES.searchStructuredOutput`, `CAPABILITIES.haikuWebSearch` and `REFUSAL_FALLBACK_DEFAULT` are still at their assumed `true`. Open security finding from the automated commit review: state-changing routes in `server/src/index.js` have no Origin/Host enforcement.

## Global Constraints

- Node `>=22.12.0`; ESM. No model-ID string literals outside `packages/core/src/models.js` and `*.test.js`; no provider names outside `server/src/db/migrations.js` (guard tests enforce both).
- Tests assemble key-shaped strings at runtime (`'sk-' + 'ant-api03-' + 'A'.repeat(40)`); never bypass the pre-commit hook; never run `smoke:live` or `evals --live`; never set `ANTHROPIC_API_KEY`.
- Never send `temperature`, `top_p`, `top_k`, prefill, forced `tool_choice` or disabled thinking.
- Degrading must never touch safety behaviour: no retry may remove the budget check (`beforeCall` runs before EVERY underlying request, retries included), and no log or error may contain the key.
- Commit messages end with a blank line then `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Commands run from `sa-job-agent-suite/` unless stated.

## Review Focus

1. A 400 that is NOT about an optional feature (bad model name, malformed request) must not be retried or masked.
2. A retry that also fails must surface the SECOND error, and must not loop (each degrade step at most once per call).
3. A degraded retry must still run the budget hook and still record usage for the response that succeeded.
4. `Host: evil.example` or a rebinding hostname pointing at 127.0.0.1 must be refused even for GET.
5. The packaged desktop app and the Vite dev client must still work (preflight for the custom header; desktop smoke test).

---

### Task 1: Self-degrading `callClaude`

**Files:**
- Modify: `packages/core/src/ai.js`, `packages/core/src/index.js` (exports)
- Test: `packages/core/src/ai.test.js` (add a `describe`-style block of tests)
- Modify: `server/src/agents/llm.js` (log degrade notices through `addLog`), `CLAUDE.md` (repo root: document the behaviour in the `callClaude` paragraph)

**Interfaces:**
- Consumes: existing `callClaude(req, hooks)`, `fakeClient` with `{ __throw: err }` entries (errors are plain objects with `status` and `message`).
- Produces:
  ```js
  // ai.js
  export function getLearnedCapabilities(): { refusalFallback: boolean, schemaWithTools: boolean, haikuSearch: boolean }  // true = still allowed
  export function resetLearnedCapabilities(): void                                                                    // tests only
  // ClaudeResult gains: degraded: string[]   // e.g. ['refusal-fallback'], [] when nothing degraded
  ```
  Degrade steps (each at most once per call, applied in this order of detection, each retry is a fresh request that first runs `hooks.beforeCall`):
  | Step id | Trigger (HTTP 400 only; message lower-cased contains) | Retry change |
  |---|---|---|
  | `refusal-fallback` | `fallback` or `server-side-fallback` or `betas` (and the request used the beta path) | use `client.messages.stream` without `betas`/`fallbacks` |
  | `schema-with-tools` | request has `tools` AND `output_config.format` AND message contains one of `output_config`, `format`, `json_schema`, `structured` | drop `output_config.format` (keep `effort`) |
  | `haiku-search` | request has a web-search tool AND model is the Haiku registry model AND message contains `web_search` or `tool` | switch `model` to `MODEL_IDS.sonnet` |
  A step only counts as *learned* (process-level, so later calls skip the failing variant up front) when the retried request SUCCEEDS. A non-matching 400, any non-400, or a failed retry is rethrown (the retry's own error wins) and learns nothing. A learned `refusalFallback:false` makes `useFallback` false before the first request; learned `schemaWithTools:false` drops `format` when tools are present; learned `haikuSearch:false` swaps Haiku for Sonnet when a web-search tool is present. Each learned/applied degrade is reported via `hooks.onLog('<task>: <step> not accepted by the API; retried without it', 'system')` once per call and listed in `result.degraded`.

- [ ] **Step 1: Write the failing tests** in `ai.test.js` (use `fakeClient`, `resetLearnedCapabilities()` in `beforeEach`/`afterEach`, runtime-built key). Test names and assertions:
  - `a 400 about the fallback beta is retried on the plain stream and remembered`: first response `{__throw:{status:400,message:'fallbacks: Extra inputs are not permitted'}}`, second a normal message; assert `calls.length === 2`, `calls[0].beta === true`, `calls[1].beta` falsy and no `fallbacks`/`betas` in `calls[1]`, `result.degraded` deep-equals `['refusal-fallback']`, `getLearnedCapabilities().refusalFallback === false`; a second `callClaude` in the same test starts on the plain stream (`calls[2].beta` falsy) and `degraded` is `[]`.
  - `a 400 about structured output with server tools drops the schema and keeps effort`: tools = `[webSearchTool({maxUses:1})]`, schema given, first response throws `{status:400,message:'output_config.format is not supported with this tool'}`; assert the retry has `output_config` deep-equal `{ effort: <task effort> }`, `degraded` is `['schema-with-tools']`, learned `schemaWithTools === false`.
  - `a 400 about web search on Haiku retries on Sonnet`: task `planner`-class Haiku model with a web-search tool and message `web_search tool is not supported for this model`; assert `calls[1].model === MODEL_IDS.sonnet`, `degraded` `['haiku-search']`, learned `haikuSearch === false`.
  - `an unrelated 400 is not retried` (message `model: not found`): `calls.length === 1`, error rethrown with its original message, `degraded` n/a, nothing learned (`getLearnedCapabilities()` all true).
  - `a 401 is never retried` (still `ClaudeAuthError`, one call).
  - `a failing retry surfaces the second error and learns nothing`: first throw matches fallback, second throw `{status:400,message:'something else'}`; the rejection message is `something else`; `getLearnedCapabilities().refusalFallback === true`; `calls.length === 2`.
  - `each degrade step is used at most once per call`: three consecutive matching 400s for the fallback step reject after the second request (no third request).
  - `the budget hook runs before every retry and usage is reported only for the successful response`: `beforeCall` counter equals the number of requests sent (including the retry), `onUsage` called once.
  - `two steps can combine in one call` (fallback 400 then schema 400 then success): `degraded` deep-equals `['refusal-fallback','schema-with-tools']`, `calls.length === 3`.
  - `degrade notices never contain the key` (assert `onLog` messages do not include the key string).
- [ ] **Step 2: Run** `npm test --workspace=packages/core`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** in `ai.js`: wrap the single stream-and-final step in a small helper that, on a caught SDK error, classifies it with a pure `degradeStepFor(err, request)` function (exported only for tests if useful), mutates a per-call `request variant` (`useFallback`, `dropFormat`, `model`) and retries the same `attempt` index. Keep `wrapSdkError` for the final throw. Do not change the pause_turn logic or result shape other than adding `degraded`.
- [ ] **Step 4: Server log wiring and docs.** In `server/src/agents/llm.js` the existing `onLog` hook already forwards to `addLog`; confirm degrade notices reach the activity log (add a test in `llm.test.js` using `fakeClient` that a fallback-400 followed by success yields an `addLog` entry mentioning `not accepted by the API` and a successful `callLlm` result). Add a short paragraph to `CLAUDE.md` (`callClaude` section): the three assumptions, the degrade behaviour, `result.degraded`, and that `npm run smoke:live` is still the way to make the choices permanent.
- [ ] **Step 5: Run** `npm test` (root). Expected: PASS, all guards green.
- [ ] **Step 6: Commit** `feat(core): degrade gracefully when an optional API feature is rejected`.

---

### Task 2: Local API guard (Host, Origin, custom header)

**Files:**
- Create: `server/src/localGuard.js`, `server/src/localGuard.test.js`
- Modify: `server/src/index.js` (mount the middleware after `cors`, before `express.json` and all routes), `client/src/main.jsx` (add the header to API fetches), `scripts/demo.test.mjs` and any other in-repo non-browser caller of the API that issues a non-GET request (find with a grep; e.g. `scripts/demo-client.mjs`, `scripts/demo-runtime.mjs`), `CLAUDE.md` (Security model bullet)

**Interfaces:**
- Produces:
  ```js
  // localGuard.js
  export const CLIENT_HEADER = 'x-sajas-client'
  export const CLIENT_HEADER_VALUE = '1'
  export function checkLocalRequest(
    req: { method: string, host?: string, origin?: string, clientHeader?: string },
    opts: { port: number | string }
  ): { ok: true } | { ok: false, status: 403, error: string }
  export function localGuard(opts: { port }): express.RequestHandler   // calls checkLocalRequest with req.method, req.headers.host, req.headers.origin, req.headers[CLIENT_HEADER]
  ```
  Rules, in this order:
  1. `host` must be present and match (case-insensitive) `127.0.0.1`, `localhost` or `[::1]` followed by exactly `:<port>` (the configured port); anything else, including a missing Host header, other ports and any other hostname (DNS rebinding), is refused with `error: 'Host not allowed'`.
  2. If `origin` is present, its hostname must be `localhost`, `127.0.0.1` or `[::1]` (any port: the Vite dev server runs on another port); otherwise refused with `error: 'Origin not allowed'`. An absent Origin is allowed (Electron renderer, curl, same-origin).
  3. For methods other than `GET`, `HEAD`, `OPTIONS`, the request must carry the header with value `'1'`; otherwise refused with `error: 'Missing X-SAJAS-Client header'`.
  Refusals are `res.status(403).json({ error })` and nothing else runs; no request data is echoed.

- [ ] **Step 1: Write the failing tests** `localGuard.test.js` (pure function plus a tiny Express app on an ephemeral port using `http` for the middleware case):
  - `allows localhost, 127.0.0.1 and [::1] hosts on the configured port` (also upper-case `LOCALHOST:5000`).
  - `refuses a foreign Host and a rebinding hostname even for GET` (`evil.example:5000`, `attacker.test`, and `127.0.0.1.evil.example:5000` must all be 403) *(Review Focus 4)*.
  - `refuses a missing Host header and a wrong port`.
  - `refuses a foreign Origin and allows an absent or localhost Origin on any port` (`https://evil.example` 403; `http://localhost:4173` ok; no Origin ok; `null` string origin 403).
  - `non-GET requests need the custom header` (POST/PUT/PATCH/DELETE without it -> 403 `Missing X-SAJAS-Client header`; with `'1'` -> ok; with `'0'` or other value -> 403).
  - `GET HEAD and OPTIONS do not need the header`.
  - `the middleware answers 403 JSON and does not call the route` (spawn the app; a POST without the header never reaches a counter route; with the header it does).
- [ ] **Step 2: Run** `npm test --workspace=server -- --test-name-pattern="localGuard|local guard"`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `localGuard.js` per the rules; mount in `index.js` with `app.use(localGuard({ port: PORT }))` AFTER `app.use(cors(corsOptions))` and BEFORE `express.json` so preflight `OPTIONS` is answered by `cors` and everything else is checked. Confirm the `cors` configuration reflects the custom request header on preflight (the `cors` package reflects `Access-Control-Request-Headers` when `allowedHeaders` is unset); add an explicit `allowedHeaders` only if a test shows it is needed.
- [ ] **Step 4: Client and in-repo callers.** In `client/src/main.jsx`, before rendering, wrap `window.fetch` so every request whose URL starts with the API base (`import.meta.env.VITE_SAJAS_API_BASE || 'http://localhost:5000/api'`, matching `API_BASE` in `App.jsx`) adds `X-SAJAS-Client: 1` to its headers (preserve existing headers, `Request` objects and `init`). Update every in-repo non-browser caller that makes a non-GET request to the API (grep `scripts/` and `electron/` for `method:`/`POST`/`DELETE`) to send the header, and make `scripts/demo.test.mjs` assertions pass with it. Add integration assertions to the non-demo server test in `scripts/demo.test.mjs`: a POST without the header returns 403 and does not change state; the same POST with the header succeeds; a GET with a `Host: evil.example` header (use `http.request` with an explicit Host) returns 403 *(Review Focus 4)*.
- [ ] **Step 5: Verify the shells.** Run `npm test`, `npm run test:demo`, `npm run build:client`, and `npm run test:desktop` (source desktop smoke; it must still render the client and reach a healthy API) *(Review Focus 5)*. Start `npm run dev` once and confirm from the browser console or a quick script that the Vite client (port 4173) can still load `/api/profile` and `POST` something harmless (e.g. toggle a setting) successfully, then stop the servers.
- [ ] **Step 6: Docs.** Update the `CLAUDE.md` Security model section: Host/Origin/custom-header enforcement (what it blocks: cross-site form POSTs and DNS rebinding), the header name, that new in-repo callers must send it. Add one line to `THREAT-MODEL.md` section 10 noting the guard is now in place (leave the rest of that document to M3).
- [ ] **Step 7: Commit** `feat(server): refuse foreign hosts/origins and require a custom header on non-GET routes`.

---

### Task 3: Record the open live-verification item

**Files:**
- Create: `docs/superpowers/baselines/2026-10-25-m0-live-verification-pending.md`

**Interfaces:** none.

- [ ] **Step 1: Write the note**: what is unverified (the three flags and the cache-hit probe), why (no API key yet), what now protects the first run (Task 1's degrade behaviour), and the exact commands to run later (`ANTHROPIC_API_KEY=… npm run smoke:live -- --yes-spend`, `node evals/run.mjs --live --yes-spend --trials 1`) with expected cost (cents / roughly $1-2), the decision rules for each failing probe (copy from plan `2026-10-24-m0-foundations.md` Task 15 Step 4), and a checklist to tick when done.
- [ ] **Step 2: Commit** `docs: record the pending live verification`.

---

## Self-review

- **Spec coverage:** safety-net behaviour for the three unverified flags (Task 1); local API hardening from the security review and THREAT-MODEL section 7 (Task 2); open item recorded (Task 3). Not covered here by design: OS keychain storage, browser-side key handling, CSP (M3).
- **Types:** `degraded` and `getLearnedCapabilities` are defined in Task 1 and only read by Task 1's tests and `llm.js`; `CLIENT_HEADER` is defined in Task 2 and used by the client wrapper and the scripts.
- **Review Focus coverage:** 1, 2, 3 in Task 1 tests; 4 and 5 in Task 2.
