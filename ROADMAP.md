# SA-JAS Roadmap — From Local Tool to One-of-a-Kind Product

**Owner:** Kone · **Last updated:** 7 June 2026
**Premise:** SA-JAS is a three-agent (Hunter → Tailor → Apply) job-application suite for the South African market. This roadmap takes it from a fire-on-demand local app to an always-on, self-improving, sellable product — sequenced so revenue arrives early and cost/legal risk stays low.

**Two principles that govern every decision below:**
1. **Revenue before infrastructure.** We monetize the app we already have *before* building anything that costs money to run.
2. **The user's machine is the safest place for their data.** Keep CVs, IDs, and API keys local for as long as possible. POPIA exposure only appears when *we* start holding data.

---

## Part A — Distribution & Monetization

### The decision (settled)
**License store first → hosted managed-key tier later.** We do *not* build the hosted, you-pay-the-API-bill model first; it is the expensive bet and we fund strangers' usage before we know anyone will pay.

| Model | Verdict | Why |
|---|---|---|
| BYO-everything site (user links own Vercel/Neon/Supabase/Anthropic) | ❌ Not our market | 95% drop-off for non-technical SA job seekers; only works for developers. |
| Hosted, your business key, tiered Haiku/Sonnet/Opus | ⏳ Later (Phase B2) | Real business, but cost risk + POPIA + backend. Earn the right to build it. |
| Patreon + local installer | ⚠️ Replace with proper store | Right instinct, wrong tool — no entitlement enforcement. |
| **License-key store (Lemon Squeezy / Paddle)** | ✅ **Start here** | Same local app, real licensing, merchant-of-record handles global tax/cards from SA. |
| Freemium hybrid (free BYO + paid hosted) | ✅ Endgame | The natural destination once both tiers exist. |

> **MCP is not monetization.** Shipping an MCP server is a *reach & credibility* play (plug SA-JAS into Claude Desktop), not a revenue channel. It belongs in the tech roadmap, not here.

### Why a merchant-of-record matters for you specifically
As a solo seller in South Africa taking money from abroad, **Lemon Squeezy or Paddle act as the merchant of record** — they collect and remit VAT/sales tax worldwide, handle international card processing, and pay you out. Gumroad is the lighter-weight alternative. Stripe alone leaves the tax/compliance burden on you.

---

## Part B — Phased Plan (everything, one by one)

Each phase has a **goal**, **why now**, **build checklist**, and **done-when**. Phases are ordered so each one is shippable on its own.

### Phase 0 — Harden what exists (pre-revenue, ~1 week)
**Goal:** Make the current local app safe to charge money for.
**Why now:** You can't sell something that breaks on a stranger's machine or leaks their data.

- [ ] Audit the blank-window / React-instance fixes hold on a clean install (no dev server, packaged build only).
- [ ] Confirm `keys.json` + `browser-profile/` never enter the ASAR or any shared bundle.
- [ ] Add a first-run **POPIA/consent notice**: state plainly that CVs, answers, and (optional) EE/salary data stay on *their* device, and that auto-apply acts on *their* behalf.
- [ ] Add a hard "**never auto-submit**" reaffirmation in the UI (you already enforce it in Agent 3 — make it visible, it's a trust selling point).
- [ ] Crash/telemetry: minimal, opt-in, anonymous (don't ship silent analytics on a job-seeker's data).

**Done when:** A non-technical tester installs the packaged build, enters one key, and completes hunt→tailor→apply without you touching their machine.

---

### Phase B1 — License-gated local product (first revenue)
**Goal:** Turn the existing local app into a paid product. No new architecture.
**Why now:** Fastest path to your first paying customer; zero API cost risk; POPIA stays on the user's device.

- [ ] Pick a store: **Lemon Squeezy** (recommended) or Paddle. Set up product + checkout.
- [ ] Add **license-key activation** on app launch: validate key against the store API, cache an activation token locally, allow N offline days before re-check.
- [ ] Tiers without a backend: gate *features*, not API spend (since the user pays Anthropic directly). Suggested:
  - **Free / Trial:** Hunter + manual tailor, capped jobs.
  - **Pro (one-time or monthly):** full Tailor, Apply Copilot, routines (Phase T1), candidate memory.
- [ ] Build a tiny landing page (own domain) → "Download + buy a license."
- [ ] Add an in-app "Buy / Manage license" link.

**Done when:** Someone who is not you has paid for and activated a license.

**Watch-outs:** License keys can be shared — accept some leakage; don't over-engineer DRM. Refund/region pricing: use the store's purchasing-power parity if available (matters for SA buyers).

---

### Phase T1 — Routines (the spine; biggest single UX upgrade)
**Goal:** Make SA-JAS work while the user sleeps.
**Why now:** Job hunting is recurring, not an event. This is what converts a tool into a subscription people don't cancel.

> **Note on Anthropic's "Routines":** Anthropic shipped a Routines feature in 2026, but it runs in *their cloud* on Claude Code (Pro/Max/Team/Enterprise) — **not** via a raw API key. Since SA-JAS is local + BYO-key, you implement your *own* routines layer. The concept fits; the plumbing is yours.

- [ ] Add a scheduler in the Electron main process (`node-cron`), persisted in `db.json` (`routines: [{id, cron, type, params, lastRun, enabled}]`).
- [ ] **Morning Hunt routine:** at user-set time → run Agent 1 → auto-tailor top N matches (Agent 2) → drop into a new **"Ready to apply"** tray. User wakes up to finished packages.
- [ ] Run-on-launch catch-up (desktop apps aren't always on): if a scheduled run was missed, offer to run it now.
- [ ] Routine activity feed + the ability to pause/stop mid-run (reuse `hunterState.stopRequested`).
- [ ] Settings UI: enable/disable, pick cadence, choose keywords/locations per routine.

**Done when:** A routine runs unattended and produces tailored packages without a click.

**Sequencing:** Make this a **Pro-tier feature** in B1 — it's your strongest reason to pay.

---

### Phase T2 — Adopt the official Memory tool + nightly "Dreaming"
**Goal:** Replace the hand-rolled `candidateMemory` with a self-improving dossier.
**Why now:** Your roadmap already wants "learn which phrasings won." Anthropic's **memory tool** + **Dreaming** (a scheduled pass that reviews sessions and curates memory) is exactly this, natively.

- [ ] Map current `candidateMemory` (insights / employers / applications) onto the memory-tool store; keep the local JSON as the source of truth / export.
- [ ] **Dream routine** (ties into T1): nightly, review the application outcome log (applied→interview→offer/rejected) and re-weight which phrasings/insights to surface in future tailoring.
- [ ] Feed the curated digest into Agent 2's cached `cvSystem` and Agent 3's smart-fill prompt (you already inject `buildMemoryDigest` — upgrade the *source*).
- [ ] Keep the user in control: show what was learned; allow edit/delete (you have `deleteInsight`).

**Done when:** Two weeks of use measurably improves cover-letter relevance / smart-fill accuracy, and the user can see *why*.

---

### Phase T3 — Computer-use Agent 3 (the differentiator)
**Goal:** Replace brittle DOM heuristics with an agent that *sees and operates* the application form.
**Why now:** This is the capability that makes SA-JAS demo-worthy and hard to copy. Your current planner/vision fallback is clever but fragile against form churn.

- [ ] Add Anthropic **computer-use** as an opt-in driver for Agent 3, behind the existing `useVision`/provider-capability gate (Anthropic/Gemini only).
- [ ] Keep the **human-on-the-loop** guarantees intact: never auto-submit, pause on CAPTCHA/verification, detect-and-handoff. Computer-use changes *how* fields get filled, not the safety model.
- [ ] Fallback chain: computer-use → planner (`planPage`) → keyword heuristic. Cap calls per session (cost).
- [ ] Measure: success rate of reaching a filled, ready-to-submit form vs the current heuristic, on 10 real SA portals.

**Done when:** Computer-use mode completes more forms unattended than the heuristic on the test set, with zero auto-submits.

**Cost note:** This is the most token-hungry feature — it belongs on Sonnet/Opus and is a natural **top-tier** gate.

---

### Phase T4 — Parallel sub-agents ✅ DONE
**Goal:** Turn serial work into bursts.
**Why now:** You tailor one job at a time. Fan-out makes the morning routine finish in seconds and enables deeper per-company research.

- [x] Tailor N jobs concurrently (bounded pool) instead of sequentially. — `agents/pool.js` (`mapPool`, order-preserving, per-item error isolation) + `agents/subAgents.js` (`tailorJobsConcurrently`). Wired into the `hunt_and_tailor` routine (replaces the serial loop) and a new `POST /api/jobs/tailor-batch` endpoint + a "Tailor all found" button.
- [x] Optional **research fan-out** per target job: a lead step spawns sub-agents to pull company site / role history / salary context, feeding richer cover letters. — `agents/companyResearch.js` (`researchCompany`, grounded Claude `web_search`); briefs gathered in parallel, threaded into Agent 2's cached `cvSystem` + cover-letter prompt. Gated by `useResearchFanout` (Anthropic-only, default OFF).
- [x] Backpressure + cost cap (concurrency tied to tier). — bounded pool IS the backpressure; `resolveTailorConcurrency` clamps `profile.tailorConcurrency` to 1–5 (the tier-gate hook), batches hard-capped at 10 jobs, research `max_uses` bounded.

**Done when:** A 10-job morning routine completes in a fraction of the current serial time. ✅ — tailoring now runs `tailorConcurrency` jobs (default 3) at a time instead of one-by-one. Pure pool logic unit-tested (14/14: order, error isolation, peak-concurrency bound).

---

### Phase T5 — MCP server (reach & credibility, not revenue)
**Goal:** Let power users plug SA-JAS hunter/tailor/apply tools into Claude Desktop / Code.
**Why now:** Second distribution surface + the ecosystem-contribution that gets you noticed by Anthropic.

- [ ] Wrap the three agents as MCP tools (`hunt_jobs`, `tailor_application`, `start_apply_copilot`).
- [ ] Reuse the local key + data model — MCP server runs locally alongside the app.
- [ ] List in the MCP directory; write the README as a case study.

**Done when:** SA-JAS appears as a usable connector inside an MCP client.

---

### Phase B2 — Hosted managed-key tier (the scalable bet, earn it)
**Goal:** Offer a "just works, no API key" premium tier funded by subscriptions.
**Why now:** Only after B1 proves people pay and you've seen real usage patterns to price against.

- [ ] Backend that holds *your* business key **server-side only** (never shipped to a browser).
- [ ] **Credit/metering model**, not "unlimited": sell application credits or capped monthly runs. Tier by model (Haiku → Sonnet → Opus) *and* by credits.
- [ ] Stripe (or via the store) for recurring billing; enforce hard caps so a heavy user can't exceed margin.
- [ ] **POPIA now bites:** you're storing CVs/answers server-side. Add a data-processing policy, retention limits, deletion-on-request, encryption at rest, and a processor agreement stance. Get this reviewed.
- [ ] Abuse prevention: rate limits, per-account usage ceilings, anomaly alerts.

**Done when:** A user subscribes, never sees an API key, and your unit economics are positive at the cap.

---

### Phase B3 — Freemium hybrid + Anthropic radar
**Goal:** Run both tiers and put the product in front of Anthropic.
- [ ] Free local BYO-key tier (B1) + paid hosted tier (B2), shared codebase.
- [ ] Publish a writeup + demo video: "Autonomous job-application agent for the South African market," stacking routines + memory/dreaming + computer-use + sub-agents.
- [ ] Submit through Anthropic builder/developer programs and the MCP directory.

**Done when:** A public case study exists and you've applied to at least one Anthropic program.

---

## Dependency map (what blocks what)

```
Phase 0 ──► B1 (revenue) ──► B2 (hosted) ──► B3 (hybrid + radar)
              │
              ├──► T1 Routines ──► T2 Memory/Dreaming
              │                       │
              └──► T3 Computer-use ───┤
                       │              │
                       └──► T4 Sub-agents
                                      │
                                T5 MCP server ──► B3
```

- **Ship order (recommended):** 0 → B1 → T1 → T2 → T3 → T4 → T5 → B2 → B3.
- T1 (Routines) and T3 (Computer-use) are your two strongest paid-tier hooks — prioritize them right after first revenue.

---

## Risk register

| Risk | Phase | Mitigation |
|---|---|---|
| Funding strangers' API spend | B2 | Hard credit caps; never "unlimited"; key server-side only. |
| POPIA non-compliance (SA) | 0, B2 | Keep data local in B1; in B2 add retention limits, deletion, encryption, get reviewed. |
| Auto-apply liability | all | Never auto-submit; human-on-the-loop; visible consent; CAPTCHA handoff. |
| License sharing | B1 | Accept some leakage; light activation, not heavy DRM. |
| Site ToS / anti-bot bans on user accounts | T3 | Detect-and-handoff CAPTCHAs; never auto-solve; respect rate limits. |
| Cost blow-ups from computer-use | T3 | Per-session caps; gate to higher tiers; fallback chain. |
| Cross-border payments from SA | B1 | Use merchant-of-record (Lemon Squeezy/Paddle). |

---

## Immediate next 3 actions
1. **Phase 0 hardening** — clean-install test + first-run POPIA consent notice.
2. **Open a Lemon Squeezy account** and wire license-key activation into app launch (B1).
3. **Prototype the Morning Hunt routine** (T1) as the headline Pro feature.
