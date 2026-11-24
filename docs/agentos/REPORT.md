# Report

One line per merged pull request, newest at the bottom.

- 2026-11-20: docs: add the agentos working plan (PHASES.md, TASKS.md, REPORT.md, plus docs/PHASES.md and docs/TASKS.md) so every agent has ordered, verifiable work grounded in the v2 master plan.
- 2026-11-24: docs (TASK-313): audited master plan, all 16 specs under docs/superpowers/specs/, README.md, PUBLICATION.md, and ROADMAP.md; recorded workstream inventory (open, done, superseded) in REPORT.md and shared memory; ticked Phase 1 Research in docs/TASKS.md and docs/agentos/TASKS.md; verified with npm test and check-secrets.mjs.
- 2026-11-24: docs (t_bf90ed3c): updated docs/agentos/TASKS.md and docs/TASKS.md as the ordered index with defining spec paths and matching docs/agentos/PHASES.md and docs/PHASES.md headings covering all open workstreams (Phases 1-7), ticked Phase 1 task 2, and verified with npm test and check-secrets.mjs.

## Workstream Inventory (2026-11-24, TASK-313)

Audited sources: `AGENTS.md`, `docs/superpowers/specs/2026-10-24-sa-jas-v2-master-plan.md`, all 15 additional specs under `docs/superpowers/specs/`, `README.md`, `PUBLICATION.md`, `ROADMAP.md`, `docs/PHASES.md`, `docs/TASKS.md`, `docs/agentos/PHASES.md`, and `docs/agentos/TASKS.md`.

### Open Workstreams
- **Master Plan WS1 (AI core, Anthropic-only)**: Partially done (Arc 1 API compliance shipped in PR #8). Open in Phase 2: single model registry, code-based escalation policy, structured outputs everywhere, prompt caching verification, metering reconciliation.
- **Master Plan WS2 (Durable runs)**: Open in Phase 3: persisted run ledger, stop-reason branch mapping, compaction and context editing, token-bucket rate limiter, Runs UI view.
- **Master Plan WS3 (Memory)**: Open: run memory (`/memories/run/<id>/progress.md`), native `memory_20250818` tool backing, source memory (candidate memory and nightly dreaming exist in local JSON).
- **Master Plan WS4 (Hunter v2)**: Partially done (Arc 6 SA location classifier and filters in PR #15; Arc 7 scraper resilience and `docs/SCRAPER-DEBUGGING.md` in PR #17). Open in Phase 4: unified source adapter interface, multi-page cursor pagination, source health board with daily canaries, proposals-only self-healing, link-quality `web_fetch` verification.
- **Master Plan WS5 (Profile and sessions revamp)**: Partially done (web Profile v2, documents store, and CV intake shipped in PR #31). Open: desktop migration, multiple personas, encrypted sensitive fields, separate `hunt` vs `apply` browser session manager.
- **Master Plan WS6 (Assisted apply and auto-apply)**: Partially done (Arc 8 web apply packet, desktop review/submit, and per-site consent in PR #19; Automation Phase 2/3 Apply Foundation and Extension in PR #32 and PR #33). Open: accessibility-snapshot typed-tool apply agent, L0-L3 autonomy ladder, default-deny `SubmitPolicy` with trust ramp and kill switch.
- **Master Plan WS7 (Keys and security, BYOK)**: Partially done (web zero-knowledge key lifecycle, CSP, canary-key test, and cross-profile isolation shipped in M3a-2 and Arc 2). Open: desktop `safeStorage` or OS keyring replacing `keys.json`, origin allowlist and pairing token for Runner, `SECURITY.md` and `THREAT-MODEL.md` full BYOK rewrite.
- **Master Plan WS8 / Post-M3a-3 Arc 10 (Inbox and MCP integration)**: Open (planned; supersedes `ROADMAP.md` Phase T5).
- **Master Plan WS9 (Hosting, build, release)**: Partially done (Cloudflare Pages static hosting, CI, extension-release, and live-check workflows exist). Open in Phase 5: `apps/gateway` Worker, `npx sa-jas-runner`, Docker image, release checklist in `docs/OPERATIONS.md`, and `README.md`/`PUBLICATION.md` verified-state reconciliation.
- **Master Plan WS10 (Evals, observability, cost)**: Partially done (dry-run evals and usage ledger exist). Open: multi-trial Pareto eval harness for ladder selection, fabrication verifier corpus, per-run trace/OpenTelemetry.
- **Automation and Data Depth Phase 4 (Demo v3)**: Open in `docs/superpowers/specs/2026-11-01-automation-and-data-depth-design.md` (Phases 1-3 shipped).
- **Docs Index Alignment (Phase 1)**: Remaining Phase 1 tasks in `docs/TASKS.md` and `docs/agentos/TASKS.md` (ordered index with spec paths, README link to `docs/agentos`, `ROADMAP.md` historical pointer, review, and next-task note).

### Done / Shipped Workstreams
- `2026-10-27-m3-hosted-web-alpha-design.md` (M3a-1, M3a-2, M3a-3 shipped; Runner pairing deferred to M4)
- `2026-10-27-m3a-3-feeds-tracker-design.md` (shipped)
- `2026-10-27-post-m3a3-pipeline.md` Arcs 1-9:
  - Arc 1: API compliance (PR #8)
  - Arc 2 / `2026-10-27-live-scale-isolation-design.md`: Live-scale hardening and isolation (PR #9)
  - Arc 3 / `2026-10-27-ui-ux-refresh-design.md`: UI/UX refresh (PR #11)
  - Arc 4 / `2026-10-27-web-tailoring-support-design.md`: Web tailoring and support (PR #12)
  - Arc 5 / `2026-10-27-agentic-rag-design.md`: Agentic RAG over candidate documents (PR #13)
  - Arc 6 / `2026-10-28-sa-relevance-and-filters-design.md`: South Africa relevance and search filters (PR #15)
  - Arc 7 / `2026-10-28-scraper-resilience-design.md`: Scraper resilience (PR #17)
  - Arc 8 / `2026-10-28-real-browser-apply-design.md`: Real-browser auto-apply (PR #19)
  - Arc 9 / `2026-10-28-live-demo-mode-design.md`: Live demo mode (PR #20)
- `2026-11-01-profile-and-documents-design.md` (Automation Phase 1, PR #31)
- `2026-11-01-apply-foundation-design.md` (Automation Phase 2, PR #32)
- `2026-11-01-extension-design.md` (Automation Phase 3, PR #33)
- `ROADMAP.md` Phase T4 (Parallel sub-agents) and Phase A1 (Hosted Apply Assistant extension)

### Superseded Workstreams
- `ROADMAP.md` is superseded by `docs/superpowers/specs/2026-10-24-sa-jas-v2-master-plan.md`:
  - Phases B1 (license-key store), B2 (hosted managed-key tier), and B3 (freemium hybrid) are dropped (free BYOK model).
  - Phase 0 (harden local app), T1 (Routines), T2 (Memory/Dreaming), T3 (Computer-use Agent 3), and T5 (MCP server) are superseded/absorbed into Master Plan WS1-WS8.
