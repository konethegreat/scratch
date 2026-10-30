// Offline proof of the hosted Job Hunter: the page reads the three public
// feeds from the browser, scores the South African rows, saves the new ones to
// the tracker and reports an all-duplicate second run. Every feed response is a
// checked-in fixture, so nothing touches the live network.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { startStaticServer } from './lib/staticServer.mjs';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'client/dist');
const fixtures = path.join(root, 'packages/core/src/feeds/fixtures');

const FEEDS = new Map([
  ['https://remotive.com/api/remote-jobs', 'remotive.json'],
  ['https://www.arbeitnow.com/api/job-board-api', 'arbeitnow.json'],
  ['https://jobicy.com/api/v2/remote-jobs', 'jobicy.json']
]);

const SAVED_TITLE = 'Product Designer';
const FOREIGN_TITLE = 'Support Engineer';

let step = 'start';
const at = (name) => { step = name; };

async function main() {
  await fs.access(path.join(dist, 'index.html')).catch(() => {
    throw new Error('client/dist/index.html is missing. Run npm run build:web first.');
  });
  const payloads = new Map();
  for (const [url, file] of FEEDS) {
    payloads.set(url, JSON.parse(await fs.readFile(path.join(fixtures, file), 'utf8')));
  }

  const server = await startStaticServer({ root: dist });
  const origin = new URL(server.url).origin;
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    const external = [];
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', (error) => errors.push(String(error)));

    await page.route('**/*', async (route) => {
      const url = route.request().url();
      let parsed;
      try {
        parsed = new URL(url);
      } catch {
        parsed = null;
      }
      if (parsed && parsed.origin === origin) return route.continue();
      const body = payloads.get(url);
      if (body) {
        external.push(url);
        return route.fulfill({
          status: 200,
          headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
          body: JSON.stringify(body)
        });
      }
      external.push(url);
      return route.abort('blockedbyclient');
    });

    at('open the app without a key');
    await page.goto(server.url, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('onboarding').waitFor({ timeout: 20_000 });
    await page.getByTestId('key-skip').click();
    await page.getByRole('button', { name: /Enter the Suite/i }).click({ timeout: 20_000 });
    await page.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor({ timeout: 15_000 });

    at('open the hunter');
    await page.getByRole('button', { name: 'Job Hunter', exact: true }).click();
    await page.getByTestId('web-hunter').waitFor({ timeout: 15_000 });
    await page.getByRole('heading', { name: 'Your tracker', exact: true }).waitFor({ timeout: 15_000 });

    at('run the hunt');
    await page.getByTestId('run-web-hunter').click();
    await page.getByTestId('web-hunter-result').waitFor({ timeout: 40_000 });
    const first = await page.getByTestId('web-hunter-result').innerText();
    assert.match(first, /4 new saved, 0 already tracked, 0 failed/, first);
    assert.match(first, /2 outside South Africa skipped/, first);

    at('saved jobs reach the tracker');
    await page.locator('table.data-table tbody').getByText(SAVED_TITLE, { exact: true }).first().waitFor({ timeout: 15_000 });
    const rows = await page.locator('[data-testid="job-row"]').count();
    assert.ok(rows >= 4, `the tracker shows ${rows} rows after the hunt`);
    assert.equal(
      await page.locator('table.data-table tbody').getByText(FOREIGN_TITLE, { exact: true }).count(),
      0,
      'a foreign posting reached the tracker'
    );

    at('a second hunt adds nothing');
    await page.getByTestId('run-web-hunter').click();
    await page.getByTestId('web-hunter-result').filter({ hasText: '0 new saved' }).waitFor({ timeout: 40_000 });
    const second = await page.getByTestId('web-hunter-result').innerText();
    assert.match(second, /0 new saved, 4 already tracked, 0 failed/, second);

    at('network surface');
    assert.deepEqual(errors, [], `console errors: ${errors.join(' | ')}`);
    const unexpected = external.filter((url) => !FEEDS.has(url));
    assert.deepEqual(unexpected, [], `the hunt reached an unexpected URL: ${unexpected.join(', ')}`);

    console.log('web-hunter: PASS');
  } finally {
    await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(`web-hunter: FAIL at "${step}"`);
  console.error(error?.stack || error);
  process.exitCode = 1;
});
