# Phases

The canonical copy of this document is docs/PHASES.md; this file mirrors it for
agents that look under docs/agentos first. Change both in the same pull
request.

## Phase 1: One ordered index for agents and contributors

Goal: make docs/agentos the ordered index, each task naming the spec it
implements. Done when: docs/agentos/TASKS.md covers every open workstream of
the master plan with its spec path, README.md links to docs/agentos, and
docs/PHASES.md and docs/TASKS.md stay in sync in the same pull request.

## Phase 2: AI core aligned with the current Anthropic API

Goal: implement master plan section 5 (WS1) in small steps with tests.
Done when: the model registry is the only place model IDs appear, the
escalation policy is tested code, AI responses are structured outputs, and the
dry-run evals pass offline.

## Phase 3: Durable runs that always finish

Goal: every agent run ends in a recorded terminal state (done, escalated,
budget exhausted, or failed) that the UI can show. Done when: a run ledger row
opens at start and closes at end, each WS2 stop reason maps to a tested branch,
and the workflow regression asserts a ledger row.

## Phase 4: Hunter resilience and source health

Goal: a broken scraper is visible as unhealthy before a run silently returns
nothing, and fixes are proposals a human approves. Done when: adapters report
success rate and last-good time into a health board, a dead source is flagged
without a failed run, and a test proves no proposal is auto-applied.

## Phase 5: Release and live verification cadence

Goal: a repeatable release checklist tying CI, the packaged desktop build, and
the paid live smoke to a tagged release. Done when: docs/agentos/REPORT.md
records the evidence for the latest release, the checklist lives in
docs/OPERATIONS.md, and every merged pull request appends one line to
docs/agentos/REPORT.md.

## Phase 6: Memory, profile, and browser session revamp

Goal: implement WS3 run/source memory, WS5 desktop profile v2 with encrypted
sensitive fields and isolated `hunt` vs `apply` browser sessions, and Demo v3
(`2026-11-01-automation-and-data-depth-design.md` section 6). Done when: run
and source memory are tested, desktop profiles migrate and encrypt sensitive
fields, `sessions.js` pauses on challenges, and `demo:v3` passes offline.

## Phase 7: Assisted apply, BYOK security, MCP, and evals

Goal: implement WS6 L0-L3 apply with default-deny `SubmitPolicy`, WS7 OS
keychain BYOK and rewritten security docs, WS8 bidirectional MCP, and WS10
evals and per-run traces. Done when: `SubmitPolicy` trust ramp and kill switch
are tested, `keys.json` is replaced by OS keychain, `SECURITY.md` and
`THREAT-MODEL.md` match BYOK, MCP tools/connectors are tested, and trace/eval
suites pass.
