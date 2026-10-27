// Merge-blocking offline proof for the browser-only features: the three public
// job feeds, the tracker edits (status and notes) and the backup round trip.
// Every request is answered by the local server or a checked-in fixture, so the
// run is deterministic and never touches the live network.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { startStaticServer } from './lib/staticServer.mjs';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'client/dist');
const fixtures = path.join(root, 'packages/core/src/feeds/fixtures');

// The exact endpoints the feed client calls, mapped to the fixture that stands
// in for the real payload. Anything else the page tries is aborted.
const FEEDS = new Map([
  ['https://remotive.com/api/remote-jobs', 'remotive.json'],
  ['https://www.arbeitnow.com/api/job-board-api', 'arbeitnow.json'],
  ['https://jobicy.com/api/v2/remote-jobs', 'jobicy.json']
]);

const NOTE = 'Phone screen on 12 November.';

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

// Read the vault directly so a status or note that only looks saved in React
// cannot pass: the assertion is about what survives the reload, which is what
// IndexedDB holds.
async function readJob(page, title) {
  return page.evaluate(async (wanted) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('sajas-web');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const rows = await new Promise((resolve, reject) => {
      const tx = db.transaction('jobs', 'readonly');
      const request = tx.objectStore('jobs').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return rows.find((row) => row.title === wanted) || null;
  }, title);
}

async function waitForStoredJob(page, title, check, label) {
  const deadline = Date.now() + 15_000;
  let last = null;
  while (Date.now() < deadline) {
    last = await readJob(page, title);
    if (last && check(last)) return last;
    await delay(100);
  }
  assert.fail(`${label}: the vault never stored the expected record (last seen: ${JSON.stringify(last)})`);
}

// The source cards render unconditionally, so read the per-source job count
// the tab shows: it only appears after that feed answered and its rows survived
// the normalizer. An errored or empty feed never produces a positive count.
async function waitForSourceCount(page, id) {
  const card = page.getByTestId(`feed-source-${id}`);
  const deadline = Date.now() + 15_000;
  let last = '';
  while (Date.now() < deadline) {
    last = (await card.innerText()).replace(/\s+/g, ' ').trim();
    const match = last.match(/(\d+) jobs/);
    if (match) return Number(match[1]);
    await delay(100);
  }
  assert.fail(`the ${id} card never reported a job count (last seen: ${JSON.stringify(last)})`);
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

async function openSettings(page) {
  await page.getByRole('button', { name: /Profile & Settings/i }).click();
  await page.getByRole('heading', { name: 'Profile & Settings', exact: true }).waitFor({ timeout: 15_000 });
}

async function main() {
  await assertBuiltDist();
  const payloads = new Map();
  for (const [url, file] of FEEDS) {
    payloads.set(url, JSON.parse(await fs.readFile(path.join(fixtures, file), 'utf8')));
  }

  const server = await startStaticServer({ root: dist });
  const serverOrigin = new URL(server.url).origin;
  const allowedOrigins = new Set([serverOrigin, ...[...FEEDS.keys()].map((url) => new URL(url).origin)]);
  let browser = null;
  let downloadFile = null;

  try {
    browser = await chromium.launch({ headless: true });
    // A fresh context per run: no saved key, no IndexedDB, no cookies.
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();

    const aborted = [];
    const offOrigin = [];
    // Cards render whether or not a feed answered, so record which feed payloads
    // were actually served and assert that below.
    const fulfilledFeeds = new Set();
    await page.route('**/*', async (route) => {
      const request = route.request();
      const url = request.url();
      let parsed;
      try {
        parsed = new URL(url);
      } catch {
        parsed = null;
      }
      if (parsed && parsed.origin === serverOrigin) return route.continue();
      const body = payloads.get(url);
      if (body) {
        fulfilledFeeds.add(url);
        // The page is on a different origin from every feed, so the mocked
        // response carries the CORS header a real feed would send.
        return route.fulfill({
          status: 200,
          headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
          body: JSON.stringify(body)
        });
      }
      aborted.push(url);
      if (!parsed || !allowedOrigins.has(parsed.origin)) offOrigin.push(url);
      return route.abort('blockedbyclient');
    });

    at('onboarding without a key');
    await page.goto(server.url, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('onboarding').waitFor({ timeout: 15_000 }).catch(() => {
      throw new Error('client/dist did not render the web onboarding screen - it is not a web build, run npm run build:web first.');
    });
    // The skip path exists exactly for this: the feed, tracker and backup flows
    // do not need a key, so this run never enters one.
    await page.getByTestId('key-skip').click();
    await enterSuite(page);
    await page.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor({ timeout: 15_000 });

    at('open Job Feeds');
    await page.getByRole('button', { name: 'Job Feeds', exact: true }).click();
    for (const id of ['remotive', 'arbeitnow', 'jobicy']) {
      await page.getByTestId(`feed-source-${id}`).waitFor({ timeout: 15_000 });
    }
    await page.getByTestId('feed-row-0').waitFor({ timeout: 15_000 });

    at('every feed returned rows');
    for (const id of ['remotive', 'arbeitnow', 'jobicy']) {
      const count = await waitForSourceCount(page, id);
      assert.ok(count >= 1, `the ${id} card reports ${count} jobs; that feed contributed nothing`);
    }
    assert.deepEqual(
      [...fulfilledFeeds].sort(),
      [...FEEDS.keys()].sort(),
      `the run did not request exactly the three feeds (served: ${[...fulfilledFeeds].join(', ')})`
    );

    const firstRow = page.getByTestId('feed-row-0');
    const title = (await firstRow.locator('td').first().locator('div').first().innerText()).trim();
    assert.ok(title.length > 0, 'the first feed row has no job title');

    at('add the first feed job');
    await page.getByTestId('add-job-0').click();
    await page.getByTestId('add-job-0').filter({ hasText: 'In tracker' }).waitFor({ timeout: 15_000 });

    at('tracker shows the added job');
    await openTracker(page);
    await page.locator('table.data-table tbody').getByText(title, { exact: true }).first().waitFor({ timeout: 15_000 });

    at('change the status');
    await page.getByTestId('job-status').selectOption('interviewing');
    await waitForStoredJob(page, title, (job) => job.status === 'interviewing', 'status update');
    await page.waitForFunction(() => {
      const select = document.querySelector('[data-testid="job-status"]');
      return Boolean(select) && select.value === 'interviewing';
    }, undefined, { timeout: 15_000 });

    at('status survives reload');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await enterSuite(page);
    await openTracker(page);
    assert.equal(
      await page.getByTestId('job-status').inputValue(),
      'interviewing',
      'the status did not survive a reload'
    );

    at('add and save a note');
    const trackerRow = page.locator('table.data-table tbody tr').first();
    await trackerRow.getByRole('button', { name: 'Add note', exact: true }).click();
    await page.getByTestId('job-notes').fill(NOTE);
    await page.getByTestId('save-notes').click();
    await page.getByTestId('job-notes').waitFor({ state: 'detached', timeout: 15_000 });
    await waitForStoredJob(page, title, (job) => job.notes === NOTE, 'note save');

    at('note survives reload');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await enterSuite(page);
    await openTracker(page);
    const reloadedRow = page.locator('table.data-table tbody tr').first();
    await reloadedRow.getByRole('button', { name: 'Note', exact: true }).click();
    assert.equal(await page.getByTestId('job-notes').inputValue(), NOTE, 'the note did not survive a reload');

    at('export backup');
    await openSettings(page);
    await page.getByRole('button', { name: 'Backup', exact: true }).click();
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 20_000 }),
      page.getByTestId('export-backup').click()
    ]);
    downloadFile = path.join(os.tmpdir(), `sajas-web-feeds-${process.pid}-${Date.now()}.json`);
    await download.saveAs(downloadFile);
    const backup = JSON.parse(await fs.readFile(downloadFile, 'utf8'));
    assert.equal(backup.app, 'sajas-web', 'the backup is not a SA-JAS web backup');
    const savedJobs = Object.values(backup.data?.jobs || {});
    const savedJob = savedJobs.find((job) => job.title === title);
    assert.ok(savedJob, `the backup does not contain "${title}"`);
    assert.equal(savedJob.status, 'interviewing', 'the backup did not carry the job status');
    assert.equal(savedJob.notes, NOTE, 'the backup did not carry the job note');
    assert.equal('keyVault' in (backup.data || {}), false, 'the backup contains a keyVault store');
    assert.equal(JSON.stringify(backup).includes('keyVault'), false, 'the backup mentions keyVault');
    assert.equal(JSON.stringify(backup).includes('anthropicApiKey'), false, 'the backup mentions an API key field');

    at('panic wipe');
    await page.getByRole('button', { name: 'AI & Cost', exact: true }).click();
    await page.getByTestId('panic-wipe').click();
    await page.getByTestId('wipe-confirm-text').fill('wipe');
    await page.getByTestId('panic-confirm').click();
    await page.getByTestId('key-input').waitFor({ timeout: 20_000 });
    await page.getByTestId('key-skip').click();
    await enterSuite(page);
    await openTracker(page);
    assert.equal(
      await page.locator('table.data-table tbody').getByText(title, { exact: true }).count(),
      0,
      'the job survived the panic wipe'
    );

    at('import backup');
    await openSettings(page);
    await page.getByRole('button', { name: 'Backup', exact: true }).click();
    await page.getByTestId('import-file').setInputFiles(downloadFile);
    await page.getByTestId('import-confirm-text').waitFor({ timeout: 15_000 });
    await page.getByTestId('import-confirm-text').fill('import');
    await page.getByTestId('import-confirm').click();
    await openTracker(page);
    await page.locator('table.data-table tbody').getByText(title, { exact: true }).first().waitFor({ timeout: 15_000 });
    assert.equal(await page.getByTestId('job-status').inputValue(), 'interviewing', 'the imported job lost its status');

    at('network surface');
    // No exception is allowed: the mocked feeds, the local bundle and the
    // intercepted /api calls are the whole surface.
    assert.deepEqual(aborted, [], `the web build tried to reach a blocked URL: ${aborted.join(', ')}`);
    assert.deepEqual(offOrigin, [], `the web build tried to reach an off-origin URL: ${offOrigin.join(', ')}`);
  } finally {
    if (downloadFile) await fs.rm(downloadFile, { force: true }).catch(() => {});
    if (browser) await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }
}

main()
  .then(() => {
    console.log('web-feeds: PASS');
  })
  .catch((error) => {
    console.error(`web-feeds: FAIL at "${step}"`);
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
