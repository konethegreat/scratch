import { addLog } from '../db/helper.js';
import { detectBlock } from './blockDetect.js';
import { collectPageData, createCollector, installCapture } from './capture.js';
import { extractPage } from './extract.js';
import { retryPlan } from './pacing.js';

/**
 * Fetches ONE results page of a HunterSource and extracts its raw cards.
 * Does what each original scraper did for a single page: goto, wait for the
 * network to settle, read the title, extract in-page. Adds block detection.
 *
 * Never throws: every failure is returned in `meta.error`.
 *  - A STRONG block (HTTP 429, short 401/403, challenge title, login wall) skips
 *    extraction entirely.
 *  - A SOFT block (interstitial wording in the body text only) still runs
 *    extraction: if any item is found the page was a false alarm
 *    (`meta.blockHint` says so), otherwise the block stands.
 *  - Any other HTTP status >= 400 skips extraction and sets `meta.error`.
 * Must not import agent1-hunter.js (the hunter imports this, not the reverse).
 *
 * @returns {Promise<{ items: object[], meta: { url: string, title: string, httpStatus: number|null,
 *   ms: number, blocked: boolean, blockKind: string|null, blockHint: string|null, error: string|null,
 *   strategy: string|null, valid: number, rejected: number, rejectReasons: string[],
 *   strategies: object|null } }>}
 */
export async function fetchSourcePage(page, source, query, pageNo = 1, opts = {}) {
  const started = Date.now();
  const meta = {
    url: '', title: '', httpStatus: null, ms: 0, blocked: false, blockKind: null, blockHint: null,
    error: null, strategy: null, valid: 0, rejected: 0, rejectReasons: [], strategies: null
  };
  let items = [];
  let detachCapture = () => {};
  const name = source?.name ?? 'source';

  try {
    const timeoutMs = Number.isFinite(opts?.timeoutMs) && opts.timeoutMs > 0 ? opts.timeoutMs : 20000;
    const pause = typeof opts.sleep === 'function' ? opts.sleep : (ms) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());
    const retryCount = Number.isFinite(opts.retryCount) ? Math.max(0, opts.retryCount) : 2;
    const location = query?.location ?? null;
    const where = location ? ` in "${location}"` : '';
    const pageTag = pageNo > 1 ? ` (page ${pageNo})` : '';
    const kw = query?.keyword;

    meta.url = source.buildUrl(query, pageNo);
    addLog(`[${name}] Searching: "${kw}"${where}${pageTag}`, 'agent1');

    const collector = opts.collector ?? createCollector({ origin: source.origin });
    detachCapture = installCapture(page, collector);

    // A retry gets a clean slate: JSON captured from a failed attempt must not
    // be read as if it described the page that finally loaded.
    const clearCapture = () => {
      try {
        if (Array.isArray(collector.payloads)) collector.payloads.length = 0;
        const state = collector.state;
        if (state) Object.assign(state, { malformed: 0, skipped: 0, totalBytes: 0, stopped: false });
      } catch { /* a custom collector without this shape is left alone */ }
    };

    if (opts.pacer && typeof opts.pacer.wait === 'function') {
      await opts.pacer.wait(new URL(meta.url).host);
    }

    let response = null;
    for (let attempt = 0; ; attempt += 1) {
      try {
        response = await page.goto(meta.url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
        const headers = (() => {
          try { return response?.headers?.() || {}; } catch { return {}; }
        })();
        const plan = retryPlan({
          status: response ? response.status() : null,
          attempt,
          retryAfter: headers['retry-after'] ?? headers['Retry-After'] ?? null,
          maxRetries: retryCount
        });
        if (!plan.retry) break;
        addLog(`[${name}] Retrying after HTTP ${response.status()} in ${plan.delayMs}ms${pageTag}`, 'agent1');
        await pause(plan.delayMs);
        clearCapture();
      } catch (err) {
        const plan = retryPlan({ error: err, attempt, maxRetries: retryCount });
        if (!plan.retry) throw err;
        addLog(`[${name}] Retrying after a network error in ${plan.delayMs}ms${pageTag}`, 'agent1');
        await pause(plan.delayMs);
        clearCapture();
      }
    }
    meta.httpStatus = response ? response.status() : null;

    if (source.waitIdleMs > 0) {
      await page.waitForLoadState('networkidle', { timeout: source.waitIdleMs }).catch(() => {});
    }

    const captured = await collectPageData({ page, collector, origin: source.origin });

    meta.title = await page.title();
    addLog(`[${name}] Page loaded: "${meta.title}"${pageTag}`, 'agent1');

    const text = await page
      .evaluate(() => (document.body ? document.body.innerText : '').slice(0, 2000))
      .catch(() => '');

    const block = detectBlock({ status: meta.httpStatus, title: meta.title, text, url: page.url() }) ?? {};
    const status = meta.httpStatus;
    const failedStatus = typeof status === 'number' && status >= 400;
    const soft = block.blocked && block.signal === 'text';

    const markBlocked = () => {
      meta.blocked = true;
      meta.blockKind = block.kind;
      addLog(`[${name}] Blocked (${block.kind}) on "${kw}"${where}${pageTag}: "${meta.title}"`, 'error');
    };

    if (block.blocked && (!soft || failedStatus)) {
      // Strong signal, or a soft text hit on an error response: no extraction.
      markBlocked();
    } else if (failedStatus) {
      meta.error = `HTTP ${status}`;
      addLog(`[${name}] Error: ${meta.error}${pageTag}`, 'error');
    } else {
      const result = await extractPage({
        page,
        source,
        query,
        captured,
        aiExtract: typeof opts.aiExtract === 'function' ? opts.aiExtract : null,
        maxCards: Number.isFinite(opts.maxCards) && opts.maxCards > 0 ? opts.maxCards : 80
      });
      items = result.items;
      meta.strategy = result.strategy;
      meta.valid = result.valid;
      meta.rejected = result.rejected;
      meta.rejectReasons = result.rejectReasons;
      meta.strategies = result.strategies;
      if (soft) {
        if (items.length >= 1) {
          meta.blockHint = 'text signal ignored: items were found';
        } else {
          markBlocked();
        }
      }
      addLog(`[${name}] Found ${items.length} valid card(s) via ${result.strategy} for "${kw}"${where}${pageTag}`, 'agent1');
    }
  } catch (err) {
    meta.error = err?.message || String(err);
    items = [];
    try { addLog(`[${name}] Error: ${meta.error}`, 'error'); } catch { /* logging must not throw */ }
  } finally {
    detachCapture();
  }

  meta.ms = Date.now() - started;
  return { items, meta };
}
