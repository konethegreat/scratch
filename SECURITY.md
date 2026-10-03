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
