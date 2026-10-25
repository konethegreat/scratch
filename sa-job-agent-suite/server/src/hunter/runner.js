import { addLog } from '../db/helper.js';
import { detectBlock } from './blockDetect.js';

/**
 * Fetches ONE results page of a HunterSource and extracts its raw cards.
 * Does what each original scraper did for a single page: goto, wait for the
 * network to settle, read the title, extract in-page. Adds block detection.
 *
 * Never throws: every failure is returned in `meta.error`. A blocked page
 * (challenge / denied / rate-limit / login wall) skips extraction entirely.
 * Must not import agent1-hunter.js (the hunter imports this, not the reverse).
 *
 * @returns {Promise<{ items: object[], meta: { url: string, title: string, httpStatus: number|null,
 *   ms: number, blocked: boolean, blockKind: string|null, error: string|null } }>}
 */
export async function fetchSourcePage(page, source, query, pageNo = 1, opts = {}) {
  const started = Date.now();
  const timeoutMs = Number.isFinite(opts?.timeoutMs) && opts.timeoutMs > 0 ? opts.timeoutMs : 20000;
  const name = source.name;
  const location = query?.location ?? null;
  const where = location ? ` in "${location}"` : '';
  const pageTag = pageNo > 1 ? ` (page ${pageNo})` : '';

  const meta = { url: '', title: '', httpStatus: null, ms: 0, blocked: false, blockKind: null, error: null };
  let items = [];

  try {
    meta.url = source.buildUrl(query, pageNo);
    addLog(`[${name}] Searching: "${query?.keyword}"${where}${pageTag}`, 'agent1');

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

    const block = detectBlock({ status: meta.httpStatus, title: meta.title, text, url: page.url() });
    meta.blocked = block.blocked;
    meta.blockKind = block.kind;

    if (block.blocked) {
      addLog(`[${name}] Blocked (${block.kind}) on "${query?.keyword}"${where}${pageTag}: "${meta.title}"`, 'error');
    } else {
      const raw = await page.evaluate(source.extractInPage, { location, origin: source.origin });
      items = Array.isArray(raw) ? raw : [];
      addLog(`[${name}] Found ${items.length} raw cards for "${query?.keyword}"${where}${pageTag}`, 'agent1');
    }
  } catch (err) {
    meta.error = err?.message || String(err);
    items = [];
    addLog(`[${name}] Error: ${meta.error}`, 'error');
  }

  meta.ms = Date.now() - started;
  return { items, meta };
}
