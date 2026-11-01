# Phase 2: Apply Foundation

**Status:** shipped 2026-11-01 (PR #32)
**Phase of:** [Automation and Data Depth](2026-11-01-automation-and-data-depth-design.md)
**Date:** 2026-11-01
**Phase:** 2 of 4
**Sources of truth:** the architecture spec above, `SECURITY.md`, `THREAT-MODEL.md`, `POLICY.md`, and the Phase 1 packet, documents and submission contracts.

## Goal

Turn the copy sheet into a prepared application: one canonical packet that carries the candidate's details, answers and the exact files a portal needs, a tailored CV as a real PDF, and a guarded hand-off to the browser extension that arrives in Phase 3. A user without the extension keeps the current copy workflow.

## Scope

In:

- Packet v2 in `@sajas/core`: canonical fields, attachments with bytes, a version and a packet id.
- A validation function that rebuilds a received packet and refuses anything outside the contract.
- Browser-side tailored CV PDF generation with `pdf-lib`, lazy-loaded.
- Apply mode that shows the base CV and the tailored PDF, lets the user choose supporting documents, and sends the packet to the extension when it is present.
- A nonce-guarded `postMessage` bridge between the app and the extension content script.
- A web API result contract that records an extension delivery in the tracker and memory.
- Offline tests and a browser proof for every piece.

Out:

- The extension itself, field matching against real portals, filling and submitting (Phase 3).
- Demo v3 (Phase 4). Demo mode keeps its simulated portal and gains no extension or PDF controls.
- Any change to the desktop app, the desktop copilot, `SYNTHETIC_DEMO` or `server/src/demo.js`. The desktop keeps packet v1 and its delivery values.

## Packet v2

`buildApplyPacketV2({ profile, job, answerBank, attachments, now })` returns:

```js
{
  version: 2,
  packetId: '<uuid>',
  createdAt: '<ISO timestamp>',
  job: { id, title, company, site, applyUrl },
  identity: [{ key, label, value }],
  questions: [{ key, label, value, source }],
  fields: [{ key, label, value, source }],
  attachments: [{ key, kind, label, fileName, mime, size, dataBase64 }],
  checklist: [{ key, label, done }],
  warnings: ['...']
}
```

- `identity` and `questions` keep the v1 shape so the copy sheet and any later adapter read the same display data.
- `fields` is the canonical matcher list: `fullName`, `firstName`, `lastName`, `preferredName`, `email`, `phone`, `linkedInUrl`, `portfolioUrl`, `githubUrl`, `city`, `province`, `postalCode`, `country`, `currentCompany`, `currentTitle`, `yearsExperience`, `highestQualification`, `noticePeriod`, `currentSalary`, `expectedSalary`, `rightToWorkSA`, `willingToRelocate`, `driversLicense`, `ownVehicle`, `availabilityDate`, plus saved answer-bank questions keyed `bank:<normalized>`.
- Employment-equity fields (`eeRace`, `gender`, `disability`) appear only when `profile.eeOptIn === true`. The legacy v1 packet is unchanged.
- Salary amounts are formatted as `R 55 000 per month` or `R 720 000 per year`, using a manual grouping rule so tests do not depend on the host locale.
- `currentCompany` and `currentTitle` come from the work-history entry marked `current`, otherwise the first entry.
- Attachments: `kind` is `tailored-cv` or `document`. Allowed MIME types are PDF for a tailored CV and PDF, DOCX or text for a document. Caps are 10 attachments, 8 MB each and 20 MB in total before base64 encoding. Each output carries base64 `dataBase64` and the byte `size`.
- Values are capped at 500 characters, labels at 120 and the apply URL at 2,000. Documents list availability exactly as v1 does.
- The packet never contains the API key, an ID number, a bank detail or any key-shaped field name.

`sanitisePacketV2(raw)` rebuilds a packet from known fields only. It rejects a wrong version, a malformed id or timestamp, a non-`http(s)` apply URL, an unknown MIME type, a base64 string that does not decode, a byte count that differs from the base64 length, and any attachment over a cap. Every string is re-capped. The bridge and the Phase 3 extension both use it.

## Tailored PDF

`createCvPdf({ text, title })` returns `Uint8Array` bytes for an A4 PDF:

- `pdf-lib` is imported lazily, so the main bundle does not grow.
- Helvetica 10.5pt body, 14pt section headings for lines that start with `#`, bullets for lines starting with `- ` or `* `.
- Markdown emphasis markers are removed, curly quotes and dashes are mapped to their plain equivalents, and characters outside WinAnsi are dropped rather than throwing.
- Text is capped at 120,000 characters and the document at 12 pages; exceeding either is a clear validation error.
- Input is the tailored CV text already stored on the job. The PDF is generated on demand and is not persisted, so the tracker and backups keep one source of truth.
- A download helper produces `${safeTitle}-cv.pdf` from a Blob URL and revokes it.

## Extension bridge

The app and the extension share one window and one origin.

| Direction | Message | Payload |
|---|---|---|
| app to extension | `sajas:hello` | `source: 'sajas-app'`, `version: 1`, `nonce` |
| extension to app | `sajas:ready` | `source: 'sajas-extension'`, `version: 1`, `nonce` |
| app to extension | `sajas:packet` | `source`, `version`, `nonce`, `packet` (validated v2) |
| extension to app | `sajas:ack` | `source: 'sajas-extension'`, `version: 1`, `nonce`, `packetId` |

- The app creates one nonce per bridge with `crypto.randomUUID()`.
- A message is accepted only when `event.source === window`, `event.origin === location.origin` and the nonce matches.
- `probe()` posts hello and resolves `true` on ready or `false` after 1.2 seconds.
- `send(packet)` validates, posts, and resolves `{ ok: true }` on a matching ack or `{ ok: false, reason }` on timeout, rejection or an absent extension. It never rejects.
- `dispose()` removes the listener.
- The bridge lives in `client/src/web/extensionBridge.js` and takes its window and nonce by injection so Node tests can drive it without a browser.

## Submission contract

- `SUBMISSION_DELIVERIES` gains `extension`; `desktop-copilot` and `web-guided` keep their meaning. `submittedBy` stays `user` or `copilot-confirmed`.
- `POST /api/jobs/:id/applied` accepts an optional JSON body `{ delivery, fields, confirmation }`. The default stays `web-guided`. The web app accepts only `web-guided` and `extension`; any other value is a validation error. Fields are cleaned and capped by the existing submission rules. The job becomes `applied`, the tracker gets `appliedAt`, and the memory application record stores the delivery, submitter, site, documents, fields and confirmation exactly as it does today.
- The Phase 3 extension will call this route with `delivery: 'extension'` and the fields it filled.

## Apply mode

The Apply tab keeps its current sections and copy buttons, and adds:

- A documents block that lists the default CV from the documents library, the generated tailored PDF, and any supporting documents with a checkbox each. The default CV and tailored PDF are preselected. A user with no stored CV sees a plain instruction to add one.
- **Download tailored CV PDF** and **Download base CV** actions. Both are hidden in demo mode.
- **Send to extension**:
  1. Generates the tailored PDF.
  2. Fetches the chosen documents' bytes from the local API.
  3. Builds and validates packet v2.
  4. Probes the bridge. When absent, it shows a plain message that the extension is not installed and keeps the copy sheet visible. When present, it sends and reports the ack.
- The extension button is hidden in demo mode, and the Apply component performs no document fetch or PDF work in demo mode. The existing simulated-portal button and copy sheet are unchanged.

## Security and privacy

- The packet contains profile answers and file bytes, and goes only to the extension inside the same origin. It is never sent to the app's origin, Anthropic or a feed.
- No key, key-shaped field or key vault record can enter a packet; validation and a test enforce this.
- The job page is untrusted: the packet carries the expected site and apply URL so the Phase 3 content script can refuse to act on a different host. The extension never receives a navigation instruction.
- The app never accepts a message from another origin or without the live nonce.
- Tailored PDFs are built locally from text the user already reviewed. Nothing about them leaves the device except through the extension hand-off the user presses.
- Documents stay under the Phase 1 caps and are unencrypted on the device, as `POLICY.md` already states.

## Testing

- Core packet v2 tests: shape, field derivation, EE opt-in, salary formatting, work history, answer-bank fields, attachment caps and base64 agreement, key-shaped input dropped.
- `sanitisePacketV2` tests: hostile packet, unknown fields, over-cap attachment, mismatched size, non-http link, wrong version.
- Submission tests: `extension` is accepted and recorded, unknown deliveries still throw.
- Web API tests: extension delivery updates the job and memory, invalid delivery is rejected, default remains web-guided.
- PDF tests: a generated PDF has the `%PDF` header, loads back through `pdf-lib`, has at least one page, and handles accented text and over-cap input.
- Bridge tests: ready handshake, ack, timeout, foreign origin and wrong nonce ignored, invalid packet never posted.
- Browser proof (`web-apply` extended): downloading the tailored PDF yields a non-zero file, an absent extension shows the install message, the copy sheet still works, and no request leaves the local origin.
- Existing gates stay green: `npm test`, `npm run test:demo`, `npm run build:web`, `npm run test:web`, `node tools/check-secrets.mjs --all`.

## Acceptance criteria

1. A tailored job produces a valid PDF that opens, with the expected file name.
2. A v2 packet contains canonical fields, the selected attachments and no key material.
3. The bridge ignores forged or foreign messages, and a valid packet reaches a fake extension once.
4. The web app records an extension submission with the same tracker and memory effects as a manual one.
5. Without the extension, the copy sheet remains complete and the UI says plainly that the extension is not installed.
6. Demo mode shows none of the extension or PDF controls and makes no real storage or network access.
7. All gates pass and the desktop packet and copilot behaviour are unchanged.

## Evidence

- Gates: `npm test`, `npm run test:demo`, `npm run build:web`, `npm run test:web` and `node tools/check-secrets.mjs --all`, all green.
- Proofs: packet v2 unit tests, submission and API extension tests, PDF tests, bridge tests and the extended `web-apply` browser proof.
- Docs: `SECURITY.md`, `THREAT-MODEL.md` and `POLICY.md` describe the packet, the bridge and the extension delivery.
- Review: an independent review raised four MEDIUM findings (WinAnsi control codes, vacuous bridge rejection tests, a proof that did not exercise the Send click, and credential-shaped packet fields); each was fixed with a test before the PR.

## Risks

| Risk | Mitigation |
|---|---|
| Packet size from base64 attachments | Hard caps, preselected files only, clear size labels and a server-side size check on every document. |
| PDF font coverage | WinAnsi-safe mapping with a test for accents and punctuation. |
| Extension impersonation | Same-window, same-origin and per-load nonce checks; packets are validated again on receipt. |
| UI regressions for users without the extension | The copy sheet is never removed; the send button degrades to an explanation. |
| Demo isolation | New work is gated behind `!demo`, and the existing demo gates run on every PR. |
