# Phases

Ordered work for SA-JAS (the scratch repository), derived from the repository
state on 2026-11-20 (HEAD f20f415). The authority for direction is
`docs/superpowers/specs/2026-10-24-sa-jas-v2-master-plan.md`; the older
`ROADMAP.md` marks itself superseded. These phases sequence that plan into
small, verifiable steps and do not add scope beyond it.

## Phase 1: One ordered index for agents and contributors

The repository now carries sixteen design specs under `docs/superpowers/specs/`,
a superseded ROADMAP.md, and verified-state claims in README.md and
PUBLICATION.md. Nothing states which document wins or what to build next, so
every agent re-derives its own queue.

Goal: make docs/agentos the ordered index, with each task pointing at the spec
it implements.

Done when: docs/agentos/TASKS.md lists every open workstream of the master plan
with the spec path beside it, README.md links to docs/agentos, and
docs/PHASES.md and docs/TASKS.md are kept in sync with docs/agentos in the same
pull request that changes either.

## Phase 2: AI core aligned with the current Anthropic API

Master plan section 2.1 records the AI layer as stale against the current
Anthropic API, and section 5 (WS1) specifies the replacement: a model registry
with an explicit escalation ladder, structured outputs everywhere, prompt
caching, and metering carried into a budget.

Goal: replace the stale client behaviour with the WS1 design in small steps,
keeping `npm test` and the dry-run evals green at every step.

Done when: the model registry is the only place model IDs appear, the
escalation policy is code with tests rather than model judgement, every AI
response is parsed as a structured output, and the dry-run evals pass with no
network access.

## Phase 3: Durable runs that always finish

Master plan section 6 (WS2) records agents that quit on hard ceilings and
specifies a run ledger plus a defined behaviour per stop reason. CI already
exercises a ten-result workflow regression; the ledger makes each run
inspectable after the fact.

Goal: every agent run ends in a recorded terminal state (done, escalated,
budget exhausted, or failed) that the UI can show.

Done when: a run row is written at start and closed at end in the local store,
each stop reason from the WS2 table maps to a tested branch, and the workflow
regression asserts a ledger row for the run it executes.

## Phase 4: Hunter resilience and source health

Master plan sections 8.1 to 8.5 specify the source adapter interface,
pagination, a source health board, proposals-only self-healing, and link
quality. `docs/SCRAPER-DEBUGGING.md` documents today's manual debugging.

Goal: a scraper that breaks is visible as unhealthy in the app before a run
silently returns nothing, and a fix is a proposal a human approves.

Done when: each source adapter reports success rate and last-good time into the
health board, a dead source is flagged in the UI without a failed run, and a
test proves a proposal is never applied without explicit approval.

## Phase 5: Release and live verification cadence

`.github/workflows/ci.yml`, `extension-release.yml`, and `live-check.yml`
already guard keys, build the desktop app, run the synthetic demo, and check
live behaviour. `npm run smoke:live` spends real money, so it needs a stated
cadence rather than ad hoc use.

Goal: a repeatable release checklist that ties CI, the packaged desktop build,
and the paid live smoke to a tagged release.

Done when: docs/agentos/REPORT.md records the evidence for the latest release
(CI run, packaged desktop startup, live smoke date), the checklist exists in
docs/OPERATIONS.md, and every merged pull request appends one line to
docs/agentos/REPORT.md.
