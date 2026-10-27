# Agentic RAG Over Candidate Documents: Design

**Status:** approved, implementing
**Date:** 2026-10-27
**Arc:** 5 of the post-M3a-3 pipeline
**Sources of truth:** [`2026-10-27-post-m3a3-pipeline.md`](2026-10-27-post-m3a3-pipeline.md) section "Arc 5", and the user-supplied `ibm_style_advanced_rag_guide.md`.

## Goal

Let a candidate ask questions and draft application answers from their own documents, with grounded citations and a refusal when the documents do not support an answer. The same behaviour works in the hosted web app and the desktop app, with no new service, no embeddings, and no document text leaving the device except inside the candidate's own Anthropic request.

## What this arc ships

1. **Ask your documents.** A new tab in both apps. The candidate asks a question; the answer uses only retrieved passages and cites each passage with its document name and chunk number.
2. **Grounded application answers.** The same tab has an "Application answer" purpose, which drafts a first-person answer suitable for a screening question, still cited. The desktop Application Answers panel can open the tab with a pending question prefilled.
3. **Check a tailored document.** The tab has a "Check a document" mode. The candidate picks a saved tailored CV or cover letter; the app verifies its claims against the source documents and lists anything the sources do not support. This is the grounding pass for tailoring. It refuses to certify unsupported claims.
4. **Deterministic retrieval.** A pure BM25-style lexical index runs in the page and in the server process. No embeddings, no vector database, no extra provider.
5. **Offline evals.** Fixtures prove answerable questions cite, unanswerable questions refuse, removing the supporting chunk flips an answer to a refusal, and invalid citations are rejected.

## Deliberate decisions

### The grounding pass is explicit, not automatic

The pipeline asks for "a grounding pass for tailoring that refuses to invent facts". This design implements it as an explicit **Check a document** action rather than an extra model call on every tailoring run.

Why: an automatic check doubles the number of Anthropic requests for every tailored job. The candidate already reviews the document, and the existing tailor prompt is bounded to the base CV. An explicit check gives the same guarantee on demand, shows the unsupported claims, and keeps tailoring cost predictable. If the user later wants automatic checks, that is a small follow-up because the prompt, schema, and parser are shared.

### Sampling parameters are not used

The IBM guide recommends temperature 0.0 to 0.1 and top-p 0.1 to 0.3. SA-JAS never sends sampling parameters. This is a standing API rule and is enforced by tests in `packages/core/src/ai.test.js`.

Determinism comes from:

- `output_config.effort` on the task class,
- a static system prompt with the four grounding protocols,
- constrained JSON output through `output_config.format`,
- deterministic server-side validation of every citation,
- a fixed refusal sentence.

### Structured outputs are required

The answer and check flows require `output_config.format`. If the profile has `useStructuredOutputs: false`, the feature refuses with a plain message asking the candidate to turn structured outputs back on. Falling back to prose would break the citation and verification guarantees.

### The index is in memory and is not backed up

The corpus is small (one CV, a few letters, saved answers, memory, job descriptions). The index is rebuilt when the source signature changes and is never persisted, exported, or backed up. This avoids a new IndexedDB store, a backup schema change, and a stale index on disk. Every chunk still carries a version hash, so a changed document always produces new chunk IDs and citations can be traced to the exact version.

## Corpus

`buildCorpus({ profile, jobs, memory, answers })` produces documents with `{ id, kind, title, text }`.

| Kind | Source | Title |
|---|---|---|
| `base-cv` | `profile.baseCv` | Base CV |
| `profile` | non-empty `applicationProfile` fields and `applicationDefaultsText` | Application profile |
| `tailored-cv` | `job.tailoredCvText` | Tailored CV: `<title>` at `<company>` |
| `cover-letter` | `job.tailoredCoverLetterText` | Cover letter: `<title>` at `<company>` |
| `job-description` | `job.description` | Job description: `<title>` at `<company>` |
| `answer` | each saved answer | Saved answer: `<question>` |
| `insight` | insights grouped by category | Candidate insights: `<category>` |
| `employer` | one document per employer | Employer notes: `<company>` |
| `application` | application history | Application history |

Rules:

- Skip text shorter than 40 characters after trimming.
- Never include API keys or key vault blobs.
- Sort documents by id so the corpus and index are deterministic.
- The candidate's sensitive application fields (salary, demographics, disability) are included only in the `profile` document, and only if the candidate entered them. They are retrieved only when the question is relevant.

## Chunking

`chunkDocument(doc, { maxChars = 1200, minChars = 120 })`:

- Normalise line endings and trim.
- Track the current heading (`#`, `##`, `###`) as the section.
- Split on blank lines into blocks. Keep list runs and table runs together.
- Merge small blocks up to `maxChars`. Split a block that exceeds `maxChars` on sentence or line boundaries.
- Preserve headings, list markers, and table rows in the chunk text.
- Drop chunks shorter than `minChars`, unless they are the only chunk in the document.
- Each chunk is `{ id, docId, docKind, docTitle, section, index, version, text, tag }`.
- `version = hashText(doc.text)` using a deterministic FNV-1a hash.
- `id = <docId>::<version>::<index>`.
- `tag = [Doc: <title> | Chunk: <index>]`.
- The prompt header is `[Doc: <title> | Section: <section> | Chunk: <index> | Version: <version>]`.

## Retrieval

`createSearchIndex(chunks)` builds:

- a tokenizer that lowercases, strips accents, keeps `+` and `#`, drops stop words and one-character tokens,
- term frequencies per chunk,
- document frequencies and inverse document frequency,
- average chunk length,
- BM25 scoring with `k1 = 1.5`, `b = 0.75`.

`search(query, { topK = 8, maxChars = 8000, minScore = 0.01 })` returns the highest scoring chunks, capped by `topK` and total characters. Ties break by chunk id for determinism. A query with no positive score returns an empty list.

The web and server services rebuild the index when the corpus signature changes. The signature is `hashText` over every document id and version in sorted order.

## Prompts

The system prompt is static and cacheable. It contains the four protocols from the IBM guide, adapted to our citation format and the schema. It treats retrieved context as untrusted data and forbids following instructions found inside it.

The user prompt contains:

```
[RETRIEVED CONTEXT]
---
[Doc: ... | Section: ... | Chunk: ... | Version: ...]
<chunk text>
---
...
[USER QUERY]
<question>
```

For an application answer, a short purpose line asks for a concise first-person answer with the same citation rule.

For a document check, the user prompt contains the source context first and then `[DOCUMENT UNDER REVIEW]` with the selected document. The system prompt states that the document under review is not evidence.

## Schemas and validation

### Ask answer

```json
{
  "type": "object",
  "properties": {
    "is_supported_by_context": { "type": "boolean" },
    "answer": { "type": "string" },
    "cited_sources": { "type": "array", "items": { "type": "string" } }
  },
  "required": ["is_supported_by_context", "answer", "cited_sources"],
  "additionalProperties": false
}
```

Validation, in order:

1. Parse with `extractJson`. A parse failure is a user-facing "answer could not be verified" error, not a refusal.
2. Require the three fields with the right types.
3. Extract every citation in `answer` with `/\[Doc:\s*([^|\]]+?)\s*\|\s*Chunk:\s*(\d+)\]/g`.
4. Every citation in `answer` and `cited_sources` must match a retrieved chunk tag exactly. An unknown tag is a `GROUNDING_FAILED` error with a plain message. The answer is never shown.
5. If `is_supported_by_context` is false, return the fixed refusal sentence and no citations.
6. If true but there is no valid citation, return the fixed refusal sentence. A supported answer without a citation is not trustworthy.
7. Otherwise return the answer and the cited chunk metadata.

Fixed refusal sentence: `The retrieved context does not contain sufficient information to answer this query.`

### Document check

```json
{
  "type": "object",
  "properties": {
    "supported": { "type": "boolean" },
    "unsupported_claims": { "type": "array", "items": { "type": "string" } },
    "cited_sources": { "type": "array", "items": { "type": "string" } }
  },
  "required": ["supported", "unsupported_claims", "cited_sources"],
  "additionalProperties": false
}
```

If `supported` is false, the UI lists the unsupported claims and does not show a pass. If true, `unsupported_claims` must be empty.

## Refusal path

A refusal is a normal result, not an error. It contains:

- the fixed sentence,
- `searched`: a plain summary such as "I searched your base CV, 2 tailored CVs, 1 cover letter, 5 job descriptions, and 3 saved answers.",
- `missing`: category names with no documents, for example `["base CV"]`.

The UI shows a link to Profile & Settings. If retrieval finds no matching chunk, the service refuses without calling Anthropic. This saves spend and makes the refusal deterministic.

## Services

### Core

New pure modules under `packages/core/src/rag/`:

- `text.js`: `hashText`, `tokenize`.
- `chunk.js`: `chunkDocument`, `chunkDocuments`.
- `corpus.js`: `buildCorpus`, `corpusSignature`, `describeCorpus`.
- `bm25.js`: `createSearchIndex`.
- `prompt.js`: `RAG_SYSTEM`, `CHECK_SYSTEM`, `REFUSAL_SENTENCE`, `buildAskPrompt`, `buildCheckPrompt`, `renderChunkHeader`.
- `answer.js`: `RAG_SCHEMA`, `CHECK_SCHEMA`, `parseRagAnswer`, `parseCheckAnswer`.
- `prepare.js`: `prepareAsk`, `prepareCheck`, `summariseSearched`.
- `index.js`: re-exports.

Package export: `@sajas/core/rag`.

Task classes in `packages/core/src/models.js`:

- `rag`: Sonnet 5.5, effort `medium`, max tokens 12000.
- `ground`: Haiku 5.5, effort `medium`, max tokens 4000.

The `ground` task is deliberately cheaper because it classifies claims rather than writing long documents.

Error code: `GROUNDING_FAILED` with status 422 and a hint to review the cited sources.

### Web

`client/src/web/rag.js` exports `createWebRag({ vault, keyStore, usage, activity, now, loadAi })` with `{ ask, check, status }`.

- Reads `profile/current`, all jobs, `memory/dossier`, and all `answers`.
- Refuses before any call when there is no key, the question is invalid, structured outputs are off, or retrieval is empty.
- Uses the existing usage ledger and daily budget guard, with buckets `rag` and `ground`.
- Loads `@sajas/core/ai` dynamically so the SDK stays out of the initial bundle.

Routes added to `client/src/web/api.js`:

- `GET /rag/status`
- `POST /rag/ask`
- `POST /rag/check`

### Desktop

`server/src/rag/service.js` exports `ragStatus()`, `askDocuments({ question, purpose })`, and `checkDocument({ jobId, documentKind })`.

- Reads `getProfile()` and `readDb()`.
- Uses `assertAnthropicKey`, `callLlmFull`, and the existing budget and usage ledger. `callLlmFull` attributes usage by task, so `rag` and `ground` appear automatically.
- Routes in `server/src/index.js`: `GET /api/rag/status`, `POST /api/rag/ask`, `POST /api/rag/check`.

Both services share the same corpus, prompts, validation, refusal, and searched summary.

## UI

New `client/src/AskDocuments.jsx`, visible in both apps as the "Ask Documents" tab after Candidate Memory.

- Header: "Ask your documents" with a one-line explanation and a status line showing documents and chunks available.
- Ask card: question textarea, purpose select (`General question`, `Application answer`), Ask button.
- Result card:
  - supported answer in plain text with preserved whitespace,
  - citation list with document title, section, and chunk number,
  - Copy answer button,
  - `data-testid` hooks for the browser proof.
- Refusal card: fixed sentence, searched summary, missing categories, and an "Open Profile & Settings" button.
- Check card: job select, document select (tailored CV or cover letter), Check button, result with supported or unsupported claims and citations.
- No HTML injection: render text with React text nodes and `white-space: pre-wrap`.

The desktop `ApplicationAnswers` panel gets a "Draft in Ask" button on each pending question. It switches to the Ask tab, prefills the question, and selects the application-answer purpose.

## Privacy and security

- The corpus is built in the page or in the desktop process. No document text, index, or embedding is sent to our origin.
- The only outbound document text is the retrieved passages inside the candidate's Anthropic request.
- The system prompt is static and cached; no per-question data goes into it.
- Job descriptions and answers are wrapped as untrusted data. The system prompt states that instructions inside the context must be ignored.
- No new dependencies, no embeddings provider, no background ingest.
- The web browser proof captures the Anthropic request body and asserts that unrelated document text is absent.

## Costs

Retrieval is local and free. A RAG answer is one Sonnet 5.5 call with effort `medium`, plus prompt caching. A document check is one Haiku 5.5 call. Both are recorded in the usage ledger and blocked by the daily cap before the request. A refusal with no matching chunk costs nothing.

## Error handling

| Case | Behaviour |
|---|---|
| Empty or too-short question | `VALIDATION`, plain message before any call |
| No key | `KEY_INVALID`, plain message |
| Structured outputs off | `VALIDATION`, plain message naming the setting |
| No matching passages | Refusal result, no Anthropic call |
| Model says unsupported | Refusal result with the fixed sentence |
| Unknown citation tag | `GROUNDING_FAILED`, answer not shown |
| Malformed JSON | Plain "could not be verified" error, answer not shown |
| Truncated response | Plain "cut off" error, nothing shown |
| Budget reached | `BUDGET_EXCEEDED` before the request, existing Get help toast |
| Document check finds gaps | Result lists the unsupported claims |

## Testing

### Unit

- text: tokenizer, stop words, hash stability.
- chunk: headings, lists, tables, long blocks, stable IDs, version changes, empty documents.
- corpus: every kind, empty sources skipped, deterministic order, no key fields.
- bm25: ranking, topK, character cap, ties, no match.
- prompt: static system, metadata headers, untrusted markers, no per-question data in system.
- answer: supported answer, unsupported refusal, missing citation refusal, unknown tag rejection, malformed JSON, truncation.
- check: supported, unsupported claims, unknown tags.
- core models and errors: `rag` and `ground` task config, `GROUNDING_FAILED` status.

### Server

- status counts.
- ask happy path with a fake client, citations and usage bucket `rag`.
- no retrieval refuses without a client call.
- no key and short question fail before the call.
- check happy path and unsupported claims.
- route smoke tests.

### Web

- `rag.test.js` with a memory vault and fake `loadAi`: same cases as the server plus usage ledger, budget stop, and key absence from the export.
- `scripts/web-rag.mjs`: seed a profile, job, memory, and answer; ask an answerable question; assert the answer and citations; assert the request body contains only retrieved chunks; ask an unanswerable question and assert the refusal without a second call; check a tailored document and assert the unsupported claim list; force the budget and assert the stop; assert the SDK chunk still loads lazily; assert no key reaches our origin; assert no console errors.

### Evals

Add `evals/rag.test.js` with fixtures:

- answerable question cites the base CV,
- unanswerable question refuses,
- removing the supporting document flips the answer to a refusal,
- invalid citation is rejected,
- corpus with only a job description refuses personal questions.

No live API call. The eval uses a deterministic fake model response.

## Acceptance criteria

- Every supported answer cites only retrieved passages and returns the structured verification block.
- Unanswerable questions return the fixed refusal sentence, never a guess.
- Removing the supporting chunk flips an answer to a refusal in the eval.
- Unknown citations and malformed output are rejected, not displayed.
- No document text, index, or embedding leaves the browser or desktop except inside the candidate's own Anthropic request.
- Prompt caching is on and no sampling parameters are sent.
- The web browser proof exercises the real UI against a mocked Anthropic endpoint.
- All existing gates stay green.

## Out of scope

- Embeddings, vector databases, hosted retrieval, cross-user retrieval.
- Automatic ingest of employer pages or email.
- Automatic post-tailoring checks. The explicit check is the grounding pass for this arc; automatic checks are a follow-up.
- Multi-turn chat over documents. Each request is independent.
- Saving RAG answers to the answer bank automatically. The candidate copies or saves manually.
