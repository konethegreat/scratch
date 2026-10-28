// Manual single-source replay. No AI, no key, not part of npm test or CI.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { openProfileContext } from '../server/src/hunter/browser.js';
import { getSource } from '../server/src/hunter/registry.js';
import { createCollector, installCapture, collectPageData } from '../server/src/hunter/capture.js';
import { detectBlock } from '../server/src/hunter/blockDetect.js';
import { extractPage } from '../server/src/hunter/extract.js';
import { parseDebugArgs, formatDebugReport, DEBUG_USAGE } from '../server/src/hunter/debugReport.js';

const MAX_CARDS = 80;

async function pageText(page) {
  try {
    return await page.evaluate(() => (document.body ? document.body.innerText : '').slice(0, 2000));
  } catch {
    return '';
  }
}

async function runLive(args, source) {
  const query = { keyword: args.keyword, location: args.location };
  const context = await openProfileContext({ headless: !args.headful });
  const page = await context.newPage();
  const collector = createCollector({ origin: source.origin });
  const detach = installCapture(page, collector);
  try {
    const url = source.buildUrl(query, 1);
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (source.waitIdleMs > 0) {
      await page.waitForLoadState('networkidle', { timeout: source.waitIdleMs }).catch(() => {});
    }
    const captured = await collectPageData({ page, collector, origin: source.origin });
    detach();
    const title = await page.title();
    const block = detectBlock({ status: response?.status(), title, text: await pageText(page), url: page.url() }) || {};
    const html = args.save ? await page.content() : '';
    let result = { items: [], strategy: 'none', valid: 0, rejected: 0, rejectReasons: [], strategies: {} };
    if (!block.blocked) {
      result = await extractPage({ page, source, query, captured, maxCards: MAX_CARDS });
    }
    return {
      url: page.url(),
      title,
      httpStatus: response?.status() ?? null,
      blocked: !!block.blocked,
      blockKind: block.kind || null,
      error: null,
      captured,
      html,
      result,
      malformed: captured.malformed,
      skipped: captured.skipped
    };
  } finally {
    detach();
    await context.close().catch(() => {});
  }
}

async function runReplay(args, source) {
  const html = await fs.readFile(args.html, 'utf8');
  const browser = await chromium.launch({ headless: true, channel: 'chrome' }).catch(() => chromium.launch({ headless: true }));
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    // The saved HTML carries its own JSON-LD and embedded state; the capture
    // file adds the network responses that only existed at fetch time.
    const fromPage = await collectPageData({
      page,
      collector: createCollector({ origin: source.origin }),
      origin: source.origin
    });
    const captured = { ...fromPage, payloads: [...fromPage.payloads] };
    if (args.capture) {
      const saved = JSON.parse(await fs.readFile(args.capture, 'utf8'));
      captured.payloads = [...(saved.payloads || []), ...captured.payloads];
      captured.malformed += saved.malformed || 0;
      captured.skipped += saved.skipped || 0;
    }
    const block = detectBlock({ status: 200, title: await page.title(), text: await pageText(page), url: source.origin }) || {};
    const result = block.blocked
      ? { items: [], strategy: 'none', valid: 0, rejected: 0, rejectReasons: [], strategies: {} }
      : await extractPage({ page, source, query: { keyword: args.keyword, location: args.location }, captured, maxCards: MAX_CARDS });
    return {
      url: args.html,
      title: await page.title(),
      httpStatus: 200,
      blocked: !!block.blocked,
      blockKind: block.kind || null,
      error: null,
      captured,
      html,
      result,
      malformed: captured.malformed || 0,
      skipped: captured.skipped || 0
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function save(run) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join('hunter-debug', `${run.sourceId}-${stamp}`);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'page.html'), run.html || '', 'utf8');
  await fs.writeFile(path.join(dir, 'capture.json'), JSON.stringify(run.captured, null, 2), 'utf8');
  await fs.writeFile(path.join(dir, 'report.json'), JSON.stringify({
    url: run.url, title: run.title, httpStatus: run.httpStatus, blocked: run.blocked,
    blockKind: run.blockKind, strategy: run.result.strategy, strategies: run.result.strategies,
    valid: run.result.valid, rejected: run.result.rejected, rejectReasons: run.result.rejectReasons,
    malformed: run.malformed, skipped: run.skipped
  }, null, 2), 'utf8');
  return dir;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseDebugArgs(argv);
  if (args.help) { console.log(DEBUG_USAGE); return 0; }
  if (args.error) { console.error(args.error); console.error(DEBUG_USAGE); return 1; }
  const source = getSource(args.source);
  if (!source) { console.error(`Unknown source: ${args.source}`); return 1; }
  try {
    const run = args.html ? await runReplay(args, source) : await runLive(args, source);
    const firstItem = run.result.items[0] || null;
    console.log(formatDebugReport({
      source,
      url: run.url,
      title: run.title,
      httpStatus: run.httpStatus,
      blocked: run.blocked,
      blockKind: run.blockKind,
      error: run.error,
      strategy: run.result.strategy,
      strategies: run.result.strategies,
      rejectReasons: run.result.rejectReasons,
      firstItem,
      malformed: run.malformed,
      skipped: run.skipped
    }));
    if (args.save) console.log(`Saved: ${await save({ ...run, sourceId: source.id })}`);
    return 0;
  } catch (err) {
    console.error(`Debug run failed: ${err?.message || err}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => { process.exitCode = code; });
}
