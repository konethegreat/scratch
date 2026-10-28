// Offline proof that the hosted Apply tab builds the packet, copies a field, and
// records Mark applied in the local vault. No request leaves the machine.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startStaticServer } from './lib/staticServer.mjs';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'client/dist');

const PROFILE = {
  fullName: 'Thandi Mokoena',
  email: 'thandi@example.test',
  phone: '0000000000',
  applicationProfile: { rightToWorkSA: 'Yes', noticePeriod: '30 days', expectedSalary: 'R 55 000 per month' }
};

const JOB = {
  id: 'job-apply', title: 'Full Stack Developer', company: 'Acme',
  location: 'Cape Town', description: 'Build web applications.',
  applyUrl: 'https://example.com/apply', datePosted: '2026-10-20',
  matchScore: 88, status: 'tailored', notes: '', source: 'Manual',
  tailoredCvText: '# Tailored CV\n\nThandi Mokoena\n', tailoredCoverLetterText: '# Cover letter\n\nDear Acme\n',
  dateAdded: '2026-10-20'
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
      const tx = db.transaction(['profile', 'jobs', 'meta', 'answers'], 'readwrite');
      tx.objectStore('profile').put(profile, 'current');
      tx.objectStore('jobs').put(job, job.id);
      tx.objectStore('meta').put({ onboarded: true }, 'app');
      tx.objectStore('answers').put({ id: 'driver', question: 'Driver licence?', answer: 'Code B', normalized: 'driver licence' }, 'driver');
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
    return { jobs: await read('jobs'), memory: await read('memory') };
  });
}

async function main() {
  try {
    await fs.access(path.join(dist, 'index.html'));
  } catch {
    throw new Error('client/dist/index.html is missing. Run npm run build:web first.');
  }

  const server = await startStaticServer({ root: dist });
  const origin = new URL(server.url).origin;
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    const errors = [];
    const requests = [];
    const page = await context.newPage();
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('request', (request) => requests.push(request.url()));

    await page.goto(server.url, { waitUntil: 'networkidle' });
    await page.getByTestId('onboarding').waitFor({ timeout: 20_000 });
    await seed(page);
    // Applying is fully offline and needs no key; skip key entry, then enter the suite.
    await page.getByTestId('key-skip').click({ timeout: 20_000 });
    await page.getByRole('button', { name: /Enter the Suite/i }).first().click({ timeout: 20_000 });

    await page.getByRole('button', { name: /^Apply$/ }).click();
    await page.getByRole('heading', { name: 'Apply with a packet' }).waitFor();
    await page.getByText('Thandi Mokoena').first().waitFor({ timeout: 20_000 });
    assert.equal(await page.getByText('Thandi Mokoena').count() > 0, true);
    assert.equal(await page.getByText('30 days').count() > 0, true);
    assert.equal(await page.getByText('R 55 000 per month').count() > 0, true);
    assert.equal(await page.getByText('Code B').count() > 0, true);

    const link = page.getByRole('link', { name: /Open the job site/i });
    assert.equal(await link.getAttribute('target'), '_blank');
    assert.match(await link.getAttribute('rel'), /noopener/);
    assert.equal(await link.getAttribute('href'), JOB.applyUrl);

    await page.getByRole('button', { name: /^Copy$/ }).first().click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'Thandi Mokoena');

    await page.getByRole('button', { name: /Mark applied/i }).click();
    await page.getByText('Marked as applied.').waitFor({ timeout: 10_000 });

    const vault = await readVault(page);
    assert.equal(vault.jobs.find((job) => job.id === JOB.id).status, 'applied');
    assert.equal(vault.memory.length, 1);
    const application = vault.memory[0].applications[0];
    assert.equal(application.delivery, 'web-guided');
    assert.equal(application.site, 'example.com');
    assert.ok(application.fields.some((field) => field.label === 'Notice period' && field.value === '30 days'));

    assert.deepEqual(errors, [], `console errors: ${errors.join(' | ')}`);
    assert.equal(requests.some((url) => /anthropic\.com|openrouter|openai\.com/.test(url)), false, 'an AI host was contacted');

    console.log('web-apply: ok');
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
