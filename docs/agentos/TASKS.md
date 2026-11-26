# Tasks

The canonical copy of this document is docs/TASKS.md; this file mirrors it for
agents that look under docs/agentos first. Change both in the same pull
request.

## Phase 1: One ordered index for agents and contributors

- [x] Research: read the master plan, every spec under docs/superpowers/specs/, README.md, PUBLICATION.md, and ROADMAP.md, and list which workstreams are open, done, or superseded. (Spec: `docs/superpowers/specs/2026-10-24-sa-jas-v2-master-plan.md`, `docs/agentos/REPORT.md` Workstream Inventory)
- [x] Write docs/agentos/TASKS.md as the ordered index, each task naming the spec path that defines it, and the matching docs/agentos/PHASES.md headings. (Spec: `docs/superpowers/specs/2026-10-24-sa-jas-v2-master-plan.md`, `docs/PHASES.md`)
- [ ] Link docs/agentos from README.md in one line next to the roadmap mention, and mark ROADMAP.md as historical with a pointer to the master plan. (Spec: `docs/superpowers/specs/2026-10-24-sa-jas-v2-master-plan.md` Non-goals, `ROADMAP.md`)
- [ ] Review: confirm docs/PHASES.md and docs/TASKS.md match docs/agentos, no secrets, no `.env` content, and no em dash or en dash in the added text. (Spec: `AGENTS.md` Law 2, `docs/PHASES.md` Phase 1)
- [ ] Improvement: add a short "how to pick the next task" note at the top of docs/agentos/TASKS.md that tells an agent to take the first unchecked task in the earliest incomplete phase. (Spec: `docs/PHASES.md` Phase 1)

## Phase 2: AI core aligned with the current Anthropic API

- [ ] Experiment: run the dry-run evals against the current client and record which checks fail because of API drift, without making any paid call. (Spec: `docs/superpowers/specs/2026-10-24-sa-jas-v2-master-plan.md` sections 2.1, 5)
- [ ] Enhancement: upgrade `@anthropic-ai/sdk` to 1.x and remove any non-Anthropic provider paths so the client is Anthropic-only. (Spec: `docs/superpowers/specs/2026-10-24-sa-jas-v2-master-plan.md` sections 2.1, 5.1)
- [ ] Implementation: implement the model registry from master plan section 5.2 as one module, with tests, and move the existing model IDs behind it. (Spec: `docs/superpowers/specs/2026-10-24-sa-jas-v2-master-plan.md` section 5.2)
- [ ] Implementation: implement the escalation policy from section 5.3 as tested code, replacing any model-judgement escalation. (Spec: `docs/superpowers/specs/2026-10-24-sa-jas-v2-master-plan.md` section 5.2)
- [ ] Implementation: migrate one AI call path (tailor) to structured outputs with a schema test, then the remaining call paths in follow-up pull requests. (Spec: `docs/superpowers/specs/2026-10-24-sa-jas-v2-master-plan.md` section 5.3)
- [ ] Enhancement: add prompt caching per section 5.4 where the same prefix is reused, with a test asserting the cache marker is present. (Spec: `docs/superpowers/specs/2026-10-24-sa-jas-v2-master-plan.md` section 5.4)
- [ ] Review: confirm metering still records spend per run and the dry-run evals pass offline. (Spec: `docs/superpowers/specs/2026-10-24-sa-jas-v2-master-plan.md` sections 5, 14)

## Phase 3: Durable runs that always finish

- [ ] Research: for each stop reason in section 6.2, find the code path today and note whether the run is recorded anywhere after it ends. (Spec: `docs/superpowers/specs/2026-10-24-sa-jas-v2-master-plan.md` section 6.2)
- [ ] Implementation: implement the run ledger (start, terminal state, reason, spend) in the local store, with a migration and tests. (Spec: `docs/superpowers/specs/2026-10-24-sa-jas-v2-master-plan.md` section 6.1)
- [ ] Implementation: map every WS2 stop reason to a tested ledger state, and fail the test suite when a new stop reason appears without one. (Spec: `docs/superpowers/specs/2026-10-24-sa-jas-v2-master-plan.md` section 6.2)
- [ ] Enhancement: add compaction (`compaction_20260112`) and a per-key token-bucket rate limiter so long or parallel runs do not stall or 429 each other. (Spec: `docs/superpowers/specs/2026-10-24-sa-jas-v2-master-plan.md` sections 6.3, 6.4)
- [ ] Implementation: surface the ledger in the UI run view so a finished run can be inspected after the fact. (Spec: `docs/superpowers/specs/2026-10-24-sa-jas-v2-master-plan.md` section 6.1)
- [ ] Experiment: extend the ten-result workflow regression to assert a ledger row and its terminal state for the run it performs. (Spec: `docs/superpowers/specs/2026-10-24-sa-jas-v2-master-plan.md` sections 6.1, 6.2)
- [ ] Review: confirm a cancelled run and a crashed run both leave a ledger row that is not "done". (Spec: `docs/superpowers/specs/2026-10-24-sa-jas-v2-master-plan.md` sections 6.1, 6.2)

## Phase 4: Hunter resilience and source health

- [ ] Research: list every source adapter (the SA job-board scrapers and Claude grounded search) and what it returns when the source is down. (Spec: `docs/superpowers/specs/2026-10-24-sa-jas-v2-master-plan.md` section 8.1)
- [ ] Implementation: implement the source adapter interface from section 8.1 and multi-page cursor pagination from section 8.2 so each adapter reports success, last-good time, and item count. (Spec: `docs/superpowers/specs/2026-10-24-sa-jas-v2-master-plan.md` sections 8.1, 8.2)
- [ ] Implementation: build the source health board from section 8.3 as one view backed by the adapter reports, with a test for the dead-source case. (Spec: `docs/superpowers/specs/2026-10-24-sa-jas-v2-master-plan.md` section 8.3)
- [ ] Enhancement: implement proposals-only self-healing from section 8.4: a fix is written as a proposal file that a human approves, never applied automatically. (Spec: `docs/superpowers/specs/2026-10-24-sa-jas-v2-master-plan.md` section 8.4)
- [ ] Implementation: add the link-quality check from section 8.5 to the hunter output and record the result in the run ledger. (Spec: `docs/superpowers/specs/2026-10-24-sa-jas-v2-master-plan.md` section 8.5)
- [ ] Experiment: verify the daily canary workflow against fixture data plus one live query per source and confirm health updates. (Spec: `docs/superpowers/specs/2026-10-24-sa-jas-v2-master-plan.md` section 8.6)
- [ ] Improvement: update docs/SCRAPER-DEBUGGING.md so a broken source is diagnosed through the health board before touching code. (Spec: `docs/superpowers/specs/2026-10-24-sa-jas-v2-master-plan.md` sections 8.3, 8.4, `docs/SCRAPER-DEBUGGING.md`)

## Phase 5: Release and live verification cadence

- [ ] Research: record what each workflow (ci.yml, extension-release.yml, live-check.yml) proves and what it does not, in docs/agentos/REPORT.md notes. (Spec: `docs/superpowers/specs/2026-10-24-sa-jas-v2-master-plan.md` section 13, `.github/workflows/ci.yml`)
- [ ] Implementation: write the release checklist in docs/OPERATIONS.md: CI green, packaged Windows desktop start with disposable data, and a dated live smoke run. (Spec: `docs/superpowers/specs/2026-10-24-sa-jas-v2-master-plan.md` sections 13, 15, `docs/OPERATIONS.md`)
- [ ] Enhancement: add the checklist state for the latest release to docs/agentos/REPORT.md, with the CI run link and the live smoke date. (Spec: `docs/superpowers/specs/2026-10-24-sa-jas-v2-master-plan.md` section 13, `docs/agentos/REPORT.md`)
- [ ] Review: confirm PUBLICATION.md and README.md verified-state claims match the checklist exactly, and correct any claim that the evidence does not support. (Spec: `docs/superpowers/specs/2026-10-24-sa-jas-v2-master-plan.md` sections 13, 15, `PUBLICATION.md`)
- [ ] Improvement: append one line per merged pull request to docs/agentos/REPORT.md (date, pull request number, one sentence), and confirm the habit holds for two review cycles. (Spec: `docs/PHASES.md` Phase 5, `docs/agentos/REPORT.md`)

## Phase 6: Memory, profile, and browser session revamp

- [ ] Research: audit current `memory/store.json`, `profile.json`, and browser session state against WS3, WS5, and Demo v3 requirements. (Spec: `docs/superpowers/specs/2026-10-24-sa-jas-v2-master-plan.md` sections 7, 9, `docs/superpowers/specs/2026-11-01-automation-and-data-depth-design.md` section 6)
- [ ] Implementation: add run memory (`/memories/run/<id>/progress.md` backed by `memory_20250818`) and per-source memory (`sources/<id>/notes.md`), surfaced in the Memory screen with search and delete. (Spec: `docs/superpowers/specs/2026-10-24-sa-jas-v2-master-plan.md` section 7)
- [ ] Enhancement: complete desktop `profile.v2.json` migration, multiple personas, and encrypted `sensitive: true` fields on the Runner. (Spec: `docs/superpowers/specs/2026-10-24-sa-jas-v2-master-plan.md` section 9.1, `docs/superpowers/specs/2026-11-01-profile-and-documents-design.md`)
- [ ] Implementation: implement `sessions.js` with separate `hunt` and `apply` named profiles, encrypted session persistence, Lock/Clear action, and challenge pause notification. (Spec: `docs/superpowers/specs/2026-10-24-sa-jas-v2-master-plan.md` section 9.2)
- [ ] Experiment: implement and run `demo:v3` end-to-end against a local mock ATS in deterministic no-key mode in CI. (Spec: `docs/superpowers/specs/2026-11-01-automation-and-data-depth-design.md` section 6)
- [ ] Review: verify no raw unvalidated web text or secrets enter memory and session isolation tests pass. (Spec: `docs/superpowers/specs/2026-10-24-sa-jas-v2-master-plan.md` sections 7, 9.2)

## Phase 7: Assisted apply, BYOK security, MCP, and evals

- [ ] Research: inventory existing apply-engine, `submitGuard.js`, `keys.json`, MCP server, and eval scripts against WS6, WS7, WS8, and WS10. (Spec: `docs/superpowers/specs/2026-10-24-sa-jas-v2-master-plan.md` sections 10, 11, 12, 14)
- [ ] Implementation: implement accessibility-snapshot typed-tool apply agent with computer-use fallback, L0-L3 autonomy ladder, default-deny `SubmitPolicy`, trust ramp, and kill switch. (Spec: `docs/superpowers/specs/2026-10-24-sa-jas-v2-master-plan.md` section 10)
- [ ] Enhancement: replace desktop `keys.json` with OS keychain (`safeStorage` or keyring), add Runner pairing token and origin allowlist, and add Cloudflare Gateway Worker if CORS requires it. (Spec: `docs/superpowers/specs/2026-10-24-sa-jas-v2-master-plan.md` sections 11, 13, `docs/superpowers/specs/2026-10-27-m3-hosted-web-alpha-design.md`)
- [ ] Implementation: build `sa-jas-mcp` server tools and toggleable external MCP connectors (Gmail, Calendar, Drive) with injection-shielded inputs. (Spec: `docs/superpowers/specs/2026-10-24-sa-jas-v2-master-plan.md` section 12, `docs/superpowers/specs/2026-10-27-post-m3a3-pipeline.md` Arc 10)
- [ ] Experiment: add per-run JSON traces, fabrication verifier corpus, and multi-trial Pareto eval harness (plus capped $1 paid eval script). (Spec: `docs/superpowers/specs/2026-10-24-sa-jas-v2-master-plan.md` section 14)
- [ ] Review: rewrite `SECURITY.md` and `THREAT-MODEL.md` for BYOK and verify `SubmitPolicy`, key-erasure, and MCP security tests pass. (Spec: `docs/superpowers/specs/2026-10-24-sa-jas-v2-master-plan.md` sections 10.2, 11)
- [ ] Improvement: add `npx sa-jas-runner` packaging and `Dockerfile` for self-hosters and verify end-to-end release readiness. (Spec: `docs/superpowers/specs/2026-10-24-sa-jas-v2-master-plan.md` sections 13, 15)
