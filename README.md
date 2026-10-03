# SA-JAS — South African Job Agent Suite

> Find jobs. Tailor your CV. Submit applications — all from one desktop app.

SA-JAS is a three-agent automation suite for the South African job market. It finds live vacancies using **Claude grounded web search** (with 13 SA job-board scrapers as a fallback), rewrites your CV and cover letter with AI for each role, then opens a guided, **persistent** browser copilot that understands each page, fills the form, and walks multi-step applications — while always leaving the final Submit to you.

Packaged as an **Electron desktop app** (React frontend + Express backend).

This public repository is a clean source snapshot. Original private history is
preserved separately; it is not included here. Runtime key stores, profile data,
browser sessions, and generated documents are excluded. See [PUBLICATION.md](PUBLICATION.md).

Verified for this snapshot: 65 server tests and the frontend production build.
The tests use synthetic pages and data; no live job application or paid AI call
was performed. Provider/model compatibility needs a separate configured check.

| Agent | Role | Tech |
|-------|------|------|
| **1 · Job Hunter** | Primary engine: Claude grounded web search returns real SA vacancies with real source URLs. Fallback: 13 SA scrapers (Careers24, Indeed SA, LinkedIn, PNet, CareerJunction, Gumtree SA, JobMail, Jobs.co.za, Google Jobs, National Government, Adzuna SA, Executive/Job Placements) with a schema.org JSON-LD safety net. | Anthropic web search + Playwright |
| **2 · Document Tailor** | Rewrites your base CV and drafts a 300–400 word cover letter per role, ATS-optimised, in SA English. Renders both to **PDF** for upload. | Gemini · Anthropic Claude · OpenRouter |
| **3 · Apply Copilot** | Visible browser with a persistent HUD. Autopilot understands each page (planner + optional vision), fills forms (deterministic + AI), attaches your CV PDF, advances multi-step flows, learns answers to new questions — never auto-submits, never solves CAPTCHAs. | Playwright + your AI key |

A React dashboard sits on top: live agent terminal, KPI tiles, job pipeline, profile & settings, and a smart application-answers manager.

---

## Features

- **AI job search (grounded)** — Claude's live web search returns real vacancies with real apply links; the 13 scrapers run as a best-effort fallback. Token-aware scoring 0–100, saves ≥ 18, lenient SA-location filter.
- **AI tailoring** — swappable backends (Gemini, Anthropic, OpenRouter); ATS-friendly CVs + cover letters in SA English, rendered to PDF.
- **Persistent Apply Copilot** — a floating HUD that survives navigation and follows new tabs/popups (e.g. PNet's "I'm interested").
- **Auto-pilot** — fills each real form, attaches your CV PDF, and clicks Apply / I'm interested / Continue / Next to walk multi-step flows. Toggle on/off in the HUD.
- **Page understanding** — a per-page AI **planner** comprehends each page (form vs listing vs login) and decides what to do, instead of brittle keyword rules. Optional **vision fallback** (screenshot → multimodal model) for tricky/custom pages.
- **Smart-fill, 3 passes** — (1) deterministic fill from your structured profile + saved answers (no guessing on demographics/salary), (2) AI for free-text screening questions, (3) captures any unanswered required question so you answer it once.
- **Learn-as-you-go answer bank** — questions Agent 3 can't answer are saved to Settings; answer them once and they auto-fill on every future application across any site.
- **Structured application answers** — a guided questionnaire for the ~17 recurring SA questions (right to work, EE, notice period, salary, licence, etc.), with correct field types incl. dropdowns, radios, and checkboxes. ID/passport number is deliberately not stored.
- **Safety first** — never auto-submits, never auto-solves CAPTCHAs (detect-and-hand-off), scans pages for prompt-injection, and refuses to click final submit/pay controls.
- **Local-first & key-safe** — data lives in `db.json`; API keys live separately in `keys.json` and are never returned to the client or bundled in the app.

---

## Quick start

```bash
# from sa-job-agent-suite/
npm run install:all        # workspace + client + server deps
npx playwright install chromium

npm run dev                # Express (5000) + Vite (4173) together
# or
npm run electron:dev       # Vite + Electron desktop window
npm run dist:win           # build + package a Windows installer
```

| Service | URL |
|---------|-----|
| Dashboard (React / Vite) | http://localhost:4173 |
| API (Express) | http://localhost:5000 |

> Playwright launches a real Chromium process for Agents 1 and 3 — run locally, not on a headless VPS, if you want to interact with the apply window.

---

## First-launch checklist

Open **Profile & Settings** and complete each section before running the Hunter.

1. **AI provider + key** — pick Gemini, Anthropic, or OpenRouter and paste your key. Keys are entered through the UI only (saved to `keys.json`). Gemini has a free tier.
2. **Anthropic key (for AI search)** — the Job Hunter's primary engine uses Claude web search, which needs an Anthropic key (independent of your tailoring provider).
3. **Personal info** — name, email, phone, LinkedIn, portfolio. Used to autofill forms.
4. **Search criteria** — comma-separated keywords and locations, plus max keywords/locations per run.
5. **Base CV** — paste or upload your full CV as text. Agent 2 rewrites it per role; the original is never changed.
6. **Standard application answers** — fill the guided questionnaire (right to work, EE, notice period, salary, licence, etc.). Optional but makes autopilot far more complete.

Save, return to the **Dashboard**, and click **Run Hunter**.

---

## How it works

### Agent 1 — Job Hunter
Runs Claude grounded web search first (`jobSearchAI.js`, SA-localized, real source URLs, no invented jobs), then the 13 Playwright scrapers as fallback — each with a schema.org/JobPosting JSON-LD net. Token-aware scoring keeps anything ≥ 18; foreign-only locations are rejected. Cancellable mid-run.

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
├── client/                   # React + Vite frontend
│   └── src/
│       ├── App.jsx               # all tabs, state, polling, modals
│       ├── ApplicationAnswers.jsx# questionnaire + answer bank + pending Qs
│       ├── main.jsx
│       └── index.css
└── server/                   # Express API + agents (ESM)
    └── src/
        ├── index.js          # routes, async agent dispatch
        ├── db/helper.js      # JSON store + answer-bank/pending helpers
        └── agents/
            ├── agent1-hunter.js   # AI search + 13 scrapers + browser setup
            ├── agent2-tailor.js   # CV + cover letter + PDF
            ├── agent3-applier.js  # persistent HUD, autopilot, 3-pass smart-fill
            ├── pageBrain.js       # planner + vision fallback + clickButtonByText
            ├── jobSearchAI.js     # Claude grounded web_search engine
            ├── llm.js             # callLlm + callLlmVision + providerSupportsVision
            └── pdf.js             # Markdown → PDF
```
Runtime (gitignored): `generated-docs/` holds tailored PDFs + confirmation screenshots.

---

## API reference

Served from `http://localhost:5000`.

### Profile & application answers
| Method | Path | Description |
|--------|------|-------------|
| `GET` / `POST` | `/api/profile` | Read / save profile. Keys returned only as `hasGeminiKey` / `hasAnthropicKey` / `hasOpenRouterKey` booleans. |
| `DELETE` | `/api/profile/key/:provider` | Delete a stored key (`gemini` / `anthropic` / `openrouter`). |
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
| `GET` | `/api/browser/login-status` | Check which sites are logged in. |

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

API keys are **never** put in `.env`. Enter them in Profile & Settings → saved to `keys.json` (separate from `db.json`, gitignored, and never bundled in the packaged app). In packaged Electron, `db.json`, `keys.json`, and `browser-profile/` live under the OS user-data directory.

Key Agent 3 flags (Profile & Settings):
- **Smart page understanding (planner)** — default ON. One cheap text call per ambiguous page; capped per session.
- **AI vision fallback** — default OFF. Screenshots a page for a multimodal model when the planner is unsure. Costs more; Gemini/Anthropic only.

---

## AI provider setup

| Provider | Get a key | Suggested model | Vision? |
|----------|-----------|-----------------|---------|
| **Gemini** (free tier) | https://aistudio.google.com | `gemini-1.5-flash` | Yes |
| **Anthropic Claude** | https://console.anthropic.com | `claude-3-5-sonnet-latest` | Yes |
| **OpenRouter** | https://openrouter.ai | `deepseek/deepseek-chat` (free) | No (text-only) |

The Job Hunter's AI search specifically needs an **Anthropic** key (Claude web search), independent of whichever provider you pick for tailoring and form-filling. The vision fallback only works on Gemini/Anthropic and is skipped automatically on OpenRouter.

---

## Security & privacy

- **Keys** travel UI → `keys.json` only; the client sees booleans, never raw keys.
- **Never auto-submits** an application and **never solves CAPTCHAs** — challenges are detected, the window is brought forward, and the session waits for you.
- **Prompt-injection scanning** runs on every page; hidden manipulation text is flagged in the HUD. Form labels are treated as untrusted in all AI prompts.
- The planner can recommend a click, but `clickButtonByText()` refuses submit / send / finish / confirm / pay wording — the final action is always yours.
- **Demographics/salary are never guessed** — they're filled only from values you explicitly entered. ID/passport number is not stored.
- All data is local; the only outbound calls are to job sites (Playwright) and your chosen AI provider.

---

## Tips & troubleshooting

**Hunter saved 0 jobs** — check the Run Summary on the Dashboard. Usually: AI search off, no Anthropic key, or keywords matched nothing. Enable AI search and add an Anthropic key.

**Autopilot typed into a search box / didn't enter the application** — fixed: it now skips search boxes, detects real forms, and clicks Apply/Continue to reach the form. If a site is unusual, enable the vision fallback or click Apply yourself; it takes over from there.

**A field wasn't filled** — open Settings → Standard application answers. Anything the copilot couldn't answer is queued under "Questions to answer"; answer it once and it's remembered.

**Apply window opens on the server machine** — Agent 3 drives a real browser on the host running Express. Run locally.

**Costs** — deterministic fill is free; the planner is one small call per ambiguous page (capped); vision only fires when enabled and the planner is unsure.

---

## Licence

MIT — go forth and apply.
