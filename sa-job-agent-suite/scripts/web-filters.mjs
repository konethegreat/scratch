// Offline proof of the South Africa default and the job filter bar: seed SA,
// foreign and unknown jobs, then check the hide count, reveal, province and
// score filters, persistence across reload, and a full reset. No key.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { startStaticServer } from './lib/staticServer.mjs';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'client/dist');
const TODAY = new Date().toISOString().slice(0, 10);

const PROFILE = {
  fullName: 'Kone Tshivhinda',
  email: 'test@example.com',
  keywords: 'Developer',
  locations: 'Johannesburg, Cape Town',
  feedSaOnly: true,
  dailyBudgetUSD: 0
};

const JOBS = [
  {
    id: 'job-sa-live', title: 'Backend Developer', company: 'Cape Systems',
    location: 'Cape Town', description: 'Node.js services.',
    applyUrl: 'https://example.com/sa-live', datePosted: TODAY,
    matchScore: 90, status: 'found', notes: '', source: 'PNet',
    linkStatus: 'live', dateAdded: TODAY
  },
  {
    id: 'job-sa-gp', title: 'Data Analyst', company: 'Joburg Data',
    location: 'Johannesburg', description: 'SQL and reporting.',
    applyUrl: 'https://example.com/sa-gp', datePosted: TODAY,
    matchScore: 70, status: 'found', notes: '', source: 'Indeed',
    linkStatus: 'unverified', dateAdded: TODAY
  },
  {
    id: 'job-foreign', title: 'Frontend Developer', company: 'Thames Digital',
    location: 'London, UK', description: 'React applications.',
    applyUrl: 'https://example.com/foreign', datePosted: TODAY,
    matchScore: 95, status: 'found', notes: '', source: 'Manual',
    linkStatus: 'live', dateAdded: TODAY
  },
  {
    id: 'job-unknown', title: 'Support Engineer', company: 'Remote Works',
    location: 'Remote', description: 'Customer support.',
    applyUrl: 'https://example.com/unknown', datePosted: TODAY,
    matchScore: 60, status: 'found', notes: '', source: 'Manual',
    linkStatus: 'unverified', dateAdded: TODAY
  }
];

let step = 'start';

function at(name) {
  step = name;
}

async function enterSuite(page) {
  const enter = page.getByRole('button', { name: /Enter the Suite/i });
  const dashboard = page.getByRole('heading', { name: 'Dashboard', exact: true });
  // After a reload the landing renders a moment later, so wait for whichever
  // screen appears instead of checking visibility once.
  await Promise.race([
    enter.waitFor({ timeout: 20_000 }).catch(() => {}),
    dashboard.waitFor({ timeout: 20_000 }).catch(() => {})
  ]);
  if (await enter.isVisible().catch(() => false)) await enter.click();
  await dashboard.waitFor({ timeout: 20_000 });
}

async function openTracker(page) {
  await page.getByRole('button', { name: 'Job Hunter', exact: true }).click();
  await page.locator('table.data-table tbody').waitFor({ timeout: 15_000 });
}

async function seed(page) {
  await page.evaluate(async ({ profile, jobs }) => {
    const stores = ['profile', 'jobs', 'answers', 'memory', 'usage', 'meta', 'keyVault'];
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('sajas-web', 1);
      request.onupgradeneeded = () => {
        for (const store of stores) {
          if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['profile', 'jobs', 'meta'], 'readwrite');
      tx.objectStore('profile').put(profile, 'current');
      for (const job of jobs) tx.objectStore('jobs').put(job, job.id);
      tx.objectStore('meta').put({ onboarded: true }, 'app');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, { profile: PROFILE, jobs: JOBS });
}

async function rowTitles(page) {
  return page.getByTestId('job-row').evaluateAll((rows) => rows.map((row) => row.querySelector('td div')?.textContent?.trim() || ''));
}

async function main() {
  try {
    await fs.access(path.join(dist, 'index.html'));
  } catch {
    throw new Error('client/dist/index.html is missing. Run npm run build:web first.');
  }

  const server = await startStaticServer({ root: dist });
  const origin = new URL(server.url).origin;
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', (error) => errors.push(String(error)));

    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith(origin)) return route.continue();
      return route.abort('blockedbyclient');
    });

    at('seed and enter');
    await page.goto(server.url, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('onboarding').waitFor({ timeout: 20_000 });
    await seed(page);
    // The app fetched an empty vault on first mount, so reload to read the seed.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await enterSuite(page);
    await openTracker(page);

    at('foreign job is hidden by default');
    await page.getByTestId('job-hidden-foreign').waitFor({ timeout: 15_000 });
    assert.match(await page.getByTestId('job-hidden-foreign').innerText(), /1 job outside South Africa hidden/);
    assert.deepEqual((await rowTitles(page)).sort(), ['Backend Developer', 'Data Analyst', 'Support Engineer'].sort());
    assert.equal(await page.getByText('Frontend Developer').count(), 0, 'the foreign job was visible by default');
    assert.equal(await page.getByTestId('location-unconfirmed').count(), 1, 'the unknown location was not labelled');

    at('show the hidden foreign job');
    await page.getByTestId('job-show-foreign').click();
    await page.getByText('Frontend Developer').first().waitFor({ timeout: 15_000 });
    assert.equal(await page.getByTestId('job-row').count(), 4);
    assert.equal(await page.getByTestId('job-hidden-foreign').count(), 0);

    at('province filter narrows the list');
    await page.getByTestId('job-filter-province').selectOption('Gauteng');
    assert.deepEqual(await rowTitles(page), ['Data Analyst']);
    await page.getByTestId('job-filter-province').selectOption('all');

    at('score filter narrows the list');
    await page.getByTestId('job-filter-score').selectOption('80');
    assert.deepEqual((await rowTitles(page)).sort(), ['Backend Developer', 'Frontend Developer'].sort());
    await page.getByTestId('job-filter-score').selectOption('0');

    at('search filter narrows the list');
    await page.getByTestId('job-filter-search').fill('support');
    assert.deepEqual(await rowTitles(page), ['Support Engineer']);

    at('filters survive a reload');
    await page.getByTestId('job-filter-search').fill('');
    await page.getByTestId('job-filter-score').selectOption('80');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await enterSuite(page);
    await openTracker(page);
    assert.equal(await page.getByTestId('job-filter-score').inputValue(), '80', 'the score filter did not persist');

    at('clear restores the defaults');
    await page.getByTestId('job-clear-filters').click();
    assert.equal(await page.getByTestId('job-filter-score').inputValue(), '0');
    await page.getByTestId('job-hidden-foreign').waitFor({ timeout: 15_000 });
    assert.deepEqual((await rowTitles(page)).sort(), ['Backend Developer', 'Data Analyst', 'Support Engineer'].sort());

    at('no console errors');
    assert.deepEqual(errors, [], `the page logged errors: ${errors.join(' | ')}`);
  } finally {
    await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }
}

main()
  .then(() => {
    console.log('web-filters: PASS');
  })
  .catch((error) => {
    console.error(`web-filters: FAIL at "${step}"`);
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
