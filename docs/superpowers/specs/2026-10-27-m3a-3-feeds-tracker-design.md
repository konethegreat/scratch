# M3a-3: Free job feeds, dedupe, and tracker

Status: design approved 2026-10-27. Implements M3a-3 of
`docs/superpowers/specs/2026-10-27-m3-hosted-web-alpha-design.md` (section 4.4 and
the milestone table).

## 1. Context

M3a-2 shipped the hosted shell, the IndexedDB vault, and the zero-knowledge key
lifecycle. The hosted app can hold a profile and a tracker, but it has no way to
discover a job: the Job Hunter tab still shows desktop crawler controls that
return `NOT_SUPPORTED_IN_WEB`.

M3a-3 closes that gap with three keyless public feeds that the browser calls
directly, a normalise/dedupe/filter pipeline, add-to-tracker, usable application
statuses and notes, and a web backup tab.

Decisions taken with the user:

- Scope is the hosted web app. No server or desktop feed code.
- Feeds get their own **Job Feeds** tab; the tracker stays where it is.
- Filters are pre-filled from the profile and editable per session.

## 2. Goals

1. A signed-out-of-everything stranger can open the app, fetch public jobs from
   three sources, and add relevant ones to the tracker without a key.
2. The same job seen in two feeds, or already in the tracker, appears once.
3. Every feed failure is isolated and explained: which feed, why, and what to do.
4. The tracker can record the whole application lifecycle and free-text notes.
5. A user can move their data out of and back into the browser as one JSON file.
6. Nothing about the user leaves the browser while fetching feeds.

## 3. Non-goals

- Server-side feeds, proxies, or scheduled refresh.
- Feed pagination beyond the first page each API returns.
- Persisting fetched feed data across reloads.
- AI hunt (M3a-5), tailoring (M3a-4), or any Anthropic call.
- Changing desktop crawler behaviour.
- Light mode and the landing page redesign (separate increment).

## 4. Architecture

```
Job Feeds tab (web only)
  feeds.js  (client/src/web/feeds.js)
    ├─ per-source fetch: AbortController 20 s, one retry, in-memory 15 min cache
    ├─ normalize(raw)  ->  RawJob[]     (packages/core/src/feeds/*.js, pure)
    ├─ merge across sources by fingerprint
    ├─ filter and score with profile keywords/locations
    └─ "Add to tracker" -> POST /jobs -> IndexedDB vault
```

- Normalizers are pure functions in `packages/core/src/feeds/`. They take a parsed
  JSON value and return a `RawJob[]`. They import nothing from `client/`.
- `client/src/web/feeds.js` owns network, retry, timeout, cache, merge, dedupe,
  filter, and score. It accepts an injected `fetch` so tests run offline.
- The UI calls `feeds.js` directly. It does not add feed routes to the web API
  port: the feeds are not part of the `/api/*` contract.
- `addJob` remains the single write path into the tracker.

### 4.1 File map

| File | Responsibility |
|---|---|
| `packages/core/src/feeds/shape.js` | `RawJob` bounds, URL validation, text cleanup |
| `packages/core/src/feeds/remotive.js` | Remotive normalizer |
| `packages/core/src/feeds/arbeitnow.js` | Arbeitnow normalizer |
| `packages/core/src/feeds/jobicy.js` | Jobicy normalizer |
| `packages/core/src/feeds/index.js` | `SOURCES` registry, `normalizeSource` |
| `packages/core/src/feeds/match.js` | `fingerprint`, `dedupeJobs`, `filterJobs`, `scoreJob` |
| `client/src/web/feeds.js` | fetch, retry, cache, orchestration, `clearFeedCache` |
| `client/src/JobFeeds.jsx` | The Job Feeds view |
| `client/src/web/api.js` | `updateJob` status/notes validation |
| `client/src/App.jsx` | Tab wiring, tracker status/notes UI, web gating |
| `client/src/SettingsBackup.jsx` | Web-only export/import tab |
| `scripts/web-canary.mjs` | Offline E2E with mocked feeds |

## 5. Data model

### 5.1 RawJob

```js
{
  source: 'remotive' | 'arbeitnow' | 'jobicy',
  sourceId: string,          // source-native id or slug
  title: string,             // required, max 300
  company: string,           // required, max 200
  location: string,          // max 200, may be ''
  description: string,       // plain text, max 20 000
  applyUrl: string,          // absolute http(s) or ''
  datePosted: string,        // YYYY-MM-DD or ''
  remote: boolean,
  tags: string[],            // max 10, each max 40
  salaryText: string         // max 120
}
```

A row without a non-empty `title` or `company` is dropped. Fields of the wrong
type fall back to their empty value. `description` has HTML tags stripped and
entities decoded before bounding; it is never rendered as HTML.

### 5.2 Tracker job

The existing job shape gains one field:

```js
notes: ''   // string, max 20 000
```

Feed jobs are saved with `source` set to the feed label (`Remotive`,
`Arbeitnow`, `Jobicy`), `applyUrl`, `description`, `datePosted`, and `matchScore`
from the filter. `status` starts as `found`.

Allowed statuses: `found`, `tailored`, `applied`, `interviewing`, `offer`,
`rejected`. The desktop `tailoring` value stays valid because the desktop
tailor flow still writes it.

## 6. Adapters

Endpoint and field mapping. All endpoints are keyless and send
`Access-Control-Allow-Origin: *`.

| Source | Endpoint | Root | Row fields |
|---|---|---|---|
| Remotive | `https://remotive.com/api/remote-jobs` | `jobs[]` | `id`, `title`, `company_name`, `candidate_required_location`, `description`, `url`, `publication_date`, `salary`, `tags` |
| Arbeitnow | `https://www.arbeitnow.com/api/job-board-api` | `data[]` | `slug`, `title`, `company_name`, `location`, `description`, `url`, `created_at`, `remote`, `tags` |
| Jobicy | `https://jobicy.com/api/v2/remote-jobs` | `jobs[]` | `id`, `jobTitle`, `companyName`, `jobGeo`, `jobDescription`, `url`, `pubDate`, `annualSalaryMin`, `annualSalaryMax`, `salaryCurrency`, `jobIndustry` |

Rules:

- A missing or non-array root throws `FeedShapeError`, which the client maps to
  `FEED_FAILED` with `retryable: false`. An empty array is a valid, empty result.
- A non-array `tags` becomes `[]`.
- Jobicy salary becomes `"R 300 000 - R 450 000"` style text only when both
  bounds or one bound plus a currency are present. Remotive passes its salary
  string through. Arbeitnow has no salary field.
- `remote` is true for Arbeitnow's flag, for Jobicy when the location or title
  says remote/worldwide/anywhere, and for Remotive when the candidate location
  says remote/worldwide/anywhere.
- Dates are normalised to `YYYY-MM-DD`; an unparseable date becomes `''`.
- Each adapter keeps at most 300 rows after dropping invalid ones, in feed order.

## 7. Feed client

```js
createFeedClient({ fetchImpl, now, cacheTtlMs = 15 * 60 * 1000 })
  .load(sourceId, { force = false }) -> { source, jobs, fetchedAt, cached }
  .loadAll({ force = false })        -> { results, errors }
  .clear()
```

- URL per source comes from the registry, not from user input.
- Timeout: `AbortController` after 20 000 ms. The timer is cleared in `finally`.
- Retry: one retry on network error, 5xx, 429, or timeout. No retry on 4xx other
  than 429, and no retry on a malformed payload.
- Backoff: 750 ms before the retry. Tests inject a fake clock, so no real delay.
- Cache: module-level `Map` keyed by source, storing `{ at, jobs }`. A fresh
  entry is returned without a request unless `force` is set. `clear()` empties it.
- `loadAll` runs the three sources concurrently and returns per-source results and
  errors. It never throws for a single source failure.
- No request carries profile data or credentials. The browser sends its own
  origin and nothing else.

Error mapping:

| Condition | Code | Message | Retryable |
|---|---|---|---|
| HTTP 5xx or 429 after retry | `FEED_FAILED` | `<Source> did not respond.` | true |
| Network error or timeout | `FEED_FAILED` | `<Source> did not respond in time.` | true |
| Fetch `TypeError` with no HTTP response | `CORS_BLOCKED` | `This browser blocked the request to <Source>.` | true |
| Non-2xx 4xx | `FEED_FAILED` | `<Source> rejected the request (HTTP <n>).` | false |
| Root shape wrong | `FEED_FAILED` | `<Source> sent data this app does not understand.` | false |

Every message gets a hint: "Retry this feed; the other feeds still work." for
retryable failures, or "Try another feed; this one may have changed its API."
otherwise.

## 8. Dedupe and matching

### 8.1 Fingerprint

```js
fingerprint(title, company) =>
  normalise(title) + '|' + normalise(company)

normalise(value):
  lowercase
  strip diacritics
  replace anything that is not a letter, digit, or space with a space
  collapse whitespace and trim
  drop a trailing legal suffix: pty ltd, pty, ltd, inc, llc, cc, co, corp
```

### 8.2 Dedupe

- Within the fetched set, rows with the same fingerprint merge into one. The
  merged row keeps the longest description, the first non-empty apply URL, the
  earliest date, and collects unique source labels in `sources`.
- Against the tracker, the client builds a `Set` of tracker fingerprints on each
  refresh. A fetched row whose fingerprint is in the set renders as
  `In tracker` with the add button disabled.
- `POST /jobs` keeps its existing conflict check. The UI treats HTTP 409 from
  that call as "already in tracker" and refreshes the row state instead of
  showing an error toast.

### 8.3 Filters

Inputs are comma-separated strings. Empty input means no constraint.

- Keyword match: any keyword phrase appears, case-insensitively, in the title or
  description. Phrases with multiple words must appear as a phrase, allowing any
  whitespace between words.
- Location match: any location phrase appears in the job location or description,
  or the job is remote and a location phrase is `remote`, `anywhere`, or
  `worldwide`.
- `onlyMatches` is on by default. Turning it off shows every fetched row, still
  deduped and scored.
- Filters never mutate the profile. A `Save as defaults` action writes the two
  strings back to the profile through `POST /profile`.

### 8.4 Score

```js
score = min(75, titleHits * 25) + min(25, descriptionHits * 10)
if no keywords: score = 50
```

Sort order: score descending, then `datePosted` descending, then title.

## 9. Job Feeds UI

New web-only tab `feeds` in the sidebar, placed after Job Hunter.

- Header: "Free job feeds", subtitle explains that the feeds are public, keyless,
  and fetched by the browser, and that no profile data is sent.
- Filter bar: keywords, locations, `Only show matches`, `Refresh all`,
  `Save as defaults`, `Add all matches`.
- Source cards, one per feed: label, state, result count, `fetched hh:mm`, and
  the attribution link. On failure the card shows the message, hint, and
  `Retry this feed`.
- Results table: checkbox, title and company, location plus a Remote badge,
  source badges, posted date, match score, `Open`, and `Add to tracker` or
  `In tracker`.
- `Add all matches` adds the currently visible, matched, not-yet-tracked rows,
  sequentially, and reports `n added, m already there, k failed`.
- Empty states: no matches (suggest loosening filters) and all feeds failed
  (list each error with its retry button).
- Loading state: a per-card skeleton, never a full-page blocker.
- Feed text is rendered as text. URLs are validated before rendering a link.

## 10. Tracker upgrades

These ship in the shared UI and work on both data ports.

- Status is an inline `<select>` on each tracker row, saved with
  `PATCH /jobs/:id`. `StatusBadge` gains the three new statuses.
- Notes: a row action opens an inline editor with a textarea and Save/Cancel.
  A small indicator shows when a job has notes. Saved with `PATCH /jobs/:id`.
- The web port's `updateJob` validates:
  - `status` is in the allowed list, otherwise `VALIDATION` with a hint listing
    the allowed values;
  - `notes` is a string of at most 20 000 characters;
  - only `status`, `notes`, `applyUrl`, and `description` are accepted from the
    client. Everything else is ignored.
- Web mode hides the crawler-only controls in the Job Hunter tab:
  `Launch crawler`, `Tailor all found`, and `Re-check links`. `Add manually` and
  `Clear all` stay. `Tailor` stays until M3a-4 replaces it.
- The tracker filter select gains Interviewing, Offer, and Rejected.

## 11. Export and import

New settings tab `backup`, web only. Desktop keeps its server-backed `data` tab.

- Export: `vault.exportAll()` serialised with two-space indentation, downloaded as
  `sajas-backup-YYYY-MM-DD.json` through a temporary object URL that is revoked
  afterwards. The payload contains no key material.
- Import: file picker, then `JSON.parse`, then a summary showing the export date
  and record counts per store, then a confirmation that names the destructive
  effect. On confirm, `vault.importAll` runs; it validates every store before it
  clears anything.
- After a successful import, profile, jobs, and logs reload from the vault.
- Errors: invalid JSON, wrong app or schema version, missing store, and
  `STORAGE_FULL` are shown with code, message, and hint. Nothing is cleared on
  any validation failure.
- Panic wipe also calls `clearFeedCache()`.

## 12. Isolation, scale, and privacy

- There is no server and no account. Every record lives in the user's own
  IndexedDB for the `sajas.pages.dev` origin. A second user on a different
  browser profile cannot read the first user's data, and the operator cannot
  read either.
- Exported files are the only way data moves between devices. The import path is
  explicit and destructive-by-confirmation.
- Feed requests are public GETs to third-party origins. They carry no key, no
  profile, and no identifiers. Keywords never leave the browser.
- Per-session load is bounded: one fetch per source per 15 minutes unless the
  user forces a refresh, at most 300 rows per source, and no background polling.
  These limits are politeness and cost controls, not security controls.
- Static hosting means traffic is absorbed by Cloudflare's edge. The app has no
  origin to exhaust, and each user's Anthropic spend is paid with their own key
  and bounded by the local budget guard.

## 13. Testing

Offline only. No test calls a feed or Anthropic.

- `packages/core/src/feeds/*.test.js`:
  - each normalizer against a trimmed fixture (3 rows) plus missing fields,
    wrong types, empty arrays, invalid dates, and bad URLs;
  - root shape errors;
  - cap of 300 rows.
- `packages/core/src/feeds/match.test.js`: fingerprint normalisation and legal
  suffixes, cross-source merge, keyword and location matching, remote rules,
  scoring, and deterministic ordering.
- `client/src/web/feeds.test.js` with an injected fetch and fake clock: success,
  5xx then success on retry, 5xx twice, timeout, CORS `TypeError`, malformed
  payload, cache hit, forced refresh, `clear`, concurrent `loadAll` isolation.
- `client/src/web/api.test.js`: add a feed job, duplicate returns `CONFLICT`,
  status allowlist, notes persistence and bound, rejected patch.
- `client/src/web/vault.test.js`: export excludes `keyVault`; import validates
  before clearing.
- `scripts/web-canary.mjs` extension, offline:
  - route the three feed origins to fixtures, block anything else outside the
    allowed origins;
  - open Job Feeds, see three cards and results;
  - add one job, then see `In tracker` and a 409 path handled quietly;
  - change status and add notes, reload, confirm both persist;
  - export downloads a file that parses and contains the job;
  - panic wipe empties the vault and the feed cache;
  - import restores the job;
  - no key appears anywhere new.
- Gates: `npm test`, `npm run test:web`, `npm run build:client`,
  `npm run build:web`, `npm run test:demo`, `node tools/check-secrets.mjs --all`.
- Manual acceptance, once, outside CI: load the live build, fetch the real feeds,
  and add a real job.

## 14. Risks

| Risk | Mitigation |
|---|---|
| A feed changes its schema | Tolerant field mapping; malformed root is an explicit error card; fixture tests catch changes when fixtures are refreshed |
| A feed closes CORS | Per-source `CORS_BLOCKED` card; the other feeds keep working; CSP already allows only these origins |
| Duplicate noise | Fingerprint dedupe across feeds and against the tracker |
| Large payloads | 300-row cap per source and bounded descriptions |
| User expects feed results after reload | Copy states the results are a live fetch, not saved; only added jobs persist |
| Import destroys newer local data | Summary plus explicit confirmation, and validation before any clear |
| New statuses break dashboards | `StatusBadge` fallback stays; existing KPI counts only read `found`, `tailored`, `applied` |

## 15. Exit criteria

- Offline fixture and client tests pass; E2E canary passes on the built bundle.
- In a real browser, the three feeds load, filtering and dedupe behave, and a
  fetched job can be added, annotated, moved through statuses, exported, wiped,
  and restored.
- Desktop suites stay green.
