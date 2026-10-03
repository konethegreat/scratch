import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

/**
 * Minimal, dependency-free Markdown → HTML converter. Handles the subset that
 * tailored CVs/cover letters actually use: headings, bold/italic, bullet and
 * numbered lists, horizontal rules, and paragraphs. All text is HTML-escaped
 * first so scraped/AI content can't inject markup.
 */
export function markdownToHtml(md) {
  // Quotes are escaped as well as <, > and &: the link rule below puts a URL
  // inside href="...", so a raw " in it would let scraped or model-written
  // text add attributes (autofocus + an inline handler) to the anchor.
  const esc = (s) => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const inline = (s) => esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2">$1</a>');

  const lines = (md || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let listType = null; // 'ul' | 'ol' | null

  const closeList = () => { if (listType) { out.push(`</${listType}>`); listType = null; } };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { closeList(); continue; }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { closeList(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) { closeList(); out.push('<hr/>'); continue; }

    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    if (ul) { if (listType !== 'ul') { closeList(); out.push('<ul>'); listType = 'ul'; } out.push(`<li>${inline(ul[1])}</li>`); continue; }

    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ol) { if (listType !== 'ol') { closeList(); out.push('<ol>'); listType = 'ol'; } out.push(`<li>${inline(ol[1])}</li>`); continue; }

    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join('\n');
}

export function wrapHtml(bodyHtml, title) {
  const safeTitle = (title || 'Document').replace(/[<>&]/g, '');
  // The document is static: no script, no network, only its own inline style.
  // Enforced by the browser even if the markup were ever to carry something odd.
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${safeTitle}</title>
<style>
  @page { margin: 18mm 16mm; }
  body { font-family: 'Calibri','Segoe UI',Arial,sans-serif; font-size: 11pt; line-height: 1.45; color: #1a1a1a; }
  h1 { font-size: 20pt; margin: 0 0 4pt; }
  h2 { font-size: 14pt; margin: 14pt 0 4pt; border-bottom: 1px solid #ccc; padding-bottom: 2pt; }
  h3 { font-size: 12pt; margin: 10pt 0 3pt; }
  p { margin: 4pt 0; }
  ul, ol { margin: 4pt 0 4pt 18pt; padding: 0; }
  li { margin: 2pt 0; }
  a { color: #1a4f8b; text-decoration: none; }
  code { font-family: Consolas,monospace; background: #f2f2f2; padding: 0 3px; border-radius: 3px; }
  hr { border: none; border-top: 1px solid #ddd; margin: 10pt 0; }
</style></head><body>${bodyHtml}</body></html>`;
}

/**
 * Renders Markdown to a PDF file at outPath using a headless Chromium instance.
 * Creates the parent directory if needed. Returns outPath.
 */
export async function renderMarkdownToPdf(markdown, outPath, title) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const html = wrapHtml(markdownToHtml(markdown), title);

  let browser;
  try {
    try {
      browser = await chromium.launch({ headless: true, channel: 'chrome' });
    } catch {
      browser = await chromium.launch({ headless: true });
    }
    // A throwaway context with JavaScript disabled and every request refused:
    // the CV is static text, so rendering it never needs either.
    const context = await browser.newContext({ javaScriptEnabled: false });
    await context.route('**/*', (route) => route.abort());
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.pdf({ path: outPath, format: 'A4', printBackground: true });
    return outPath;
  } finally {
    if (browser) { try { await browser.close(); } catch {} }
  }
}
