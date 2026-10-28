# South Africa First and Search Filters: Design

**Status:** proposed 2026-10-28, awaiting review
**Date:** 2026-10-28
**Arc:** 6 of the post-M3a-3 pipeline (inserted before real-browser auto-apply)
**Sources of truth:** [`2026-10-27-post-m3a3-pipeline.md`](2026-10-27-post-m3a3-pipeline.md) sections "Arc 6" and "Arc 7", and the user's request of 2026-10-28.

## Goal

Every job the candidate sees is South African, or is clearly labelled as having an unconfirmed location. The candidate can narrow the job list by the attributes that matter: province or city, source, status, match score, link health, remote, and date added. The same behaviour works in the hosted web app and the desktop app.

This arc exists because the user's first complaint about the live product is that the list can contain American and European jobs. A correct application workflow is worthless on a wrong list, and the scraper work in Arc 7 must preserve this gate rather than replace it.

## Revised arc order

| Arc | Scope | Why here |
|---|---|---|
| 6 | South Africa relevance and search filters | Fixes the visible relevance problem and gives the candidate control. Highest user value. |
| 7 | Scraper resilience | The four-principle brief: API and hydration interception, resilient selectors, runtime schema validation, anti-bot baseline, debugging guide. |
| 8 | Real-browser apply and browser sessions | The original Arc 6. Starts by proving the persistent profile and adding the consent surface for reusing the candidate's own site sessions. |
| 9 | Inbox and MCP integration | The original Arc 7. |

## Findings that shaped this design

These were confirmed by reading the current code on 2026-10-28, not assumed.

1. **The strict location check is never applied.** `agent1-hunter.js` calls `isSouthAfricanLocation(job.location, false)` for every source. The `false` forces the lenient mode, so `saCheck: 'strict'` sources (LinkedIn, Google Jobs) never reject an unknown location. The comment at that call site says so plainly.
2. **`saCheck: 'none'` skips the check entirely.** Eight sources use it: PNet, CareerJunction, Gumtree, GovZA, Jobmail, Jobs.co.za, Executive Placements, and Job Placements. A cross-post on any of them with a foreign location is saved.
3. **The foreign marker list is short and substring based.** It has no US states, most European cities, or large parts of Asia and Africa. Matching uses `includes`, which invites both misses and accidental hits.
4. **The feeds are global.** Remotive, Arbeitnow, and Jobicy are worldwide remote boards. They are only filtered when the candidate has locations set, and the matcher is a text substring check with no South Africa gate. With no locations set, every feed row passes.
5. **AI web search is asked for South Africa but never checked.** The prompt says "South African locations only", and there is no post-check before scoring. A prompt instruction is not a guarantee.
6. **Filters are thin.** The Jobs tab has a free-text search and a status select. There is no province, source, score, link, remote, or date filter, and nothing persists across reloads.
7. **The persistent browser profile works at the mechanism level.** A local proof launched a persistent Chromium context against a local HTTP server, set a cookie, closed the context, relaunched, and read the same cookie. The live desktop profile also contains a 229 KB cookie store and a 40 KB Login Data file last written on 2026-06-18, so sessions were captured at some point. Session validity needs the desktop "Check logins" action, which performs a live navigation, and that belongs to Arc 8.

## What this arc ships

1. **One shared location classifier** in `packages/core`, used by the hunter, the feeds, the AI search post-check, and both job views.
2. **Hunter enforcement** that rejects foreign locations from every source and unknown locations from strict sources, and records the verdict on each saved job.
3. **Feed and AI search enforcement** using the same classifier, with an explicit South Africa only default in the feed tab.
4. **A Jobs filter bar** with province, source, status, minimum match, link health, remote, date added, and the existing free text. Every filter combines and persists.
5. **Non-destructive handling of existing jobs.** Foreign jobs already in the database are hidden by default, counted, and revealable. Nothing is deleted.
6. **Offline evidence** for the classifier, every enforcement point, every filter, and the web flow.

## Location classifier

New module: `packages/core/src/jobs/location.js`, exported from the core index.

```js
classifyLocation(raw) -> {
  verdict: 'sa' | 'foreign' | 'unknown',
  province: string | null,   // one of the nine SA provinces
  place: string | null,      // recognised city or town
  remote: boolean,
  reason: string             // see the table below
}
```

The classifier is pure, has no I/O, and never throws. Rules run in this order:

| Order | Condition | Verdict | Reason |
|---|---|---|---|
| 1 | Blank or whitespace | `unknown` | `blank` |
| 2 | South Africa country signal (`south africa`, `south african`, `rsa`, `za` as a country token) | `sa` | `country` |
| 3 | Province name, including `kzn` and `kwazulu natal` | `sa` | `province` |
| 4 | Recognised SA city or town | `sa` | `city` |
| 5 | Explicit foreign country, region, or major city (`united states`, `usa`, `uk`, `london`, `new york`, `berlin`, `lagos`, `dubai`, `india`, `europe`, `emea`, and a widened list) | `foreign` | `foreign` |
| 6 | Worldwide remote (`worldwide`, `anywhere`, `global`, `work from anywhere`) | `foreign` | `worldwide` |
| 7 | Bare remote or hybrid (`remote`, `work from home`, `hybrid`) | `unknown` | `remote-unstated` |
| 8 | Anything else | `unknown` | `unrecognised` |

Additional rules:

- **South Africa wins a mixed location.** `Johannesburg or London` is `sa`. A listing that can be done from South Africa is useful to this candidate, and the strict policy below still rejects pure foreign listings.
- **Matching is token and phrase aware, not raw substring.** `us` never matches inside `business`, and `uk` never matches inside a word. Two-letter country codes only count when they appear as a comma separated last token (`Cape Town, ZA`) or as the standalone token `za`.
- **Ambiguous names are handled deliberately.** `Georgia` is foreign, because the country and the US state are both outside South Africa. `Newcastle` and `Queenstown` are not in the SA city list because they are also large foreign cities. They resolve to `unknown` and stay visible with a badge.
- **The SA city list covers the current list plus the main metros and mining and industrial towns.** Each city maps to its province. The full list lives in the module and in its tests, not in this document.
- **The foreign list covers all continents.** Country names, major cities, and region names. The list is data, kept next to the SA list, so it can grow without touching logic.

Policy is separate from classification:

```js
isSouthAfrican(raw, { strict = false }) -> boolean
```

`strict` means only `sa` passes. Lenient means `sa` and `unknown` pass. `foreign` never passes. This keeps one verdict function and two policies, which is what the hunter and the views need.

## Enforcement

### Hunter, desktop

- Replace `SA_LOCATION_TERMS`, `FOREIGN_LOCATION_TERMS`, and `isSouthAfricanLocation` with the core classifier.
- **Foreign is rejected for every source**, including `saCheck: 'none'`. A cross-post on PNet or Gumtree is still a foreign job.
- **Unknown is rejected only when `saCheck === 'strict'`.** Soft and none keep unknown jobs and label them.
- Pass the policy from the source, not a hard-coded constant. The call site bug is the fix.
- Save `locationVerdict` and `province` on each job. Old jobs without these fields are classified on the fly when they are read.
- Log the rejected count per source, plus one sample, so a source that has become global is visible in the Activity Console.

### AI web search, desktop

- After parsing the structured result and before scoring, run every job through the same lenient gate and drop foreign locations.
- Log `Rejected N non-SA job(s) from AI search`.
- Keep the prompt wording. The post-check is the guarantee, the prompt is the hint.

### Feeds, web and desktop

- `filterJobs(jobs, { keywords, locations, onlyMatches, saOnly })` gains `saOnly`, default `true`.
- With `saOnly`, foreign rows are removed from the visible results and counted. Unknown rows stay and carry the `Unconfirmed location` badge.
- The Job Feeds tab gains a `South Africa only` checkbox, on by default, next to the existing keyword, location, and only-matches controls. The count of hidden foreign rows is shown under the list.
- Saving feed defaults stores `saOnly` with the other filters.
- This changes the current default. Existing feed tests and fixtures that expect foreign rows to pass are updated to assert the new behaviour, so the change is visible in the diff rather than silently absorbed.

### Existing jobs and both job views

- Add a pure helper `jobLocationVerdict(job)` in core that trusts `job.locationVerdict` when present and valid, and classifies `job.location` otherwise.
- Both the desktop Jobs tab and the web Jobs tab default `saOnly` to on.
- Foreign jobs are hidden, never deleted. The filter bar shows `N non-SA job(s) hidden` and a `Show them` control that turns `saOnly` off for the session.
- A bulk cleanup action is deliberately out of scope. Deleting stored jobs is irreversible and needs a separate, explicit confirmation flow.

## Filters

New pure module: `packages/core/src/jobs/viewFilters.js`, exported from the core index. The client only renders and stores state.

```js
DEFAULT_VIEW_FILTERS = {
  q: '',
  status: 'all',
  province: 'all',
  source: 'all',
  minScore: 0,
  link: 'all',          // all | live | no-link
  remoteOnly: false,
  addedWithin: 'any',   // any | 7 | 30
  saOnly: true
}

normalizeViewFilters(input) -> safe filters
filterJobsForView(jobs, filters) -> { visible, hiddenForeign, total }
```

Rules:

- `normalizeViewFilters` accepts untrusted input, including a parsed localStorage value. Any missing, wrong-typed, or unknown value falls back to its default. It never throws.
- `filterJobsForView` classifies only when a job has no stored verdict. It does not mutate the job.
- `q` matches title, company, location, and source, case insensitive, as today.
- `province` matches the job's stored `province`, or the classifier's province when absent.
- `source` matches `job.source` exactly.
- `minScore` keeps jobs at or above the chosen score. Jobs without a score count as 0.
- `link` keeps `live` links, or jobs with `no-link`, using the existing `linkStatus` values.
- `remoteOnly` keeps jobs the classifier marks remote.
- `addedWithin` compares `dateAdded` to today. Missing or invalid dates are kept only when the filter is `any`.
- Results keep the current order. The view does not re-sort.
- `hiddenForeign` counts foreign jobs hidden by `saOnly`, so the UI can be honest about what it removed.

### UI

- One filter row above the job table: search, province, source, status, minimum match, link, date, and a South Africa only checkbox.
- Secondary chips for `Remote`, `Live link`, `Strong match (80+)`, and `Added this week`, mapped to the same state. They are shortcuts, not a second filter system.
- The row collapses behind a `Filters` button below 720 px, with the active filter count on the button.
- `Showing X of Y` stays visible. `N non-SA job(s) hidden` appears when `hiddenForeign > 0`.
- `Clear filters` resets to `DEFAULT_VIEW_FILTERS`.
- Empty state names the active filters and offers `Clear filters`, instead of a generic "no jobs" message.
- Filter state is saved to `localStorage` under `sajas.jobFilters.v1` on every change, and validated with `normalizeViewFilters` on load. Invalid data is discarded silently and the defaults apply.
- Province and source options are built from the jobs present plus the nine provinces, so the controls never offer an empty choice.

## Data changes

- Jobs gain two optional fields: `locationVerdict` and `province`. No migration is required because missing fields classify on read.
- The profile gains one optional feed default: `feedSaOnly`, default true.
- One new localStorage key: `sajas.jobFilters.v1`.
- No new IndexedDB store, no backup schema change, no new network call, no key material.

## Error handling and copy

- A saved filter value that cannot be read is discarded, never surfaced as an error. The candidate sees the default view.
- Location copy is plain: `Unconfirmed location` for unknown, `N non-SA job(s) hidden` for foreign, `Show them` to reveal.
- No em dashes. No blame. No technical jargon in the UI.
- The hunter log uses the existing plain style: `[PNet] Rejected 3 non-SA location job(s). Samples: "Engineer (London, UK)".`

## Non-goals

- Deleting stored jobs automatically, or at all in this arc.
- Changing how jobs are scored or ranked.
- Scraper interception, hydration parsing, and schema gates. That is Arc 7.
- Browser session consent and auto-apply. That is Arc 8.
- Country selection beyond South Africa. This product is for South African roles.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| The classifier hides a legitimate SA job | Only foreign is hidden. Unknown stays visible with a badge, and hidden foreign is counted and revealable. |
| A new foreign city is not on the list | The verdict is `unknown`, so the job stays visible and labelled. The list is data and can grow without code changes. |
| `SA only` hides worldwide remote jobs the candidate could do | Worldwide is treated as foreign by policy, and the reveal control shows them. The filter is visible and reversible. |
| A stored filter value breaks the view | `normalizeViewFilters` is total and tested against malformed input. |
| The hunter change drops too many jobs | Tests cover the strict, soft, and none matrix, and the Activity Console logs rejected counts per source with samples. |
| The desktop and web views drift apart | Both call the same core function. The client only renders. |

## Testing and evidence

- **Classifier table tests.** At least 30 cases covering cities, provinces, country names, foreign cities, mixed locations, bare remote, worldwide, blank, and inside-word traps such as `business`.
- **View filter tests.** Every filter alone, combinations, defaults, and malformed stored state.
- **Hunter gate tests.** Strict rejects unknown, soft and none keep unknown, every mode rejects foreign, and AI results are filtered before scoring. Pure functions and fixtures only.
- **Feed tests.** `saOnly` drops foreign, keeps unknown, and counts the drop.
- **Web proof.** Seed SA, foreign, and unknown jobs in IndexedDB, then assert: foreign hidden by default with a count, reveal works, province and score filters narrow the list, filters persist across reload, clear restores the defaults, and no console errors. No key required.
- **Gates.** `npm test`, `npm run test:web`, `npm run build:web`, `npm run build:client`, and the secret scanner.
- **Live check.** The deployed web app shows the filter bar, the South Africa only default, and the correct count copy. The hunter enforcement is desktop only and is covered by the offline evidence; the live check says so.

## Rollout

One branch, one PR, one deploy, one live check, matching the established workflow. The web build changes and deploys. The desktop package changes but is not published from this arc. No new provider names, no model IDs, no key handling changes.

The pipeline spec [`2026-10-27-post-m3a3-pipeline.md`](2026-10-27-post-m3a3-pipeline.md) is updated in the same PR to show the inserted Arc 6 and Arc 7, and to renumber real-browser auto-apply to Arc 8 and inbox and MCP to Arc 9.
