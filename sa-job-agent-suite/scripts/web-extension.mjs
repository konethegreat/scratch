// Offline proof of the MV3 extension: the app hands over packets, the extension
// fills real fixture forms, a person reviews and submits, results queue, and the
// app drains them into its vault. No network beyond the two local servers.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startStaticServer } from './lib/staticServer.mjs';

const root = path.resolve(import.meta.dirname, '..');
const extensionDist = path.join(root, 'extension/dist');
const clientDist = path.join(root, 'client/dist');
const fixtures = path.join(root, 'extension/fixtures');
const CV_BASE64 = Buffer.from('%PDF-1.4\n').toString('base64');

const packet = (jobId, title, applyUrl, extraFields = [], extraAttachments = []) => ({
  version: 2,
  packetId: `packet-${jobId}`,
  createdAt: '2026-11-01T10:00:00.000Z',
  job: { id: jobId, title, company: 'Acme Bank', applyUrl },
  identity: [],
  questions: [],
  fields: [
    { key: 'fullName', label: 'Full name', value: 'Thandi Mokoena', source: 'profile' },
    { key: 'firstName', label: 'First name', value: 'Thandi', source: 'profile' },
    { key: 'lastName', label: 'Last name', value: 'Mokoena', source: 'profile' },
    { key: 'email', label: 'Email address', value: 'thandi@example.test', source: 'profile' },
    { key: 'noticePeriod', label: 'Notice period', value: '30 days', source: 'profile' },
    ...extraFields
  ],
  attachments: [
    { key: 'tailored-cv', kind: 'tailored-cv', label: 'Tailored CV', fileName: 'thandi-cv.pdf', mime: 'application/pdf', size: 9, dataBase64: CV_BASE64 },
    ...extraAttachments
  ],
  checklist: [],
  warnings: []
});

const JOB_ROW = (id, title) => ({
  id, title, company: 'Acme Bank', location: 'Cape Town', description: 'A fixture role.',
  applyUrl: '', datePosted: '2026-11-01', matchScore: 70, status: 'found', notes: '',
  source: 'Manual', tailoredCvText: '# CV', tailoredCoverLetterText: '', dateAdded: '2026-11-01'
});

const PROFILE = { fullName: 'Thandi Mokoena', email: 'thandi@example.test', applicationProfile: {} };

async function seedVault(page, jobs) {
  await page.evaluate(async ({ profile, rows }) => {
    const stores = ['profile', 'jobs', 'answers', 'memory', 'usage', 'meta', 'keyVault'];
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('sajas-web');
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
      for (const row of rows) tx.objectStore('jobs').put(row, row.id);
      tx.objectStore('meta').put({ onboarded: true }, 'app');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }, { profile: PROFILE, rows: jobs });
}

async function readVault(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('sajas-web');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const read = (store) => new Promise((resolve, reject) => {
      const request = db.transaction(store, 'readonly').objectStore(store).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return { jobs: await read('jobs'), memory: await read('memory') };
  });
}

const readResults = (worker) => worker.evaluate(async () => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('sajas-extension');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return new Promise((resolve, reject) => {
    const request = db.transaction('results', 'readonly').objectStore('results').getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
});

const tabIdFor = (worker, needle) => worker.evaluate(async (text) => {
  const tabs = await chrome.tabs.query({});
  return tabs.find((tab) => String(tab.url || '').includes(text))?.id ?? null;
}, needle);

async function inject(worker, tabId, packetId) {
  await worker.evaluate(async ({ tabId: id, packetId: packet }) => {
    await chrome.scripting.executeScript({ target: { tabId: id }, files: ['page.js'] });
    await chrome.tabs.sendMessage(id, { type: 'sajas:fill', packetId: packet });
  }, { tabId, packetId });
}

async function reviewAndSubmit(page, confirmation) {
  await page.locator('#sajas-review').check();
  await page.locator('#sajas-submit').click();
  await page.locator('#sajas-panel').getByText(`Submitted. ${confirmation}`).waitFor({ timeout: 10_000 });
}

async function main() {
  for (const dir of [extensionDist, clientDist]) {
    await fs.access(path.join(dir, 'manifest.json')).catch(async () => {
      await fs.access(path.join(dir, 'index.html'));
    }).catch(() => {
      throw new Error(`${dir} is missing. Run npm run build:extension and npm run build:web first.`);
    });
  }

  const fixtureServer = await startStaticServer({ root: fixtures });
  const clientServer = await startStaticServer({ root: clientDist });
  const fixtureUrl = fixtureServer.url;
  const clientUrl = clientServer.url;
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sajas-extension-proof-'));
  const { chromium } = await import('playwright');
  const context = await chromium.launchPersistentContext(userDataDir, {
    // Extensions need the full Chromium build, not the headless shell.
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extensionDist}`,
      `--load-extension=${extensionDist}`
    ]
  });

  const errors = [];
  const requests = [];
  context.on('page', (page) => {
    page.on('console', (message) => { if (message.type() === 'error') errors.push(`${page.url()} ${message.text()}`); });
    page.on('pageerror', (error) => errors.push(`${page.url()} ${error}`));
  });
  context.on('request', (request) => requests.push(request.url()));

  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15_000 });

    const appPage = context.pages()[0] || await context.newPage();
    const jobs = {
      greenhouse: packet('ext-job-1', 'Backend Engineer', `${fixtureUrl}/greenhouse.html`),
      lever: packet('ext-job-2', 'Data Analyst', `${fixtureUrl}/lever.html`),
      generic: packet('ext-job-3', 'Operations Coordinator', `${fixtureUrl}/generic.html`, [
        { key: 'rightToWorkSA', label: 'Right to work in South Africa', value: 'Yes', source: 'profile' },
        { key: 'expectedSalary', label: 'Expected salary', value: 'R 720 000 per year', source: 'profile' }
      ]),
      captcha: packet('ext-job-4', 'Store Manager', `${fixtureUrl}/captcha.html`)
    };
    await appPage.addInitScript((packets) => { window.__PACKETS__ = packets; }, jobs);

    for (const name of Object.keys(jobs)) {
      await appPage.goto(`${fixtureUrl}/app.html?job=${name}`, { waitUntil: 'domcontentloaded' });
      await appPage.waitForFunction((id) => window.__sajasAck === id, jobs[name].packetId, { timeout: 15_000 });
    }

    // Greenhouse: generic adapter quirks, a real attachment and a skipped field.
    const greenhouse = await context.newPage();
    await greenhouse.goto(`${fixtureUrl}/greenhouse.html`);
    const greenhouseTab = await tabIdFor(worker, 'greenhouse.html');
    assert.ok(greenhouseTab, 'the greenhouse tab was not found');
    await inject(worker, greenhouseTab, jobs.greenhouse.packetId);
    await greenhouse.locator('#sajas-submit').waitFor({ timeout: 15_000 });
    assert.equal(await greenhouse.locator('#first_name').inputValue(), 'Thandi');
    assert.equal(await greenhouse.locator('#last_name').inputValue(), 'Mokoena');
    assert.equal(await greenhouse.locator('#email').inputValue(), 'thandi@example.test');
    assert.equal(await greenhouse.locator('#notice_period').inputValue(), '30 days');
    assert.equal(await greenhouse.locator('#pronouns').inputValue(), '');
    assert.equal(await greenhouse.locator('#resume').evaluate((input) => input.files.length), 1);
    assert.equal(await greenhouse.locator('#resume').evaluate((input) => input.files[0].name), 'thandi-cv.pdf');
    await greenhouse.locator('#sajas-panel').locator('li.skip', { hasText: 'Preferred pronouns' }).first().waitFor();
    await reviewAndSubmit(greenhouse, 'Thank you for applying to Acme Bank.');

    let results = await readResults(worker);
    assert.equal(results.length, 1, 'greenhouse did not queue a result');
    assert.equal(results[0].jobId, 'ext-job-1');
    assert.match(results[0].confirmation.text, /Thank you for applying to Acme Bank/);
    assert.ok(results[0].fields.some((field) => field.label === 'First name' && field.value === 'Thandi'));

    // Lever: name-based matching and its own submit button.
    const lever = await context.newPage();
    await lever.goto(`${fixtureUrl}/lever.html`);
    await inject(worker, await tabIdFor(worker, 'lever.html'), jobs.lever.packetId);
    await lever.locator('#sajas-submit').waitFor({ timeout: 15_000 });
    assert.equal(await lever.locator('#name').inputValue(), 'Thandi Mokoena');
    assert.equal(await lever.locator('#email').inputValue(), 'thandi@example.test');
    await reviewAndSubmit(lever, 'Application submitted. We have received your application.');
    results = await readResults(worker);
    assert.equal(results.length, 2, 'lever did not queue a result');

    // Generic: selects, an answer bank value and a file without a name.
    const generic = await context.newPage();
    await generic.goto(`${fixtureUrl}/generic.html`);
    await inject(worker, await tabIdFor(worker, 'generic.html'), jobs.generic.packetId);
    await generic.locator('#sajas-submit').waitFor({ timeout: 15_000 });
    assert.equal(await generic.locator('#given').inputValue(), 'Thandi');
    assert.equal(await generic.locator('#family').inputValue(), 'Mokoena');
    assert.equal(await generic.locator('#right-to-work').inputValue(), 'yes');
    assert.equal(await generic.locator('#salary').inputValue(), 'R 720 000 per year');
    assert.equal(await generic.locator('#licence').inputValue(), '');
    await generic.locator('#sajas-panel').locator('li.skip', { hasText: "Driver's licence" }).first().waitFor();
    await reviewAndSubmit(generic, 'Application submitted. We have received your application.');
    results = await readResults(worker);
    assert.equal(results.length, 3, 'generic did not queue a result');

    // CAPTCHA: the panel refuses to submit and nothing is queued.
    const captcha = await context.newPage();
    await captcha.goto(`${fixtureUrl}/captcha.html`);
    await inject(worker, await tabIdFor(worker, 'captcha.html'), jobs.captcha.packetId);
    await captcha.locator('#sajas-submit').waitFor({ timeout: 15_000 });
    await captcha.locator('#sajas-review').check();
    await captcha.locator('#sajas-submit').click();
    await captcha.locator('#sajas-panel').getByText('then press Submit application again').waitFor({ timeout: 5000 });
    assert.equal((await readResults(worker)).length, 3, 'a CAPTCHA page queued a result');

    // App sync: only the tracked job is recorded; the other two are dropped.
    const app = await context.newPage();
    await app.goto(clientUrl, { waitUntil: 'networkidle' });
    await app.getByTestId('onboarding').waitFor({ timeout: 20_000 });
    await seedVault(app, [JOB_ROW('ext-job-1', 'Backend Engineer')]);
    await app.getByTestId('key-skip').click({ timeout: 20_000 });
    await app.getByRole('button', { name: /Enter the Suite/i }).waitFor({ timeout: 20_000 });
    await app.getByText('Synced 1 application from the extension.').waitFor({ timeout: 15_000 });

    const vault = await readVault(app);
    assert.equal(vault.jobs.find((job) => job.id === 'ext-job-1')?.status, 'applied');
    const application = vault.memory
      .flatMap((entry) => entry.applications || [])
      .find((entry) => entry.jobId === 'ext-job-1');
    assert.ok(application, 'the extension application was not recorded');
    assert.equal(application.delivery, 'extension');
    assert.match(application.confirmation.text, /Thank you for applying to Acme Bank/);
    assert.equal((await readResults(worker)).length, 0, 'acknowledged results were kept');

    assert.deepEqual(errors, [], `console errors: ${errors.join(' | ')}`);
    const external = requests.filter((url) => /^https?:\/\//.test(url)
      && !url.startsWith(fixtureUrl) && !url.startsWith(clientUrl));
    assert.deepEqual(external, [], 'a request left the two local origins');
    console.log('web-extension: ok');
  } finally {
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {});
    await fixtureServer.close();
    await clientServer.close();
  }
}

main().catch((error) => {
  console.error(`web-extension: FAIL - ${error.stack || error.message}`);
  process.exitCode = 1;
});
