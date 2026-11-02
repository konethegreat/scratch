// Offline proof that the hosted Apply tab builds the packet, copies a field,
// downloads the tailored PDF, handles an absent extension and records Mark
// applied in the local vault. No request leaves the machine.
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
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['profile', 'jobs', 'meta', 'answers', 'documents'], 'readwrite');
      tx.objectStore('profile').put(profile, 'current');
      tx.objectStore('jobs').put(job, job.id);
      tx.objectStore('meta').put({ onboarded: true }, 'app');
      tx.objectStore('answers').put({ id: 'driver', question: 'Driver licence?', answer: 'Code B', normalized: 'driver licence' }, 'driver');
      const cvBytes = new TextEncoder().encode('Base CV for Thandi Mokoena');
      tx.objectStore('documents').put({
        id: 'cv-base', kind: 'cv', label: 'Base CV', fileName: 'base-cv.txt',
        mime: 'text/plain', size: cvBytes.byteLength, text: 'Base CV for Thandi Mokoena',
        data: cvBytes.buffer, uploadedAt: '2026-10-30T10:00:00.000Z', isDefault: true
      }, 'cv-base');
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

    const downloadEvent = page.waitForEvent('download');
    await page.getByTestId('download-tailored-pdf').click();
    const savedPdf = await downloadEvent;
    assert.match(savedPdf.suggestedFilename(), /\.pdf$/);
    const pdfPath = await savedPdf.path();
    assert.ok(pdfPath, 'the browser reported no file for the PDF download');
    const pdfBytes = await fs.readFile(pdfPath);
    assert.equal(new TextDecoder().decode(pdfBytes.subarray(0, 5)), '%PDF-');
    assert.ok(pdfBytes.byteLength > 500, 'the PDF was suspiciously small');

    await page.getByText('Base CV: base-cv.txt').waitFor();
    assert.equal(await page.getByRole('checkbox', { name: 'Base CV (cv)' }).isChecked(), true);
    const baseEvent = page.waitForEvent('download');
    await page.getByTestId('download-base-cv').click();
    const savedBase = await baseEvent;
    assert.equal(savedBase.suggestedFilename(), 'base-cv.txt');
    const basePath = await savedBase.path();
    assert.ok(basePath, 'the browser reported no file for the base CV');
    assert.equal(await fs.readFile(basePath, 'utf8'), 'Base CV for Thandi Mokoena');

    // The send button must answer for itself: no toast exists before the click,
    // and the click produces the one that names the missing extension.
    assert.equal(await page.getByText(/Check that it is installed and enabled/i).count(), 0);
    await page.getByTestId('send-to-extension').click();
    await page.getByText(/Check that it is installed and enabled/i).first().waitFor({ timeout: 4000 });

    // The install hint must offer the packaged download, not just point at the repo.
    const installHint = page.getByTestId('extension-install-hint');
    await installHint.waitFor({ timeout: 10_000 });
    assert.equal(
      await installHint.getByRole('link', { name: /Download the extension/i }).getAttribute('href'),
      'https://github.com/konethegreat/scratch/releases/latest/download/sajas-apply-assistant.zip'
    );
    assert.match(await installHint.innerText(), /Load unpacked/);

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
    const external = requests.filter((url) => /^https?:\/\//.test(url) && !url.startsWith(origin));
    assert.deepEqual(external, [], 'a request left the local origin');

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
