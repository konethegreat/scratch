# M0 live verification — PENDING (no API key yet)

**Status:** not done. M0 and M0.5 were built and tested without a real Anthropic API key. Everything below is unverified against the live API.

## What is unverified

| Assumption | Where it lives | Current default |
|---|---|---|
| Server-side refusal fallback (`betas: ['server-side-fallback-2026-07-01']` + `fallbacks: 'default'`) is accepted | `REFUSAL_FALLBACK_DEFAULT` in `packages/core/src/ai.js` | `true` |
| JSON-schema structured output works together with the `web_search_20260209` tool | `CAPABILITIES.searchStructuredOutput` in `packages/core/src/models.js` | `true` |
| Haiku 5.5 accepts the web search tool (Token Saver preset) | `CAPABILITIES.haikuWebSearch` in `packages/core/src/models.js` | `true` |
| Prompt caching actually hits (second identical call reads from cache) | smoke probe 6 | not measured |
| Cost per completed task, cache-hit ratio per task class | `evals/run.mjs --live` | not measured |

## What protects the first real run (M0.5)

`callClaude` degrades instead of failing. If the API answers HTTP 400 and the message points at one of the first three assumptions, it retries the same request once without that feature (plain stream; no schema; Sonnet instead of Haiku), remembers the lesson for the rest of the process, and writes a notice to the activity log (`<task>: <step> not accepted by the API (...); retried without it`). So a wrong default costs one rejected request per launch, not a broken hunt. It does **not** make the choice permanent and it does not cover the cache or cost numbers.

## To close this out when you have a key

Use a key from a dedicated Workspace with a spend limit (Anthropic Console). Do not use an Admin key.

```bash
# from sa-job-agent-suite/
export ANTHROPIC_API_KEY=...        # PowerShell: $env:ANTHROPIC_API_KEY = "..."
npm run smoke:live -- --yes-spend   # a few cents. Add --no-fallback to test without the refusal-fallback beta
node evals/run.mjs --live --yes-spend --trials 1   # roughly $1-2 per trial; prints an upper-bound estimate first
```

Each smoke probe resets the learned-degrade state first and reports FAIL (naming the step) if the API rejected a feature and `callClaude` had to retry without it.

### Decision rules for a failing probe

- Probe 3 fails (search + schema): set `CAPABILITIES.searchStructuredOutput = false` in `packages/core/src/models.js`. If probes 3/4 only fail with the fallback transport, re-run with `--no-fallback` to tell the two causes apart.
- Probe 4 fails (Haiku + web search): set `CAPABILITIES.haikuWebSearch = false` (the Token Saver preset then searches on Sonnet at light depth).
- Probe 5 / 5b fails (refusal fallback): set `REFUSAL_FALLBACK_DEFAULT = false` in `packages/core/src/ai.js`.
- Probe 6 fails (second call does not read the cache): stop and diagnose the cached prefix before relying on the cost numbers. This is a real bug, not a flag.
- Re-run `npm test` after any flag change.

After the baseline run, copy the per-class summary (pass rate, cost per completed task, cache-hit ratio) into `docs/superpowers/baselines/<date>-m0-post.md` with the date, the models and the smoke outcomes, and tick the boxes below.

## Checklist

- [ ] `npm run smoke:live -- --yes-spend` run, all probes PASS (or flags flipped per the rules above)
- [ ] `node evals/run.mjs --live --yes-spend --trials 1` run
- [ ] Baseline numbers recorded in `docs/superpowers/baselines/<date>-m0-post.md`
- [ ] Flags committed (if any changed) and `npm test` green

---

## Live scraping verification (pending)

**Status:** not done. Every hunter adapter is verified only against the synthetic
fixtures in `server/src/hunter/fixtures/`, and every pagination parameter is
`verified: false`. Nothing below needs an API key; it needs a network and a
browser. Do it before trusting a live hunt.

### 1. Record one real page per board

From `sa-job-agent-suite/`. Each command visits the LIVE site; `--yes` is the
confirmation, and `--keyword`/`--location` are optional (keyword defaults to
`developer`, location to the board's canary location).

```bash
node scripts/hunter-record.mjs linkedin       --keyword "software engineer" --location Johannesburg --yes
node scripts/hunter-record.mjs indeed         --keyword "software engineer" --location Johannesburg --yes
node scripts/hunter-record.mjs pnet           --keyword "software engineer" --location Johannesburg --yes
node scripts/hunter-record.mjs careerjunction --keyword "software engineer" --location Johannesburg --yes
node scripts/hunter-record.mjs googlejobs     --keyword "software engineer" --location Johannesburg --yes
node scripts/hunter-record.mjs adzuna         --keyword "software engineer" --location Johannesburg --yes
node scripts/hunter-record.mjs executive      --keyword "software engineer" --location Johannesburg --yes
node scripts/hunter-record.mjs jobplacements  --keyword "software engineer" --location Johannesburg --yes
node scripts/hunter-record.mjs govza          --yes
node scripts/hunter-record.mjs jobmail        --keyword "software engineer" --location Johannesburg --yes
node scripts/hunter-record.mjs jobscoza       --keyword "software engineer" --location Johannesburg --yes
node scripts/hunter-record.mjs gumtree        --keyword "software engineer" --location Johannesburg --yes
```

Each run loads page 1 headlessly, strips scripts/styles/iframes/inline handlers
and masks emails/phone numbers, writes
`server/src/hunter/fixtures/recorded/<id>-<yyyymmdd>.html` (gitignored) and
prints the path plus its byte count. A suspiciously small file (a consent or
bot-wall page) is itself a finding: the board is not serving a result list to
this browser fingerprint.

Then:

```bash
npm test --workspace=server
```

`contract[<id>]: recorded live pages (when present) ...` now runs each adapter
against the recorded page and fails when a board yields 0 items, a blank title,
or a non-absolute apply link. A board with no recording simply skips. Re-record
after fixing selectors, and compare the failing page with the synthetic fixture
to see what changed.

### 2. Test sources in the app

Hunter tab → **Source health** → **Test sources**. This runs one canary page per
enabled board, about two seconds apart, and writes each result to the board and
the source history. Disabled boards are skipped; no jobs are saved. For a
scheduled version, create a **Check source health (no hunting)** routine: it
takes the `canary` browser lock, records `{canary, tested, passed, note}`, and
is marked `skipped` when a hunt/apply already holds the browser. It never calls
the AI.

### 3. Reading a failing canary

Open the board row's reason (or the routine's last-result line). `reasons` is
ordered, so the first item is the cause:

- `blocked: <kind>` — a bot wall or login wall. A login block shows as
  **Needs login**: sign in via the login browser, then re-test. A challenge or
  rate-limit block cools the source down for 6 hours after two consecutive
  occurrences.
- `error: <message>` — navigation failed or timed out (45 s in the record tool;
  the canary uses the normal page timeout).
- `returned 0 items, expected at least <n>` — the page loaded but the selectors
  found nothing: the layout drifted, or the site served an empty/consent page.
- `only <x>% of items have title and link` — the selectors partially match (a
  renamed title/link class). Linkless boards are checked on title only.

A failing canary that is **newer** than the last hunt reads as **Broken** on the
board; an older canary does not override a healthy hunt. Three consecutive
broken hunt runs open the circuit breaker (the board shows **Reset**); two
consecutive non-login blocks set the 6-hour cooldown.

### 4. Confirm the pagination parameters

Every source declares `pagination: { param, firstValue, step, verified: false }`.
Open page 2 in a normal browser (build it with `source.buildUrl(query, 2)`, or
add the parameter by hand) and confirm it returns a DIFFERENT set of cards — not
page 1 again and not an error/empty page.

| Source | Parameter | Page 2 value |
|---|---|---|
| LinkedIn | `start` | 25 |
| Indeed | `start` | 10 |
| PNet | `page` | 2 |
| CareerJunction | `page` | 2 |
| Adzuna | `p` | 2 |
| Executive Placements | `page` | 2 |
| Job Placements | `page` | 2 |
| National Government | `page` | 2 |
| JobMail | `page` | 2 |
| Jobs.co.za | `page` | 2 |
| Google Jobs | none | — |
| Gumtree | none | — |

Once a parameter is confirmed, set `verified: true` in that source's
`sources/<id>.js` (and update the contract test's `pagination.verified`
assertion, which currently pins every source to `false`). If a board ignores the
parameter, set `param: null` so the crawler does not waste a page fetch.
