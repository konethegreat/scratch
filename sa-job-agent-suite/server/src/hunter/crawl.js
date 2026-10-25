// Bounded, saturation-aware pagination loop for the Hunter's declarative sources.
//
// Pure and dependency-free: the page fetcher, the sleeper and the clock are injected, so
// the loop never touches the network, a browser or a real timer by itself. It cannot hammer
// a site or loop forever: a hard page cap, a per-query time budget, and stops on empty,
// saturated (no new unique items), blocked and stop-requested pages.

/** Hard page cap per search depth. */
export const PAGE_CAPS = Object.freeze({ light: 1, standard: 2, deep: 4 });

/** A page (>= 2) whose share of never-seen items falls below this ratio ends the crawl. */
export const DEFAULT_MIN_NEW_RATIO = 0.25;

/** Wall-clock budget for one query (all its pages). */
export const DEFAULT_QUERY_TIME_BUDGET_MS = 60_000;

/** Page cap for a depth name; an unknown depth falls back to 'standard' (2). */
export function pageCapForDepth(depth) {
  return Object.prototype.hasOwnProperty.call(PAGE_CAPS, depth) ? PAGE_CAPS[depth] : PAGE_CAPS.standard;
}

/** De-duplication key: the lower-cased applyUrl, else `title::company` (lower-cased, trimmed). */
export function defaultKeyOf(item) {
  const url = String(item?.applyUrl ?? '').trim().toLowerCase();
  if (url) return url;
  const title = String(item?.title ?? '').trim().toLowerCase();
  const company = String(item?.company ?? '').trim().toLowerCase();
  return `${title}::${company}`;
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Walk pages 1..maxPages of one query.
 *
 * Page 1 is always fetched unless shouldStop() is already true. After each page the stop
 * conditions are checked in this fixed order (first match wins):
 *   blocked -> error (0 items) -> exhausted (0 items) -> saturated (page >= 2) ->
 *   page_cap -> time -> stopped
 * Items are de-duplicated across pages by keyOf (first occurrence kept, order preserved).
 * A saturated page's few new items are still kept. A blocked page's items are discarded:
 * a bot-wall/login page is not a real result list. A fetchPage that throws is treated as
 * { items: [], meta: { error: message } }. delayMs is awaited (via sleep) between pages only.
 *
 * maxPages is clamped to at least 1 (and a non-finite value counts as 1), so page 1 is
 * fetched and the loop can never exceed max(1, floor(maxPages)) pages.
 */
export async function crawlPages({
  fetchPage,
  maxPages,
  minNewRatio = DEFAULT_MIN_NEW_RATIO,
  timeBudgetMs = DEFAULT_QUERY_TIME_BUDGET_MS,
  shouldStop = () => false,
  keyOf = defaultKeyOf,
  delayMs = 0,
  sleep = defaultSleep,
  now = Date.now,
} = {}) {
  const cap = Number.isFinite(maxPages) ? Math.max(1, Math.floor(maxPages)) : 1;
  const items = [];
  const pages = [];
  const seen = new Set();
  const startedAt = now();

  if (shouldStop()) return { items, pages, stopReason: 'stopped' };

  for (let pageNo = 1; ; pageNo += 1) {
    if (pageNo > 1 && delayMs > 0) await sleep(delayMs);

    let result;
    try {
      result = await fetchPage(pageNo);
    } catch (err) {
      result = { items: [], meta: { error: String(err?.message || err) } };
    }
    const meta = result?.meta;
    const blocked = Boolean(meta?.blocked);
    const pageItems = blocked || !Array.isArray(result?.items) ? [] : result.items;

    let newCount = 0;
    for (const item of pageItems) {
      const key = keyOf(item);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
      newCount += 1;
    }

    const count = pageItems.length;
    const entry = { pageNo, count, newCount };
    if (meta) entry.meta = meta;
    pages.push(entry);

    let stopReason = null;
    if (blocked) stopReason = 'blocked';
    else if (meta?.error && count === 0) stopReason = 'error';
    else if (count === 0) stopReason = 'exhausted';
    else if (pageNo >= 2 && newCount / count < minNewRatio) stopReason = 'saturated';
    else if (pageNo >= cap) stopReason = 'page_cap';
    else if (now() - startedAt >= timeBudgetMs) stopReason = 'time';
    else if (shouldStop()) stopReason = 'stopped';

    if (stopReason) return { items, pages, stopReason };
  }
}
