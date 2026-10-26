import { addLog } from '../db/helper.js';
import { detectBlock } from './blockDetect.js';

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
 *   ms: number, blocked: boolean, blockKind: string|null, blockHint: string|null, error: string|null } }>}
 */
export async function fetchSourcePage(page, source, query, pageNo = 1, opts = {}) {
  const started = Date.now();
  const meta = { url: '', title: '', httpStatus: null, ms: 0, blocked: false, blockKind: null, blockHint: null, error: null };
  let items = [];
  const name = source?.name ?? 'source';

  try {
    const timeoutMs = Number.isFinite(opts?.timeoutMs) && opts.timeoutMs > 0 ? opts.timeoutMs : 20000;
    const location = query?.location ?? null;
    const where = location ? ` in "${location}"` : '';
    const pageTag = pageNo > 1 ? ` (page ${pageNo})` : '';
    const kw = query?.keyword;

    meta.url = source.buildUrl(query, pageNo);
    addLog(`[${name}] Searching: "${kw}"${where}${pageTag}`, 'agent1');

    const response = await page.goto(meta.url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    meta.httpStatus = response ? response.status() : null;

    if (source.waitIdleMs > 0) {
      await page.waitForLoadState('networkidle', { timeout: source.waitIdleMs }).catch(() => {});
    }

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
      const raw = await page.evaluate(source.extractInPage, { keyword: kw, location, origin: source.origin });
      items = Array.isArray(raw) ? raw : [];
      if (soft) {
        if (items.length >= 1) {
          meta.blockHint = 'text signal ignored: items were found';
        } else {
          markBlocked();
        }
      }
      addLog(`[${name}] Found ${items.length} raw cards for "${kw}"${where}${pageTag}`, 'agent1');
    }
  } catch (err) {
    meta.error = err?.message || String(err);
    items = [];
    try { addLog(`[${name}] Error: ${meta.error}`, 'error'); } catch { /* logging must not throw */ }
  }

  meta.ms = Date.now() - started;
  return { items, meta };
}
