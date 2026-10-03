# Security Policy

SA-JAS is a local-first desktop application. All data — your CV, contact details, API keys, scraped jobs — stays on your own machine. Nothing is sent to any SA-JAS server because there isn't one.

---

## Architecture security model

| Layer | What protects it |
|---|---|
| API keys | Stored in `keys.json`, never in `db.json`. Never returned raw from any API endpoint (boolean `hasGeminiKey` flag only). Never sent to portal pages. |
| CV and personal data | Stored in `db.json` in your OS user-data directory. Never leaves your machine except as input to the AI provider you chose. |
| Browser sessions | Persistent Playwright profile in `browser-profile/`. On Windows with real Chrome, cookies are DPAPI-encrypted and tied to your local Windows account. |
| AI prompts (Agent 2) | Every prompt begins with an injection shield. The job description is wrapped in `[BEGIN UNTRUSTED JOB DESCRIPTION]` / `[END UNTRUSTED JOB DESCRIPTION]` markers. Any directives found inside are treated as plain text, not instructions. |
| Apply portal pages (Agent 3) | DOM injection scanner runs before HUD injection, looking for hidden elements (display:none, opacity<0.1, fontSize<2px) that match known manipulation patterns. Only `{ title, company, autofill, tailoredCvText, tailoredCoverLetterText }` enter `page.evaluate` — `baseCv` and API keys never touch the portal page context. Scraped strings are HTML-escaped before insertion into innerHTML. `applyUrl` is validated to `http://` or `https://` before navigation — `javascript:`, `file://`, and `data:` schemes are rejected. |
| Electron renderer | `contextIsolation: true`, `nodeIntegration: false`. External links open in the system browser via `shell.openExternal`, not inside the app window. |
| Git history | `keys.json`, `db.json`, and `browser-profile/` are gitignored. `.env` carries `PORT` only — no secrets. |

---

## Routines (unattended automation) — safety model

Routines run agents **without a human watching**, so they are deliberately constrained. The guiding rule: a routine may *find and prepare*, never *act irreversibly*.

| Risk | Guard in place |
|---|---|
| **Auto-submitting an application unattended** | Routines can only be type `hunt` or `hunt_and_tailor`. They **never invoke Agent 3 and never submit anything**. Enforced in both `helper.js` (`ROUTINE_TYPES`) and `routineRunner.js`. The apply step stays a manual, supervised human action — the core human-on-the-loop guarantee is preserved. |
| **Runaway API cost from a bad schedule** | `every_n_hours` has a hard 1-hour floor; `autoTailorCount` is capped at 10; only **one** routine runs per 60-second tick and only **one** at a time. Auto-tailoring is **skipped silently when no provider key is set**, so a routine can never half-run and burn credit. |
| **Unattended run colliding with the user** | Before executing, a routine checks the global `hunterState`/`applyState`. If the user is already hunting or applying, the routine **defers** (marked `skipped`) and retries next tick — it never runs two browsers or two hunts at once. |
| **Cost the user didn't opt into** | Every paid feature is opt-in and per-routine: "Find only" does no tailoring; "Find & tailor N" is an explicit, capped choice. The provider/model and AI-search toggles still apply, so the user controls exactly which tokens are spent. |
| **A crash taking down the server** | The runner is fully best-effort: any error is caught, logged, and recorded on the routine (`lastStatus: 'error'`); it never propagates to crash the Express process. |
| **Silent failure** | Every run writes `lastRun` / `lastStatus` / `lastResult` to the routine and streams start/finish lines to the Activity Console, so unattended work is always auditable after the fact. |

**Residual risks to be aware of:** routines only run while the app is open (a desktop app isn't a server) — missed daily runs catch up on next open if enabled, but a routine is not a guaranteed cron. Auto-tailored documents are still drafts: the user must review them before applying, exactly as with manual tailoring. The injection-shield and DOM-scanner limitations below apply unchanged to routine-driven hunts.

---

## Computer-use form filler — safety model

The optional computer-use finisher (Anthropic only, off by default) lets the model *see and operate* the live form. Because it can move the mouse and type, its guardrails are enforced in **code**, not just the prompt:

| Risk | Guard in place |
|---|---|
| **Model clicks the final Submit / Apply / Pay** | Every click is hit-tested: the element under the cursor (and its button/anchor ancestor) is read via `document.elementFromPoint`, and if its visible text matches the submit/finish/pay pattern the click is **refused** and the model is told to leave it for the human. A coordinate click cannot bypass this — it's the same hard line as the rest of Agent 3. The system prompt also forbids submitting. |
| **Solving a CAPTCHA / passing human-verification** | The loop checks the page text each step and **stops** on CAPTCHA / "verify you are human" / login wording. It never attempts a challenge. |
| **Wandering off the page / opening tabs / runaway cost** | The prompt restricts it to filling the current form; it's bounded by a per-form **step cap** (1–25, default 12 — each step is one screenshot + model call), so cost is predictable and capped. |
| **Invented personal data** | It's grounded only on the candidate data block (structured profile + tailored cover letter); the prompt forbids inventing identifiers (ID numbers, salaries) not provided. |
| **Sending sensitive data off-device** | Screenshots of the form go to Anthropic (the chosen provider) for the duration of the loop — the same trust boundary as any AI call in the app. No API keys or raw base-CV dump are placed in the page context. |

**Residual risks:** click accuracy depends on the screenshot resolution and `devicePixelRatio` — a very large/scaled window can misplace a click (mitigated by the submit-guard, which refuses dangerous targets regardless). It is Anthropic-only and the most token-intensive feature, hence opt-in and step-capped. As always, the human makes the final submit.

---

## Reporting a vulnerability

SA-JAS is free, open-source software run entirely on your own machine. There is no hosted service to attack. Even so, security bugs in the local app matter — a malicious job listing could attempt to exploit the scraper or the Apply Copilot.

**To report a vulnerability:**

1. **Do not open a public GitHub issue** if the report contains a working exploit or sensitive details.
2. Email **erictshivhinda@gmail.com** with the subject line `[SA-JAS Security]`.
3. Include:
   - A description of the vulnerability
   - Steps to reproduce
   - The component affected (Agent 1 / 2 / 3, Electron shell, server API)
   - Potential impact

You will receive a response within **7 days**. If a fix is warranted, a patched release will follow with credit to you in the changelog (unless you prefer to remain anonymous).

---

## Scope

| In scope | Out of scope |
|---|---|
| Prompt injection via scraped job content | Attacks requiring physical access to the user's machine |
| XSS in the Apply Copilot HUD | Vulnerabilities in third-party job sites (report to them) |
| URL injection via `applyUrl` | Rate-limiting or scraping fairness on job sites |
| Electron context isolation bypass | Social engineering of the user |
| Local data exfiltration via crafted job listings | Denial of service against the local server |

---

## Known limitations

- **Injection scanner is heuristic.** The DOM scanner in Agent 3 matches text patterns and visibility styles. It can be bypassed by Unicode homoglyphs, zero-width characters, or novel phrasing. It is a warning layer, not a block.
- **AI providers are third-party.** Your CV and job description are sent to Google (Gemini), Anthropic, or OpenRouter depending on your chosen provider. Review each provider's data retention and privacy policies before use.
- **Local API has no authentication.** The Express server listens on `localhost:5000` and trusts all requests. This is intentional for a single-user desktop app. Do not expose this port to a network.
- **`browser-profile/` contains live session cookies.** Treat this directory with the same sensitivity as saved passwords. The `.gitignore` excludes it, but be careful with backups and file-sharing tools.
