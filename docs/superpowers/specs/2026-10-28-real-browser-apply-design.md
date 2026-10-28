# Real-Browser Auto-Apply: Design

**Status:** shipped 2026-10-28
**Date:** 2026-10-28
**Arc:** 8 of the post-M3a-3 pipeline
**Sources of truth:** [`2026-10-27-post-m3a3-pipeline.md`](2026-10-27-post-m3a3-pipeline.md) section "Arc 8", `SECURITY.md`, `POLICY.md`, and the user's decisions of 2026-10-28.

## Goal

Help the candidate complete a real job application without taking control away from them. The hosted web app gets a safe guided apply packet that works on every board. The desktop copilot gains per-site session consent, a final review step, a confirmed submit, and an exact record of what was sent.

## Feasibility decision

The gate compared three delivery forms. The decision is recorded here and implemented as described.

| Form | Verdict | Reason |
|---|---|---|
| Guided apply packet on the web | **Chosen** | A page cannot script another origin's form, so the web app prepares answers, documents and a checklist instead. It reaches every visitor on every board and needs no permissions or install. |
| Hardened desktop copilot | **Chosen** | The copilot already walks multi-step forms in a real browser with smart-fill, uploads and injection scanning. It is the only existing automation, and it ships in the packaged desktop app that CI already builds and starts. |
| Browser extension | **Rejected** | Needs store review or developer-mode install, broad host permissions, and a second automation stack to maintain. Its advantage over the existing desktop copilot does not justify that cost for this arc. |
| Desktop only | **Rejected** | Public visitors on the hosted app would still have no apply path. |
| Web only | **Rejected** | Leaves the existing copilot without consent, a safe finish or submission recording. |

The extension is not prohibited forever. A later arc may revisit it with its own feasibility gate.

## Scope

In scope:

- A shared core apply packet used by both delivery forms.
- A web guided apply tab: per-field copy sheet, documents, checklist, open portal, Mark applied.
- Per-site session consent with Connect and Disconnect, reusing the persistent Chromium profile.
- A desktop final review with an explicit in-app confirmation, then one confirmed submit click.
- Submission recording for both forms.
- Offline evidence: unit tests, a web Playwright proof and a desktop fixture rehearsal with screenshots.

Out of scope:

- CAPTCHA solving or bypass, proxy rotation, fingerprint spoofing.
- Bulk or unattended applying. Routines still never launch Agent 3.
- Credential collection. The app never asks for, stores or transmits site passwords.
- A browser extension.
- Scripting a third-party page from the hosted web app.
- Editing or overwriting a submitted application.
- New runtime dependencies. This arc uses Node built-ins, existing Playwright and the existing React stack.

## Architecture

```
profile + job + answers + documents
                  |
        @sajas/core/apply  (pure packet)
          |                    |
   web Apply tab        desktop final review
   copy + checklist     confirm dialog -> confirmed submit
          |                    |
   POST /jobs/:id/applied  recordApplication + snapshot
```

One packet definition means both surfaces agree on the fields and documents that make up an application. Delivery differs; the record does not.

## Core packet

New subpath export `@sajas/core/apply` in `packages/core/src/apply/`. Pure: no network, no AI, no browser.

`buildApplyPacket({ profile, job, answerBank = [], supportingDocs = [] })` returns:

```js
{
  job: { id, title, company, applyUrl, site },        // site = hostname or ''
  identity: [{ key, label, value }],                   // contact fields
  questions: [{ key, label, value, source }],          // source: 'profile' | 'answer-bank'
  documents: [{ key, label, fileName, available }],    // tailored CV, letter, supporting docs
  checklist: [{ key, label, done }],                   // portal steps and open questions
  warnings: [string]                                  // plain-language gaps
}
```

Rules:

- Only values the user declared appear. Nothing is inferred from a CV or a keyword.
- ID and passport numbers are never included. The packet lists them in the checklist as "paste per application".
- Empty high-value answers (salary, notice period, right to work) produce a checklist item and a warning, not a guess.
- Strings are trimmed, control characters removed, and capped (values 500 characters, labels 120).
- `site` is the lowercased hostname from the apply URL, or empty when there is no URL.
- `documents[].available` is true only when the source says a file exists. The tailored CV and letter are available when their text is non-empty.

`summariseSubmission(packet, { delivery, submittedBy, fields })` returns the record payload described under Recording.

## Web guided apply

A new `Apply` tab in the web build, hidden on desktop where the copilot lives.

- Job picker limited to saved jobs with tailored documents (the same rule the copilot uses).
- Sections: Your details, Application questions, Documents, Before you apply.
- Every value has a Copy button. Copy uses the clipboard API with a selectable fallback when the API is unavailable or blocked.
- Documents: copy the tailored CV text, copy the cover letter text, and print either one. Supporting documents show their file name when the web store has metadata.
- "Open application" opens the portal URL in a new tab with `noopener noreferrer`. The app never scripts the portal.
- "Mark applied" calls `POST /jobs/:id/applied` with the packet summary, sets job status to `applied`, and records the submission. It asks for confirmation first because it is a real record.
- The tab states plainly that the hosted app cannot fill another site's form and that the user applies on the portal themselves.

## Desktop sessions and consent

A single site registry (`server/src/hunter/loginSites.js`) holds the known boards: key, label, login URL, check URL, origins and signed-in detection. The existing login browser and login-status check are refactored onto it so there is one list, not three.

Consent is stored in the local database under `siteConsent`:

```js
{
  [siteKey]: { siteKey, label, origin, connectedAt, method: 'login' }
}
```

- `POST /api/sites/:key/connect` acquires the browser lock, opens a visible browser on the site's login page with the persistent profile, and polls the signed-in check. On success it records consent. If the window closes or five minutes pass without a session, nothing is recorded and the response says so plainly.
- `POST /api/sites/:key/disconnect` acquires the browser lock, clears cookies and site storage for the site's origins through the Chromium DevTools protocol, then deletes the consent entry. It reports what it cleared.
- `GET /api/sites` returns the registry with `connected` and the consent timestamp.
- The Profile settings section "Job site logins" replaces the old open-login-browser button with a row per site and Connect or Disconnect. The shared registry still powers the sign-in status check.
- The copilot uses the persistent profile only when the apply URL's host matches a site with consent. A host matches when it equals the site origin's host or is a subdomain of it, so `za.indeed.com` and `www.indeed.com` both match the Indeed entry. Otherwise it launches a temporary context with no saved cookies and logs: "This site is not connected. The copilot is using a temporary session; connect the site under Job site logins to reuse your login."
- The app never sees or stores a site password. Consent records a domain and a time, nothing more.

## Desktop confirmed submit

Today the copilot never clicks a submit control. Arc 8 adds one narrow, confirmed path and keeps every other path blocked.

Detection:

- The copilot is inside an application (`isApplicationForm` or a page was filled).
- A control classifies as `final-submit` (`submitGuard.classifyControl`).
- No advance control is available on the page.
- No challenge is present.

When all four hold, the copilot does not click. It captures a pre-submit snapshot, stores a pending confirmation, and waits.

Pending confirmation lives in `applyState.pendingConfirmation`:

```js
{
  nonce,            // one-time UUID
  jobId, jobTitle, company, site,
  pageUrl,
  controlText,
  fieldsFilled,     // count
  documents,        // file name strings
  createdAt, expiresAt  // 2 minutes
}
```

The client polls `/status` every 3 seconds. When `apply.pendingConfirmation` is present it shows a modal naming the job, the company and the site, the number of filled fields, and the attached documents, with Confirm submit and Keep editing. It never displays field values.

- `POST /api/apply/confirm` with `{ nonce }` marks the confirmation approved.
- `POST /api/apply/confirm` with `{ nonce, cancel: true }` clears it and resumes supervision; the same page is not offered again in this session.
- Confirmation is refused when the nonce is unknown, expired, already used, belongs to another job or session, or the page origin changed.

On approval, the copilot:

1. Re-lists controls and confirms the control text and index are unchanged. A relabel or move aborts with "The form changed since you reviewed it. Nothing was submitted."
2. Verifies the page URL origin matches the pending record.
3. Captures the field snapshot: visible filled controls as `{ label, value }`, capped at 80 fields with 500 characters per value, plus attached file names.
4. Clicks the submit control exactly once through `clickSubmitControl`, which refuses any call without `confirmed: true`.
5. Waits up to 60 seconds for the existing confirmation detection. On success it saves the screenshot and records the application. On timeout it logs "Submit was clicked but the site did not confirm it. Check the browser, then mark the application applied if it went through." and records nothing.

Hard rules:

- Autopilot, the planner, vision and computer-use still cannot click a final submit. Their policy modules are unchanged.
- A confirmed submit is never retried automatically.
- A challenge that appears while a confirmation is pending blocks the click. The copilot waits for the challenge to clear and never clicks through it.
- Closing the window cancels everything. No submit happens after the user closes the copilot.

## Recording

`recordApplication` gains optional fields and keeps existing records valid:

```js
{
  delivery: 'web-guided' | 'desktop-copilot',
  submittedBy: 'user' | 'copilot-confirmed',
  site,
  documents: [{ key, fileName }],
  fields: [{ label, value }],        // desktop: actual, web: packet values shown to the user
  confirmation: { confirmedAt, text } // text may be empty
}
```

- The desktop record uses the pre-submit snapshot and `submittedBy: 'copilot-confirmed'` when the copilot clicked, or `'user'` when the user submitted and the copilot only detected the confirmation page.
- The web record uses the packet fields the user was shown, documents that were available, and `submittedBy: 'user'`.
- Both set the job to `applied` with `appliedAt`. The desktop form keeps the existing salary snapshot and transcript behaviour; the web form records an empty transcript because the web app cannot observe the portal's questions.
- `POST /jobs/:id/applied` is implemented on the desktop server and in the web API router. The web implementation writes the same fields into the local memory application record.
- The snapshot stays on the device. It is never logged, never sent to an AI provider and never added to `/status`.

## Safety and privacy rules

- No CAPTCHA bypass. A challenge pauses everything and brings the browser forward.
- No bulk applying. One session at a time, launched by a person, never by a routine.
- No credential harvesting. The app never asks for a site password and never reads one.
- No hidden submission. Every submit requires a fresh in-app confirmation that names the job and site.
- The web app makes no request to the portal. It only opens the URL and copies text locally.
- No new secret leaves the device. The API key rules are unchanged, and this arc adds no provider calls.
- Consent is required before a saved login is reused. Disconnect clears cookies and storage for that site.
- A local record may contain the user's own application answers. It lives in `db.json` or IndexedDB, is never uploaded, and is removed by the existing data clearing features.

## Error handling and copy

Plain language, no em dashes in user-facing text. Examples:

- "This site is not connected. The copilot is using a temporary session. Connect the site to reuse your login."
- "The form changed since you reviewed it. Nothing was submitted. Review the page and try again."
- "Submit was clicked but the site did not confirm it. Check the browser, then mark the application applied if it went through."
- "The confirmation expired. Review the page and confirm again."
- "Could not clear the saved session for this site. Close any open browser window for it and try again."

## Testing and evidence

Offline only. No live application is submitted by a test.

Unit:

- Packet: complete profile, sparse profile, no documents, no apply URL, answer bank merged, values capped, ID and passport absent.
- Record summary: additive fields, existing records still valid.
- Site registry: keys, origins and detection labels are unique and complete.
- Consent store: set, read, remove, corrupt input tolerated.
- Confirmation state: issue, expire, one-time use, wrong job, wrong origin, cancel.
- Submit guard: unchanged paths still refuse final submit; confirmed path requires the flag.

Browser proofs (Playwright, local fixtures, no network):

- Web apply: seed a job with tailored documents in the web store, open the Apply tab, copy a field and a document, open the fixture URL in a new tab, Mark applied, and assert the job status and the recorded delivery. Screenshot the packet and the confirmation.
- Desktop rehearsal: a local fixture form with two steps, fields, a file input and a final Submit. Run the copilot headless with the fixture, verify the pending confirmation appears, confirm through the API, verify the submit click, the confirmation page, the record and the screenshot. Also verify cancel and page-changed paths submit nothing.
- Session consent: connect and disconnect against a local fixture origin, asserting cookies are cleared and the record is removed.

Gates: `npm test`, `npm run test:web`, `npm run test:desktop`, `node tools/check-secrets.mjs`. No live smoke and no provider key.

## Acceptance mapping

| Pipeline criterion | Where it is met |
|---|---|
| Written feasibility decision names the chosen form and rejected options | This section, and the README section added in Task 8 |
| Chosen form completes a rehearsal against a local fake form with screenshots | Web proof and desktop fixture rehearsal, both offline |
| User confirms before any real submission and the app records what was submitted | Confirmation modal, one-time nonce, pre-submit snapshot, recording fields |
| No new secret leaves the device | No provider calls, no passwords, local-only record |
| No third-party page is scripted without an explicit user action | Web never scripts; desktop opens only after a person clicks Launch and submits only after a second explicit confirmation |
