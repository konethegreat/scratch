#!/usr/bin/env node
// Record ONE live page for a hunter source, so the adapter contract can be
// re-run against a page the site really served (not only the synthetic fixture).
//
//   node scripts/hunter-record.mjs <sourceId> [--keyword <kw>] [--location <loc>] --yes
//
// This visits the LIVE site. It never writes the DB, never takes the browser
// lock and never calls the AI: it loads page 1 in headless Chrome, opens a fresh
// browser context carrying the hunter fingerprint (UA, viewport, locale,
// timezone), sanitises the HTML (scripts, styles, noscript, iframes, inline
// handlers, emails, phone numbers) and writes
// server/src/hunter/fixtures/recorded/<id>-<yyyymmdd>.html, which is gitignored.
// The contract test picks the file up automatically.
//
// sanitizeHtml is exported and pure; importing this module from a test must not
// launch anything. The CLI itself only runs when this file is the entry point.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SOURCES, getSource } from '../server/src/hunter/registry.js';

const DEFAULT_KEYWORD = 'developer';
const RECORDED_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', 'server', 'src', 'hunter', 'fixtures', 'recorded'
);

// The same hunter-like browser fingerprint the hunter and canary use. These are
// CONTEXT options: chromium.launch() ignores them, so they must go to newContext().
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const LAUNCH_ARGS = ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-setuid-sandbox'];
const LAUNCH_ONLY_OPTIONS = Object.freeze({ args: LAUNCH_ARGS });
const LAUNCH_CONTEXT = Object.freeze({
  userAgent: USER_AGENT,
  viewport: { width: 1366, height: 768 },
  locale: 'en-ZA',
  timezoneId: 'Africa/Johannesburg'
});

const BLOCK_TAGS = /<(script|style|noscript|iframe)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const SELF_CLOSING_BLOCK_TAGS = /<(script|style|noscript|iframe)\b[^>]*\/\s*>/gi;
// An opening tag that never closes swallows the rest of the document (a browser
// reads everything after it as that block's body), so drop from it to end of input.
const UNCLOSED_BLOCK_TAG = /<(script|style|noscript|iframe)\b[^>]*>[\s\S]*$/i;
const LEFTOVER_BLOCK_TAGS = /<\/?(script|style|noscript|iframe)\b[^>]*>/gi;
const INLINE_HANDLERS = /\son[a-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const EMAILS = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RUNS = /\+?\d[\d\s().-]{6,}\d/g;

const digitsIn = (text) => (text.match(/\d/g) || []).length;

/**
 * Removes everything a recorded fixture must never carry: executable/style
 * blocks (including self-closing iframes and unclosed blocks, whose body runs to
 * the end of the input), inline `on*=` handlers, email addresses and phone-like
 * runs of nine or more digits. Visible text and all other markup are preserved.
 * Pure, and never throws.
 *
 * @param {string} html
 * @returns {string}
 */
export function sanitizeHtml(html) {
  if (typeof html !== 'string') return '';
  if (!html) return '';
  try {
    let out = html
      .replace(BLOCK_TAGS, '')
      .replace(SELF_CLOSING_BLOCK_TAGS, '')
      .replace(UNCLOSED_BLOCK_TAG, '')
      .replace(LEFTOVER_BLOCK_TAGS, '')
      .replace(INLINE_HANDLERS, '');
    out = out.replace(EMAILS, '[email]');
    out = out.replace(PHONE_RUNS, (run) => (digitsIn(run) >= 9 ? '[phone]' : run));
    return out;
  } catch {
    return html;
  }
}

/** Local (not UTC) yyyymmdd, so a late-evening run is filed under today. */
function localDateStamp(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

function parseArgs(argv) {
  const out = { sourceId: null, keyword: DEFAULT_KEYWORD, location: null, yes: false, help: false, unknown: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--yes' || arg === '-y') {
      out.yes = true;
    } else if (arg === '--keyword' || arg === '-k') {
      out.keyword = argv[++i];
    } else if (arg.startsWith('--keyword=')) {
      out.keyword = arg.slice('--keyword='.length);
    } else if (arg === '--location' || arg === '-l') {
      out.location = argv[++i];
    } else if (arg.startsWith('--location=')) {
      out.location = arg.slice('--location='.length);
    } else if (arg === '--help' || arg === '-h') {
      out.help = true;
    } else if (!arg.startsWith('-') && out.sourceId === null) {
      out.sourceId = arg;
    } else if (out.unknown === null) {
      out.unknown = arg;
    }
  }
  if (typeof out.keyword !== 'string' || !out.keyword.trim()) out.keyword = DEFAULT_KEYWORD;
  if (typeof out.location !== 'string' || !out.location.trim()) out.location = null;
  return out;
}

function usage() {
  return [
    'Record one live hunter page as a fixture.',
    '',
    'Usage: node scripts/hunter-record.mjs <sourceId> [--keyword <kw>] [--location <loc>] --yes',
    '',
    `  sourceId    one of: ${SOURCES.map((s) => s.id).join(', ')}`,
    `  --keyword   search keyword (default: ${DEFAULT_KEYWORD})`,
    "  --location  location (default: the source's canary location when it has one)",
    '  --yes       required confirmation: this command visits the LIVE site',
    '',
    `Writes ${path.join('server', 'src', 'hunter', 'fixtures', 'recorded', '<id>-<yyyymmdd>.html')} (gitignored).`
  ].join('\n');
}

/**
 * Runs the CLI. Returns the process exit code (0 ok, 1 refused/failed).
 * Playwright and the browser are loaded only here, so importing this module is free.
 */
async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return 0;
  }

  const source = getSource(args.sourceId);
  if (!source) {
    console.error(args.sourceId ? `Unknown source: ${args.sourceId}` : 'Missing source id.');
    console.error(`Valid source ids: ${SOURCES.map((s) => s.id).join(', ')}`);
    console.error('');
    console.error(usage());
    return 1;
  }

  if (args.unknown) {
    console.error(`Unknown argument: ${args.unknown}`);
    console.error(usage());
    return 1;
  }

  if (!args.yes) {
    console.error('Refusing to run without --yes: this command visits LIVE job sites.');
    console.error('It loads one real search page in headless Chrome and saves a sanitised copy as a test fixture.');
    console.error('Re-run with --yes once you are happy for it to visit the site.');
    return 1;
  }

  const keyword = args.keyword;
  const location = args.location ?? source.canary?.location ?? null;
  const url = source.buildUrl({ keyword, location }, 1);
  const waitMs = Math.min(Math.max(0, Number(source.waitIdleMs) || 0), 5000);

  console.log(`Recording ${source.id} page 1 — this visits the LIVE site: ${url}`);
  const { chromium } = await import('playwright');
  let browser = null;
  let context = null;
  try {
    try {
      browser = await chromium.launch({ headless: true, channel: 'chrome', ...LAUNCH_ONLY_OPTIONS });
    } catch {
      browser = await chromium.launch({ headless: true, ...LAUNCH_ONLY_OPTIONS });
    }
    context = await browser.newContext(LAUNCH_CONTEXT);
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));

    const html = sanitizeHtml(await page.content());
    mkdirSync(RECORDED_DIR, { recursive: true });
    const file = path.join(RECORDED_DIR, `${source.id}-${localDateStamp()}.html`);
    writeFileSync(file, html, 'utf8');
    const bytes = Buffer.byteLength(html, 'utf8');
    console.log(`Wrote ${file} (${bytes} bytes).`);
    console.log('The contract test picks it up automatically: npm test --workspace=server');
    return 0;
  } finally {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((err) => {
      console.error(`Record failed: ${err?.message || err}`);
      process.exitCode = 1;
    });
}
