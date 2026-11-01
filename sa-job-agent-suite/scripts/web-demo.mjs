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
    const stores = ['profile', 'jobs', 'answers', 'memory', 'usage', 'meta', 'documents', 'keyVault'];
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
    const text = 'Sentinel document. Do not touch.';
    const bytes = new TextEncoder().encode(text);
    const document = {
      id: 'sentinel-doc', kind: 'cv', label: 'Sentinel CV', fileName: 'sentinel.txt',
      mime: 'text/plain', size: bytes.byteLength, text,
      data: bytes.buffer, uploadedAt: '2026-11-01T10:00:00.000Z', isDefault: true
    };
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['profile', 'jobs', 'meta', 'documents'], 'readwrite');
      tx.objectStore('profile').put(profile, 'current');
      tx.objectStore('jobs').put(job, job.id);
      tx.objectStore('meta').put({ onboarded: true }, 'app');
      tx.objectStore('documents').put(document, document.id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }, { profile: PROFILE, job: JOB });
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
    return {
      profile: await read('profile'),
      jobs: await read('jobs'),
      documents: await read('documents')
    };
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

    // Count bridge hellos the app posts. Demo mode must never create the
    // extension bridge, so a postMessage is as much a leak as a request.
    await page.addInitScript(() => {
      window.__sajasBridgePosts = 0;
      const post = window.postMessage.bind(window);
      window.postMessage = (data, targetOrigin, transfer) => {
        try {
          if (data && data.source === 'sajas-app') window.__sajasBridgePosts += 1;
        } catch {
          // ignore: not a bridge message
        }
        return transfer === undefined ? post(data, targetOrigin) : post(data, targetOrigin, transfer);
      };
    });

    await page.goto(server.url, { waitUntil: 'networkidle' });
    await page.getByTestId('onboarding').waitFor({ timeout: 20_000 });
    await seed(page);
    await page.getByTestId('key-skip').click({ timeout: 20_000 });
    await page.getByRole('button', { name: /Enter the Suite/i }).waitFor({ timeout: 20_000 });

    assert.deepEqual(await demoKeys(page), [], 'demo keys exist before the demo action');
    assert.equal(await page.getByText('Naledi Mokoena', { exact: false }).count(), 0, 'fixture text is in the initial page');

    await page.getByTestId('try-demo-landing').click();
    await page.getByTestId('demo-banner').waitFor({ timeout: 20_000 });
    // Real mode may have posted a hello before the demo started; count from here.
    await page.evaluate(() => { window.__sajasBridgePosts = 0; });
    assert.match(await page.getByTestId('demo-banner').innerText(), /Demo mode\. Everything here is simulated\./);
    await page.getByTestId('demo-trial-strip').waitFor();
    await page.getByText('Bokamoso Bank', { exact: false }).first().waitFor({ timeout: 20_000 });

    await page.getByRole('button', { name: /Profile & Settings/i }).click();
    await page.getByTestId('demo-key-note').waitFor();
    assert.equal(await page.getByTestId('key-input').count(), 0, 'the key input is reachable in demo mode');

    await page.getByRole('button', { name: /^Documents$/ }).click();
    await page.getByTestId('demo-documents-note').waitFor({ timeout: 20_000 });
    await page.getByText('Base CV', { exact: false }).first().waitFor();
    await page.getByText('Certified ID copy (sample)', { exact: false }).first().waitFor();
    await page.getByText('BSc Computer Science certificate (sample)', { exact: false }).first().waitFor();
    await page.getByText('Cover letter template', { exact: false }).first().waitFor();
    assert.equal(await page.getByRole('button', { name: /Upload file/i }).count(), 0, 'demo documents allow uploads');
    assert.equal(await page.getByRole('button', { name: /Delete Base CV/i }).count(), 0, 'demo documents allow deletion');

    await page.getByRole('button', { name: /^Job Feeds$/ }).click();
    await page.getByTestId('feed-source-remotive').waitFor({ timeout: 20_000 });
    await page.getByTestId('feed-hidden-foreign').waitFor();
    assert.match(await page.getByTestId('feed-hidden-foreign').innerText(), /outside South Africa hidden/);

    await page.getByRole('button', { name: /^Document Tailor$/ }).click();
    await page.getByText('Data Engineer').first().click();
    await page.getByTestId('optimise-cv').click();
    await page.getByTestId('tailored-cv').waitFor({ timeout: 15_000 });
    assert.match(await page.getByTestId('tailored-cv').locator('textarea').inputValue(), /Highveld Haulage/);

    await page.getByRole('button', { name: /^Ask Documents$/ }).click();
    await page.getByTestId('ask-question').fill('Which accessibility dashboard project did Naledi build?');
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
      /9 added, 3 already tracked, 2 outside South Africa skipped/
    );
    assert.match(await page.getByText(/Skipped 2 outside South Africa/).first().innerText(), /Frontend Developer/);
    assert.ok(
      await page.locator('table.data-table').getByText('IT Support Officer').count() > 0,
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

    await page.getByRole('button', { name: /^Apply$/ }).click();
    await page.getByText('Base CV', { exact: false }).first().waitFor({ timeout: 15_000 });
    await page.getByRole('button', { name: /^Apply Copilot$/ }).click();
    await page.getByTestId('open-simulated-portal').click();
    await page.getByTestId('demo-form-continue').waitFor({ timeout: 20_000 });
    await page.getByTestId('demo-field-phone').fill('011 555 0100');
    await page.getByTestId('demo-form-continue').click();
    await page.getByTestId('demo-question').waitFor();
    const criminal = page.getByTestId('demo-field-bank-criminal-record-check');
    if (await criminal.count()) await criminal.fill('No');
    await page.getByTestId('demo-question').fill('The accessibility dashboard project.');
    await page.getByTestId('demo-question-continue').click();
    await page.getByTestId('demo-review').waitFor();
    const review = await page.getByTestId('demo-review').innerText();
    assert.match(review, /011 555 0100/);
    assert.match(review, /Base CV/);
    assert.match(review, /Tailored CV/);
    if (await criminal.count()) assert.match(review, /No/);
    await page.getByTestId('demo-review-submit').click();
    await page.getByTestId('demo-confirm').click();
    await page.getByTestId('demo-receipt').waitFor({ timeout: 15_000 });
    const receipt = await page.getByTestId('demo-receipt').innerText();
    assert.match(receipt, /Nothing was sent to an employer\./);
    assert.match(receipt, /web-guided/);
    assert.match(receipt, /copilot-confirmed/);
    assert.match(receipt, /6 document\(s\) attached/);
    assert.equal(
      await page.evaluate(() => window.__sajasBridgePosts),
      0,
      'demo mode posted an extension bridge message'
    );

    await page.reload({ waitUntil: 'networkidle' });
    await page.getByTestId('demo-banner').waitFor({ timeout: 20_000 });
    await page.getByText('Bokamoso Bank', { exact: false }).first().waitFor({ timeout: 20_000 });
    assert.equal(
      await page.evaluate(() => window.__sajasBridgePosts),
      0,
      'demo mode posted an extension bridge message after a reload'
    );

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
    assert.equal(vault.documents.length, 1, 'demo documents reached the real documents store');
    assert.equal(vault.documents[0].id, 'sentinel-doc');
    assert.equal(vault.documents[0].label, 'Sentinel CV');
    assert.equal(vault.documents.some((doc) => String(doc.id).startsWith('demo-doc-')), false);

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
