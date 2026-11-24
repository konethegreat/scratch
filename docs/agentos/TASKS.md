# Tasks

The canonical copy of this document is docs/TASKS.md; this file mirrors it for
agents that look under docs/agentos first. Change both in the same pull
request.

## Phase 1: One ordered index for agents and contributors

- [x] Research: read the master plan, every spec under docs/superpowers/specs/, README.md, PUBLICATION.md, and ROADMAP.md, and list which workstreams are open, done, or superseded.
- [ ] Write docs/agentos/TASKS.md as the ordered index, each task naming the spec path that defines it, and the matching docs/agentos/PHASES.md headings.
- [ ] Link docs/agentos from README.md in one line next to the roadmap mention, and mark ROADMAP.md as historical with a pointer to the master plan.
- [ ] Review: confirm docs/PHASES.md and docs/TASKS.md match docs/agentos, no secrets, no `.env` content, and no em dash or en dash in the added text.
- [ ] Improvement: add a short "how to pick the next task" note at the top of docs/agentos/TASKS.md that tells an agent to take the first unchecked task in the earliest incomplete phase.

## Phase 2: AI core aligned with the current Anthropic API

- [ ] Experiment: run the dry-run evals against the current client and record which checks fail because of API drift, without making any paid call.
- [ ] Implement the model registry from master plan section 5.2 as one module, with tests, and move the existing model IDs behind it.
- [ ] Implement the escalation policy from section 5.3 as tested code, replacing any model-judgement escalation.
- [ ] Migrate one AI call path (tailor) to structured outputs with a schema test, then the remaining call paths in follow-up pull requests.
- [ ] Add prompt caching per section 5.4 where the same prefix is reused, with a test asserting the cache marker is present.
- [ ] Review: confirm metering still records spend per run and the dry-run evals pass offline.

## Phase 3: Durable runs that always finish

- [ ] Research: for each stop reason in section 6.2, find the code path today and note whether the run is recorded anywhere after it ends.
- [ ] Implement the run ledger (start, terminal state, reason, spend) in the local store, with a migration and tests.
- [ ] Map every WS2 stop reason to a tested ledger state, and fail the test suite when a new stop reason appears without one.
- [ ] Surface the ledger in the UI run view so a finished run can be inspected after the fact.
- [ ] Experiment: extend the ten-result workflow regression to assert a ledger row and its terminal state for the run it performs.
- [ ] Review: confirm a cancelled run and a crashed run both leave a ledger row that is not "done".

## Phase 4: Hunter resilience and source health

- [ ] Research: list every source adapter (the SA job-board scrapers and Claude grounded search) and what it returns when the source is down.
- [ ] Implement the source adapter interface from section 8.1 so each adapter reports success, last-good time, and item count.
- [ ] Build the source health board from section 8.3 as one view backed by the adapter reports, with a test for the dead-source case.
- [ ] Implement proposals-only self-healing from section 8.4: a fix is written as a proposal file that a human approves, never applied automatically.
- [ ] Add the link-quality check from section 8.5 to the hunter output and record the result in the run ledger.
- [ ] Improvement: update docs/SCRAPER-DEBUGGING.md so a broken source is diagnosed through the health board before touching code.

## Phase 5: Release and live verification cadence

- [ ] Research: record what each workflow (ci.yml, extension-release.yml, live-check.yml) proves and what it does not, in docs/agentos/REPORT.md notes.
- [ ] Write the release checklist in docs/OPERATIONS.md: CI green, packaged Windows desktop start with disposable data, and a dated live smoke run.
- [ ] Add the checklist state for the latest release to docs/agentos/REPORT.md, with the CI run link and the live smoke date.
- [ ] Review: confirm PUBLICATION.md and README.md verified-state claims match the checklist exactly, and correct any claim that the evidence does not support.
- [ ] Improvement: append one line per merged pull request to docs/agentos/REPORT.md (date, pull request number, one sentence), and confirm the habit holds for two review cycles.
