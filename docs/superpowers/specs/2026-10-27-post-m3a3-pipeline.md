# Post-M3a-3 delivery pipeline

**Status:** active
**Owner:** Kone
**Created:** 2026-10-27
**Extends:** [`2026-10-24-sa-jas-v2-master-plan.md`](2026-10-24-sa-jas-v2-master-plan.md)

## Purpose

M3a-3 shipped the hosted web alpha: zero-knowledge key handling, the web shell, job feeds, dedupe, and the tracker. The master plan defines the architecture and milestones M0 to M6, but it did not give the follow-up work a named lane. This document names the arcs that come next, so none of them is dropped or silently reordered.

A request from 2026-10-27 asked for three things beyond M3a-3: verify the app against the current Anthropic API, make the free hosted app survive real traffic without exposing keys or mixing users, and refresh the UI with light mode and a home page built from Kone's public work. The first two are correctness and safety work. The third is committed product work, not a nice-to-have.

A second request on the same day chose the next four capabilities, in order: web tailoring, agentic RAG, real-browser auto-apply, and inbox/MCP. It also added a support section with Kone's public contact details to the first of those arcs. The user's condition is explicit: the system has to work before it is shown to anyone. Each arc therefore ends with a live browser check of the real flow, not only green tests.

## Order

| # | Arc | Status | Ships when |
|---|---|---|---|
| 1 | API compliance | Shipped 2026-10-27 (PR #8, `fd4863f`) | All offline tests pass and each changed API assumption cites the docs |
| 2 | Live-scale hardening and isolation | Shipped 2026-10-27 (PR #9) | Isolation, key-canary, spend-cap and feed-failure tests pass |
| 3 | UI/UX refresh | Shipped 2026-10-27 (PR #11) | Light mode, copy sweep and the new home page pass the acceptance list below |
| 4 | Web tailoring and support | In progress | A visitor tailors CV and letter in the browser, spend is tracked and capped, and support is reachable |
| 5 | Agentic RAG over candidate documents | Planned | Answers cite retrieved passages, refuse when unsupported, and pass the grounding eval |
| 6 | Real-browser auto-apply | Planned | A feasibility gate picks the delivery form, then the chosen form passes an end-to-end apply rehearsal |
| 7 | Inbox and MCP integration | Planned | A feasibility gate picks the delivery form, then the chosen form passes an offline integration test |

Arcs run in order. Arc 2 depends on Arc 1 because retry and error behaviour shape what the isolation tests can assert. Arc 3 depends on Arc 2 because the redesign should not land on top of a shell that is still changing. Arc 4 depends on Arc 3 because tailoring uses the refreshed document pane and the shared design tokens. Arc 5 depends on Arc 4 because retrieval is applied to the documents that web tailoring produces. Arcs 6 and 7 depend on Arc 5 because both need grounded candidate and employer context.

## Arc 1: API compliance

**Goal:** make every Anthropic API assumption match the current documentation, and make the cost estimate honest enough to trust for budgeting.

Scope:

- Use the current web search tool type, `web_search_20260318` (the previous `web_search_20260209` is deprecated).
- Send a current `anthropic-version` from the browser key check (the API overview uses `2026-10-21`).
- Treat `model_context_window_exceeded` as truncation, alongside `max_tokens`, and keep `pause_turn` continuation in the documented shape: append the assistant response, assistant last.
- Map HTTP 403 `permission_error` to a distinct user-facing code, so a valid key that lacks access to a model is not reported as an invalid key.
- Account for 1-hour cache writes at 2x input, separate from 5-minute writes at 1.25x.
- Account for Haiku 5.5 long-context pricing above 100k prompt tokens.
- Do not retry a 429 that is a spend cap. A spend cap is not transient, so retrying it only delays the plain error.
- Wire the probe-derived capability flags into the self-degrading path, and mark both frontier models explicitly.

Acceptance criteria:

- `npm test` passes offline, with no `ANTHROPIC_API_KEY` set and no network call to Anthropic.
- A test fails if the web search type, API version, stop-reason handling, 403 mapping, cache multipliers, or long-context prices regress.
- The README error table and the error contract docs list the new code.
- No key-shaped string is added to the repo.

Out of scope: live smoke calls, live evals, and any change that needs a real Anthropic key.

## Arc 2: Live-scale hardening and isolation

**Goal:** make the claim "free, hosted, bring your own key, and isolated per browser" true under load and under attack.

The hosted app is static. There is no origin server to exhaust, and user data lives in each browser's IndexedDB. The real risks are therefore different from a normal web app:

- XSS on the hosted origin stealing a key or reading profile data.
- One browser profile reaching another user's data.
- A malicious page framing the app or reading it through a shared origin.
- Upstream feed changes, partial failures, and rate limits.
- IndexedDB eviction or quota exhaustion deleting a user's tracker.
- Deploy abuse and accidental secret publication.
- A user's own key hitting provider rate limits or spend caps.

Scope:

- Write the isolation model down: origin, storage partition, key lifetime, backup contents, and what the app never sends to the origin.
- Add a key canary test that asserts the key never appears in the DOM, localStorage, sessionStorage, IndexedDB plaintext, backup JSON, analytics, or any request to our origin.
- Add a cross-profile isolation test: two browser contexts, separate tracker data, no bleed.
- Add CSP and frame-ancestors assertions to the deployed headers, and a test that third-party script cannot be injected.
- Add feed failure isolation: one failed feed does not blank the other two, retries are bounded, and the UI says which feed failed.
- Add storage pressure handling: quota errors explain the fix and never silently drop data.
- Document the free-tier limits and the residual risks that cannot be fixed in a static app.
- Add spend-cap and rate-limit behaviour tests on the client path.

Acceptance criteria:

- Every item above has a test or a documented manual check with evidence.
- A stranger opening the live URL in a fresh browser sees no other user's jobs.
- Removing the key and clearing site data removes every key-derived artifact.
- The security notes state plainly what the free host does and does not protect.

**Shipped 2026-10-27 in PR #9.** Evidence: `npm run test:web` runs the canary, the feeds failure pass and the two-context isolation pass; `SECURITY.md` records the free-plan limits and residual risks.

Out of scope: a backend, accounts, server-side storage, and anything that would put user data on our origin.

## Arc 3: UI/UX refresh (committed)

**Goal:** make the product look and read like deliberate work by a specific builder, not a generated template, and give it a home page that presents Kone's public portfolio.

Design direction:

- Light-first, with dark mode retained. One accent colour, restrained surfaces, and tokens instead of hard-coded dark values.
- K-ONE-inspired palette and typography, using the published client site as the reference, not a generic dashboard kit.
- No em dashes in user-facing copy. No gradient hero text, glassmorphism on every card, emoji icons, filler adjectives, or copy that explains the obvious.
- Motion only where it carries meaning: page entry, state changes, and a scroll-linked progress rail on the home page.
- The home page presents only public work: SA-JAS, Vigil, MuniSolve ZA, ClearCut, TimeLex, and Diary. It excludes all Mostoeneng Bill work. It links to the portfolio, the client site, the CV, and GitHub.

Scope:

- Add a theme toggle with three states: system, light, dark. Persist the choice and follow the OS preference on first visit.
- Apply the theme to every screen, including onboarding, key panel, feeds, tracker, backup, and error cards.
- Sweep user-facing strings for em dashes and AI-styled filler.
- Rebuild the home view as a portfolio-led landing page with selected work, a short builder statement, and clear entry points.
- Add accessible motion with `prefers-reduced-motion` support.
- Check keyboard navigation, focus visibility, and contrast in both themes.

Acceptance criteria:

- First visit follows the OS theme, the toggle persists, and there is no flash of the wrong theme.
- Light and dark both meet WCAG AA contrast for body text and controls.
- A repo check finds zero em dashes in user-facing strings.
- The home page names only the approved projects and links to the portfolio, client site, and GitHub. The CV link is deferred by the content ruling in the design spec.
- The home page makes no request to our origin and contains no key or profile data.
- Layout works at 360, 768, and 1280 pixels wide, with reduced motion enabled and disabled.
- The UI is tested in a browser, not only by unit tests.

**Shipped 2026-10-27 in PR #11.** Evidence: `npm run test:web` runs `scripts/check-ui.mjs` (tokens, AA contrast, zero em dashes, zero emoji, script order) and `scripts/web-ui.mjs` (pre-paint boot, first visit, toggle, system follow, keyboard, landing content, skip link, dialog, toast, 360/768/1280, reduced motion, console and network surface).

Out of scope: new product features, new data sources, and any change to the key lifecycle.

## Arc 4: Web tailoring and support (in progress)

**Goal:** make the Document Tailor tab work in the hosted app, with honest spend tracking, and give every visitor a support path.

The desktop tailor already exists and its prompts are pure. The web port blocks the endpoint, so the tab is visible and broken. This arc moves the prompts into `@sajas/core`, calls Anthropic directly from the browser with the visitor's key, records usage in IndexedDB, enforces the daily cap before every request, and adds Copy, Markdown download, and Print to PDF. It also adds a landing support section and an in-app Help tab with Kone's public contact details, an FAQ, and a report action whose diagnostics contain no key or personal data.

Full design: [`2026-10-27-web-tailoring-support-design.md`](2026-10-27-web-tailoring-support-design.md).

Acceptance criteria:

- A visitor with a valid key and a base CV tailors a saved job in the hosted app and sees both documents.
- Spend appears in the Usage panel and the daily cap stops a run before the request.
- A failed re-tailor keeps the previous documents; truncated or empty output is never saved.
- Copy, Markdown download, and Print to PDF work in a browser.
- The landing page and Help tab show the approved contact details and the FAQ.
- Every error toast offers "Get help" with diagnostics that contain no key, profile, job, or CV text.
- The client bundle does not load the Anthropic SDK until the first tailor run.
- All gates pass offline, then the live flow is checked in a real browser before promotion.

Out of scope: web research fan-out, memory digests, batch tailoring, server PDFs, and any request that carries user data to our origin.

## Arc 5: Agentic RAG over candidate documents

**Goal:** answer questions and draft application content from the candidate's own documents, with grounded citations and a refusal when the documents do not support an answer.

The user supplied `C:\Users\Kone\Downloads\ibm_style_advanced_rag_guide.md` on 2026-10-27 and asked that it shape Arcs 5, 6, and 7. Its protocols are binding for this arc:

- **Strict boundedness.** Answer only from the retrieved context. If the context does not contain the answer, say so in a fixed sentence. Do not use prior training knowledge to fill gaps.
- **Inline citation and attribution.** Every factual claim carries the source tag injected at the head of its chunk, for example `[Doc: base-cv | Chunk: 2]`.
- **Verification.** Self-audit claims and citations before answering, and return a structured result with `is_supported_by_context`, `answer`, and `cited_sources` when structured outputs are enabled.
- **Structural integrity.** Preserve tables, lists, and headings from the source.
- **Metadata injection.** Every chunk handed to the model starts with its document name, section, and chunk index.

One part of the guide is deliberately not adopted. It recommends temperature 0.0 to 0.1 and top-p 0.1 to 0.3. SA-JAS never sends sampling parameters, by standing API rule. Determinism comes from `output_config.effort`, the strict system prompt, the citation schema, and a verification pass. The spec will state this deviation and why.

Scope:

- Corpus: base CV, tailored CVs, cover letters, saved application answers, candidate memory insights, and saved job descriptions.
- Retrieval: a local lexical index (BM25 or equivalent) in the browser and on the desktop. No embeddings, no extra provider, no document text sent anywhere except the chosen passages in the user's own Anthropic request.
- Chunking with stable IDs, metadata headers, and a version stamp so stale chunks are dropped when a document changes.
- Surfaces: an "Ask your documents" panel, grounded application answers, and a grounding pass for tailoring that refuses to invent facts.
- Refusal path: a plain message naming which documents were searched and what is missing, with a link to add the missing document.
- Evals: offline fixtures with answerable and unanswerable questions, citation coverage, unsupported-claim detection, and refusal accuracy.

Acceptance criteria:

- Every answer cites the passages it used and returns the structured verification block.
- Unanswerable questions are refused with the fixed message, not guessed.
- A fixture set proves that removing the supporting chunk flips an answer to a refusal.
- No document text, index, or embedding leaves the browser or desktop except inside the user's own Anthropic request.
- Prompt caching and the no-sampling-params rule still hold.

Out of scope: a hosted vector database, server-side document storage, cross-user retrieval, and any automatic ingest of employer pages.

## Arc 6: Real-browser auto-apply

**Goal:** help the candidate complete a real application form without taking control away from them.

The hosted app is static and runs on a different origin from the job board. Browser security forbids a page from scripting another origin's form. Real-browser automation therefore cannot live in the hosted page. This arc begins with a feasibility gate that compares three delivery forms:

1. **Guided apply packet (web).** A per-field copy list, a one-click open of the application URL, and a checklist. Works everywhere, no extension, no credentials.
2. **Browser extension.** Fills the form in the active tab after an explicit user action. Needs store review, permissions, and a clear scope, and must never submit silently.
3. **Desktop automation.** The existing Playwright copilot, improved and documented.

The gate picks the form with the best reach for the user's actual job boards, and the arc implements only that form. Rules for every form: no CAPTCHA bypass, no mass applying, no credential harvesting, no hidden submission. The user reviews and submits. The submit guard stays.

Acceptance criteria:

- A written feasibility decision names the chosen form and the rejected options with reasons.
- The chosen form completes a rehearsal against a local fake application form, with screenshots as evidence.
- The user must confirm before any real submission, and the app records what was submitted.
- No new secret leaves the device, and no third-party page is scripted without an explicit user action.

Out of scope: solving CAPTCHAs, bulk applications, and any automation that hides its actions from the user.

## Arc 7: Inbox and MCP integration

**Goal:** let the candidate pull application replies into the tracker and let their own tools read SA-JAS data safely.

The hosted app cannot receive mail or host an MCP server. This arc starts with a feasibility gate:

1. **MCP server for desktop.** A local, read-only-by-default server exposing jobs, memory, and documents to MCP clients such as Claude Desktop, with an explicit write scope and an audit log.
2. **Inbox import in the browser.** Parse forwarded `.eml` files or pasted messages into application events. No mailbox credentials in the web app.
3. **Desktop IMAP.** Read-only mailbox sync behind an explicit opt-in, with credentials in the OS keychain, never in the web build.

The gate picks what can ship safely first, and the arc implements that. Every form follows the same rules: read-only by default, explicit consent for each write, no background scanning without a visible switch, and no credentials outside the OS keychain or a native process.

Acceptance criteria:

- A written feasibility decision names the chosen form and the rejected options with reasons.
- Offline fixtures prove that a reply is matched to the right application and that nothing is written without confirmation.
- The MCP surface, if chosen, lists no key material and cannot read the web vault.
- Removing the integration deletes its credentials and stops all background work.

Out of scope: hosting an MCP server on our origin, reading mail without consent, and storing mailbox credentials in a browser.

## Gates

Every arc ends with the same gates, run from `sa-job-agent-suite/`:

```bash
npm test
npm run test:demo
npm run build:client
npm run build:web
npm run test:web
node tools/check-secrets.mjs --all
```

Plus, for every arc that ships user-facing behaviour: a live check on the deployed URL after the merge, and a short note in the PR describing what a human should click to verify the change. For Arc 4 onward the live check must exercise the real flow in a browser, not only load the page.
