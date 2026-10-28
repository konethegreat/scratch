# Scraper Resilience: Design

**Status:** approved 2026-10-28, implementation starting
**Date:** 2026-10-28
**Arc:** 7 of the post-M3a-3 pipeline
**Sources of truth:** the user's scraping brief of 2026-10-28, [`2026-10-27-post-m3a3-pipeline.md`](2026-10-27-post-m3a3-pipeline.md) section "Arc 7", and [`POLICY.md`](../../../sa-job-agent-suite/POLICY.md) section 4.

## Goal

A job board changing its CSS classes, its markup or its API should not silently break a source. The hunter should read the most stable representation of the page it can find, validate every row before saving it, and when it truly cannot recover, say exactly what broke and how to reproduce it. No corrupted row reaches the tracker, and no failure reads as a healthy empty result.

This arc also sets the honest anti-bot baseline: real Chrome with the existing persistent profile, South African locale and timezone, polite pacing, backoff on rate limits, and a clear handoff when a site challenges or walls the browser. It does not solve CAPTCHAs, rotate proxies or spoof fingerprints.

## Non-goals

- Signing in, storing site credentials, reusing a LinkedIn or other cookie session, and surfacing session state. Those belong to Arc 8, which also owns real-browser apply and consent.
- Changes to the hosted web app. The scraper pipeline is desktop-only. The web app keeps using public feeds.
- Direct per-site API clients. Interception uses the page's own requests, so no private endpoint or token has to be reverse-engineered up front.
- New runtime dependencies. The schema validator is a small module in `@sajas/core`.
- Changing the South Africa gate, scoring, link validation, canary cadence or circuit breaker semantics beyond the new quality fields.

## Current state

- `server/src/hunter/registry.js` registers 12 declarative sources. Each source declares `extractInPage`, a self-contained function with CSS and `[class*=]` selectors.
- `server/src/hunter/runner.js` (`fetchSourcePage`) loads one page, detects blocks, then runs `extractInPage`.
- `server/src/agents/agent1-hunter.js` merges the source DOM rows with a JSON-LD fallback (`scrapeJsonLd`) and may call the AI extractor (`hunter/aiExtract.js`) when a first page returns zero rows.
- `server/src/hunter/health.js` and `healthStore.js` compute source status, baselines, cooldown and a circuit breaker from run records. `canary.js` runs one page per source and records a pass or fail.
- `server/src/hunter/blockDetect.js` classifies rate limits, denial, login walls and challenge pages.
- The browser is already a persistent context at `BROWSER_PROFILE_PATH`, launched with `channel: 'chrome'` and a Chromium fallback, with `locale: 'en-ZA'` and `timezoneId: 'Africa/Johannesburg'`.
- `SourceHealth.jsx` already renders the `via` field of a run, so a strategy name can be shown without a new screen.

## Decisions

1. **Honest anti-bot baseline.** Keep the real Chrome persistent profile, add consistent headers and per-host pacing, respect `Retry-After`, retry only 429, 503 and transient network errors, and hand off login walls and challenges to the user. Never auto-solve a CAPTCHA, never rotate proxies, never patch fingerprints beyond the existing `--disable-blink-features=AutomationControlled` flag. The rationale is in `POLICY.md` section 4: if a board blocks automated access, the user should use the board's own interface.
2. **Structured data first when it is valid, but yield wins.** All strategies run on the same loaded page and cost no extra network. The strategy with the most valid rows wins. Ties prefer structured, then source DOM, then semantic DOM. This avoids preferring a thin but stable payload over a rich DOM.
3. **One validator for every strategy.** Structured, DOM, semantic and AI rows all pass the same `validateJobCard`. A row is accepted or rejected with a field and a reason.
4. **AI extraction stays last and stays opt-in.** It runs only when every free strategy returns zero valid rows, only on the first page of the first query, only with a key, within the existing shared budget, and never in a canary.
5. **Quality is part of health.** The run record gains the winning strategy, valid and rejected counts, and the top rejection reasons. A high rejection ratio turns the source broken or degraded instead of silently saving bad rows.
6. **Debugging is a first-class workflow.** A manual CLI replays one source through the whole pipeline and can save the HTML, captured payloads and a report. The guide explains how to go from a canary failure to a fixed source.

## Architecture

### New and changed modules

| Module | Responsibility |
|---|---|
| `packages/core/src/scrape/cardSchema.js` | Pure job-card validation and normalization. No dependencies, no I/O. |
| `packages/core/src/scrape/index.js` | Subpath barrel. `@sajas/core/scrape`. |
| `server/src/hunter/capture.js` | Collects same-origin JSON responses, embedded state and JSON-LD from a loaded page. |
| `server/src/hunter/structured.js` | Maps captured payloads to job cards, source adapter first, then JSON-LD, then generic job arrays. |
| `server/src/hunter/semanticDom.js` | Self-contained in-page extractor that uses semantic attributes and heading anchors. |
| `server/src/hunter/extract.js` | Runs the strategies, validates rows, picks the winner and returns counts. |
| `server/src/hunter/browser.js` | One context factory for hunter, canary and login browser. |
| `server/src/hunter/pacing.js` | Pure delay, retry and `Retry-After` policy. |
| `scripts/hunter-debug.mjs` | Manual single-source replay with optional snapshot saving. |
| `docs/SCRAPER-DEBUGGING.md` | Triage guide and adapter recipe. |

Changed: `runner.js` (capture and extractor hooks), `canary.js` and `agent1-hunter.js` (use the pipeline and context factory), `health.js` and `healthStore.js` (quality fields), `SourceHealth.jsx` only if the strategy labels need mapping, `package.json` (subpath export and the manual debug script).

### Page lifecycle

1. The hunter creates one context from `browser.js` and opens a page.
2. Before navigation, `runner.fetchSourcePage` installs the capture collector on the page.
3. Navigation runs with the existing `domcontentloaded` and idle wait. The collector records same-origin JSON responses as they arrive.
4. After load, the runner reads embedded state and JSON-LD, then runs block detection exactly as today.
5. If the page is blocked or has a failing HTTP status, extraction is skipped and the block or error is returned. No strategy runs on a bot wall.
6. Otherwise `extract.js` runs every free strategy, validates the rows and returns the winner, the per-strategy counts and the rejection reasons.
7. If and only if every free strategy returned zero valid rows, the injected AI extractor may run once. The runner never imports the AI client; the hunter passes the callback.
8. The hunter applies the South Africa gate, scoring, link validation and saving as today.

### Strategy contract

Every strategy returns raw items in the existing card shape (`title`, `company`, `location`, `description`, `applyUrl`, `datePosted`, `source`). The orchestrator tags each candidate with its strategy name and validates it.

| Order | Strategy | Produces |
|---|---|---|
| 1 | `structured` | Source adapter result, else JSON-LD `JobPosting` nodes, else generic job arrays found in embedded state or captured XHR JSON. |
| 2 | `dom` | The source's existing `extractInPage` result. |
| 3 | `semantic` | Semantic DOM extractor result. |
| 4 | `ai` | Existing AI page extractor result. Only when 1 to 3 yield zero valid rows. |

Winner: most valid rows. Tie-break: `structured`, then `dom`, then `semantic`. If all are zero, the run is an empty result and the AI chance is considered. A strategy that throws is recorded as an error candidate and does not stop the others.

### Capture limits

- Same-origin JSON responses only, where the content type is `application/json` or ends in `+json`.
- At most 12 responses, 512 KB per response, 1.5 MB in total. A response over the per-response cap is skipped, and the collector stops once the total cap is reached.
- Body reads are best effort. A failed or aborted body is ignored, never fatal.
- Embedded state: known globals `__NEXT_DATA__`, `__NUXT__`, `__INITIAL_STATE__`, `__APOLLO_STATE__`, and `script[type="application/ld+json"]`. At most 5 scripts or globals, 2 MB per payload.
- JSON parsing is strict. A malformed payload is skipped and counted, never thrown.
- Generic job-array detection is bounded: depth 12, 5,000 visited nodes, 200 items per array, and at least one title-like string per item.

### Card schema

`validateJobCard(raw, { linkless = false } = {})` returns `{ ok, value, issues }`, where `issues` is a list of `{ field, code, message }`.

| Field | Rule | On failure |
|---|---|---|
| `title` | Required, trimmed, 4 to 300 characters | Reject the row |
| `applyUrl` | Required when `linkless` is false, optional when `linkless` is true; must parse as absolute http(s), at most 500 characters | Drop the field when optional and empty; reject the row when present but invalid or when required and missing |
| `company` | Optional string, trimmed, at most 200 characters | Drop the field |
| `location` | Optional string, trimmed, at most 200 characters | Drop the field |
| `description` | Optional string, trimmed, at most 5,000 characters | Drop the field |
| `datePosted` | Optional string, trimmed, at most 100 characters | Drop the field |
| `source` | Optional string, trimmed, at most 100 characters | Drop the field |

Unknown fields are dropped. Non-object rows are rejected with `invalid-row`. A rejected row is never saved. `validateJobCards(list, options)` returns `{ valid, rejected, rejectReasons }`, where `rejectReasons` holds at most three human-readable summaries.

### Quality gate and health

- `summariseRun` gains `strategy`, `valid`, `rejected` and `rejectReasons`, all defaulted so old callers keep working.
- Acceptance ratio is `valid / raw` when `raw > 0`.
- With `raw >= 4`: ratio below 0.8 is `broken` with reason "the page layout changed: N of M cards failed validation"; 0.8 up to 0.95 is `degraded` with the top rejection reason; 0.95 and above is healthy on that check.
- With fewer than 4 raw rows, the existing title/link completeness check decides, so one odd row cannot swing a source.
- The block and error checks keep their precedence. A blocked page is never judged by its row quality.
- `via` becomes the winning strategy name (`structured`, `dom`, `semantic`, `ai`, `mixed`, `none`). `SourceHealth.jsx` maps the names to plain labels and keeps showing unknown values unchanged.

### Pacing and backoff

- A per-host minimum interval, default 2,000 ms, with jitter of up to 500 ms, added before each page after the first. The existing per-source delay and between-source delay stay.
- `Retry-After` on 429 or 503 is honored in seconds or as an HTTP date, capped at 60 seconds.
- At most two retries, at 5 seconds and 15 seconds, and only for 429, 503, 408 or a transient network error before any content was read. A login wall, a challenge page or a 401/403 is never retried.
- Retries never apply to the AI extractor or to the link validator in this arc.
- All timing is injected so tests use a fake clock and a recording sleeper.

### Handoff copy

- Login wall: "PNet needs you to sign in. Open the login browser, sign in, then run the hunt again." The existing `needs-login` status and login browser stay the destination.
- Rate limit or challenge: "PNet asked us to slow down. The source cools down for six hours; use the site's own search until then." The existing cooldown and circuit breaker enforce it.
- No new auto-retry loop, no CAPTCHA interaction.

### Debug CLI

`node scripts/hunter-debug.mjs --source pnet --keyword developer [--location Johannesburg] [--headful] [--save] [--html path]`

- Runs one page through capture, all free strategies and the schema gate. No AI call, no key needed.
- Prints the source, URL, HTTP status, title, block verdict, each strategy's raw and valid counts, the winning strategy, the top rejections, and the first valid row.
- `--save` writes `hunter-debug/<source>-<timestamp>/page.html`, `capture.json` and `report.json`. The folder is gitignored.
- `--html` replays a previously saved page with Playwright `setContent` so a failure can be debugged offline. Replay uses the saved capture JSON.
- The CLI is manual only. It is not part of `npm test`, `test:web` or CI.

## Testing strategy

- Core schema: accept and reject matrix, URL handling, caps, unknown fields, malformed inputs, linkless sources.
- Capture: fake response stream, content type and origin filters, per-response and total caps, body failures, late responses, embedded state shapes, malformed JSON.
- Structured mapping: JSON-LD shapes including `@graph` and arrays, Next.js state, generic XHR arrays, source adapters, dedupe, relative URLs, hostile sizes.
- Semantic DOM: a Playwright page built from a static fixture string, proving attribute, heading and anchor extraction and the card cap.
- Pipeline: strategy selection and tie-breaks, invalid rows rejected before saving, AI only after all free strategies are empty, AI never in a canary, thrown strategy does not stop the others.
- Health: ratio thresholds with small and large samples, backward compatibility with old run records, blocked precedence.
- Pacing: interval, jitter bounds, `Retry-After` seconds and date, cap, retry limits and no retry for login or 403.
- Runner: capture installed before navigation, blocked pages skip extraction, meta carries the strategy and counts.
- Source contract: every registry source still passes its fixture and its canary spec.
- Browser context: option assertions only, no browser launch in unit tests.
- Manual live check: after merge, run the debug CLI against two major sources with one page each and record the strategy, valid count and rejection summary in the PR. No live scraping in CI.

## Acceptance

- Every source run reports a winning strategy and valid and rejected counts.
- A CSS-only breakage either recovers through structured or semantic extraction, or marks the source broken with named reasons. No invalid row is saved.
- A blocked page never runs extraction and never reads as healthy.
- The debug CLI reproduces a source failure from a saved snapshot.
- All existing gates stay green: core, server, client, web, desktop smoke, secret scanner, CI.
- The honest anti-bot baseline is documented in `README.md` and the debugging guide, including what the tool will not do.

## Risks

- **Runner change touches every source.** Mitigation: the source DOM strategy is unchanged at first, the pipeline is defaulted on, and the source contract tests plus canary fixtures gate the refactor.
- **Semantic extraction can produce false cards.** Mitigation: the same schema gate, title length, a link requirement unless the source is linkless, a 100-card cap, and the strategy only wins on valid-row count.
- **Captured XHR bodies can be large.** Mitigation: per-response and total caps, same-origin only, and best-effort reads.
- **A structured payload can be thinner than the DOM.** Mitigation: valid-row count decides the winner, not strategy order alone.
- **Health thresholds could over-report breakage.** Mitigation: ratio checks only at four or more raw rows, with completeness as the fallback.

## Rollout

1. Core schema and its subpath export.
2. Capture and structured mapping.
3. Semantic DOM extractor and pipeline.
4. Runner and hunter integration, health quality fields and UI label mapping.
5. Browser factory and pacing.
6. Debug CLI, guide and docs.
7. Gates, PR, merge, manual live check against two sources, then update this document to shipped.
