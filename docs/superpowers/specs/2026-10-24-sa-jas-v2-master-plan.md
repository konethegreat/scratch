# SA-JAS v2 — Master Plan

**Status:** DRAFT for approval. Nothing in this plan has been built.
**Date:** 2026-10-24 · **Owner:** Kone
**One line:** Rebuild SA-JAS as an Anthropic-only, bring-your-own-key job agent that runs for free on a public host, finishes the work it starts, tells you when a scraper is broken, and can apply for you with explicit guardrails.

---

## 1. Intent

SA-JAS started as a local desktop tool with three agents (Hunter, Tailor, Apply Copilot). It works, but it was built on a multi-provider abstraction, 2026-H1 model assumptions, and brittle scrapers. The goals now:

1. **Anthropic only.** One provider, used properly: current models, prompt caching, structured outputs, streaming, compaction, memory, MCP.
2. **Agents that finish.** A run survives rate limits, token ceilings, context growth, and restarts. It pauses and resumes; it does not quietly quit.
3. **Model escalation.** Cheap model for mechanical work, stronger model when a deterministic signal says the cheap one failed. Never silently overspend.
4. **A Hunter you can trust.** Real pagination, a health board per source, and a fallback that still works when a site changes its HTML.
5. **Profile and session revamp.** A versioned candidate profile and a managed set of browser sessions.
6. **Assisted apply and auto-apply.** A graded autonomy ladder, enforced in code, with explicit warnings and a kill switch.
7. **Free public hosting, BYOK.** Users bring their own Anthropic key. Keys must never leak, and must be trivially removable.
8. **MCP-capable.** SA-JAS both exposes tools over MCP and hosts user-approved external MCP connectors (Gmail, Calendar, Drive, etc.).
9. **Go live.** A public alpha is a milestone in this plan, not an afterthought.

### Anti-goals (what would make this a failure even if it technically works)
- A key leaks, or is stored anywhere a user cannot delete it.
- A scraper returns zero results and the UI shows green.
- An auto-apply submits wrong answers because a field was low-confidence and nothing stopped it.
- An agent burns the user's credit in a loop with no ceiling.
- A model-escalation design that destroys the prompt cache and costs more than not escalating.

### Non-goals
- No accounts, payments, licence keys, or managed-key tier (supersedes ROADMAP phases B1/B2/B3).
- No server-side storage of CVs, answers, or keys.
- No CAPTCHA solving. Challenges are detected and handed to the human.
- No Gemini / OpenRouter / OpenAI code paths. They are deleted, not hidden.

---

## 2. Where the code is today (audit)

Read from the repo on 2026-10-24. "Hard ceiling" means a constant that can end a task early; each needs confirming with instrumentation in M0.

### 2.1 Stale against the current Anthropic API
| Finding | Where |
|---|---|
| SDK `@anthropic-ai/sdk ^0.98.0`; current TypeScript SDK is 1.x, and 1.0 is the first major that sends API version `2026-10-21` | `package.json` |
| Provider switch includes Gemini and OpenRouter; default model `claude-3-5-sonnet-latest`; AI-search default `claude-sonnet-4-6` | `agents/llm.js`, `agents/jobSearchAI.js` |
| `web_search_20250305` (basic). Current Sonnet 5.5 / Opus 5.5 get `web_search_20260209` with dynamic filtering, plus `web_fetch` | `jobSearchAI.js`, `companyResearch.js`, `referralAgent.js` |
| `computer_20251124` + beta header. On the Claude API, Opus 5.5 and Sonnet 5.5 return **400** unless the request uses `computer_toolset_20260801` | `agents/computerUse.js` |
| Free-text JSON from search (`extractJson` over prose) instead of structured outputs | `jobSearchAI.js` |
| Cost table is hand-maintained June-2026 prices | `db/costs.js` |
| `temperature` / `top_p` / `top_k` are rejected on API version `2026-10-21`; grep shows model/tool-string matches in 8 server files to audit | `server/src/**` |

### 2.2 Hard ceilings that can make an agent quit
| Ceiling | Value | Where |
|---|---|---|
| Search turn loop | 5 turns (4 for link repair), then "kept pausing" and the keyword is skipped | `jobSearchAI.js` `runSearchTurns` |
| Search output budget | 3000 / 4096 / 6000 tokens by depth. A JSON array of 20-25 jobs plus citations can exceed this and truncate to unparseable JSON | `DEPTH_SETTINGS` |
| Smart-fill output | 2000 tokens; CV excerpt truncated to 4000 chars | `agent3-applier.js` |
| Planner | 400 tokens per call, 25 calls per session | `pageBrain.js`, `PLANNER_CAP` |
| Computer-use | 12 steps default (1-25) | `computerUse.js` |
| Apply session | 20 min poll timeout | `agent3-applier.js` |
| Scrapers | 20 s navigation, 7-10 s networkidle, 80 cards/page, **first page only** | `agent1-hunter.js` |
| Rate limits | only the SDK's default 2 retries; no queue, no `retry-after` awareness, no token-bucket | everywhere |
| Cache | placed on system only; fan-out starts N tailor calls simultaneously (each writes its own cache entry, none read) | `llm.js`, `subAgents.js` |

### 2.3 Structure
- Single 2,737-line `client/src/App.jsx`; 1,357-line `agent1-hunter.js`; 1,382-line `agent3-applier.js`; 1,257-line `db/helper.js`.
- Data in a flat `db.json`; **keys in `keys.json` with POSIX mode 0600, which does nothing on Windows**, so on the main target platform the key file is plaintext.
- Express API on loopback, polled every 3 s for logs.
- Docs (`SECURITY.md`, `THREAT-MODEL.md`, `ROADMAP.md`) describe a local-only app or a managed-key business; all three need rewriting for BYOK.

### 2.4 Assets worth keeping
Injection shields and untrusted-content markers; `submitGuard.js` (hard submit refusal, with tests); DOM injection scanner; link validator (keep-on-doubt policy); `pool.js`; usage ledger and budget guard; synthetic demo and fixture pages (`scripts/demo.mjs`, `testSupport/`); `tools/check-secrets.mjs`; the memory/dreaming design.

---

## 3. Decisions

### 3.1 Calls I made (veto any of them)
1. **Hybrid delivery.** Free hosts cannot run Chromium with a persistent profile, and agent loops run for minutes. So: a **hosted web app** (static, free) does everything that needs only the Anthropic API; a **local Runner** (today's Electron/Node app, hardened) adds scrapers, browser sessions, assisted apply, auto-apply, and routines. One React UI, two shells.
2. **Local-first data ("Vault").** CV, answers, memory, jobs live on the user's device (IndexedDB in the web app, `db.json` in the Runner). The host stores nothing personal. This is also what keeps POPIA exposure near zero, and it is the only model a free host can afford.
3. **Zero-knowledge key handling.** In the web app the key goes **browser → api.anthropic.com** directly (SDK `dangerouslyAllowBrowser`). Our host never receives it, so it cannot log it or lose it.
4. **Cloudflare** (Pages + a small Worker) as the free host; GitHub Pages / Vercel Hobby as fallbacks. The TypeScript SDK supports Workers and browsers.
5. **Runtime-agnostic core.** New `packages/core` (AI layer, run engine, schemas) runs in browser, Worker, and Node. JavaScript with JSDoc + zod schemas; no TypeScript rewrite.
6. **SA-first.** Default market stays South Africa; the market-specific bits (sources, EE questions, locations) sit behind a "market pack" interface so other countries can be contributed.
7. **Models are looked up, not hard-coded.** A model registry reads capabilities from the Models API at runtime and prices from a versioned table with a user override.

### 3.2 Needs your answer (changes what gets built)
See section 17.

---

## 4. Target architecture

```
┌──────────────── Hosted (free: Cloudflare Pages + Worker) ────────────────┐
│  Web app (static React)                                                  │
│   • Vault in IndexedDB (CV, answers, memory, jobs)                       │
│   • core: AI layer + run engine (runs in the tab)                        │
│   • Key held in tab memory / passphrase-encrypted blob                   │
│  Gateway Worker (stateless, stores nothing personal)                     │
│   • Static assets, OAuth redirect relay for MCP connectors               │
│   • Public stateless MCP utilities (no user data)                        │
└───────────────┬──────────────────────────────────────────┬───────────────┘
                │ HTTPS (key in header, browser → Anthropic)│ optional pairing
                ▼                                          ▼
        api.anthropic.com                      ┌──── User's machine ────────────┐
        (web_search, web_fetch,                │ Runner (Node + Electron shell) │
         MCP connector, memory,                │  • core (same package)         │
         compaction, caching)                  │  • Hunter adapters + scrapers  │
                                               │  • Session Manager (browser    │
                                               │    profiles)                   │
                                               │  • Apply engine + SubmitPolicy │
                                               │  • Routines scheduler          │
                                               │  • MCP host (stdio servers)    │
                                               │  • Vault = db.json, key in OS  │
                                               │    keychain (safeStorage)      │
                                               │  • Loopback only (127.0.0.1)   │
                                               └────────────────────────────────┘
```

### 4.1 Capability matrix
| Capability | Web only | Web + Runner | Runner (desktop UI) |
|---|:--:|:--:|:--:|
| Hunt via Claude web search/fetch | yes | yes | yes |
| DOM scrapers, pagination, source health | – | yes | yes |
| Tailor CV + cover letter, research, memory | yes | yes | yes |
| PDF export | yes (client-side) | yes | yes |
| Application kit (PDFs, answers, copy buttons) | yes | yes | yes |
| Assisted apply in a real browser | – | yes | yes |
| Auto-apply | – | yes | yes |
| Routines (scheduled) | on-open catch-up | yes | yes |
| Remote MCP connectors | yes | yes | yes |
| Local (stdio) MCP servers | – | yes | yes |

### 4.2 One data port, two implementations
UI talks to a `DataPort` interface. `BrowserVault` (IndexedDB) and `RunnerApi` (loopback HTTP) implement it. Exactly one is active at a time; connecting a Runner offers a one-time, explicit "move my vault to the Runner" import. This avoids two sources of truth.

### 4.3 Repository shape (target)
```
packages/core      AI layer, run engine, schemas, ledger, policy, prompts
packages/sources   Hunter source adapters + fixtures + canary specs
packages/ui        shared React components
apps/web           hosted static app
apps/runner        Express API, Electron shell, Playwright, session manager
apps/gateway       Cloudflare Worker
```
Existing `sa-job-agent-suite/server` and `client` migrate into `apps/runner` and `packages/ui` incrementally behind passing tests; no big-bang move.

---

## 5. WS1 — AI core (Anthropic-only)

### 5.1 Client
- One factory `makeClient({ apiKey, runtime })`. Key is a per-call input, never a module global, never in `process.env`, never written to disk by core.
- SDK upgraded to 1.x with the `2026-10-21` API version; remove `temperature`/`top_p`/`top_k`; fix document/citation block placement per the migration guide.
- Streaming for anything long (`max_tokens` 64k for agent work, SDK `finalMessage()` helper). Typed error chain (429 → backoff using `retry-after`, 5xx/overloaded → retry, 400 → surface, 401 → "key invalid" UX).
- Refusal handling: check `stop_reason === 'refusal'`; enable the server-side `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`) on the 5.x models that support it; Haiku 5.5 has no server-side fallback, so it escalates by rung instead.

### 5.2 Model registry and ladder
Prices below are the cached table from 2026-10-06 and are re-verified in M0; the app reads them from the registry, not from code.

| Rung | Model | $/MTok in / out | Use for |
|---|---|---|---|
| 0 | `claude-haiku-5-5` | 0.10 / 0.50 | Page triage, link classification, form-label mapping, answer-bank matching, dedupe/scoring, universal page extractor, planner, "did anything change" checks |
| 1 | `claude-sonnet-5-5` | 2 / 10 | **Default workhorse**: search synthesis, tailoring, cover letters, free-text answers, company research, memory reflection, apply agent |
| 2 | `claude-opus-5-5` | 4 / 20 | Escalation: hard multi-step forms, `computer_toolset` fallback, failed-verification retries, scraper repair proposals, dreaming over a large dossier |
| 3 | `claude-fable-5-1` | 10 / 50 | Opt-in "Max" preset only. Needs 30-day retention; no Priority Tier; shown with a warning |

Facts that shape the design (from the API guide): Sonnet 5.5 and Opus 5.5 reject forced `tool_choice` (use `auto` + `strict: true` + prompt steering); thinking cannot be disabled on Opus 5.5 (control via `effort`, default `medium`); Sonnet 5.5 default effort is `high` (use `medium` for agentic work, `low` for chat); thinking blocks are model-bound; sampling parameters are gone; minimum cacheable prefix is 512 tokens on all of these models (so a normal CV now caches, which it did not on Haiku 4.5's 4096 floor).

### 5.3 Escalation policy (code, not model judgement)
A `Router.run(task, attempt)` picks the rung from `task.class`, then escalates **between attempts, never inside a conversation** (a mid-conversation model switch is a full cache miss and orphans thinking blocks).

Escalation triggers (each is a deterministic signal):
| Signal | Action |
|---|---|
| Output fails schema validation after one repair turn | next rung |
| Verifier fails (e.g. tailored CV contains an employer/degree/skill not in the base CV; cover letter outside length; required keywords missing) | next rung, with the verifier's findings appended |
| Form field confidence below threshold, or two fills rejected by the page | next rung for that page only |
| Apply agent makes no progress for N steps (same URL + same field set) | next rung, else hand to human |
| `refusal` | server fallback; otherwise next rung; otherwise surface |
| Rung ceiling reached, or budget reached | stop and ask the user; never escalate past the user's "max model" |

Rules: one rung per attempt; escalation state is stored on the run so a resume keeps it; every escalation is logged with the signal that caused it.

**The escalation ladder is a hypothesis until the eval says so.** The cost guide's finding is that the strongest model at lower effort often beats a multi-model cascade on cost per completed task, and a cascade forfeits cache sharing. Opus 5.5 is only 2x Sonnet 5.5, whereas Sonnet is 20x Haiku. So M1 includes an eval that compares, per task class: (a) Haiku→Sonnet→Opus ladder, (b) Sonnet at medium/high, (c) Opus at low/medium. The shipped defaults are whatever wins on cost per *successful* task. An advisor-tool pairing (Sonnet 5.5 executor + Opus 5.5 advisor, beta) is evaluated in the same run.

### 5.4 Prompt caching design
Prefix order, stable to volatile:
1. **Tools** (sorted by name, byte-stable).
2. **Global system**: role, injection shield, output rules. No dates, no IDs, no flags. Breakpoint 1.
3. **User dossier block**: base CV, profile summary, memory digest. Changes only when the profile changes or a nightly "dream" re-weights memory, never per application. Breakpoint 2.
4. **Job block**: description, research brief, per-job instructions. After the last breakpoint.
5. Dynamic reminders (mode changes, step counters) go in as mid-conversation `system` messages (turn-scoped with `clear_at` where supported), never by editing the system prompt.

Mechanics:
- Explicit breakpoint on the static prefix + top-level automatic caching for the conversation tail.
- **Warm-then-fan**: for N parallel tailor jobs, send the first, wait for its first streamed token, then start the rest so they read the cache the first one wrote. (Today they all write.)
- TTL: 5 min for bursts; 1 h for apply sessions where a human pauses between steps. Keep-alive with `max_tokens: 0` is evaluated against the 1 h TTL.
- Fork operations (summaries, sub-agents) reuse the parent's exact tools/system/model prefix.
- Pin `thinking` and `effort` per task class; never vary per request.
- **Verification:** unit tests assert `cache_read_input_tokens > 0` on the second identical call; the Usage panel shows cache-hit % per bucket; the dev build enables cache diagnostics (beta) and prints the divergence point on a miss.

### 5.5 Structured outputs everywhere
`output_config.format` JSON Schema for: search results, tailored documents (CV + letter + self-check), smart-fill, planner, memory reflection, dreaming, extractor, repair proposals. Search results come back as a schema-validated array, which removes today's truncated-JSON failure. Where a tool call must be reliable, `strict: true`.

### 5.6 Metering and budget (carry over, upgrade)
Keep the ledger and daily budget guard. Add: cost per *completed task* (hunt, tailor, application) rather than per call; per-run budget separate from daily; cache savings; escalation counts; estimate vs reality reconciliation (the Console invoice remains ground truth). The registry replaces `costs.js`.

**Done when:** one `ai.run()` entry point serves every feature; zero non-Anthropic imports remain; cache-hit assertions pass in CI; the eval picks the default ladder.

---

## 6. WS2 — Durable runs (agents that finish)

The central change: **a task is a persisted run, not a function call.**

### 6.1 Run ledger
```
Run { id, type, input, plan[], stepIndex, status, rung, effort,
      budget { tokens, usd, wallclock }, spent { tokens, usd },
      artifacts[], checkpoints[], notesPath, createdAt, updatedAt }
status: queued | running | paused_budget | paused_rate | paused_human | failed | done | cancelled
```
Stored in the Vault. Every step appends a checkpoint (what was done, what's next, artifacts). A crashed tab, closed laptop, or restarted Runner resumes from the last checkpoint.

### 6.2 Loop behaviour per stop reason
| `stop_reason` / condition | Behaviour (today → v2) |
|---|---|
| `pause_turn` | 5-turn cap → continue until the run budget is spent |
| `max_tokens` | truncated JSON, keyword skipped → checkpoint, re-ask with a larger cap or a "continue" user turn (no prefill on these models), merge results |
| context nearing window | not handled → server-side **compaction** (`compact-2026-01-12`) for long hunts and apply sessions; **context editing** of stale tool results (scraped pages) with a high trigger; append-only history to keep thinking blocks valid |
| `429` / overloaded | 2 SDK retries → shared token bucket per key from `anthropic-ratelimit-*` headers, honour `retry-after`, status `paused_rate` with a visible countdown |
| `refusal` | error → fallback / escalate / surface (see 5.1) |
| step cap (planner 25, computer-use 12) | silent stop → cost-based budget; cap only as a runaway backstop, set high, and reaching it pauses for a human instead of failing |
| session timeout (20 min) | kill → idle-aware: pause while waiting on a human, with no wall-clock death |

Task budgets (beta `task-budgets-2026-03-13`) are passed on long agent loops so the model paces itself and wraps up gracefully instead of being cut off; the run's own budget is the hard stop.

### 6.3 Concurrency
One scheduler per key: bounded parallelism (existing `pool.js` generalised), per-run priority, backpressure from the token bucket. Fan-out uses warm-then-fan (5.4).

### 6.4 UX
A **Runs** view: live step list, cost so far, current rung, pause/resume/cancel, "why did this stop?" in plain language. Replaces the 3-second log polling with server-sent events (Runner) or in-process events (web).

**Done when:** on a synthetic suite, runs complete under injected faults (429 storms, forced `max_tokens`, killed process mid-run, 200K-token tool-result growth) and resume without repeating paid steps.

---

## 7. WS3 — Memory

Three layers, kept separate:
1. **Run memory** (within a run): compaction + the memory tool scratch directory `/memories/run/<id>/progress.md`, so a resumed agent re-reads where it was.
2. **Candidate memory** (existing dossier): insights with weights, employer notes, application outcomes. Backed by the client-side **memory tool** (`memory_20250818`) so Claude can read and write it natively; the Vault stays the source of truth and exports to JSON.
3. **Source memory**: per-source learned facts (typical yield, selectors that last worked, block patterns). Feeds the health board (WS4).

Rules: the memory backend rejects anything shaped like a secret (reuse `scrubSecrets`); path-traversal-safe; per-user isolation is trivial because the Vault is local. Nightly Dreaming (existing) stays and runs on Sonnet 5.5; its output is a versioned digest, which is what the cached dossier block contains, so memory improves without invalidating the cache every application.

**Done when:** a two-week simulated history measurably changes tailoring output (rubric-scored) and the user can see, edit, and delete what was learned.

---

## 8. WS4 — Hunter v2

### 8.1 Source adapter interface
```
Source { id, tier, market, capabilities,
         search(query, cursor) → { items[], nextCursor, meta },
         canary: { query, expect: { minItems, requiredFields[] } } }
```
Tiers: **1** Claude web search/fetch (works in web-only mode); **2** DOM scrapers (Runner); **3** universal page extractor (Haiku 5.5 structured extraction from page text/ARIA snapshot; used when a Tier-2 adapter returns zero or fails its field check, and for employer career pages with no adapter).

The 12 current scrapers become Tier-2 adapters with recorded HTML fixtures, one at a time.

### 8.2 Pagination
- Cursor loop per source: fetch page → normalise → dedupe → continue while `nextCursor` and the new-unique-items ratio stays above a threshold, bounded by the depth preset's page cap, the run budget, and a time budget. Stop reasons are recorded (`exhausted | saturated | page_cap | budget | blocked`).
- AI search paginates by **continuation rounds with an exclusion list** (ids/URLs already seen), replacing the single 5-search pass; structured outputs remove truncation.
- Depth presets (light / standard / deep) now mean page caps and round counts, not just `max_uses`.
- API and UI: `GET /api/jobs?cursor&limit&status&q&sort`, same for runs, logs, memory; virtualised lists; no more fetching every job on each poll.

### 8.3 Source health board ("is the scraper still functional?")
Per source, computed from every run plus scheduled canaries:
| Signal | Meaning |
|---|---|
| yield vs 14-day median | silent breakage (200 OK, zero cards) |
| field completeness (title, company, URL, location, date) | selector drift (cards found, fields empty) |
| block signals (HTTP 403/429, challenge page titles, redirect to login) | bot wall / session expired |
| latency and timeouts | degraded |
| canary pass/fail against fixed query | ground truth |

Status: `healthy · degraded · broken · blocked · needs-login · disabled`, with last-success time and a plain-language reason. A **Test sources** button runs the canaries on demand; a daily canary routine runs in the Runner. Broken sources are circuit-broken: skipped with a visible reason and covered by Tier 3 / Tier 1 for that run. Contract tests replay recorded HTML in CI, so a contributor changing a scraper sees the break before merge.

### 8.4 Self-healing (proposals only)
When a source goes `broken`, a repair job gives Opus 5.5 the old selectors, the failing field set, and a trimmed fresh DOM snapshot, and asks for **new selectors as data** (not code). The proposal is auto-validated against the canary expectations and stored as `selectors.override.json`, applied only after the user approves (or exported as a patch for a PR). Model-written JavaScript is never executed.

### 8.5 Link quality
Keep the keep-on-doubt validator and junk-aggregator list. Add `web_fetch` verification for AI-search leads (confirm the posting exists and extract the canonical apply URL) in place of the separate "link repair" search.

**Done when:** every source shows a truthful status; a deliberately broken selector is detected within one canary run, flagged, and covered by Tier 3; a 5-page hunt returns more unique postings than today's first-page-only run on the same query; CI replays fixtures for all 12 adapters.

---

## 9. WS5 — Profile and sessions revamp

I read "persistent profile" as both of these; tell me if it means only one.

### 9.1 Candidate Profile v2
- Versioned, zod-validated schema with migrations from today's `profile` + `applicationProfile`.
- **Multiple personas** (e.g. Backend vs Data), each with its own base CV, keywords, locations, salary band, and answer overrides.
- CV import: upload PDF/DOCX → Claude extracts to structured fields (cheap rung) → user reviews field by field. LinkedIn data-export import.
- Sensitive fields (EE race/gender/disability, salary, criminal record) flagged, off by default, encrypted at rest with a passphrase-derived key, and never sent to a model unless the user marks the field "may be used to fill forms".
- Completeness meter tied to what forms actually ask (from the pending-questions history).
- Encrypted export/import of the whole Vault (passphrase), and a **panic wipe**.

### 9.2 Browser Session Manager (Runner)
Problems today: one shared `browser-profile/` that headless scraping and the visible apply browser both open (Playwright persistent contexts cannot be shared across processes, so runs can collide), no expiry awareness, no recovery from corruption.
- **Separate profiles**: `hunt` (headless-friendly, lower value) and `apply` (real Chrome profile, the valuable one).
- Per-site session records: logged-in check, last verified, expiry guess, "needs login" state surfaced on the source board (feeds `needs-login`).
- Profile lock handling, snapshot/restore of a known-good profile, one-click re-login window.
- Cookies stay in the OS-encrypted store of real Chrome where available; nothing session-related leaves the machine; **wipe sessions** button.
- Optional second path for later (stretch): a browser extension that fills forms in the user's own everyday browser and session, which removes the persistent-profile problem for web-only users.

**Done when:** migration preserves every existing user's profile; a hunt and an apply can run at the same time without a lock collision; an expired LinkedIn session shows up as `needs-login`, not as zero results.

---

## 10. WS6 — Assisted apply and auto-apply

### 10.1 Engine
Replace the keyword/heuristic autopilot with an **apply agent** running on the durable run engine:
- The model sees a compact **accessibility snapshot** (not raw HTML) and acts through **typed tools**: `fill_field`, `select_option`, `upload_file`, `click`, `read_page`, `ask_user`, `request_submit`. Typed tools give the policy engine a hook on every action (a bash-style "click anything" tool would not).
- Cheap deterministic first pass stays: `FIELD_DICT` + answer bank fill what is known with no model call; the agent handles the remainder.
- Escalation per page: Haiku planner → Sonnet agent → Opus, then `computer_toolset_20260801` for canvas or custom widgets, then human.
- ATS adapters (Greenhouse, Lever, Workable, SmartRecruiters first) get deterministic fillers; the agent handles their screening questions. Workday and account-gated flows come later.
- CAPTCHA/verification: detect, stop, hand off. Unchanged.

### 10.2 Autonomy ladder
| Level | Name | Behaviour |
|---|---|---|
| L0 | Observe | Opens and plans, types nothing |
| L1 | Assist (default) | Fills and attaches; **human reviews and clicks Submit** |
| L2 | Review & submit | Agent completes the flow, shows an **Application Review Card** (every field, its source and confidence, attachments, screenshots); one click from the user and the agent submits via the policy-checked path |
| L3 | Auto-apply | Agent completes and submits without per-application approval, only for applications that satisfy the **Auto-apply rules** |

### 10.3 SubmitPolicy (replaces the blanket "never click submit")
`submitGuard.js` becomes a **default-deny policy** evaluated in code before every submit action. L3 submits only if all rules hold:
- site is on the allowed list (initially employer ATS: Greenhouse/Lever/Workable/SmartRecruiters; boards' "easy apply" stays L2 until proven on supervised runs);
- match score ≥ threshold; tailored documents passed the fabrication verifier;
- every required field filled with confidence ≥ threshold; zero unanswered questions;
- no auto-answering of categories the user has not pre-declared (salary, criminal record, disability, race, right-to-work, references);
- no CAPTCHA, payment request, or identity-document request on the path;
- daily and weekly caps, per-company cap, no duplicates;
- **trust ramp**: at least N supervised (L1/L2) completions on that site before L3 unlocks for it;
- run budget not exceeded; kill switch not tripped.

Kill switch: UI button, global hotkey, and auto-stop after two consecutive anomalies (unexpected page, field rejected, confirmation missing). Every application writes an **audit record**: pre-submit screenshot, field table with sources, confirmation screenshot, policy decision. The same record backs the Review Card.

### 10.4 Warnings (shown as designed UX, not fine print)
Enabling L2/L3 requires a one-time acknowledgement screen, re-confirmed every 30 days, and a persistent banner while L3 is active. It states plainly:
- you are responsible for what is submitted in your name;
- submissions cannot be undone, and AI-filled answers can be wrong;
- many job sites' terms prohibit automation and may suspend accounts (shown as a per-site risk badge);
- employers may reject applications detected as automated;
- sensitive answers are never auto-filled unless you pre-declared them.
L3 is off by default and gated behind a typed confirmation.

**Done when:** on the synthetic ATS fixtures, L1 and L2 complete end to end; L3 refuses every rule violation in a table-driven test (zero false submits across the fixture matrix); the Review Card shows the true source of every field; supervised runs on real ATS pages meet an agreed success rate before L3 is switched on by default for any site.

---

## 11. WS7 — Keys and security (BYOK)

### 11.1 Key lifecycle
| Stage | Design |
|---|---|
| Entry | One field; validates shape (`sk-ant-api03-…`); **refuses `sk-ant-admin…`** keys; a test call (`models.list`) confirms it works. Onboarding guides the user to create a **dedicated Workspace key with a spend limit** in the Console |
| Web storage | Default: tab memory only. Option "remember on this device": AES-GCM blob in IndexedDB, key derived from a user passphrase (PBKDF2 via WebCrypto). Idle auto-forget (configurable). No plaintext in `localStorage`, URLs, cookies, or telemetry |
| Runner storage | Electron `safeStorage` (DPAPI on Windows, Keychain on macOS) or OS keyring; replaces `keys.json` |
| Use | Browser → `api.anthropic.com`; Runner → `api.anthropic.com`. The gateway Worker never sees it |
| Removal | **Forget key** (wipes memory + blob + OS entry), **Panic wipe** (key + Vault + sessions), and a one-click link to the Console to revoke. Both work offline |
| Leak resistance | Log/telemetry/export scrubbers (extend `scrubSecrets` to exports and Run ledgers); memory-tool writes screened; error reports are off by default and scrubbed |

### 11.2 Threat to defend: XSS on the hosted origin
If an attacker runs script on our origin, they can read the key from the tab. Controls:
- strict CSP: no inline script, no `eval`, `script-src 'self'`, `connect-src` limited to `api.anthropic.com`, the gateway, and `127.0.0.1`; Trusted Types; frame-ancestors none;
- all model output and scraped text rendered through a sanitiser (DOMPurify) or as text; previews of untrusted HTML go in a sandboxed iframe with no key access;
- no third-party scripts or fonts (fonts already local); SRI on anything external; lockfile pinned; `npm audit` + provenance in CI; dependency count kept small;
- reproducible builds with published hashes, so a user can verify the deployed bundle against the repo; self-host and localhost instructions front and centre.

### 11.3 Tests that prove it
- **Canary-key test:** plant `sk-ant-api03-CANARY…` as the key, run a full hunt/tailor/apply in the fixture environment, intercept all network traffic and all file/log/export output, and fail if the canary appears anywhere except as the auth header to `api.anthropic.com`.
- CSP and header tests against the built bundle; XSS payloads in job descriptions, CVs, and memory notes.
- `tools/check-secrets.mjs` in CI plus a pre-commit hook.

### 11.4 Other hardening
Loopback-only Runner (done), plus an origin allowlist (the hosted web origin and the Electron shell) and a short-lived pairing token; SSRF rules for any fetch the Runner performs (block private ranges, redirect limits); untrusted-content wrapping for **every** external input (job text, research, scraped pages, MCP tool results); prompt-injection regression suite; `applyUrl` scheme allowlist (existing); the Runner never executes model-written code.

**Done when:** the canary test, CSP tests and XSS suite pass in CI; key removal is verified to leave no trace on disk or in storage; SECURITY.md and THREAT-MODEL.md are rewritten for BYOK.

---

## 12. WS8 — MCP

Two directions.

### 12.1 SA-JAS as an MCP server
The Runner exposes tools (`hunt_jobs`, `list_jobs`, `tailor_application`, `get_ready_packages`, `start_assist`, `source_health`, `usage`) over stdio and loopback streamable HTTP so Claude Desktop/Code can drive it. Read tools by default; any tool that can cause an outward action (`start_assist`, anything that submits) is behind the same SubmitPolicy and requires approval. Completes ROADMAP T5.

### 12.2 SA-JAS as an MCP host
An **MCP Hub** lets the user attach connectors; the agent can then use them as tools.
- **Remote servers:** through the Messages API MCP connector (`mcp_servers` + `mcp_toolset`, beta `mcp-client-2025-11-20`). Anthropic connects to the server, so it must be a publicly reachable HTTPS endpoint (Streamable HTTP or SSE). The OAuth token goes browser → Anthropic and is never seen by our gateway. The connector feature is not eligible for zero-data-retention orgs; the UI says so.
- **Local servers (stdio):** the Runner hosts them using the SDK's MCP helpers and hands their tools to the run engine.
- **Allowlist mode:** `default_config.enabled = false`; the user enables individual tools. Write/send tools are `ask-every-time`. With many tools, `defer_loading` + tool search keeps the cached prefix small.
- **Results are untrusted data:** wrapped in untrusted markers, never allowed to trigger a submit or a send without a user step.

Useful connectors, in priority order: Gmail (parse confirmations and interview invites into the outcome log; draft, never send, follow-ups), Google Calendar (interview slots), Google Drive (CV import, package export), Notion/Sheets (tracker sync), a notifications channel (routine results), filesystem (local PDFs).

### 12.3 What the hosted gateway is for
Deliberately thin: static hosting, an OAuth redirect relay for connectors, and a few **stateless public MCP utilities** that touch no user data. Anything that needs a user's data or a real browser lives in the tab or the Runner. This keeps "free host" and "keys never leak" both true.

**Done when:** Claude Desktop can call the Runner's read tools; one remote connector (Calendar) works end to end from the web app; an injected instruction in a Gmail message does not cause a send or a submit (regression test).

---

## 13. WS9 — Hosting, build, release

- **Web:** Cloudflare Pages (static), `apps/gateway` Worker for the OAuth relay and public utilities. CI builds with a pinned lockfile and publishes bundle hashes.
- **Runner:** Electron installers (Windows first), `npx sa-jas-runner`, and a Docker image for self-hosters (headless features only). Auto-update opt-in and signed where possible.
- **CI (GitHub Actions):** unit + contract tests, fixture replays, canary-key test, CSP/XSS tests, `check-secrets`, `npm audit`, cache-hit assertion. A scheduled workflow runs live canaries and posts a source-status JSON, noting datacenter IPs are often blocked, so it is advisory and the Runner canary stays the source of truth.
- **Docs:** README rewrite, "5-minute setup with a spend-limited key", SECURITY/THREAT-MODEL/POLICY rewrites, ROADMAP superseded by this plan.

---

## 14. WS10 — Evals, observability, cost

- **Fixtures:** recorded job-board HTML, synthetic ATS forms (already in `testSupport/` and the demo), a CV corpus, a fabrication corpus (CVs with deliberately missing facts, to test the verifier).
- **Eval harness** (built per the API guide's eval workflow): per task class, pass rate and cost per *completed* task, three trials minimum; Pareto view of cost vs pass rate; used to pick the default ladder and effort, and re-run on every model change.
- **Rubrics:** deterministic checks first (no fabricated entities, length, keyword coverage, schema validity); a model grader only where nothing cheaper exists, and then on a fixed rung.
- **Observability:** per-run trace (steps, rung, tokens, cache hit, cost); optional OpenTelemetry export for contributors; the Usage panel gains cost-per-task, cache %, escalation counts.
- **Planning estimates (unmeasured, M0 replaces them):** a tailor call on Sonnet 5.5 with a cached 6K-token dossier and ~2K output is roughly 2-3 US cents; a "standard" hunt of 2 keywords x 5 searches is roughly 10 cents of search fees plus tokens at $10 per 1,000 searches; Haiku 5.5 reading a 20K-token page for extraction is about 0.2 cents. Apply-agent cost per application is the biggest unknown and is a first-class M0/M4 measurement.

---

## 15. Milestones

Sizes are relative effort (S/M/L/XL), not calendar estimates. Each milestone ships on its own.

| # | Milestone | Contents | Exit criteria | Size |
|---|---|---|---|---|
| **M0** | Foundations and truth | SDK 1.x + API `2026-10-21`; delete non-Anthropic code; model registry; fix the known hard ceilings that don't need the new engine (JSON truncation, turn caps); instrument runs; fixture + baseline eval set; monorepo skeleton, `packages/core` extracted | App runs Anthropic-only on 5.x models; baseline cost-per-task measured; all existing tests green | L |
| **M1** | AI core + durable runs | WS1, WS2, WS3 (run + candidate memory) | Cache-hit assertions pass; fault-injection suite resumes cleanly; eval picks the ladder | XL |
| **M2** | Hunter v2 | WS4: adapters, pagination, health board, canaries, Tier-3 extractor, repair proposals | Truthful status board; broken-selector drill passes; more unique postings than baseline | L |
| **M3** | **Public alpha (live)** | Web app on free host: web-only mode (AI hunt, tailor, research, memory, tracker, client-side PDFs, application kit), BYOK + WS7, Runner download as beta | Canary-key, CSP and XSS tests pass; a stranger can paste a key and get a tailored package without installing anything; key removal verified | XL |
| **M4** | Profile, sessions, assisted apply | WS5, WS6 up to L1 and L2, ATS adapters (first four), Review Card, audit log | L1/L2 pass fixture matrix; supervised real-site trial hits the agreed success rate | XL |
| **M5** | Auto-apply | L3 behind a flag, SubmitPolicy full rule set, trust ramp, kill switch, warnings flow | Table-driven policy tests: zero false submits; staged rollout per site | L |
| **M6** | MCP hub + reach | WS8 both directions, first connectors, Runner MCP server; stretch: browser extension track | Desktop-driven read tools; Calendar connector end to end; injection regression passes | L |

### 15.1 Post-M3a-3 pipeline

M3a-3 is delivered. The work that follows the alpha is tracked in [`2026-10-27-post-m3a3-pipeline.md`](2026-10-27-post-m3a3-pipeline.md): API compliance (in progress), live-scale hardening and isolation, then the committed UI/UX refresh (light mode, copy sweep, and a portfolio-led home page). That document is the authority for order and acceptance criteria.

**Why the live date comes before apply:** M3 needs only the AI core, Hunter Tier 1, and security. Apply needs the Runner and is the highest-risk piece, so it ships after the public surface is proven.

**Parallel lanes once M0 lands** (each could be its own session): core/runs (M1) · Hunter adapters (M2) · web shell + security (M3 groundwork) · docs/CI. M1 gates M3 and M4; M2 only gates the Runner side of M3.

---

## 16. Risk register

| Risk | Mitigation |
|---|---|
| Key stolen via XSS on the hosted origin | CSP/Trusted Types, sanitisation, no third-party script, reproducible builds, passphrase-encrypted at rest, canary test, self-host path |
| Users' accounts banned for automation | Per-site risk badge, warnings, trust ramp, L3 limited to employer ATS first, human-first defaults |
| Wrong answers submitted | Confidence gates, fabrication verifier, Review Card, unanswered-question block, audit trail |
| Cost runaway in agent loops | Run + daily budgets, task budgets, shared rate limiter, caps that pause instead of fail |
| Cascade costs more than a single model | Eval gate before shipping the ladder; cache-aware escalation between attempts only |
| Scrapers rot faster than we fix them | Canaries, health board, Tier-3 extractor, selector-proposal flow, fixture contract tests |
| Browser blocks calls to the local Runner from the hosted page (private-network rules differ by browser) | Verify per browser in M3; fallback is the Runner serving the same UI itself (desktop shell) |
| Models/API shift again | Registry reads the Models API; the eval re-runs on every model change; no model IDs outside the registry |
| MCP connector prompt injection | Untrusted wrapping, allowlist mode, writes behind approval, regression suite |
| Browser PDF quality differs from today's Playwright render | Client-side PDF path built and compared in M3; Runner keeps the Playwright renderer |

---

## 17. Questions for you

1. **Delivery shape.** Is hybrid right (free web app for AI-only features + local Runner for browser work)? The alternatives are desktop-only, or everything in the browser with no Runner (which drops scrapers, sessions, and apply from the hosted version).
2. **"Persistent profile".** Do you mean the browser sessions, the candidate profile, or both? I planned for both.
3. **Auto-apply scope for the first release.** My plan limits L3 to employer ATS pages and keeps LinkedIn/Indeed/PNet easy-apply at L2 (review-then-submit). Do you want boards in L3 from the start, with the warnings doing the work?
4. **Free host.** Cloudflare (my pick) or Vercel?

Anything else in sections 3.1 and 10 is my call and can change.
