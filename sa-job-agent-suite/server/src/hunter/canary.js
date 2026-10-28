// Canary checks: visit ONE page of each source with a known query and decide
// whether the scraper still works. A canary is what makes "silently returns
// nothing" visible before a real hunt wastes a slot on a dead source.
import { chromium } from 'playwright';
import { addLog, BROWSER_PROFILE_PATH } from '../db/helper.js';
import { SOURCES } from './registry.js';
import { fetchSourcePage } from './runner.js';
import { getHealthEntry, recordCanary } from './healthStore.js';

export const CANARY_INTERVAL_MS = 2000;

const DEFAULT_KEYWORD = 'developer';
const DEFAULT_MIN_ITEMS = 1;
const COMPLETENESS_RATIO = 0.8;

// Same launch options the hunter uses for the persistent profile.
const LAUNCH_OPTS = Object.freeze({
  headless: true,
  args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-setuid-sandbox'],
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  viewport: { width: 1366, height: 768 },
  locale: 'en-ZA',
  timezoneId: 'Africa/Johannesburg'
});

const filled = (v) => typeof v === 'string' && v.trim().length > 0;
const defaultSleep = (ms) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());
const errorResult = (err) => {
  const message = err?.message || String(err);
  return { at: new Date().toISOString(), pass: false, reasons: [`error: ${message}`], raw: 0, ms: 0, blocked: false, error: message };
};

/**
 * Runs ONE canary against an open page. Never throws: every failure is reported
 * in `reasons`, and `pass` is true only when there are none.
 *
 * Reason precedence (ruling T8-a): a block short-circuits everything, then an
 * error, then the item count and the completeness ratio. Completeness now comes
 * from the extraction pipeline: rows that fail the schema gate are counted as
 * incomplete, so a linkless source is still judged on titles only.
 *
 * @returns {Promise<{ at: string, pass: boolean, reasons: string[], raw: number, ms: number,
 *   blocked: boolean, error: string|null }>}
 */
export async function runCanary(page, source) {
  const spec = source?.canary || {};
  const keyword = filled(spec.keyword) ? spec.keyword : DEFAULT_KEYWORD;
  const location = spec.location ?? null;
  const n = Number(spec.minItems);
  const minItems = Number.isFinite(n) && n >= 1 ? Math.floor(n) : DEFAULT_MIN_ITEMS;
  const started = Date.now();

  const { meta } = await fetchSourcePage(page, source, { keyword, location }, 1);
  const valid = Number.isFinite(meta.valid) ? meta.valid : 0;
  const rejected = Number.isFinite(meta.rejected) ? meta.rejected : 0;
  const raw = valid + rejected;
  const reasons = [];

  if (meta.blocked) {
    reasons.push(`blocked: ${meta.blockKind || 'unknown'}`);
  } else if (meta.error) {
    reasons.push(`error: ${meta.error}`);
  } else {
    if (raw < minItems) reasons.push(`returned ${raw} items, expected at least ${minItems}`);
    if (raw > 0) {
      const ratio = valid / raw;
      if (ratio < COMPLETENESS_RATIO) reasons.push(`only ${Math.round(ratio * 100)}% of items have title and link`);
    }
  }

  return {
    at: new Date().toISOString(),
    pass: reasons.length === 0,
    reasons,
    raw,
    ms: Number.isFinite(meta.ms) ? meta.ms : Date.now() - started,
    blocked: !!meta.blocked,
    error: meta.error || null
  };
}

/** Records one result; a store failure must never abort the remaining sources. */
function record(id, result) {
  try {
    recordCanary(id, result);
  } catch (err) {
    addLog(`[Canary] Could not record ${id}: ${err.message}`, 'error');
  }
}

/** The ids to test: the requested subset minus sources the user turned off. */
function enabledSources(ids, sources = SOURCES) {
  const list = Array.isArray(sources) ? sources.filter((source) => source && source.id) : [];
  const wanted = Array.isArray(ids) && ids.length ? new Set(ids) : null;
  return (wanted ? list.filter((source) => wanted.has(source.id)) : list)
    .filter((source) => {
      try {
        return getHealthEntry(source.id).enabled !== false;
      } catch {
        return true; // a health read failure must not silently disable a canary
      }
    });
}

/**
 * Tests the requested sources sequentially, 2 s apart. A disabled source is
 * skipped without a result, a record or an onResult call. The caller owns the
 * browser context: runCanaries closes every page it is given back.
 *
 * `sources` is the test seam (production omits it and the registry is used);
 * ids select from that list, and unknown ids are ignored because the route
 * validates them first.
 *
 * @returns {Promise<Record<string, object>>} results keyed by source id
 */
export async function runCanaries({ ids, newPage, sleep = defaultSleep, onResult, sources = SOURCES } = {}) {
  if (typeof newPage !== 'function') throw new TypeError('runCanaries needs a newPage function');
  const selected = enabledSources(ids, sources);

  const results = {};
  for (let i = 0; i < selected.length; i++) {
    if (i > 0) await sleep(CANARY_INTERVAL_MS);
    const source = selected[i];
    let page = null;
    let result;
    try {
      page = await newPage();
      result = await runCanary(page, source);
    } catch (err) {
      result = errorResult(err);
    } finally {
      if (page && typeof page.close === 'function') await page.close().catch(() => {});
    }
    results[source.id] = result;
    record(source.id, result);
    try {
      if (typeof onResult === 'function') onResult(source.id, result);
    } catch { /* a listener must not abort the run */ }
  }
  return results;
}

/**
 * Launches the persistent browser profile headless (Chrome, then the bundled
 * Chromium: the same options as the hunter), runs the canaries and closes the
 * context. It does NOT take the browser lock — the route owns 'canary'.
 */
export async function runCanarySession({ ids, onResult } = {}) {
  const selected = enabledSources(ids);
  if (!selected.length) {
    addLog('Canary check: no enabled sources to test.', 'system');
    return {};
  }
  let context = null;
  try {
    try {
      context = await chromium.launchPersistentContext(BROWSER_PROFILE_PATH, { ...LAUNCH_OPTS, channel: 'chrome' });
    } catch {
      context = await chromium.launchPersistentContext(BROWSER_PROFILE_PATH, LAUNCH_OPTS);
    }
    const results = await runCanaries({ ids: selected.map((source) => source.id), newPage: () => context.newPage(), onResult });
    const list = Object.values(results);
    const passed = list.filter((result) => result.pass).length;
    addLog(`Canary check finished: ${passed}/${list.length} source(s) passed.`, 'agent1');
    return results;
  } finally {
    if (context) await context.close().catch(() => {});
  }
}

/**
 * Pure refusal check for POST /api/hunter/sources/test (ruling T8-e), so the
 * 409 paths are unit-testable without a browser. A running test wins over a
 * foreign browser owner.
 *
 * @returns {{ status: number, error: string } | null} null when a test may start
 */
export function canaryStartRefusal({ testing = false, browserBusy = null } = {}) {
  if (testing) return { status: 409, error: 'A source test is already running.' };
  if (browserBusy) return { status: 409, error: `A browser job is already running (${browserBusy}).` };
  return null;
}
