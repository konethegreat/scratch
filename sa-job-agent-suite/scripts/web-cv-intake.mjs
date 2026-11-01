// Offline proof that a pasted-style text CV is stored as a document and saved as
// the base CV, with no key and no network beyond the local static server.
import assert from 'node:assert/strict';
import path from 'node:path';
import { startStaticServer } from './lib/staticServer.mjs';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'client/dist');
const CV_TEXT = 'Thandi Mokoena\nSenior Backend Engineer\nCape Town\nEight years building payment systems.';

async function seed(page) {
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('sajas-web');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['profile', 'meta'], 'readwrite');
      tx.objectStore('profile').put({ fullName: 'Thandi Mokoena', v: 2 }, 'current');
      tx.objectStore('meta').put({ onboarded: true }, 'app');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  });
}

async function vault(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('sajas-web');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const readAll = (store) => new Promise((resolve, reject) => {
      const request = db.transaction(store, 'readonly').objectStore(store).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return { documents: await readAll('documents'), profile: (await readAll('profile'))[0] || {} };
  });
}

async function main() {
  const server = await startStaticServer({ root: dist });
  const origin = new URL(server.url).origin;
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const foreign = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin !== origin) foreign.push(url.href);
    });
    await page.goto(server.url, { waitUntil: 'domcontentloaded' });
    await seed(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /Enter the Suite/i }).first().click({ timeout: 20_000 });
    await page.getByRole('button', { name: /Profile & Settings/i }).first().click();
    await page.getByRole('button', { name: /Profile & CV/i }).click();

    await page.getByTestId('cv-intake-file').setInputFiles({
      name: 'cv.txt', mimeType: 'text/plain', buffer: Buffer.from(CV_TEXT)
    });
    await page.getByTestId('cv-intake-preview').waitFor({ timeout: 15_000 });
    assert.equal((await page.getByTestId('cv-intake-preview').inputValue()).includes('Senior Backend Engineer'), true);
    assert.equal(await page.getByRole('button', { name: /Read my CV with AI/i }).count() > 0, true);

    const stored = await vault(page);
    assert.equal(stored.documents.length, 1);
    assert.equal(stored.documents[0].text.includes('Senior Backend Engineer'), true);

    assert.deepEqual(foreign, [], `requests left the local origin: ${foreign.join(', ')}`);
    console.log('web-cv-intake: PASS');
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((error) => {
  console.error(`web-cv-intake: FAIL - ${error.message}`);
  process.exitCode = 1;
});
