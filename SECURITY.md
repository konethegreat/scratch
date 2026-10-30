# Security Policy

SA-JAS runs in two shapes: a hosted web app at https://sajas.pages.dev with a bring-your-own Anthropic key, and a local-first desktop application. Neither shape sends your data to a SA-JAS server. There is no SA-JAS server holding user data.

Related documents:

| Document | What it covers |
|---|---|
| [THREAT-MODEL.md](THREAT-MODEL.md) | Assets, trust boundaries, threat scenarios and residual risk |
| [POLICY.md](POLICY.md) | What is stored where, what leaves the device, POPIA rights |
| [OPERATIONS.md](OPERATIONS.md) | Hosting, scaling, bot protection and cost |
| [TRADEMARK.md](TRADEMARK.md) | The MIT code licence versus the reserved name and marks |
| `/.well-known/security.txt` | Machine-readable security contact on the deployed site |

The visitor-facing versions of these commitments live on the landing page under "Terms, privacy and ownership" and in Help.

---

## Hosted web app

The hosted app is a static Cloudflare Pages bundle. There are no Pages Functions, no accounts, and no server-side database.

| Layer | What protects it |
|---|---|
| Isolation | All persisted data lives in the browser IndexedDB database `sajas-web`, partitioned by browser profile and origin. Another profile, browser, device or private window starts empty. Tailoring runs in the page against `api.anthropic.com`; the key stays in the tab closure and the outbound header. Usage history is stored in IndexedDB without key material. |
| API key | The plaintext key is held in memory in a closure in `keyStore.js`. It is never written to localStorage, sessionStorage, cookies, URLs, logs or the backup. The optional Remember form stores only an AES-GCM blob in the `keyVault` store, unlocked by a passphrase that is never stored. |
| Key requests | Keyed requests go directly from the browser to `api.anthropic.com` in the `x-api-key` header. No code path sends the key to our origin, and the canary fails the build if the key appears in any request URL, body or header other than `x-api-key` to `api.anthropic.com`. |
| Backup | The export contains `profile`, `jobs`, `answers`, `memory`, `usage` and `meta`. It never contains `keyVault`. |
| Job links | Feed text and manually entered links keep only `http:` and `https:` URLs. `javascript:`, `data:` and `file:` values are stored as no link, so they cannot become clickable targets. |
| Response headers | Strict CSP (`script-src 'self'`, explicit `connect-src`, `frame-ancestors 'none'`, `base-uri 'none'`, `object-src 'none'`, `form-action 'self'`), `X-Frame-Options: DENY`, COOP and CORP `same-origin`, HSTS, `nosniff`, `no-referrer`, and a restrictive Permissions Policy. |
| Merge gate | `scripts/web-canary.mjs` fails the build if the key reaches the DOM, form values, iframes, URL, localStorage, sessionStorage, cookies, IndexedDB plaintext, the console, a backup export, or any request or header other than `x-api-key` to `api.anthropic.com`. It also proves CSP blocks a third-party script. `scripts/web-isolation.mjs` proves two browser contexts share nothing and that a quota failure is reported without persisting the failed write. `scripts/web-tailor.mjs` proves tailoring stays on `api.anthropic.com` with `anthropic-dangerous-direct-browser-access: true`, that the key is absent from storage and our origin, and that the budget guard stops a call. |
| Support reports | Generated only when the user clicks Get help or Email a report. The body contains the error code, safe message, request ID, time, page, surface, and browser. It excludes error details, the profile, jobs, documents, and the key. |

What our origin sees: requests for static assets only. There is no analytics, no telemetry and no user data on the origin.

What the app never sends to our origin: the API key, the CV, profile details, application answers, jobs, tracker state or backups.

### Ask Documents

The document corpus and the retrieval index are built in the page or the desktop process and are never uploaded to our origin. Only the passages retrieved for one question are sent inside the candidate's own Anthropic request. The index is never persisted, exported, or backed up. Saved documents are never sent to another user.

### Isolation contract for demo mode

The hosted demo is a separate runtime behind the same fetch seam as the real app. Its isolation is the feature, and every rule is enforced by a test.

1. **No real storage.** Demo mode never reads or writes the `sajas-web` IndexedDB vault. It uses its own vault over `sessionStorage` under the prefix `sajas:demo:`, or an in-memory adapter when `sessionStorage` is unavailable.
2. **No real key.** Demo mode never reads, holds, validates or requests a key. Its key store is a stub that reports a key is present so AI surfaces stay enabled, but returns no key material. The key panel is unreachable in demo mode.
3. **No network.** Feeds, AI output, hunter results and the application portal are local. A full demo walk makes zero requests outside the page origin.
4. **No bleed on exit.** Exit removes every `sajas:demo:` key, including progress, and switches the dispatcher back to the real runtime. The app then refetches from the real vault, which was never touched.
5. **No export.** Backup and data export are hidden in demo mode, so demo data cannot be written into a real backup.
6. **No generation path.** The demo never reaches the Anthropic SDK, `validateKey` or `keyCrypto`. Tailor, ask and check are answered by the simulation router, and a static test scans the demo module tree for forbidden imports.
7. **No collision with the desktop fixture.** `SYNTHETIC_DEMO`, `server/src/demo.js` and the desktop copilot are unchanged.

The real vault and the real key are never read by demo code. `scripts/check-demo-bundle.mjs` proves the demo bundle is lazy and absent from the entry chunk, `client/src/web/demo/isolation.test.js` enforces rules 2 and 6 and the `.test` fixture domains, and `scripts/web-demo.mjs` proves rules 1, 3, 4 and 5 in a browser, including a sentinel profile and job left untouched in the real vault.

### Free-plan limits

Cloudflare Pages free plan, checked on 2026-10-27: 500 builds per month, 20,000 files per deployment, 25 MiB maximum file size, and unmetered requests for static assets. This deployment has no Functions. Requests that invoke Functions are billed as Workers, with a free daily request allowance, which is one reason the app has none. Scaling, bot protection and the custom-domain checklist are in [OPERATIONS.md](OPERATIONS.md).

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
2. Email **erictshivhinda@gmail.com** with the subject line `[SA-JAS Security]`. The deployed site also publishes the same address in `/.well-known/security.txt`.
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
- **Backup import trusts the file's store shape, not every field.** A hand-edited backup can restore unusual values, including a `data:` apply link. Only import backups this app exported.
