# Web tailoring and support design

**Status:** approved, implementing
**Owner:** Kone
**Created:** 2026-10-27
**Arc:** 4 of the [post-M3a-3 pipeline](2026-10-27-post-m3a3-pipeline.md)
**Extends:** [`2026-10-27-m3-hosted-web-alpha-design.md`](2026-10-27-m3-hosted-web-alpha-design.md)

## Problem

The hosted app at https://sajas.pages.dev shows a Document Tailor tab, but the button cannot work. `POST /jobs/:id/tailor` is on the web port's server-only list and answers 501, so the most valuable feature in the product is visible and broken. The site also has no support path: a visitor with a problem has no contact details, no FAQ, and no way to send diagnostics.

This arc closes both gaps. Tailoring runs in the visitor's browser against their own Anthropic key, and a support section gives them somewhere to go when something fails.

## Goals

1. Tailor a CV and a cover letter in the browser for any saved job, with the same prompt contract the desktop app uses.
2. Record token usage and estimated cost in the browser, enforce the daily budget before every AI request, and show the real numbers in the existing Usage panel.
3. Let the visitor keep the output as copy, Markdown download, or print to PDF.
4. Add a support section on the landing page and an in-app Help tab with contact details, an FAQ, and a report action that carries diagnostics.
5. Fail in plain language. A partial or failed run must never look finished.

## Non-goals

- Company research fan-out, memory digests, and employer notes in web tailoring. Those need either a server or the Arc 5 retrieval work.
- Batch tailoring in the web app.
- Server-side PDF generation or document upload. The browser prints to PDF instead.
- A backend, accounts, or any request that carries user data to our origin.
- RAG, auto-apply, and inbox/MCP. Those are Arcs 5, 6, and 7.

## Architecture

### Shared prompts

`server/src/agents/tailorPrompts.js` is pure and has no Node imports. Move it to `packages/core/src/tailorPrompts.js`, export it as `@sajas/core/tailor`, and update the desktop agent, its tests, and the eval runner to import from core. Both the desktop agent and the web tailor then build prompts from one source, so a prompt fix cannot drift between modes.

`packages/core/package.json` also gains an `./ai` export, so the browser can lazily import `callClaude` and `makeClient` without loading the whole core index.

### Browser allowance

`makeClient({ apiKey, timeout })` returns a client that fails in a browser unless the SDK's `dangerouslyAllowBrowser` flag is set. Add an opt-in `allowBrowser` parameter:

```js
export function makeClient({ apiKey, timeout, allowBrowser = false } = {}) {
  return new Anthropic({
    apiKey,
    baseURL: ANTHROPIC_BASE_URL,
    maxRetries: 0,
    ...(allowBrowser ? { dangerouslyAllowBrowser: true } : {}),
    ...(timeout ? { timeout } : {})
  });
}
```

Only the web tailor passes `allowBrowser: true`. The desktop path keeps the guard.

The browser talks to `https://api.anthropic.com` directly. The deployed CSP already allows that origin in `connect-src`, and no request goes to our origin. The SDK is loaded with a dynamic `import()` the first time a visitor tailors, so the landing page and tracker do not pay its bundle cost.

### Web usage ledger

New `client/src/web/usage.js`:

```js
createUsageLedger({ vault, now = () => new Date() })
```

- Stores days in the `usage` IndexedDB store under the key `days`, in the same shape the desktop server computes: `{ days: { 'YYYY-MM-DD': { calls, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, webSearches, estCostUSD, byBucket } } }`.
- `record({ model, bucket = 'core', ...tokens })` uses `estimateCostUSD` from `@sajas/core/costs`, adds the call to today, and prunes to 14 days. It never throws; a ledger failure cannot break a run.
- `summary(profile)` returns the exact `/usage` shape the client already reads: `today`, `history` (last 14 days), `last7CostUSD`, and `budget` with `capUSD`, `spentUSD`, and `exceeded`.
- `budget(profile)` is the guard. `capUSD` of 0 means no cap.
- `clear()` replaces the days with an empty object.

`GET /usage` in `client/src/web/api.js` returns `ledger.summary(profile)`. `DELETE /usage` clears it. This replaces the hard-coded zeros, and the existing Usage panel then shows real spend.

### Web tailor

New `client/src/web/tailor.js`:

```js
createWebTailor({ vault, keyStore, usage, activity, now, loadAi })
```

`loadAi` defaults to `() => import('@sajas/core/ai')` so tests can inject a fake `callClaude` and `makeClient`.

`tailorJob(jobId, profile)`:

1. Refuse early, before any network call, when there is no key in the key store, when `profile.baseCv` is shorter than 50 characters, or when the job is missing.
2. Build prompts with `buildTailorPrompts({ baseCv, job })`. No research brief, no employer notes, no memory digest in this arc.
3. Load the AI module lazily, create a browser client with the key from `keyStore.getKey()`, and call `callClaude` with `task: 'tailor'`, `system`, `cacheSystem: profile.usePromptCaching !== false`, and `maxRetries` left at the core default.
4. Pass a `beforeCall` hook that re-checks the budget before every request, including retries and `pause_turn` continuations. An exceeded budget throws `BUDGET_EXCEEDED` with the plain message "Daily AI budget reached (est. $spent of $cap). Raise or clear the cap in Settings.".
5. Record every response's usage through the ledger with bucket `tailor`. Usage is buffered while a call runs and written once the call settles, including when it throws.
6. Generate the CV first. Strip a wrapping code fence, reject empty output, reject `truncated` output with a message that says the document was cut off and was not saved.
7. Save the CV immediately and set the job status to `tailored`. Re-tailoring keeps the previous document until the new one is saved.
8. Generate the cover letter best-effort. If it fails, keep the CV and return `{ job, warning }` with the plain reason. The API maps that to a success response that includes the warning.
9. If CV generation fails before anything was saved, restore the previous status and rethrow the typed error.

The key exists only in the closure returned by `keyStore.getKey()`, in the SDK client, and in the outbound `x-api-key` header. It is never placed in a job, the profile, the usage ledger, a log line, a backup, or a response body.

### Web API

`client/src/web/api.js`:

- Remove `/^\/jobs\/[^/]+\/tailor$/` from `SERVER_ONLY`. Keep `/jobs/tailor-batch` there.
- Add `POST /jobs/:id/tailor`, which calls `tailorJob` and returns `{ success: true, job, warning? }` when it finishes. The desktop route is fire-and-forget; the web route is synchronous because there is no background server. The client must treat the two modes differently so the toast text stays truthful.
- `GET /usage` and `DELETE /usage` use the ledger.

### Client behaviour

`App.jsx`:

- `triggerTailor` already disables the button while a run is in flight. In web mode, keep the spinner until the response arrives, then refresh jobs, select the updated job, and toast either "CV and cover letter are ready." or the warning.
- In desktop mode, keep the current "started" toast.
- `DocumentBox` gains a Print action. It opens a blank window, writes the document text through DOM APIs into a print stylesheet, then calls `print()`. There is no inline script and no HTML interpolation, so a document cannot inject markup. If the popup is blocked, the UI says so and points to Copy.
- The tailor pane tells web users that research and employer notes are desktop-only, next to the run button, so the difference is not a surprise.

### Support

New `client/src/support.js` exports the business details and `buildSupportMailto({ code, message, requestId, where })`. The function builds a `mailto:erictshivhinda@gmail.com` link whose body holds only:

- the error code, the safe message, and the request ID
- the time, the page path, the app surface (web or desktop), and the browser user agent
- the place in the app where it happened

It never includes the key, the profile, job text, CV text, or storage contents, and the message is passed through `scrubSecrets`.

New `client/src/Help.jsx`, rendered as a `help` tab in the sidebar in both modes:

- Contact block: email `erictshivhinda@gmail.com`, phone `+27 81 302 5435`, LinkedIn, GitHub, and Johannesburg.
- FAQ: where the key lives, where data is stored, what tailoring costs, whether the app ever submits an application, and what to do when the budget cap is reached.
- Report block: a button that opens the prefilled email, and a copy-diagnostics button for people without a mail client.

`Landing.jsx` gets a Support section before the footer with the same contact details and a short FAQ, so a visitor who never enters the app can still reach Kone.

Error toasts gain an optional "Get help" link. `fail()` builds the mailto link from the recorded error contract. Error toasts with the link stay up for 10 seconds instead of 4.5.

## Data and failure behaviour

- Job status moves `found` or `tailored` to `tailoring` while a run is in flight. Success ends at `tailored`.
- A CV failure restores the previous status and leaves previous documents untouched.
- A cover letter failure leaves the CV saved and status `tailored`, with a visible warning.
- Truncated or empty output is an error, never a saved document.
- Budget exhaustion is a hard stop before the request. It is not retried.
- Closing the tab during a run loses the in-flight result but never leaves a half-written CV: the CV is written once, after it is complete.

## Security and isolation

- No new network destination. Tailoring calls `api.anthropic.com`; everything else stays local.
- No key material in IndexedDB, localStorage, sessionStorage, the DOM, backups, logs, or toasts. The existing canary test is extended to the tailor path.
- Job text and CV text keep the desktop injection shield and untrusted-data markers.
- Diagnostics are built from metadata only and scrubbed before they are placed in a mailto URL.
- The print window receives text, not HTML, so generated content cannot run script.
- Support links are plain anchors. No analytics, no third-party embed, no tracking pixel.

## Testing

Unit and integration, offline:

- Core prompt tests move with the module and keep passing.
- Usage ledger: record, summary shape, budget exceeded at the cap, no cap at 0, 14-day prune, clear.
- Web tailor with a fake `callClaude`: happy path saves CV and letter, CV saved before a letter failure, truncation and empty output rejected, missing key and short CV rejected before any call, budget block before the call, status restored on CV failure, previous documents preserved on re-tailor failure, usage recorded.
- Web API: `/usage` returns real numbers, `DELETE /usage` clears them, tailor answers 200 with the job and no longer 501.
- Support: mailto contains code, request ID, and browser, and contains no key, profile, job, or CV text.
- UI gate: Help tab and landing support section contain the approved contact details, no em dashes, no emoji, and pass the existing design checks.

Browser proof, offline:

- Playwright routes `https://api.anthropic.com/**` to a local SSE response, validates the key probe, and saves a profile and job.
- Tailor from the UI, assert the spinner, the two documents, the toast, and persistence after reload.
- Assert Copy writes to the clipboard mock, Print opens a window with the document text, and the support tab opens the prefilled report.
- Force a budget error and assert the plain message, the restored status, and the "Get help" link.
- Assert no request to our origin carries the key, no console error, and no off-origin request besides the mocked Anthropic host.

## Acceptance criteria

1. A visitor with a valid key and a base CV can tailor a saved job in the hosted app and see both documents.
2. Re-tailoring replaces the documents; a failed re-tailor keeps the previous ones.
3. Usage and spend appear in the Usage panel, and the daily cap stops a run before the request with a plain message.
4. Copy, Markdown download, and Print to PDF all work in a browser.
5. The landing page and the Help tab show email, phone, LinkedIn, GitHub, and Johannesburg, plus the FAQ.
6. Every error toast offers "Get help" with diagnostics that contain no key or personal data.
7. `npm test`, `test:demo`, `build:client`, `build:web`, `test:web`, and the repo secret scan pass offline.
8. After deploy, the live flow works end to end in a real browser with a real key, before any public promotion.

## Risks

- **Bundle size:** the Anthropic SDK must stay out of the initial bundle. The dynamic import is a requirement, and the plan measures the entry chunk before and after.
- **Long browser requests:** a 16k-token document can take a minute. The UI must keep the run disabled and show progress, and it must not time out on our side because there is no our side.
- **Mobile print:** printing is not available in every mobile browser. Copy and Markdown remain the fallback.
- **Browser CORS changes:** if Anthropic changes its browser policy, the error contract reports `CORS_BLOCKED` and the FAQ explains the fix.
- **Support address:** the email and phone are already public on the client site. No new personal data is published.
