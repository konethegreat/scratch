# Scraper Debugging Guide

**Status:** Arc 7, 2026-10-28

## What the hunter reads

Each page is read through four strategies, in this order:

1. `structured`: the source adapter, then JSON-LD, then job arrays found in embedded state or same-origin JSON responses.
2. `dom`: the source's own CSS extractor.
3. `semantic`: headings, semantic attributes and heading anchors.
4. `ai`: only when the three free strategies return zero valid rows, only with a key and budget.

Every row passes the same schema gate. The strategy with the most valid rows wins. Ties prefer structured, then dom, then semantic. A rejected row is never saved.

## Triage from a canary failure

1. Open Source Health and read the status and reason. "the page layout changed" means rows were found but validation failed. "returned nothing" means no rows were found at all.
2. Run the debug CLI for that source with the canary keyword.
3. Read the per-strategy counts. If `structured` or `semantic` wins, the source is already recovered and the DOM selectors need a later cleanup. If every strategy is zero, go to the snapshot.
4. Save the snapshot and open `report.json`. The rejection reasons name what failed.
5. Fix the source selector or add a source adapter, then rerun the CLI and the source contract tests.

## The CLI

Run it from `sa-job-agent-suite/`. It needs no key and never calls AI.

```bash
node scripts/hunter-debug.mjs --source pnet --keyword developer
node scripts/hunter-debug.mjs --source indeed --keyword developer --location "Cape Town" --save
node scripts/hunter-debug.mjs --source pnet --html hunter-debug/pnet-.../page.html --capture hunter-debug/pnet-.../capture.json
```

`--save` writes `page.html`, `capture.json` and `report.json` under `hunter-debug/`, which is gitignored. `--html` replays a saved page offline and reads the JSON-LD and embedded state in that HTML, plus any network responses in the capture file.

## Adding a source adapter

Add an optional `mapStructured({ payloads, origin })` function to the source in `server/src/hunter/registry.js`. Return an array of raw cards, or an empty array to fall through to JSON-LD and generic arrays. Never fetch inside the adapter: it receives what the page already loaded.

## The anti-bot baseline

The hunter uses real Chrome with the persistent profile, a South African locale and timezone, per-host pacing with jitter, `Retry-After` honored up to 60 seconds, and at most two retries for 408, 429, 503 or a transient network error. It never solves a CAPTCHA, rotates a proxy, spoofs fingerprints beyond the existing automation flag, or retries a login wall or a 403. When a site challenges the browser, the source cools down for six hours and the user should use the site's own search. When a site needs a login, the login browser is the fix.
