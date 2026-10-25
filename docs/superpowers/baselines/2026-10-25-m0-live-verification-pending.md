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
