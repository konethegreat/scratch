# Data and privacy policy

This policy covers the hosted web app at https://sajas.pages.dev and the desktop build of SA-JAS. It describes what the software stores, where it stores it, and what leaves your device. The user-facing version of the same commitments is on the landing page under "Terms, privacy and ownership" and in Help.

Last reviewed: 30 October 2026.

---

## The short version

| Question | Answer |
|---|---|
| Do I need an account? | No. There are no accounts, passwords, or sign-in. |
| Where is my data? | In this browser (IndexedDB `sajas-web`) or, on desktop, in your OS user-data directory. |
| Does SA-JAS keep a copy? | No. There is no SA-JAS server and no server-side database. |
| Where is the API key? | In memory for the open tab, and optionally encrypted on this device behind your passphrase. It is sent only to `api.anthropic.com`. |
| What does Anthropic see? | The text of the task you run, under your own account and Anthropic's own policy. |
| Can I take it with me? | Yes. Backup exports profile, jobs, answers, memory, usage and meta as JSON. It never contains the key. |
| How do I delete it? | Clear everything in Profile and Settings, or clear this site's storage in the browser. |

---

## What is stored, and where

### Hosted web app

| Data | Store | Lifetime |
|---|---|---|
| Profile, jobs, documents, answer bank, candidate memory, usage estimates | IndexedDB `sajas-web` on this origin | Until you delete it or the browser evicts it |
| API key (plaintext) | A JavaScript closure in the open tab | Until the tab closes, or the idle-forget timeout fires |
| API key (saved) | `keyVault` record, AES-GCM encrypted with a PBKDF2 key from your passphrase | Until you forget it or clear site data |
| Theme choice, job filter defaults, dismissed notices | `localStorage` under the `sajas-` prefix | Until you clear site data |
| Demo-mode data | `sessionStorage` under `sajas:demo:` | Until the demo is exited or the tab closes |

No cookie carries user data. No analytics, telemetry, advertising ID, or fingerprinting script is loaded.

### Desktop build

| Data | Store |
|---|---|
| Profile, jobs, documents, memory, usage | `db.json` in the Electron user-data directory |
| API key | `keys.json`, separate from the database, never returned raw by an endpoint |
| Browser sessions for the Apply Copilot | `browser-profile/` (Playwright profile) |

`keys.json`, `db.json`, `.env` and `browser-profile/` are gitignored.

---

## What leaves your device

Four kinds of request, each triggered by an action you take:

1. **AI tasks.** Your prompt and the text it needs (for example a CV and a job description) go to `api.anthropic.com` with your key in the `x-api-key` header. Anthropic processes that text as the operator of its own service under its own terms. Nothing goes to the origin serving this site.
2. **Public job feeds.** The browser fetches Remotive, Arbeitnow and Jobicy directly. Their operators see your IP address and request headers, exactly as when you visit them.
3. **Application pages.** Opening an application loads the employer's site in your browser. The app fills a form only when you run the copilot, and it never presses Submit for you.
4. **Static assets.** Loading the app requests its own files from Cloudflare, which keeps standard access logs (IP address, requested path, user agent, timestamp, response status) under Cloudflare's policy. That is the only record the operator of this site can see, and it is not joined to any profile, document or key.

The key is never written to storage in plain text, never placed in a URL, log, backup or error report, and never sent to this site's origin. `scripts/web-canary.mjs` fails the build if any of that changes.

---

## Personal information and POPIA

SA-JAS is operated from South Africa as a personal project by Kone Tshivhinda, who acts as the responsible party and Information Officer for this processing.

- **Purpose.** Preparing job applications for the person using the app. Nothing else.
- **Lawful basis.** Your consent and your instruction: you enter the information, you press the buttons, you choose the model.
- **Minimality.** The hosted app keeps no server copy, so it cannot accumulate a database of candidates.
- **Cross-border transfer.** Anthropic may process text outside South Africa. Running an AI task instructs that transfer. You can use the app without AI features if you prefer.
- **Retention.** As long as your browser keeps the data. There is no remote retention to expire.
- **Security safeguards.** Origin isolation per browser profile, a strict Content Security Policy, an encrypted option for the saved key, no third-party scripts, and merge gates that test key containment on every pull request. See [SECURITY.md](SECURITY.md).
- **Your rights.** Under POPIA you may ask for access, correction or deletion of your personal information, object to processing, and complain to the Information Regulator (South Africa). Contact: https://inforegulator.org.za, inforeg@justice.gov.za. Because the data sits on your device, you can exercise access, correction and deletion directly in the app or in the browser's site-data settings.
- **Direct marketing.** None. No mailing list, no newsletter, no advertising.
- **Children.** The app is not directed at children under 18.

Write to erictshivhinda@gmail.com for any privacy request or complaint that the in-app controls do not answer.

---

## Data the app deliberately does not collect

- No analytics or telemetry service.
- No advertising or tracking cookies.
- No crash reports sent anywhere. Recent errors are held in memory for the Error Card and the optional diagnostics email, which you must send yourself.
- No usage history joined to an identity. The usage store is local, has no key material, and is not transmitted.
- No CVs, answers, documents or jobs on the origin.

---

## Backups and deletion

- **Backup** exports a JSON file from Profile and Settings. It contains profile, jobs, answers, memory, usage and meta. It does not contain the key or the key vault.
- **Clear everything** deletes jobs, saved answers, pending questions and candidate memory after a confirmation. Profile and documents are kept.
- **Full deletion** means clearing this site's storage in the browser, which removes IndexedDB, `localStorage` and any saved key blob. There is no recovery path after that except a backup file you kept.

---

## Changes

This policy changes with the product. The review date at the top changes with it, and the beta notice in the app returns when the terms change materially.
