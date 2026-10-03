import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { markdownToHtml, wrapHtml, renderMarkdownToPdf } from './pdf.js';
import { launchTestBrowser } from '../testSupport/browser.js';

test('markup in scraped or model-written text is escaped, not rendered', () => {
  const html = markdownToHtml('# Title\n\n<script>alert(1)</script> and <img src=x onerror=alert(1)>');
  assert.ok(!/<script|<img/i.test(html), html);
  assert.ok(html.includes('&lt;script&gt;'));
});

test('a markdown link cannot break out of its href attribute', () => {
  const html = markdownToHtml('[click](https://example.test/" autofocus tabindex=0 onfocus="alert(1)');
  const anchors = html.match(/<a [^>]*>/g) || [];
  assert.equal(anchors.length, 1, html);
  assert.match(anchors[0], /^<a href="[^"]*">$/, `only the two href quotes may be raw: ${anchors[0]}`);
});

test('normal markdown still renders: headings, bold, italics, lists and https links', () => {
  const html = markdownToHtml('## Skills\n\n- **TypeScript** and *Node*\n- [Site](https://example.test/a?b=1&c=2)\n\n1. one\n2. two');
  assert.match(html, /<h2>Skills<\/h2>/);
  assert.match(html, /<li><strong>TypeScript<\/strong> and <em>Node<\/em><\/li>/);
  assert.match(html, /<a href="https:\/\/example\.test\/a\?b=1&amp;c=2">Site<\/a>/);
  assert.match(html, /<ol>\s*<li>one<\/li>\s*<li>two<\/li>\s*<\/ol>/);
});

test('javascript: and data: links do not become anchors', () => {
  assert.ok(!/<a /.test(markdownToHtml('[x](javascript:alert(1)) [y](data:text/html,hi)')));
});

test('the page wrapper forbids scripts and network with a Content-Security-Policy', () => {
  const doc = wrapHtml('<p>x</p>', 'Kone "CV" <b>');
  assert.match(doc, /Content-Security-Policy" content="default-src 'none'/);
  assert.ok(doc.includes('<title>Kone "CV" b</title>'), 'angle brackets are stripped from the title');
});

const browser = await launchTestBrowser();
after(() => browser?.close());
const withBrowser = browser ? test : test.skip;

withBrowser('the CSP stops scripts and inline handlers even if hostile markup reached the page', async () => {
  const hostile = `<a href="#" tabindex="0" autofocus onfocus="document.title='handler-ran'">x</a><script>document.title='script-ran'</script>`;
  const run = async (html) => {
    const context = await browser.newContext(); // JavaScript stays ENABLED on purpose
    try {
      const page = await context.newPage();
      await page.setContent(html);
      await page.waitForTimeout(150);
      return await page.title();
    } finally {
      await context.close();
    }
  };
  // Control: without the policy the same markup does execute, so this test can tell.
  const withoutCsp = wrapHtml(hostile, 'safe').replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '');
  assert.notEqual(await run(withoutCsp), 'safe', 'control: the hostile markup should run when there is no policy');
  assert.equal(await run(wrapHtml(hostile, 'safe')), 'safe');
});

withBrowser('renderMarkdownToPdf writes a real PDF from markdown carrying a hostile link', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sajas-pdf-'));
  try {
    const out = path.join(dir, 'cv.pdf');
    await renderMarkdownToPdf('# Kone\n\n[x](https://example.test/" autofocus onfocus="alert(1)\n\n- a bullet', out, 'CV');
    const bytes = fs.readFileSync(out);
    assert.equal(bytes.subarray(0, 5).toString('latin1'), '%PDF-');
    assert.ok(bytes.length > 1000, `PDF is suspiciously small: ${bytes.length} bytes`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});