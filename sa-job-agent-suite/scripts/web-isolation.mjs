// Merge-blocking offline proof that two browser contexts on the same origin do
// not share data, and that a storage quota failure is reported without
// persisting the failed write.
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

let step = 'start';

function at(name) {
  step = name;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function assertBuiltDist() {
  try {
    await fs.access(path.join(dist, 'index.html'));
  } catch {
    throw new Error('client/dist/index.html is missing - run npm run build:web first.');
  }
}

async function enterSuite(page) {
  const enter = page.getByRole('button', { name: /Enter the Suite/i });
  await enter.waitFor({ timeout: 20_000 });
  await enter.click();
}

async function openTracker(page) {
  await page.getByRole('button', { name: 'Job Hunter', exact: true }).click();
  await page.locator('table.data-table tbody').waitFor({ timeout: 15_000 });
}

async function readJobs(page) {
  return page.evaluate(async () => {
    const info = (await indexedDB.databases()).find((entry) => entry.name === 'sajas-web');
    if (!info) return [];
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('sajas-web');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (!db.objectStoreNames.contains('jobs')) {
      db.close();
      return [];
    }
    const rows = await new Promise((resolve, reject) => {
      const tx = db.transaction('jobs', 'readonly');
      const request = tx.objectStore('jobs').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return rows;
  });
}

async function waitForStoredJob(page, title, check, label) {
  const deadline = Date.now() + 15_000;
  let last = null;
  while (Date.now() < deadline) {
    const rows = await readJobs(page);
    last = rows.find((row) => row.title === title) || null;
    if (last && check(last)) return last;
    await delay(100);
  }
  assert.fail(`${label}: the vault never stored the expected record (last seen: ${JSON.stringify(last)})`);
}

function routePage(page, { serverOrigin, payloads, aborted }) {
  return page.route('**/*', async (route) => {
    const url = route.request().url();
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      parsed = null;
    }
    if (parsed && parsed.origin === serverOrigin) return route.continue();
    const body = payloads.get(url);
    if (body) {
      return route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
        body: JSON.stringify(body)
      });
    }
    aborted.push(url);
    return route.abort('blockedbyclient');
  });
}

async function skipKeyAndEnter(page) {
  await page.getByTestId('key-skip').click();
  await enterSuite(page);
  await page.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor({ timeout: 15_000 });
}

async function main() {
  await assertBuiltDist();
  const payloads = new Map();
  for (const [url, file] of FEEDS) {
    payloads.set(url, JSON.parse(await fs.readFile(path.join(fixtures, file), 'utf8')));
  }

  const server = await startStaticServer({ root: dist });
  const serverOrigin = new URL(server.url).origin;
  const abortedA = [];
  const abortedB = [];
  let browser = null;

  try {
    browser = await chromium.launch({ headless: true });
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    await routePage(pageA, { serverOrigin, payloads, aborted: abortedA });
    await routePage(pageB, { serverOrigin, payloads, aborted: abortedB });

    at('context A adds a job');
    await pageA.goto(server.url, { waitUntil: 'domcontentloaded' });
    await pageA.getByTestId('onboarding').waitFor({ timeout: 15_000 });
    await skipKeyAndEnter(pageA);
    await pageA.getByRole('button', { name: 'Job Feeds', exact: true }).click();
    await pageA.getByTestId('feed-row-0').waitFor({ timeout: 15_000 });
    const title = (await pageA.getByTestId('feed-row-0').locator('td').first().locator('div').first().innerText()).trim();
    assert.ok(title.length > 0, 'the feed row has no title');
    await pageA.getByTestId('add-job-0').click();
    await pageA.getByTestId('add-job-0').filter({ hasText: 'In tracker' }).waitFor({ timeout: 15_000 });
    await openTracker(pageA);
    await pageA.getByTestId('job-status').selectOption('applied');
    await waitForStoredJob(pageA, title, (job) => job.status === 'applied', 'context A status');

    at('context B starts empty');
    await pageB.goto(server.url, { waitUntil: 'domcontentloaded' });
    await pageB.getByTestId('onboarding').waitFor({ timeout: 15_000 });
    const browserStorage = await pageB.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
      cookie: document.cookie
    }));
    assert.equal(browserStorage.local, 0, 'context B inherited localStorage');
    assert.equal(browserStorage.session, 0, 'context B inherited sessionStorage');
    assert.equal(browserStorage.cookie, '', 'context B inherited a cookie');
    assert.deepEqual(await readJobs(pageB), [], 'context B can see context A jobs before onboarding');
    assert.deepEqual(await contextB.cookies(), [], 'context B received a cookie');

    at('context B has an empty tracker');
    await skipKeyAndEnter(pageB);
    await openTracker(pageB);
    await pageB.getByText('No records yet. Add a job manually or pull one from Job Feeds.').waitFor({ timeout: 15_000 });
    assert.deepEqual(await readJobs(pageB), [], 'context B can see context A jobs after onboarding');

    at('context A still sees its own job');
    assert.equal(await pageA.getByTestId('job-status').inputValue(), 'applied', 'context A lost its status');
    assert.equal(await readJobs(pageA).then((rows) => rows.length), 1, 'context A lost its job');

    at('a quota failure is reported and does not persist');
    await pageA.evaluate(() => {
      const original = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) {
        if (this.name === 'jobs') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        return original.apply(this, args);
      };
    });
    await pageA.getByTestId('job-status').selectOption('offer');
    const quotaToast = pageA.locator('.toast.toast-error .toast-msg').filter({ hasText: 'storage is full' });
    await quotaToast.waitFor({ timeout: 5000 });
    const quotaText = await quotaToast.innerText();
    assert.match(quotaText, /clear site data/i, 'the storage error does not explain how to recover');
    await delay(500);
    const unchanged = await readJobs(pageA).then((rows) => rows.find((row) => row.title === title));
    assert.equal(unchanged?.status, 'applied', 'the failed write changed the stored status');

    assert.deepEqual(abortedA, [], `context A tried to reach a blocked URL: ${abortedA.join(', ')}`);
    assert.deepEqual(abortedB, [], `context B tried to reach a blocked URL: ${abortedB.join(', ')}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }
}

main()
  .then(() => {
    console.log('web-isolation: PASS');
  })
  .catch((error) => {
    console.error(`web-isolation: FAIL at "${step}"`);
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
