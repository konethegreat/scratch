# Automation and Data Depth: Design

**Status:** proposed, awaiting approval
**Date:** 2026-11-01
**Arc:** 12 onward
**Sources of truth:** the user's decisions of 2026-11-01, [`2026-10-28-live-demo-mode-design.md`](2026-10-28-live-demo-mode-design.md), `SECURITY.md`, `THREAT-MODEL.md`, `POLICY.md`.

## Goal

Make the hosted SA-JAS genuinely useful for a South African job seeker: deep, reusable candidate data; CV intake that turns a document into a structured profile; and real application automation that fills job-site forms and submits after one confirmation. Keep the parts that make the product trustworthy: no accounts, no server, no key custody, data in the user's browser, BYOK.

The work is too large for one cycle. This document fixes the architecture, the contracts and the order. Each phase gets its own spec and plan.

## Decisions

| Question | Decision | Why |
|---|---|---|
| Where does automation run? | A browser extension for Chrome and Edge. The app prepares a packet; the extension fills and submits on the job site. | Third-party sites are cross-origin. A static page cannot type into them, and a server would need key custody and abuse handling. |
| How far does it go? | Fill every field it can match, show a review panel, then click the site's Submit only after the user confirms, once per application. | Real automation with one human gate. No unattended mass submission, no CAPTCHA bypass. |
| Is there a server? | No. | The chosen boundary needs none. A backend is a later, explicit decision with its own costs. See "Server trigger". |
| Where do documents live? | In IndexedDB, originals plus extracted text, capped per file and in total. | The extension must attach the exact file. The user keeps control of it. |
| Are tailored CVs generated as files? | Yes, as PDF, in the browser. | A portal accepts a file, not text. The extension attaches the tailored PDF. |
| How is CV intake done? | Local text extraction (PDF, DOCX, TXT) then one structured Anthropic extraction with the user's key; the user reviews before saving. | The model only proposes. The user saves. The original file is retained. |
| Which portals first? | Generic matcher, then Greenhouse, Lever, SmartRecruiters. Workday, SuccessFactors, Taleo, PNet and LinkedIn follow. | The first three are single-page and stable. The rest are multi-step and often require account creation, which stays with the user. |
| How is the extension distributed? | Unpacked build with a one-page install guide and a zip release. Store submission later. | Immediate, free, no review gate on an experimental alpha. |
| Does the demo change? | Yes, it becomes a full-fidelity simulation on the same contracts. | A visitor should see the real product, not a slideshow. |

## Architecture

```
+--------------------------------------------------------------+
|  Hosted app (sajas.pages.dev, static)                          |
|  profile v2, documents, memory, answer bank, tailoring,       |
|  tracker, apply packet v2, tailored PDF, backups              |
|  AI calls go to api.anthropic.com with the user's key         |
+-----------------------------+--------------------------------+
                              | window.postMessage, nonce-guarded
                              | (content script on the app origin)
+-----------------------------v--------------------------------+
|  Extension (MV3, local only)                                  |
|  service worker: packet inbox, result queue                   |
|  content script on job pages: match, fill, review, submit     |
|  no AI calls, no key, no analytics, no remote code            |
+--------------------------------------------------------------+
```

The app is the system of record. The extension is stateless between applications except for the prepared packet and pending results.

### Trust boundaries

1. **The job page is untrusted.** Its DOM is hostile input. The extension reads labels and attributes, writes values, and never executes page-provided strings as code. It clicks Submit only on explicit confirmation.
2. **The app's packet is trusted only after validation.** The extension validates every field, caps every string, and ignores unknown fields. It never accepts a URL to navigate to; it only acts on the tab the user invoked it on.
3. **The extension is an optional surface.** A user who never installs it keeps the current copy-sheet workflow.
4. **The key never enters the extension.** Packets contain no key material, and a static test scans the extension bundle for key handling, AI SDK imports and analytics endpoints.

## Data model v2

All stores remain keyed maps in IndexedDB `sajas-web`. Backup schema version becomes 2. Existing v1 data migrates on open.

- **Profile `profile/current`, v2:** identity and contact, address, SA eligibility, employment, salary objects, education, certifications, skills, languages, references, work history, preferences, voluntary EE fields behind an explicit opt-in, base CV, base cover letter, existing settings. Existing flat fields stay so current screens and the apply packet keep working.
- **Documents `documents/<id>`:** kind, label, sanitised file name, MIME, size, uploaded time, default flag, extracted text, and the original bytes as an ArrayBuffer. Caps: 8 MB per file, 10 documents, 20 MB total.
- **Answer bank v2:** the existing question, answer and normalized key, plus category, source, times used, last used and created time.
- **Memory v2:** the existing dossier plus preferences, salary history and an apply event log. Existing insights, employers and applications keep their shape.
- **Usage:** unchanged.
- **Backups v2:** documents included as base64 under the store caps. A v1 backup restores the other stores and leaves documents untouched, because v1 could not contain them. `keyVault` remains excluded.

## CV intake

1. The user uploads a PDF, DOCX or TXT, or pastes text.
2. The app sniffs the file type, enforces the caps, extracts text locally (pdf.js, mammoth, TextDecoder) and stores the document.
3. If a key is loaded, one structured Anthropic call proposes profile sections from the text. The call is budget-guarded and logged in usage like every other AI task.
4. The user reviews a prefilled form, edits anything, and saves. Nothing is written before that save.
5. Sensitive EE fields are never inferred. Answer bank entries are never invented; only the user or a confirmed suggestion can create them.

A scanned PDF with no text layer is reported as such and the user is asked to paste the text.

## Apply flow

1. The user picks a tailored job in Apply mode. The app shows packet v2: identity, canonical question fields, attachments, warnings.
2. The app generates a tailored CV PDF and shows it alongside the base CV.
3. **Send to extension** posts the packet to the extension. The copy sheet remains as the fallback.
4. On the job page the user invokes the extension. It matches fields, fills what it is confident about, highlights what it skipped, attaches files where the site allows it, and shows a review panel.
5. The user presses **Submit application** in the panel. The extension clicks the site's Submit and watches for a success signal. CAPTCHA, verification or an unknown step stops the run and hands control back.
6. The result is written to an extension queue and synced into the tracker and memory when the app is next open. The submission record uses delivery `extension`, submitter `user`.

Field matching uses a shared, testable matcher in `@sajas/core`: normalized labels, autocomplete attributes, input names and ids, plus per-host adapters for quirks. It never guesses into fields it does not recognise.

## Demo v3

A richer simulation on the same contracts:

- A complete fictional persona with profile v2, a CV and supporting documents, a populated answer bank, a dossier with history, and salary expectations.
- About 20 plausible fictional employers across banking, retail, mining, public works, logistics, NGOs and tech, spanning several provinces, with ZAR salary bands and realistic SA application questions.
- A simulated portal with real form controls that the in-app simulated copilot fills, reviews and submits, exercising the packet v2 shape.
- All links on reserved `.test` domains, all employers fictional, no real person or company details.
- The existing isolation contract is unchanged and extended: demo mode also never touches the documents store in the real vault.

## Phases

| Phase | Scope | Exit criteria |
|---|---|---|
| 0 | Close the import-hardening increment (PR #25). | Merged with review fixes and all gates green. |
| 1 | Data foundation: profile v2, migration, documents store, CV intake, answer bank v2, backup v2. | A real CV can be uploaded, parsed, reviewed into a profile, and restored from a backup. |
| 2 | Apply foundation: packet v2, tailored CV PDF, Apply mode in the app, submission delivery contract for the extension. | A tailored PDF exists and a complete packet can be previewed and copied or sent. |
| 3 | Extension: MV3 shell, app handshake, generic matcher, three adapters, review panel, submit, result sync. | The extension fills a local fixture form and a simulated portal end to end, offline. |
| 4 | Demo v3: persona, seed data, simulated portal and walkthrough on the phase 2 and 3 contracts. | A visitor completes the full simulated journey with zero network, no key and no real storage. |

Each phase follows the same path: spec, plan, TDD, independent review, PR, merge. Production deploys happen only with explicit approval.

## Testing

- **Offline by default.** No live feeds, no live applications, no Anthropic calls in automated tests. AI paths are tested with fakes, as the tailoring tests already do.
- **Documents:** extraction tested with generated fixtures (a PDF built with pdf-lib, a DOCX built with JSZip), plus caps, type sniffing and corrupt-file failures.
- **Backups:** v1 and v2 round-trips, document base64 caps, and rejection paths that leave existing data intact.
- **Extension:** unit tests for the matcher; Playwright loads the unpacked extension in Chromium against local HTML fixtures that imitate Greenhouse, Lever and a generic form; the simulated portal proves fill, review, submit and result sync. No real portal is contacted by a test.
- **Isolation:** the existing demo gates stay, extended to prove no real storage access.

## Security, privacy and legal

- **Documents are the most sensitive data the app has stored so far.** They are stored unencrypted in the browser, like the profile today, and the privacy notice must say so plainly, alongside what is sent to Anthropic (extracted text only, never the file) and what never leaves the device.
- **Extension permissions are minimal:** `activeTab`, `scripting`, `storage`, and a host permission only for the app origin. No `<all_urls>`. No remote code.
- **No CAPTCHA or bot-protection bypass.** Detection stops the run and asks the user to finish by hand.
- **One confirmation per submission.** The extension cannot submit with no user present.
- **Portal terms are the user's responsibility.** Terms and the extension install page say so, and the user confirms responsibility before the first automated submission.
- **Store listing** needs a privacy policy and a data-use declaration before submission. That is a phase 3 follow-up, not a blocker for the unpacked alpha.

## Server trigger

A backend becomes justified only when all of these are true:

1. Users ask for unattended batch applications with the browser closed.
2. Per-application confirmation is no longer a requirement for those users.
3. There is a business model that pays for browser automation hosts, queues and abuse handling.
4. There is a legal position on automating each target portal.

Until then, the extension is the automation layer. This paragraph exists so a future increment does not drift into a server by accident.

## Non-goals

- Accounts, sync, or shared storage.
- Holding or proxying the Anthropic key.
- Automatic account creation on portals.
- Bypassing CAPTCHA, email verification or bot protection.
- Changing the desktop app, `SYNTHETIC_DEMO`, `server/src/demo.js` or the desktop copilot.
- Store distribution in the first extension release.

## Risks

| Risk | Mitigation |
|---|---|
| ATS DOM changes break adapters | Generic matcher first, adapters are declarative and covered by saved fixtures, and the review panel exposes skipped fields. |
| CAPTCHA or verification blocks a run | Detect, stop, hand over, record the reason. |
| Bundle growth from pdf.js, mammoth, pdf-lib | Lazy-load each behind the screen that needs it; size budgets in the build gate. |
| Storage quota exhaustion from documents | Hard caps with clear errors before a write, plus the existing backup guidance. |
| Extension trust and store review | Minimal permissions, no remote code, no key, local-only data, independent review before release. |
| AI extraction quality | The user reviews every field; nothing is saved automatically; low-confidence fields are left blank. |
| Legal exposure on portal automation | Per-submission confirmation, no CAPTCHA bypass, clear terms, fictional demo data. |
