# Hosted Live Demo Mode: Design

**Status:** proposed 2026-10-28
**Date:** 2026-10-28
**Arc:** 9 of the post-M3a-3 pipeline
**Sources of truth:** [`2026-10-27-post-m3a3-pipeline.md`](2026-10-27-post-m3a3-pipeline.md), `SECURITY.md`, and the user's decisions of 2026-10-28.

## Goal

Let a visitor understand what SA-JAS does in one click, without a key, an account, or any real data. A button switches the hosted app into a simulated workspace that demonstrates feeds, tailoring, grounded questions, the job hunter and the application copilot. The visitor can leave at any moment and return to the real workspace exactly as it was.

**The demo is a separate universe.** It shares no storage, no key, no network destination and no runtime state with the live app. Isolation is the feature, not a side effect.

## Decisions

| Question | Decision |
|---|---|
| Where does the demo live? | The hosted web app only. The desktop app and its synthetic fixture are unchanged. |
| What does it demonstrate? | The real web capabilities plus scripted Hunter and Apply Copilot runs, clearly labeled as simulated. |
| How does a visitor move through it? | Free roam. The real controls work. A dismissible strip suggests what to try next. |
| How long does demo state live? | Per tab. A refresh restores it. Exit or closing the tab discards it. |
| How far does the copilot go? | The full loop: fill, pause for the visitor's answer, review, confirm, simulated receipt. |
| How is it built? | A separate demo runtime behind the existing fetch seam. The real vault and key never enter demo code. |

## The isolation contract

This is the primary requirement. Every rule below is test-enforced.

1. **No real storage.** Demo mode never reads or writes the real IndexedDB vault. It uses its own vault over a `sessionStorage` adapter, under the prefix `sajas:demo:`.
2. **No real key.** Demo mode never reads, holds, validates or requests a key. Its key store is a stub that reports a key is present so the UI enables AI surfaces, but returns no key material. The key panel is unreachable in demo mode.
3. **No network.** Feeds, AI output, hunter results and the application portal are all local. A full demo walk makes zero requests outside the page origin.
4. **No bleed on exit.** Leaving demo removes every `sajas:demo:` key, including progress, and switches the dispatcher back to the real runtime. The app then refetches from the real vault.
5. **No export.** Backup and data export are hidden in demo mode. Demo data can never be written into a real backup.
6. **No generation path.** The demo never reaches the Anthropic SDK, `validateKey` or `keyCrypto`, and the tailor, ask and check routes are answered by the simulation router, not by real generation. A static test scans the demo module tree for the forbidden imports.
7. **No collision with the desktop fixture.** `SYNTHETIC_DEMO`, `server/src/demo.js` and the desktop copilot stay as they are.

If `sessionStorage` is unavailable, the demo falls back to an in-memory adapter. It still works and remains isolated, and the banner says progress will reset on refresh.

## Architecture

```
Landing or Startup
      |  Try the live demo
      v
mode controller  (sessionStorage: sajas:mode)
      |
      v
installed fetch dispatcher  (one patch, never replaced)
      |                                   |
      v                                   v
real runtime                          demo runtime
IndexedDB vault                       session vault (sajas:demo:*)
real key store                        stub key store (no key)
real activity                         demo activity
      |                                   |
      |                          simulation router
      |                        /        |        \
      |                    tailor     ask/check   copilot record
      v                                   |
createWebApi (unchanged)  <----------------+
```

The real runtime is the current `webRuntime`. The demo runtime is assembled lazily on first entry and cached for the tab. Both expose the same `handle(input, init)` contract, so `installWebApi` in `main.jsx` receives one stable dispatcher and is never reinstalled.

On exit, the app re-evaluates the real startup state. An unlocked key or a completed onboarding returns to the real workspace. A saved but locked key returns to the unlock screen. A brand new visitor returns to the startup screen.

### New modules

All new code lives under `client/src/web/demo/`.

| Module | Responsibility |
|---|---|
| `mode.js` | Pure mode controller: `getMode`, `setMode`, `subscribe`, `enterDemo`, `exitDemo`. No React, no runtime imports. |
| `sessionAdapter.js` | Storage adapter matching the vault contract, backed by `sessionStorage` under the demo prefix, with a memory fallback and `persistent` flag. |
| `fixtures.js` | The fictional applicant, jobs, answers, memory, usage and activity seed, plus canned tailored documents. |
| `runtime.js` | Lazy demo runtime: vault, stub key store, demo activity, usage ledger, `createWebApi`, simulation router. |
| `simulationApi.js` | Thin router that answers simulated routes and delegates the rest to the vault-backed router. |
| `feed.js` | Local feed client returning fixture results in the real feed-client shape. |
| `progress.js` | Suggested-step progress, persisted inside the demo namespace. |
| `SimulatedHunter.jsx` | Staged hunter run with Stop, writing fictional jobs through the demo API. |
| `SimulatedCopilot.jsx` | Fictional application form, fill animation, answer pause, review, confirmation, receipt. |
| `DemoBanner.jsx` | Persistent demo banner and Exit control. |
| `DemoTrialStrip.jsx` | Dismissible suggested steps with deep links. |

### Modified modules

| Module | Change |
|---|---|
| `client/src/web/runtime.js` | Export the active dispatcher, `enterDemo`, `exitDemo` and `subscribeMode`. |
| `client/src/main.jsx` | Install the dispatcher instead of `webRuntime.api.handle`. |
| `client/src/web/feeds.js` | `getFeedClient()` returns the demo client while demo mode is active. |
| `client/src/web/mode.js` | Tab visibility accepts a demo flag: Copilot and Logs visible, Backup hidden. |
| `client/src/App.jsx` | Mode state, banner, trial strip, demo-only tab rendering, refetch on mode change, demo-aware Apply and Settings. |
| `client/src/Landing.jsx` | Secondary "Try the live demo" action. |
| `client/src/web/WebStartup.jsx` | Demo action available in every startup phase. |
| `client/src/ApplyPacket.jsx` | In demo, "Open portal" opens the simulated form instead of an external URL; Mark applied writes to the demo vault. |

## Demo data

One fictional universe, extending the existing fixture:

- Applicant Alex Example, `alex@example.test`, Johannesburg. A short fictional base CV, including the accessibility dashboard project already used by the desktop fixture.
- Five tracked jobs with fictional employers: Example Studio, Fable Fintech, Sample Logistics, Placeholder Health and Imaginary Retail. All apply URLs use the reserved `.test` domain.
- Application answers: notice period, right to work, expected salary, and the copilot question.
- Candidate memory: a few insights, one past application and two employers.
- Usage: simulated spend and calls, inside the normal cap.
- Activity: a short, plausible history.

No real company, person, phone number, address or contact detail appears anywhere in the demo.

## Simulated behaviour

### Document Tailor

The route sets the job to `tailoring`, waits about 900 ms, then writes a canned CV and cover letter that name the job and company, sets the job to `tailored`, records simulated usage through the demo ledger, and appends activity entries. The documents carry a "Simulated" tag in the UI.

### Ask Documents

The route builds the demo corpus with the real core retrieval helpers, so refused questions still refuse for the right reason and report which documents were searched. A supported question returns a canned answer built from the top retrieved chunks with the same inline citation format as the real service. Document check returns one supported claim and one flagged claim with citations. No model call is made.

### Job Feeds

The demo feed client returns local results for the shipped feeds, shaped exactly like the real client results. It includes South African jobs and one foreign job, so the South Africa filter and its hidden count still demonstrate themselves. There is no fetch, no cache and no retry.

### Job Hunter

The Hunter tab renders `SimulatedHunter` instead of the desktop hunter. A run walks through five visible stages: checking sources, reading pages, filtering for South Africa, scoring matches, removing duplicates. A Stop control cancels the timers. A completed run writes fictional jobs through the normal jobs route, so dedupe is demonstrated on a second run. A standing note says the desktop app checks real job boards.

### Apply Copilot

The Copilot tab renders `SimulatedCopilot`, a fictional two-step application form inside the app. The flow is:

1. Open the simulated portal.
2. Fill name, email, phone, notice period and right to work from the demo profile and answers.
3. Pause on the application question and wait for the visitor's answer.
4. Show the final review with every field and document.
5. Show the confirmation dialog with job, site, button label, field count and document names.
6. Submit only after the visitor confirms.
7. Record the application in the demo vault with delivery `desktop-copilot` and submitter `copilot-confirmed`, mark the job applied, and show a receipt.

Cancelling leaves the form untouched. The receipt states plainly that nothing was sent to an employer. The form and portal are fictional and never navigate off the page.

### Apply tab

The guided packet works against the demo data. In demo mode, "Open portal" switches to the simulated Copilot tab rather than opening a `.test` URL, and Mark applied records a `web-guided` application in the demo vault.

## UI and copy

- Entry: a secondary "Try the live demo" action on the landing page and on the startup screen. It is available before unlocking a saved key. Entry and demo code paths are web-build only; the desktop app is unchanged.
- Banner: persistent, `role="status"`, theme-aware, wraps on mobile. Copy: "Demo mode. Everything here is simulated." Action: "Exit demo".
- Tags: every simulated document, answer, hunter result and receipt carries a visible "Simulated" tag. The tag is text, not color alone.
- Suggested steps: Browse feeds, Tailor a CV, Ask a question, Run the Hunter, Watch the copilot apply. Steps mark themselves done and deep-link to the tab. The strip can be dismissed and stays dismissed for the demo session.
- Settings: the key panel is replaced by "No key is used in demo mode. Add your key after you exit." Any other key status surface reads "Simulated" rather than implying a real key. Other settings still work on demo data.
- Tabs: Copilot and Activity Logs are visible in demo. Referrals and Routines stay hidden. Backup is hidden.
- Copy rules: no em dashes, no claims of real employer contact, no wording that implies the simulated results will help a real application.
- Accessibility: keyboard reachable exit, visible focus, AA contrast in both themes, `prefers-reduced-motion` honored, and a way to skip staged animation.

## Error handling

- `sessionStorage` denied or full: fall back to memory, keep the demo running, and show the reset-on-refresh note.
- Corrupt or old demo data: reseed from fixtures. The seed carries a schema version.
- A simulation route that is not implemented: return the normal typed error with a plain message. Never delegate an AI or desktop-only route to the real runtime.
- Exit during a staged run: cancel timers, discard state, wipe the namespace, then switch modes.
- A failed simulated route shows the normal error card. The demo never fails silently.

## Testing

### Unit tests

- `mode.test.js`: default real, enter and exit, per-tab storage, subscription notifications, exit clears only the demo namespace.
- `sessionAdapter.test.js`: vault adapter contract, persistence, prefix isolation, memory fallback, `clearAll`.
- `fixtures.test.js`: every job passes the shared card schema, every URL uses `.test`, no key-shaped strings, no real contact details.
- `simulationApi.test.js`: tailor transition and documents, ask answer and refusal metadata, check findings, copilot submission record, delegation for CRUD, and rejection of any unhandled AI route.
- `feed.test.js`: result shape, South Africa and foreign rows, no fetch call.
- `progress.test.js`: step completion, dismissal, namespace reset.
- `isolation.test.js`: static scan proving the demo tree does not import `keyStore`, `keyCrypto`, `validateKey` or `@sajas/core/ai`, and that every demo URL and email uses a reserved `.test` domain.
- A build check proves the real entry chunk contains no demo fixture markers, so demo data and code stay out of the initial load.
- `install.test.js` and `mode.test.js` updated for the dispatcher and demo tab visibility.

### Browser proof

`scripts/web-demo.mjs`, added to `npm run test:web`, runs offline:

1. Seed the real IndexedDB with a sentinel profile name and a sentinel job.
2. Load the app and enter the demo from the landing page.
3. Confirm the banner, the seeded data and the absence of a key input.
4. Load feeds, tailor a job, ask a supported question and an unsupported one, run the hunter to completion, and complete the copilot loop through confirmation and receipt.
5. Refresh and confirm the demo is restored.
6. Exit and confirm the sentinel profile and sentinel job are untouched, and every `sajas:demo:` key is gone.
7. Assert no console errors and zero requests outside the page origin.
8. Assert no `sajas:demo:` key exists before the demo action, and that the initial page state carries no demo fixture text.

### Live check

After deploy, in a fresh browser profile: enter the demo, run one flow from each surface, exit, and confirm the real workspace is empty and unchanged, with no console errors.

## Non-goals

- Changing the desktop app or its synthetic fixture.
- Real portal automation from the hosted app.
- Real employer contact, email, or application submission.
- Storing demo data in IndexedDB or in backups.
- Persisting demo mode across tabs, days or browser sessions.
- A backend, accounts, analytics, or any request carrying demo data to our origin.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| A visitor mistakes simulated output for real results | Persistent banner, per-result tags, labeled receipt, explicit exit. |
| Demo state leaks into the real workspace | Separate runtime, separate prefix, hidden backup, sentinel E2E test. |
| Bundle grows for real users | Demo code and fixtures are dynamically imported on first entry, and a build check guards the entry chunk. |
| Simulated response shapes drift from real ones | Unit tests assert the same top-level contracts, and application records go through the shared core summariser. |
| `sessionStorage` limits | Small seed, memory fallback, reseed on corruption. |
| A staged run keeps running after exit | Explicit cancellation on unmount and on mode change. |

## Acceptance criteria

- A visitor on `sajas.pages.dev` can enter the demo without a key and without any network request beyond the page origin.
- The demo banner is visible on every tab, and Exit returns to the real workspace.
- Feeds, tailoring, grounded ask and refusal, hunter, copilot confirmation and receipt, and guided apply all work in the demo.
- After heavy demo use and exit, the real workspace's sentinel profile and sentinel job are byte-for-byte unchanged.
- A refresh restores the demo in the same tab; a freshly opened tab starts in real mode; exit removes every demo key.
- The full demo walk produces no console errors and no non-page-origin requests.
- The demo bundle is not loaded in real mode until the demo action is used.
- Unit tests, the browser proof and the live check pass, with no key set and no live scraping.

## Rollout

This is Arc 9. Inbox and MCP integration moves to Arc 10. The arc ships with the normal gates, a PR, a merge, a Pages deployment from merged `main`, and a live browser check. `README.md` gains a demo section, `SECURITY.md` records the isolation contract, and the pipeline table records the new order.
