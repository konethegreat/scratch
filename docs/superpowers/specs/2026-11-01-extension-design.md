# Phase 3: Apply Assistant Extension

**Status:** approved as Phase 3 of [Automation and Data Depth](2026-11-01-automation-and-data-depth-design.md)
**Date:** 2026-11-01
**Phase:** 3 of 4
**Sources of truth:** the architecture spec above, the Phase 2 packet, bridge and delivery contracts, `SECURITY.md`, `THREAT-MODEL.md`, `POLICY.md`.

## Goal

Close the loop between the app and a real job form. A Manifest V3 extension receives a packet v2 from the hosted app, fills the fields it recognises on the application page, shows the user exactly what it filled and what it skipped, and submits only when the user presses the panel's Submit button. The result returns to the app and becomes an ordinary tracker record with delivery `extension`.

## Scope

In:

- `packages/core/src/apply/matcher.js` and `adapters.js`: a pure field matcher over plain field descriptors, plus generic, Greenhouse and Lever adapters.
- `extension/`: an unpacked MV3 extension with a service worker, an app-origin content script, an injected page script with a shadow-DOM review panel, a popup, and an IndexedDB store for packets and results.
- `scripts/build-extension.mjs`: esbuild bundling of the extension and the shared core modules into `extension/dist`.
- `scripts/check-extension.mjs`: static gates on the manifest, permissions and forbidden APIs.
- App-side result sync: `extensionBridge.pullResults()` and `ackResults()`, wired into the web app so results become tracker records.
- Playwright proofs against local Greenhouse, Lever and generic fixtures, and result sync against the built app.

Out:

- Store publication, signing and automatic updates. The extension is installed unpacked from the repository.
- Filling real portals in tests or CI. Every fixture is local.
- CAPTCHA solving, account creation, or any action past the site's own Submit button.
- Demo v3 (Phase 4). Demo mode gains no extension controls and never creates a bridge.
- Desktop, desktop copilot, `SYNTHETIC_DEMO` and `server/src/demo.js`. The desktop keeps packet v1 and its copilot.

## Architecture

```
sajas.pages.dev tab                      application page tab
+---------------------+                  +------------------------------+
| app (React)         |                  | fixture / portal DOM        |
|  extensionBridge    |                  |  page.js (injected)         |
|   | postMessage     |                  |    shadow-DOM review panel  |
|   v                 |                  |    matcher + fill + submit  |
| appBridge.js        |  runtime message |         |                   |
|  (content script)   | ---------------> | service worker (sw.js)      |
|                     | <--------------- |  IndexedDB: packets,        |
|                     |  results         |  results, pending           |
+---------------------+                  +---------|-------------------+
                                                    |
                                         popup (action click)
```

1. The app posts `sajas:hello` and, when the user presses Send, `sajas:packet` with the page nonce. `appBridge.js` checks source, origin and nonce, forwards the packet to the worker, and answers with `sajas:ack` only after the worker validated and stored it.
2. The worker validates every packet with `sanitisePacketV2`, stores it for eight hours (at most five), and never reads the app's IndexedDB or key.
3. On the application page the user opens the popup, which lists every fresh packet whose `job.site` matches the tab's host, newest first. One host can carry several roles, so the popup shows a radio list and the user picks the application on the page before pressing **Fill this page**. The popup asks the worker to inject `page.js` into that tab and send it the chosen packet id.
4. `page.js` reads the packet from the worker, extracts field descriptors from the visible form, runs the matcher and adapter, fills confident fields, attaches matching files, and opens the review panel with three lists: filled, needs you, attachments.
5. The user ticks **I reviewed these details** and presses **Submit application**. `page.js` refuses if a CAPTCHA is present, then records a pending submission with the worker before it clicks the adapter's submit control once. A page that updates in place is confirmed as before: the page script waits up to eight seconds for a success signal and records the result. A form that submits by navigating destroys the page script, so the worker finishes the pending submission from the tab's next URL: it must stay on the packet's site and read like a confirmation page, and it is recorded with the text `The page moved to a confirmation page.` A failed or unclear result cancels the pending entry.
6. The app pulls queued results when it loads and again whenever its window regains focus, calls the existing `markApplied` route with delivery `extension`, then asks the extension to delete the synced results. A result whose job no longer exists is dropped and acknowledged so it cannot loop. A single run guard keeps overlapping pulls from duplicating a sync.

## Matcher and adapters

`describeField(element)` and DOM access stay in the extension. `@sajas/core` receives plain descriptors so the rules are testable in Node:

```js
{
  id, name, label, placeholder, autocomplete, type, required,
  visible, disabled, options: [{ value, label, selected }]
}
```

`matchFields(packet, descriptors, adapter)` returns:

```js
{
  fills: [{ fieldId, key, label, value, source }],   // confident matches only
  skipped: [{ fieldId, label, reason }],             // 'unknown', 'sensitive', 'no answer', 'captcha'
  attachments: [{ fieldId, label, attachmentKey }],
  captcha: boolean
}
```

Rules:

- Normalise a candidate label by lowercasing, removing punctuation and collapsing whitespace, then compare against the canonical key, its synonyms and known autocomplete tokens. A match is exact on the normalised form or an explicit synonym. There is no fuzzy guessing.
- `type=password`, fields named for CSRF tokens, honeypots that are not visible, and fields with no answer are skipped with a reason; the user sees every skip.
- Selects match an option by normalised label or value; radios and checkboxes match by value; everything else receives a string.
- File inputs match by label: CV/resume takes the tailored CV attachment first, then a document labelled CV; ID, passport, certified copy, qualification, certificate and transcript take the document whose label matches. Only attachments already in the packet are used.
- Adapters carry only host matching, extraction priority and submit/success selectors: `generic`, `greenhouse` (`boards.greenhouse.io`, `job-boards.greenhouse.io`), `lever` (`jobs.lever.co`). Anything unrecognised uses `generic`.

## Extension contract

- The extension has no `fetch`, `XMLHttpRequest`, `WebSocket` or remote script. `scripts/check-extension.mjs` fails the build on any of them, on `<all_urls>`, on `externally_connectable`, on inline scripts and on any permission beyond `storage`, `scripting`, `activeTab`, `tabs`.
- Host permissions are the app origin, `http://localhost/*` and `http://127.0.0.1/*` so the empty and dev apps work. A job page is reached only through `scripting` with a user action, never through a standing host permission.
- Packets live in the extension's own IndexedDB (`sajas-extension`, store `packets`) with an eight-hour expiry and a five-packet cap. Results live in store `results` with a fifty-result cap. Pending submissions live in store `pending` with a one-minute expiry and a five-entry cap, keyed by packet id and the tab that started them. None of the stores is readable by the app's origin; only the content script relays what the worker chooses to send.
- Every message is validated: app messages by source window, origin, nonce and version; worker messages from the app script by `sender.url` host; page messages by `sender.tab.id` and the stored packet's site; popup messages by the extension origin. `begin-submit`, `cancel-submit` and `record-result` all require the page sender's tab host to equal the result's site.
- The worker re-validates a packet on read, so a corrupted store cannot yield a packet outside the contract.
- The page script never navigates, never opens a window, never submits without the panel button, and stops at a CAPTCHA, an unknown submit control or an unconfirmed submission.
- No key, key vault record or app storage handle exists anywhere in the extension.

## Result sync

The worker returns results as `{ packetId, jobId, site, submittedAt, confirmation, fields, warnings }`; the app maps them to `POST /jobs/:id/applied` with `{ delivery: 'extension', fields, confirmation }`. The existing route already caps fields, sets the job to applied, and writes the memory record with submitter `user`. The app acknowledges ids that were recorded or whose job is gone, and leaves failed ids queued for the next load. A toast reports how many applications were synced.

## Testing

- Matcher unit tests: every canonical key, synonyms, autocomplete, normalisation, unknown and sensitive skips, select and radio matching, attachments, no-answer handling, and no match on a lookalike label.
- Adapter unit tests: host matching, submit and success selectors, extraction priority.
- Protocol unit tests: message shapes, version, nonce, and refusal paths.
- Store unit tests: caps, expiry, eviction, invalid packet refusal, result cap.
- Static gate: `scripts/check-extension.mjs` as above.
- Browser proof `scripts/web-extension.mjs`: the unpacked extension loads in Chromium; an app fixture completes the hello/packet handshake; each of the four form fixtures is injected, filled, reviewed and submitted, including one form that submits by navigating to its own thank-you page; the confirmation is recorded in the results store, from the page script for in-place pages and from the tab URL for the navigating form; the built app then syncs that result into a seeded job and memory with delivery `extension`; every request stays on localhost.
- Existing gates stay green: `npm test`, `npm run test:demo`, `npm run build:web`, `npm run test:web`, `node tools/check-secrets.mjs --all`, plus `npm run build:extension`.
- The app's demo proof gains one assertion: demo mode never opens a bridge and never pulls results.

## Acceptance criteria

1. The popup lists every packet whose site matches the current tab, lets the user pick one, and refuses any other page.
2. A recognised field is filled once with the packet value; an unrecognised or sensitive field is listed as skipped with a reason.
3. Filing a CAPTCHA, an unknown submit control or a missing confirmation never records a submission, including when the page navigates away.
4. A submitted application returns to the app as a tracker record with delivery `extension`, submitter `user`, the filled fields and the confirmation text, whether the page confirmed in place or by navigating to a confirmation page on the same site.
5. The extension makes no network request; the static gate and the browser proof both prove it.
6. The extension cannot read the app's IndexedDB or key, and the app still works with no extension installed.
7. All gates pass, and the desktop, copilot and demo paths are unchanged.

## Risks

| Risk | Mitigation |
|---|---|
| Filling the wrong field on a real form | Exact matching only, a review panel before submit, every skip shown, and one submit control found by adapter. |
| A malicious app-origin page or another extension impersonating the app | Same-window, same-origin and live nonce on app messages, plus packet validation in the worker. |
| The popup injecting into an unintended tab | Injection happens only on an action click, only for the active tab, and only when its host equals the packet's site. |
| Stale packets or results | Eight-hour expiry, five-packet and fifty-result caps, and time-ordered eviction. Pending submissions expire after one minute and are capped at five. |
| A navigating form confirming the wrong thing | The next URL must stay on the packet's own site and read like a confirmation; leaving the site clears the pending entry without recording. |
| Attachment size | Phase 2 caps still apply; the extension decodes only attachments already accepted by the sanitiser. |
| Store rejection | No remote code, minimal permissions, a published privacy note, and the extension is optional. |

## Evidence

- Gates: `npm test`, `npm run test:demo`, `npm run build:extension`, `npm run check:extension`, `npm run build:web`, `npm run test:web` and `node tools/check-secrets.mjs --all`, all green.
- Proofs: matcher and adapter tests in `@sajas/core`; protocol, store and worker tests under `extension/src`, including several packets on one host, pending submission expiry and the tab-URL finalisation; the bridge and sync tests under `client/src/web`; and `scripts/web-extension.mjs` for the handshake, three adapters, a navigating form, CAPTCHA refusal, review, submit and result sync, with no request outside the two local origins.
- Docs: README install steps and behaviour; `SECURITY.md`, `THREAT-MODEL.md` and `POLICY.md` describe the extension, its stores and the navigation confirmation.
