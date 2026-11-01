# Phase 1: Profile v2, Documents and CV Intake

**Status:** implemented 2026-11-01, gates green, merge pending
**Date:** 2026-11-01
**Phase:** 1 of [Automation and Data Depth](2026-11-01-automation-and-data-depth-design.md)
**Sources of truth:** the architecture spec above, `SECURITY.md`, `THREAT-MODEL.md`, `POLICY.md`, and the existing vault, API and backup contracts.

## Goal

Turn the hosted app from a form with a CV text box into a real candidate record. A user uploads a CV, the app extracts its text locally, optionally proposes structured profile fields with one budgeted Anthropic call, and the user reviews and saves. The original file is kept so a later phase can attach it. Everything survives export and restore.

This phase changes no automation. It builds the data foundation the extension will use.

## Scope

In scope:

- Profile v2 with structured sections and a migration from v1.
- A documents store with hard caps and binary retention.
- Local CV text extraction for PDF, DOCX and TXT.
- An optional structured extraction call that only proposes.
- Answer bank v2 fields.
- Backup schema version 2, including documents.
- UI for profile sections, CV intake and the documents library.

Out of scope:

- Apply mode, tailored PDF, packet v2 (phase 2).
- Extension (phase 3).
- Demo v3 (phase 4).
- Any change to the desktop app, `SYNTHETIC_DEMO`, `server/src/demo.js` or the desktop copilot.

## Decisions

| Question | Decision | Why |
|---|---|---|
| Where do document bytes live? | `documents` store in IndexedDB, as an ArrayBuffer plus metadata and extracted text. | The file must be attachable later. ArrayBuffer clones in IndexedDB and in the memory adapter. |
| How does the UI reach documents? | Through the existing fetch port (`/documents`), with base64 JSON bodies. | One data path that demo mode already intercepts, and no direct vault access from components. |
| What are the caps? | 8 MB per file, 10 documents, 20 MB total, 1,000,000 characters of extracted text per file. | Keeps backups and memory use bounded, with errors before any write. |
| What does AI extraction see? | The extracted text only, never the file, and only when a key is loaded. | Same privacy boundary as tailoring. The user can skip AI entirely. |
| Can extraction fill sensitive answers? | No. It never returns race, gender, disability, salary, notice period, criminal record or credit consent. | These must come from the user, not a guess. |
| What happens to a scanned PDF? | Text extraction returns too little text; the app says it looks scanned and asks for pasted text. | No OCR dependency in this phase. |
| Can a v1 backup delete documents? | No. A v1 backup restores the six v1 stores and leaves documents untouched. | v1 could not contain documents, so deleting them would be surprising data loss. |

## Profile v2

Stored at `profile/current`. Existing flat fields stay exactly as they are, because the packet, tailoring prompts and current screens read them. New fields are additive.

```
v: 2
fullName, preferredName, email, phone
headline, summary
yearsExperience: number|null
highestQualification
linkedInUrl, portfolioUrl, githubUrl
address: { line1, line2, suburb, city, province, postalCode }
eeOptIn: boolean
applicationProfile: { existing SA question map, unchanged }
salary: {
  currentAmount: number|null, currentPeriod: 'month'|'year',
  expectedAmount: number|null, expectedPeriod: 'month'|'year',
  negotiable: boolean
}
workHistory: [{ company, title, start, end, current, location, bullets: [string] }]
education: [{ institution, qualification, field, year, result }]
certifications: [{ name, issuer, year }]
skills: [string]
languages: [string]
references: [{ name, relationship, company, email, phone }]
preferences: { roles: [string], sectors: [string], locations: [string], remote: 'yes'|'hybrid'|'no'|'', minSalary: number|null }
```

Rules:

- `applicationProfile` remains the single source for packet values. Structured controls write the same keys, and the salary section also writes `applicationProfile.currentSalary` and `expectedSalary` as ZAR display strings, so packet v2 and the desktop-compatible shape stay consistent.
- Turning `eeOptIn` off clears `applicationProfile.eeRace`, `gender` and `disability` after a confirmation dialog. No hidden storage of opted-out fields.
- Every string is capped at save time. Short (200): names, titles, links, file names, province, year, result. Medium (2,000): city and address lines, headline, summary, role and sector preferences, each skill, language and bullet. Long (20,000): reference notes and free-text blocks. Base CV and cover letter at 1,000,000, matching the backup cap. Oversized input is rejected with a clear message, not silently cut.
- Unknown existing keys are preserved through migration and saves.

### Migration

`migrateProfile(current)` runs from the web runtime after the vault opens, before the first profile read, and is also applied by `GET /profile`.

- No profile: create nothing. The app keeps its current empty-state behaviour.
- `v` missing or below 2: add defaults for every new field, keep every existing value, normalise `linkedInUrl` and `portfolioUrl` with `webLink`, set `v: 2`, and write once.
- `v: 2`: no write.
- Idempotent, and tolerant of malformed legacy values (wrong types are replaced with defaults, never thrown on).

## Documents

Store: `documents`, record keyed by `id`.

```
{
  id: uuid,
  kind: 'cv' | 'cover-letter' | 'certified-id' | 'qualification' | 'other',
  label: string (120),
  fileName: string (200, sanitised: no path separators or control characters),
  mime: 'application/pdf' | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' | 'text/plain',
  size: number,
  uploadedAt: ISO string,
  isDefault: boolean,
  text: string (1,000,000),
  data: ArrayBuffer
}
```

Rules:

- At most one `isDefault` CV. Setting a new default clears the old one in the same write.
- Deleting the default CV leaves no default.
- Caps are checked before the record is written, using current totals. Errors: `VALIDATION` for type, size, cap or magic-byte mismatch; `STORAGE_FULL` from the adapter when the browser itself refuses the write.
- Type detection reads the first bytes: `%PDF-` for PDF, `PK\x03\x04` for DOCX, and text for pasted content. A declared MIME that disagrees with the bytes is rejected.
- Pasted text becomes a `text/plain` document whose `data` is the UTF-8 encoding of the text and whose `text` is the same string, so download and extraction work the same way as for an uploaded file.
- The record stores bytes and text; the API never returns bytes in a list, only metadata.

### API routes

| Route | Behaviour |
|---|---|
| `GET /documents` | Metadata list, no bytes, no text. |
| `GET /documents/:id` | Metadata plus text. |
| `GET /documents/:id/file` | `{ fileName, mime, dataBase64 }` for download or attachment. |
| `POST /documents` | Create from `{ kind, label, fileName, mime, size, dataBase64, text }` after validation. |
| `PATCH /documents/:id` | Change `label`, `kind` or `isDefault`. |
| `DELETE /documents/:id` | Remove the record. |

All validation failures use the existing error contract. The routes are removed from the web server-only list. In demo mode they answer from the session simulation and never reach the real vault.

Phase 1 hides the documents tab, CV file intake and `/profile/intake` in demo mode; the simulated documents experience belongs to phase 4. The API still answers from the demo session vault, which never touches IndexedDB.

## CV intake

Module split:

- `client/src/web/documents.js`: caps, type sniffing, base64 encode and decode, file-name sanitising, record validation. Pure and unit-tested.
- `client/src/web/extract/pdf.js`: pdf.js text extraction, dynamic import, local worker asset.
- `client/src/web/extract/docx.js`: mammoth raw text extraction, dynamic import.
- `client/src/web/cvIntake.js`: prompt, structured schema, response validation, usage recording.
- Components: `ProfileEditor.jsx`, `CvIntake.jsx`, `DocumentsPanel.jsx`, with `App.jsx` reduced to wiring.

Flow:

1. Upload or paste. Client checks type and size before reading.
2. Extract text locally. Store the document record first, so a later AI failure does not lose the file.
3. If a key is loaded, offer **Read my CV**. One call, task `intake`, budget-guarded, usage-recorded, with the CV text inside untrusted markers.
4. The response must match a strict schema: strings, numbers and arrays only, each capped. Anything else fails as `VALIDATION` and nothing is shown as saved.
5. The wizard prefills a review form. Fields already set on the profile show current versus proposed, defaulting to keep current. The user chooses per section.
6. **Save profile** writes through `POST /profile` with the merged values. The wizard then closes and the profile shows the saved values.

Without a key, steps 3 to 5 collapse to a text preview and a manual form. Local extraction and document storage still work.

Extraction runs through `POST /profile/intake` with `{ documentId }`. It reads the stored text, makes the one budgeted call, validates the response, records usage, and returns the proposals. It never writes the profile; only `POST /profile` after the review step does that. This is a web route answered by the browser runtime, like tailoring, so the desktop server and copilot are unchanged.

The extraction schema covers: name, contact links, city and province, headline, summary, skills, languages, work history, education, certifications, years of experience and highest qualification. It cannot return employment-equity fields, salary, notice period, criminal record or credit consent.

## Answer bank v2

Existing records gain:

```
category: 'preference'|'strength'|'achievement'|'style'|'constraint'|'other'
source: 'manual'|'edit'
timesUsed: number
lastUsed: ISO string | null
createdAt: ISO string
```

Defaults are applied on read in the API and persisted on write. No bulk rewrite. Existing `question`, `answer` and `normalized` are unchanged, and packet v1 keeps working. Phase 1 writes `manual` for a user-typed answer and `edit` when the user changes one; an `intake` source is reserved for a later phase that proposes answers from the CV.

## Backups v2

- `EXPORT_FORMAT.schemaVersion` becomes 2. Import accepts 1 and 2.
- Version 2 adds a `documents` map, each record with `data` as base64. The store caps guarantee the export stays under about 27 MB of JSON.
- Import validates every document: kind, MIME, size against the decoded byte length, magic bytes, text cap, file name sanitising, and base64 validity. A bad document aborts before anything is cleared.
- Version 1 import restores `profile`, `jobs`, `answers`, `memory`, `usage` and `meta`, and leaves `documents` untouched. The confirmation dialog says so.
- Export refuses with a clear message if a legacy record somehow breaks the caps, rather than writing a backup that cannot be imported.
- `keyVault` stays excluded. The existing pre-download key-material check stays.

## Error handling

- `STORAGE_FULL`: the existing adapter mapping and recovery copy, plus the documents panel showing usage against `navigator.storage.estimate()` when available.
- Parse failures: "That file could not be read as a PDF or DOCX. Try another copy or paste the text."
- Scanned PDF: "This PDF has no selectable text, so it looks like a scan. Paste the text instead."
- Extraction failure: existing error card with the safe message and code; the document stays saved and the manual form stays available.
- No partial writes: every route validates fully before touching storage.

## Security and privacy

- Files never leave the device. Only extracted text goes to Anthropic, and only on an explicit **Read my CV** action.
- Document text is rendered as text, never as HTML. There is no preview of the binary.
- Download uses a sanitised file name and a revoked object URL.
- PDF and DOCX parsing are treated as untrusted input: file caps, text caps, no code execution, and libraries kept current through the existing Dependabot setup.
- Documents are stored unencrypted in the browser, like the profile today. `POLICY.md`, the privacy notice and `SECURITY.md` must say this and say what is included in a backup.
- Demo mode answers documents and intake routes from the simulation and never touches the real vault.

## Testing

- `documents.test.js`: caps, type sniffing, base64 round-trip, file-name sanitising, byte-length agreement.
- `extract` tests: a PDF generated with pdf-lib and a DOCX generated with JSZip, plus a scanned-style PDF with no text and a corrupt file.
- `cvIntake.test.js`: schema acceptance and rejection with a fake AI loader; no network; usage recorded once; budget guard honoured.
- `profile` tests: migration from v1, idempotence, malformed legacy values, caps, EE opt-out clearing.
- `api` tests: every documents route, error codes, no bytes in lists, demo not-supported.
- `vault` and `backup` tests: v2 round-trip with documents, v1 import leaves documents untouched, hostile document records rejected, existing data intact on rejection.
- Gates: `npm test`, `npm run test:demo`, `npm run build:web`, `npm run test:web`, `node tools/check-secrets.mjs --all`. No new gate may contact the network.

## Acceptance criteria

1. A PDF CV can be uploaded, its text extracted locally, the original downloaded again, and the default flag moved between CVs.
2. With a key and a fake AI loader in tests, extraction proposals are validated, and in a manual live check the wizard proposes fields that the user can edit and save. Nothing is saved without that save.
3. The stored profile and its documents survive export v2, wipe and import unchanged.
4. A v1 backup imports cleanly and leaves documents untouched.
5. Every cap and type failure produces a clear, coded error before any write, and leaves existing data intact.
6. All existing gates stay green, and the demo isolation gates still prove no real storage access.

## Risks

| Risk | Mitigation |
|---|---|
| pdf.js worker and bundle size | Lazy import behind CV intake; add a bundle-size check to the build gate. |
| Extraction quality varies by CV layout | The user reviews everything; blank low-confidence fields; never invent sensitive answers. |
| Large files strain memory | Hard caps before reading; base64 only at the API boundary; revoke object URLs. |
| Migration mistakes lose data | Idempotent additive migration, unknown keys preserved, dedicated tests, and a backup before the first v2 write is recommended in the release note. |

## Evidence

Implemented 2026-11-01 on `arc-12-profile-documents`.

- **Code.** Profile v2 migration and editor; document rules with magic-byte sniffing, shared caps and lazy PDF/DOCX extraction; CV intake that saves the original, extracts locally and proposes fields through one budgeted call; documents library with upload, download, default and delete; answer-bank v2 defaults read at the API boundary; backup schema v2 with a v2-aware cleaner and a single-transaction restore.
- **Unit and integration tests.** Client 270, server 447 (12 skipped by environment), core 201, evals 23 and script tests 9, all passing with `npm test`.
- **Demo isolation.** `npm run test:demo` passes 36 checks, including that the documents tab and CV intake stay hidden and that demo mode never opens IndexedDB or holds a key.
- **Browser proofs.** `npm run build:web` succeeds and `npm run test:web` passes all 15 checks, including the new `web-documents` and `web-cv-intake` walks with no request leaving the local origin.
- **Secrets.** `node tools/check-secrets.mjs --all` is clean over 428 files.
- **Docs.** `SECURITY.md`, `THREAT-MODEL.md` and `POLICY.md` describe the documents store, the shared caps, the AI read boundary and the atomic restore.
