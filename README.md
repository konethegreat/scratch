# SA-JAS — South African Job Agent Suite

> Find jobs. Tailor your CV. Submit applications — all from one desktop app.

SA-JAS is a three-agent automation suite for the South African job market. It finds live vacancies using **Claude grounded web search** (with 12 SA job-board scrapers as a fallback), rewrites your CV and cover letter with AI for each role, then opens a guided, **persistent** browser copilot that understands each page, fills the form, and walks multi-step applications — while always leaving the final Submit to you.

Packaged as an **Electron desktop app** (React frontend + Express backend).

Try the [repeatable synthetic application walkthrough](docs/DEMO.md):
`npm run demo` from `sa-job-agent-suite/` starts a disposable fictional profile
and local portal. The real copilot fills saved answers, attaches a PDF, learns a
missing question and leaves the final Submit to the human. Live searches and AI
calls are disabled. The guide includes dashboard and copilot screenshots.

This public repository is a clean source snapshot. Original private history is
preserved separately; it is not included here. Runtime key stores, profile data,
browser sessions, and generated documents are excluded. See [PUBLICATION.md](PUBLICATION.md).

Verified: the unit-test suites (`npm test`: the `@sajas/core` Anthropic layer, the
server, and the eval checks), a dry-run eval pass, the frontend production build,
Windows packaging and desktop startup from source and the packaged archive with
disposable user data.
The desktop check verifies the rendered UI, isolated preload and local API; it
does not install an NSIS package or exercise live job sites.
The tests use synthetic pages and data; no live job application or paid AI call
was performed. Behaviour against the live Anthropic API is checked separately by
`npm run smoke:live`, which needs your own key and spends a few cents.
An additional ten-result workflow regression exercises the real API and copilot,
including repeat-fill field integrity, the final submission guard, local receipt
recording and disposable-data cleanup. See [docs/DEMO.md](docs/DEMO.md).

| Agent | Role | Tech |
|-------|------|------|
| **1 · Job Hunter** | Primary engine: Claude grounded web search returns real SA vacancies with real source URLs. Fallback: 12 SA scrapers (Indeed SA, LinkedIn, PNet, CareerJunction, Gumtree SA, JobMail, Jobs.co.za, Google Jobs, National Government, Adzuna SA, Executive/Job Placements) with a schema.org JSON-LD safety net. | Anthropic web search + Playwright |
| **2 · Document Tailor** | Rewrites your base CV and drafts a 300–400 word cover letter per role, ATS-optimised, in SA English. Renders both to **PDF** for upload. | Anthropic Claude |
| **3 · Apply Copilot** | Visible browser with a persistent HUD. Autopilot understands each page (planner + optional vision), fills forms (deterministic + AI), attaches your CV PDF, advances multi-step flows, learns answers to new questions — never auto-submits, never solves CAPTCHAs. | Playwright + your Anthropic key |

A React dashboard sits on top: live agent terminal, KPI tiles, job pipeline, profile & settings, and a smart application-answers manager.

---

## Features

- **AI job search (grounded)**: Claude's live web search returns real vacancies with real apply links; the 12 scrapers run as a best-effort fallback. Token-aware scoring 0–100, saves ≥ 18, and a shared South Africa location classifier that rejects foreign jobs from every source and feed.
- **South Africa first, with real filters**: foreign jobs are hidden by default and counted, never deleted; filter the tracker by province, source, status, match score, link health, remote and date, and the choice persists across reloads.
- **AI tailoring** — Claude (Anthropic only; Sonnet 5.5 by default, per-task model overrides); ATS-friendly CVs + cover letters in SA English, rendered to PDF.
- **Ask Documents.** Ask questions and draft application answers from your own CV, letters, saved answers and notes. Answers cite the retrieved passage or refuse. A document check lists claims your sources do not support.
- **Persistent Apply Copilot** — a floating HUD that survives navigation and follows new tabs/popups (e.g. PNet's "I'm interested").
- **Auto-pilot** — fills each real form, attaches your CV PDF, and walks multi-step flows: on listing pages it may click Apply / I'm interested to reach the form, but once inside the application it only clicks Next / Continue / Proceed (a bare "Apply" or any Submit is left to you). Toggle on/off in the HUD.
- **Page understanding** — a per-page AI **planner** comprehends each page (form vs listing vs login) and decides what to do, instead of brittle keyword rules. Optional **vision fallback** (screenshot → multimodal model) for tricky/custom pages.
- **Smart-fill, 3 passes** — (1) deterministic fill from your structured profile + saved answers (no guessing on demographics/salary), (2) AI for free-text screening questions, (3) captures any unanswered required question so you answer it once.
- **Learn-as-you-go answer bank** — questions Agent 3 can't answer are saved to Settings; answer them once and they auto-fill on every future application across any site.
- **Structured application answers** — a guided questionnaire for the ~17 recurring SA questions (right to work, EE, notice period, salary, licence, etc.), with correct field types incl. dropdowns, radios, and checkboxes. ID/passport number is deliberately not stored.
- **Safety first** — never auto-submits, never auto-solves CAPTCHAs (detect-and-hand-off), scans pages for prompt-injection, and refuses to click final submit/pay controls.
- **Local-first & key-safe** — data lives in `db.json`; your Anthropic key lives separately in `keys.json` and is never returned to the client or bundled in the app.
- **Cost controls** — Token Saver / Balanced / Maximum presets, an optional daily budget that hard-stops AI calls, and a per-task cost and cache-hit report in Settings → AI & Cost. All figures are estimates; your Anthropic invoice is the source of truth.

---

## Quick start

Use Node.js 22.12 or newer (Node 24 LTS is used for Windows desktop CI).
The Electron downloader override selects version 5 to avoid the vulnerable
legacy downloader chain; the packaging check verifies builder compatibility.

```bash
# from sa-job-agent-suite/
npm run install:all        # workspace + client + server deps
npx playwright install chromium

npm run dev                # Express (5000) + Vite (4173) together
# or
npm run electron:dev       # Vite + Electron desktop window
npm run dist:win           # build + package a Windows installer

npm test                   # unit tests: core + server + eval checks (no network, no key)
npm run eval               # eval harness, dry run (fake client, spends nothing)
```

To verify the desktop without using your profile or API keys:

```bash
npm run build:client
npm run test:desktop
npx electron-builder --win --dir --publish never
npm run test:desktop -- release/win-unpacked/resources/app.asar
```

The check runs a hidden Electron window, blocks external requests and removes
its temporary user-data directory when it finishes. The bundled server and
runtime dependencies are unpacked beside `app.asar` so its Node child can use
real paths for its working directory and ESM imports.

| Service | URL |
|---------|-----|
| Dashboard (React / Vite) | http://localhost:4173 |
| API (Express) | http://localhost:5000 |

> Playwright launches a real Chromium process for Agents 1 and 3 — run locally, not on a headless VPS, if you want to interact with the apply window.

---

## Hosted web app (alpha)

The same React UI also builds as a static, server-less site:

```bash
# from sa-job-agent-suite/
npm run build:web                      # vite build --mode web, output client/dist/
npm run build:web && npm run test:web  # build, then run the local canary check
```

The alpha is a browser workbench, not the full suite: your profile, the job
tracker, candidate memory, settings, Job Feeds and Document Tailor work and
persist in this browser. Tailoring calls Anthropic directly with your own key
and never sends your documents to this site. Hunting and the apply copilot are
desktop features; the Copilot, Referrals, Routines and Logs tabs are hidden in
web mode. Job Hunter still appears, but its crawler controls are hidden and the
server-backed hunter actions answer with a typed "not available in the web app"
error.

### Tailoring in the browser

1. Add a standard Anthropic API key in the key panel. It stays in the tab.
2. Paste your base CV in Profile & Settings.
3. Open Document Tailor, pick a job, and choose Optimise CV & letter.
4. Copy, download the Markdown, or print to PDF.

Usage and estimated spend appear in Profile & Settings, and the daily cap stops
a run before the request when today reaches it. Company research and employer
notes remain desktop-only.

### Support

The landing page and the Help & Support tab list Kone's public contact details
and an FAQ. Every error toast offers Get help, which opens an email with the
error code, request ID, page, and browser. The report never includes your key,
profile, jobs, or documents.

### Job feeds and tracker

Job Feeds is a browser-only tab that pulls Remotive, Arbeitnow and Jobicy
directly into the page, then hands the ones you like to the tracker.

- The three feeds are public and keyless.
- Jobs are filtered in the browser; no profile data is sent.
- The app fetches up to 300 rows per feed and shows the top 100 in the tab.
  Results refresh at most every 15 minutes unless you press Refresh, and a full
  page reload fetches them again.
- Statuses and notes are local; export a backup before clearing site data.
- The backup file never contains the API key.

**Self-hosting.** `npx serve client/dist` does not apply `_headers`, so the CSP
and the other security headers are missing. Use a static host that serves that
file (Cloudflare Pages does), or copy the header block from
[`client/public/_headers`](sa-job-agent-suite/client/public/_headers) into your
host's own configuration. The web CSP allows no third-party scripts or fonts.

**Where your data lives.** Everything is in this browser's IndexedDB
(database `sajas-web`). There is no account and nothing is uploaded to us.
Export a backup from Profile & Settings before clearing site data or moving to
another device.

**Your key.** The Anthropic key is kept in memory only by default: enter it once
per session, and it is dropped on reload or after the idle timeout you choose
(15, 30 or 60 minutes; default 30). You can optionally save it as an encrypted
blob — AES-GCM with a key derived by PBKDF2-SHA-256 at 600,000 iterations, under
a passphrase you enter; the passphrase itself is never stored, so losing it
means re-entering the key. The key is never sent to our origin. The only request
that carries it is the HTTPS `x-api-key` header to `api.anthropic.com` (the key
check in this increment; AI calls are a later milestone). Revoke it any time in
the [Anthropic Console](https://console.anthropic.com/settings/keys).

**Panic wipe** in Profile & Settings clears all seven stores in this browser's
`sajas-web` database — the key, the encrypted blob, every job, your profile,
the dossier, answers, usage and meta. It cannot be undone.

**Deployment.** The alpha deploys to Cloudflare Pages as project `sajas`: the
build command is `npm run build:web`, run in `sa-job-agent-suite/` (that is
where the script lives; the repository root has no `package.json`), and the
output directory is `client/dist`.

**Browsers.** Current Chromium, Firefox and Safari with WebCrypto and
IndexedDB. Private/incognito windows may block or discard storage, so the key
and your data will not survive there.

---

## First-launch checklist

Open **Profile & Settings** and complete each section before running the Hunter.

1. **Anthropic API key** — SA-JAS is bring-your-own-key and Claude-only: one key powers job search, tailoring and the copilot. In the [Anthropic Console](https://console.anthropic.com) create a dedicated **Workspace** with a monthly **spend limit**, create a standard API key in that Workspace (an Admin key is rejected) and paste it into Settings. Keys are entered through the UI only (saved to `keys.json`). Optionally set a daily budget under Settings → AI & Cost.
2. **Personal info** — name, email, phone, LinkedIn, portfolio. Used to autofill forms.
3. **Search criteria** — comma-separated keywords and locations, plus max keywords/locations per run.
4. **Base CV** — paste or upload your full CV as text. Agent 2 rewrites it per role; the original is never changed.
5. **Standard application answers** — fill the guided questionnaire (right to work, EE, notice period, salary, licence, etc.). Optional but makes autopilot far more complete.

Save, return to the **Dashboard**, and click **Run Hunter**.

---

## How it works

### Agent 1 — Job Hunter
Runs Claude grounded web search first (`jobSearchAI.js`, SA-localized, real source URLs, no invented jobs), then the 12 Playwright scrapers as fallback — each with a schema.org/JobPosting JSON-LD net. Token-aware scoring keeps anything ≥ 18; the shared South Africa classifier rejects foreign locations for every source, and an unconfirmed location stays visible with a label. Cancellable mid-run.

### Source health

The 12 fallback job boards are visible on the Hunter tab with a per-board health status, so "this source quietly stopped returning jobs" is something you can see instead of guess. Each status has a plain-language reason:

- **Healthy** — the last hunt returned cards with titles and links.
- **Degraded** — it returned nothing before it had a baseline, many cards are missing company/location, or its yield dropped sharply against what it normally returns.
- **Broken** — it errored, returned nothing when it normally returns jobs, lost titles/links (a layout change), or its latest health check failed.
- **Blocked / Needs login** — the site showed a bot wall or a login wall. Sign in through the login browser for the latter.
- **Disabled / Unknown** — you turned the board off, or it has not run yet.

**Test sources** runs a one-page health check for every enabled board (about two seconds apart, no jobs are saved). The result is recorded on the board and in the source's history. A **Check source health (no hunting)** routine does the same thing on a schedule: it never hunts, tailors, applies or calls the AI, and it is skipped when another browser job (a hunt or an apply session) is already using the browser.

Two safety nets sit on top. After **three consecutive broken hunt runs** the circuit breaker opens and the Hunter skips that board until you press Reset; **two consecutive non-login blocks** put it on a 6-hour cooldown. Pages beyond page 1 are best-effort: every board's pagination parameter is marked **unverified** until a live run confirms the site honours it, so a board that only ever returns page 1 is still usable.

Maintainers can record one real page per board with `node scripts/hunter-record.mjs <sourceId> --yes` (from `sa-job-agent-suite/`; it visits the live site, writes a sanitised, gitignored fixture, and the adapter contract test then re-runs itself against that page).

### Agent 2 — Document Tailor
Rewrites the base CV for ATS keyword match and writes a 300–400 word cover letter per role (SA English, injection-hardened prompts), then renders both to PDF for upload. Status goes `tailoring → tailored`.

### Agent 3 — Apply Copilot
Opens a visible browser at `applyUrl` and injects a persistent HUD. Auto-pilot order of intelligence: (1) a real application form → smart-fill; (2) otherwise a cheap per-page **planner** call decides fill / click / wait / done; (3) an opt-in **vision** fallback when the planner is unsure; (4) keyword heuristics as a last resort. It fills forms, attaches the CV PDF, and clicks through multi-step flows — but never the final Submit, and it pauses on any CAPTCHA. Unanswered required questions are captured to Settings for next time.

### Data flow
```
Profile & Settings
   → Agent 1 (Hunt)   → db.json [jobs: found]
   → Agent 2 (Tailor) → db.json [jobs: tailored] + PDFs
   → Agent 3 (Apply)  → db.json [jobs: applied] + confirmation screenshot
```
All runs are async — the server returns immediately; the client polls every 3 s.

---

## Project structure

```
sa-job-agent-suite/
├── package.json              # npm workspaces root; scripts + electron-builder
├── .env                      # PORT only — no API keys (gitignored)
├── db.json                   # flat-file DB, auto-created (gitignored)
├── keys.json                 # API keys only, separate from db.json (gitignored)
├── browser-profile/          # persistent Playwright session (gitignored)
├── electron/                 # main.js (CommonJS) + preload.js
├── packages/core/            # @sajas/core: models, callClaude, costs, secrets, feeds, tailor prompts
├── evals/                    # eval harness (dry by default) + deterministic output checks
├── client/                   # React + Vite frontend
│   └── src/
│       ├── App.jsx               # all tabs, state, polling, modals
│       ├── ApplicationAnswers.jsx# questionnaire + answer bank + pending Qs
│       ├── main.jsx
│       └── index.css
└── server/                   # Express API + agents (ESM)
    └── src/
        ├── index.js          # routes, async agent dispatch
        ├── db/helper.js      # JSON store + answer-bank/pending helpers + usage ledger
        ├── db/migrations.js  # profile schema migrations
        └── agents/
            ├── agent1-hunter.js   # AI search + 13 scrapers + browser setup
            ├── agent2-tailor.js   # CV + cover letter + PDF
            ├── agent3-applier.js  # persistent HUD, autopilot, 3-pass smart-fill
            ├── pageBrain.js       # planner + vision fallback + clickButtonByText
            ├── jobSearchAI.js     # Claude grounded web_search engine
            ├── llm.js             # server adapter over @sajas/core: callLlm / callLlmFull / callLlmVision
            └── pdf.js             # Markdown → PDF
```
Runtime (gitignored): `generated-docs/` holds tailored PDFs + confirmation screenshots.

---

## API reference

Served from `http://localhost:5000`.

### Profile & application answers
| Method | Path | Description |
|--------|------|-------------|
| `GET` / `POST` | `/api/profile` | Read / save profile. The key is returned only as the `hasAnthropicKey` boolean; a malformed or Admin key is rejected with 400. |
| `DELETE` | `/api/profile/key/anthropic` | Delete the stored Anthropic key (returns `{ success: true }`). |
| `GET` | `/api/models` | The model registry used by the Settings pickers. |
| `GET` / `POST` | `/api/application/bank` | List / upsert a saved answer `{question, answer}`. |
| `DELETE` | `/api/application/bank/:id` | Delete a saved answer. |
| `GET` | `/api/application/pending` | List questions Agent 3 captured but couldn't answer. |
| `POST` | `/api/application/pending/:id/resolve` | Answer a pending question (saves to the bank). |
| `DELETE` | `/api/application/pending/:id` | Dismiss a pending question. |

### Jobs & agents
| Method | Path | Description |
|--------|------|-------------|
| `GET` / `POST` | `/api/jobs` | List (by score desc) / add manually. |
| `PATCH` / `DELETE` | `/api/jobs/:id` | Update / remove a job. |
| `DELETE` | `/api/jobs` | Clear all jobs. |
| `POST` | `/api/jobs/hunter` | Start Agent 1 (background; 409 if running). |
| `POST` | `/api/jobs/hunter/stop` | Cooperative cancel of a running hunt. |
| `POST` | `/api/jobs/:id/tailor` | Start Agent 2. |
| `POST` | `/api/jobs/:id/apply` | Start Agent 3 (opens a visible browser; one session at a time). |
| `POST` | `/api/browser/setup` | Open a visible browser to sign into SA job sites once. |
| `POST` | `/api/browser/login-status` | Check which sites are logged in. |

### Logs & status
| Method | Path | Description |
|--------|------|-------------|
| `GET` / `POST` | `/api/logs` · `/api/logs/clear` | Rolling in-memory logs / clear them. |
| `GET` | `/api/status` | `{ hunter, apply, uptime }`. |
| `GET` | `/api/health` | Liveness probe. |

---

## Configuration

`.env` in `sa-job-agent-suite/` carries **only** the port:

```env
PORT=5000
```

API keys are **never** put in `.env`. Enter them in Profile & Settings → saved to `keys.json` (desktop only; separate from `db.json`, gitignored, and never bundled in the packaged app). In packaged Electron, `db.json`, `keys.json`, and `browser-profile/` live under the OS user-data directory.

Key Agent 3 flags (Profile & Settings):
- **Smart page understanding (planner)** — default ON. One cheap text call per ambiguous page; capped per session.
- **AI vision fallback** — default OFF. Screenshots a page for Claude when the planner is unsure. Costs more.

---

## Anthropic API key setup

SA-JAS talks to one provider: Anthropic. You bring your own key, so you control the spend.

1. In the [Anthropic Console](https://console.anthropic.com), create a **Workspace** just for SA-JAS and set a **spend limit** on it.
2. Create an **API key in that Workspace** (a standard key starting `sk-ant-api`; Admin keys are refused).
3. Paste it into Profile & Settings → AI & Cost. It is stored only in `keys.json` on your machine (desktop only); delete it any time with the key's remove button.

| Model | Used for (default) | Price per million tokens (in / out) |
|-------|--------------------|--------------------------------------|
| Claude Haiku 5.5 | page planner; Token Saver's job search | $0.10 / $0.50 |
| Claude Sonnet 5.5 | job search, tailoring, form answers, memory, computer use | $2 / $10 |
| Claude Opus 5.5 | Maximum preset's job search (optional) | $4 / $20 |
| Claude Fable 5.1 | opt-in only | $10 / $50 |

Web search adds about $0.01 per search. Prices are the registry's estimates (`packages/core/src/models.js`); the Anthropic invoice is the source of truth. The same key powers job search, tailoring, the copilot's planner and the optional vision and computer-use features.

---

## Security & privacy

- **Keys** travel UI → `keys.json` only; the client sees booleans, never raw keys.
- **Never auto-submits** an application and **never solves CAPTCHAs** — challenges are detected, the window is brought forward, and the session waits for you.
- **Prompt-injection scanning** runs on every page; hidden manipulation text is flagged in the HUD. Form labels are treated as untrusted in all AI prompts.
- The planner can recommend a click, but the click policy (`submitGuard.js` / `controls.js`) refuses submit / send / finish / confirm / pay wording and account actions, and on a form page allows only Next / Continue / Proceed — the final action is always yours.
- **Demographics/salary are never guessed** — they're filled only from values you explicitly entered. ID/passport number is not stored.
- All data is local; the only outbound calls are to job sites (Playwright) and the Anthropic API.

---

## Tips & troubleshooting

### When something goes wrong

Every error card and every contract-driven error toast names a code, the cause and a fix. The most common:

| Code | What happened | What to do |
|---|---|---|
| `KEY_INVALID` / `KEY_ADMIN` | No key, a malformed key, or an Anthropic admin key | Paste a standard API key (`sk-ant-api…`) in Profile & Settings |
| `AUTH_REJECTED` | Anthropic rejected the key | Check or replace the key in Profile & Settings |
| `KEY_PERMISSION` | The key is valid but not allowed to use that model or feature | Enable the model in the Anthropic Console, or pick a different model |
| `SPEND_CAP` | The Anthropic account behind the key reached its spend or credit limit | Raise the limit in the Anthropic Console, or use a different key |
| `RATE_LIMITED` | Too many requests for this key | Wait about a minute, then Retry |
| `OVERLOADED` | Anthropic is busy or the request timed out | Retry in a moment |
| `BUDGET_EXCEEDED` | The daily AI budget is spent | Raise the cap in Settings → AI & Cost, or wait until tomorrow |
| `NETWORK_OFFLINE` / `CORS_BLOCKED` | The request never reached the service | Check the connection/proxy, then Retry |
| `STORAGE_FULL` / `STORAGE_UNAVAILABLE` | The browser blocked or filled local storage | Allow site data, free space, then reload |
| `CONFLICT` | Another run owns the browser, or this item already exists / the run is no longer active | Wait for the running job to finish; for a duplicate, open the existing item rather than retrying |

Click **Copy diagnostics** on any error card (or in Activity Logs → Recent
errors) to copy the code, request id and scrubbed detail. The log is memory-only
and disappears on reload.

**Hunter saved 0 jobs** — check the Run Summary on the Dashboard. Usually: AI search off, no Anthropic key, or keywords matched nothing. Enable AI search and add an Anthropic key.

**Autopilot typed into a search box / didn't enter the application** — fixed: it now skips search boxes, detects real forms, and clicks Apply/Continue on listing pages to reach the form. If a site is unusual, enable the vision fallback or click Apply yourself; it takes over from there.

**A field wasn't filled** — open Settings → Standard application answers. Anything the copilot couldn't answer is queued under "Questions to answer"; answer it once and it's remembered.

**Apply window opens on the server machine** — Agent 3 drives a real browser on the host running Express. Run locally.

**Costs** — deterministic fill is free; the planner is one small call per ambiguous page (capped, on Haiku by default); vision only fires when enabled and the planner is unsure. Use a performance preset and the daily budget in Settings → AI & Cost to keep spend predictable.

---

## Licence

MIT — go forth and apply.
