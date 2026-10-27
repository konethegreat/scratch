# Post-M3a-3 delivery pipeline

**Status:** active
**Owner:** Kone
**Created:** 2026-10-27
**Extends:** [`2026-10-24-sa-jas-v2-master-plan.md`](2026-10-24-sa-jas-v2-master-plan.md)

## Purpose

M3a-3 shipped the hosted web alpha: zero-knowledge key handling, the web shell, job feeds, dedupe, and the tracker. The master plan defines the architecture and milestones M0 to M6, but it did not give the follow-up work a named lane. This document names the three arcs that come next, so none of them is dropped or silently reordered.

A request from 2026-10-27 asked for three things beyond M3a-3: verify the app against the current Anthropic API, make the free hosted app survive real traffic without exposing keys or mixing users, and refresh the UI with light mode and a home page built from Kone's public work. The first two are correctness and safety work. The third is committed product work, not a nice-to-have.

## Order

| # | Arc | Status | Ships when |
|---|---|---|---|
| 1 | API compliance | Shipped 2026-10-27 (PR #8, `fd4863f`) | All offline tests pass and each changed API assumption cites the docs |
| 2 | Live-scale hardening and isolation | Shipped 2026-10-27 (PR #9) | Isolation, key-canary, spend-cap and feed-failure tests pass |
| 3 | UI/UX refresh | Shipped 2026-10-27 (PR #11) | Light mode, copy sweep and the new home page pass the acceptance list below |

Arcs run in order. Arc 2 depends on Arc 1 because retry and error behaviour shape what the isolation tests can assert. Arc 3 depends on Arc 2 because the redesign should not land on top of a shell that is still changing.

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

Plus, for Arc 2 and Arc 3: a live smoke check on the deployed URL after the merge, and a short note in the PR describing what a human should click to verify the change.
