// Offline proof of the hosted demo: enter without a key, exercise every surface,
// refresh, exit, and verify the real vault sentinel is untouched.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startStaticServer } from './lib/staticServer.mjs';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'client/dist');

const PROFILE = { fullName: 'Sentinel Person', email: 'sentinel@example.test', applicationProfile: {} };
const JOB = {
  id: 'sentinel-job', title: 'Sentinel Job', company: 'Sentinel Company',
  location: 'Cape Town', description: 'A sentinel record.', applyUrl: 'https://sentinel.test/apply',
  datePosted: '2026-10-20', matchScore: 50, status: 'found', notes: '', source: 'Manual',
  tailoredCvText: '', tailoredCoverLetterText: '', dateAdded: '2026-10-20'
};

async function seed(page) {
  await page.evaluate(async ({ profile, job }) => {
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
      tx.objectStore('jobs').put(job, job.id);
      tx.objectStore('meta').put({ onboarded: true }, 'app');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }, { profile: PROFILE, job: JOB });
}

async function readVault(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('sajas-web', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const read = (store) => new Promise((resolve, reject) => {
      const request = db.transaction(store, 'readonly').objectStore(store).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return { profile: await read('profile'), jobs: await read('jobs') };
  });
}

const demoKeys = (page) => page.evaluate(() => {
  const keys = [];
  for (let index = 0; index < sessionStorage.length; index += 1) keys.push(sessionStorage.key(index));
  return keys.filter((key) => key.startsWith('sajas:demo:'));
});

async function main() {
  await fs.access(path.join(dist, 'index.html')).catch(() => {
    throw new Error('client/dist/index.html is missing. Run npm run build:web first.');
  });
  const server = await startStaticServer({ root: dist });
  const origin = new URL(server.url).origin;
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    const requests = [];
    const page = await context.newPage();
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('request', (request) => requests.push(request.url()));

    await page.goto(server.url, { waitUntil: 'networkidle' });
    await page.getByTestId('onboarding').waitFor({ timeout: 20_000 });
    await seed(page);
    await page.getByTestId('key-skip').click({ timeout: 20_000 });
    await page.getByRole('button', { name: /Enter the Suite/i }).waitFor({ timeout: 20_000 });

    assert.deepEqual(await demoKeys(page), [], 'demo keys exist before the demo action');
    assert.equal(await page.getByText('Alex Example', { exact: false }).count(), 0, 'fixture text is in the initial page');

    await page.getByTestId('try-demo-landing').click();
    await page.getByTestId('demo-banner').waitFor({ timeout: 20_000 });
    assert.match(await page.getByTestId('demo-banner').innerText(), /Demo mode\. Everything here is simulated\./);
    await page.getByTestId('demo-trial-strip').waitFor();
    await page.getByText('Example Studio', { exact: false }).first().waitFor({ timeout: 20_000 });

    await page.getByRole('button', { name: /Profile & Settings/i }).click();
    await page.getByTestId('demo-key-note').waitFor();
    assert.equal(await page.getByTestId('key-input').count(), 0, 'the key input is reachable in demo mode');

    await page.getByRole('button', { name: /^Job Feeds$/ }).click();
    await page.getByTestId('feed-source-remotive').waitFor({ timeout: 20_000 });
    await page.getByTestId('feed-hidden-foreign').waitFor();
    assert.match(await page.getByTestId('feed-hidden-foreign').innerText(), /outside South Africa hidden/);

    await page.getByRole('button', { name: /^Document Tailor$/ }).click();
    await page.getByText('Data Engineer').first().click();
    await page.getByTestId('optimise-cv').click();
    await page.getByTestId('tailored-cv').waitFor({ timeout: 15_000 });
    assert.match(await page.getByTestId('tailored-cv').locator('textarea').inputValue(), /Sample Logistics/);

    await page.getByRole('button', { name: /^Ask Documents$/ }).click();
    await page.getByTestId('ask-question').fill('Which accessibility dashboard project did Alex build?');
    await page.getByTestId('ask-submit').click();
    await page.getByTestId('ask-answer').waitFor({ timeout: 15_000 });
    const answer = await page.getByTestId('ask-answer').innerText();
    assert.match(answer, /\[Doc:/);
    assert.match(answer, /Simulated/);

    await page.getByTestId('ask-question').fill('Do you have a commercial pilot licence?');
    await page.getByTestId('ask-submit').click();
    await page.getByTestId('ask-refusal').waitFor({ timeout: 15_000 });

    await page.getByTestId('ask-check-submit').click();
    await page.getByTestId('ask-check-result').waitFor({ timeout: 15_000 });
    assert.match(await page.getByTestId('ask-check-result').innerText(), /cannot verify/);

    await page.getByRole('button', { name: /^Job Hunter$/ }).click();
    await page.getByTestId('run-demo-hunter').click();
    await page.getByTestId('demo-hunter-result').waitFor({ timeout: 25_000 });
    assert.match(
      await page.getByTestId('demo-hunter-result').innerText(),
      /5 added, 2 already tracked, 1 outside South Africa skipped/
    );
    assert.match(await page.getByText(/Skipped 1 outside South Africa/).first().innerText(), /Frontend Developer/);
    assert.ok(
      await page.locator('table.data-table').getByText('React Developer').count() > 0,
      `a freshly hunted role is missing from the tracker: ${(await page.locator('table.data-table').innerText()).slice(0, 800)}`
    );
    // Demo filters stay in memory: the shared filter key must not be written.
    await page.getByTestId('job-filter-status').selectOption('applied');
    await page.waitForTimeout(200);
    assert.equal(
      await page.evaluate(() => localStorage.getItem('sajas.jobFilters.v1')),
      null,
      'demo mode wrote the real job-filter key'
    );
    await page.getByTestId('job-clear-filters').click();

    await page.getByRole('button', { name: /^Apply Copilot$/ }).click();
    await page.getByTestId('open-simulated-portal').click();
    await page.getByTestId('demo-form-continue').waitFor({ timeout: 15_000 });
    await page.getByTestId('demo-form-continue').click();
    await page.getByTestId('demo-question').fill('The accessibility dashboard project.');
    await page.getByTestId('demo-question-continue').click();
    await page.getByTestId('demo-review').waitFor();
    await page.getByTestId('demo-review-submit').click();
    await page.getByTestId('demo-confirm').click();
    await page.getByTestId('demo-receipt').waitFor({ timeout: 15_000 });
    assert.match(await page.getByTestId('demo-receipt').innerText(), /Nothing was sent to an employer\./);

    await page.reload({ waitUntil: 'networkidle' });
    await page.getByTestId('demo-banner').waitFor({ timeout: 20_000 });
    await page.getByText('Example Studio', { exact: false }).first().waitFor({ timeout: 20_000 });

    await page.getByTestId('exit-demo').click();
    await page.getByRole('button', { name: /Enter the Suite/i }).waitFor({ timeout: 20_000 });
    assert.deepEqual(await demoKeys(page), [], 'demo keys survived the exit');
    assert.equal(
      await page.evaluate(() => localStorage.getItem('sajas.jobFilters.v1')),
      null,
      'a demo filter survived the exit'
    );

    const vault = await readVault(page);
    assert.equal(vault.profile[0]?.fullName, 'Sentinel Person');
    assert.equal(vault.jobs.find((job) => job.id === JOB.id)?.status, 'found');
    assert.equal(vault.jobs.some((job) => job.id.startsWith('demo-job-')), false, 'demo data reached the real vault');

    assert.deepEqual(errors, [], `console errors: ${errors.join(' | ')}`);
    const external = requests.filter((url) => /^https?:\/\//.test(url) && !url.startsWith(origin));
    assert.deepEqual(external, [], 'a request left the page origin');

    console.log('web-demo: ok');
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
