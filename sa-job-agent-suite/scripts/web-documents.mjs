// Offline proof that the documents tab uploads a text file, downloads it again
// and deletes it, with every request kept on the local static server.
import assert from 'node:assert/strict';
import path from 'node:path';
import { startStaticServer } from './lib/staticServer.mjs';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'client/dist');

async function seed(page) {
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('sajas-web');
      request.onupgradeneeded = () => {
        const created = request.result;
        for (const store of ['profile', 'jobs', 'answers', 'memory', 'usage', 'meta', 'documents', 'keyVault']) {
          if (!created.objectStoreNames.contains(store)) created.createObjectStore(store);
        }
      };
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
    // The seeded meta marks the app onboarded, so it opens on the landing screen
    // without asking for a key. Documents are fully offline.
    await page.getByRole('button', { name: /Enter the Suite/i }).first().click({ timeout: 20_000 });
    await page.getByRole('button', { name: /Profile & Settings/i }).first().click();
    await page.getByRole('button', { name: /^Documents$/i }).click();

    await page.getByPlaceholder(/Label, for example My CV/i).fill('Intake CV');
    await page.getByTestId('document-file').setInputFiles({
      name: 'cv.txt', mimeType: 'text/plain', buffer: Buffer.from('Thandi Mokoena\nSenior Backend Engineer\nCape Town')
    });
    await page.getByText('Intake CV', { exact: false }).waitFor({ timeout: 15_000 });
    assert.equal(await page.getByText(/cv\.txt/).count() > 0, true);

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: /Download Intake CV/i }).click();
    const saved = await download;
    assert.equal(saved.suggestedFilename(), 'cv.txt');

    page.on('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: /Delete Intake CV/i }).click();
    await page.getByText('Intake CV', { exact: false }).waitFor({ state: 'detached', timeout: 15_000 });

    assert.deepEqual(foreign, [], `requests left the local origin: ${foreign.join(', ')}`);
    console.log('web-documents: PASS');
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((error) => {
  console.error(`web-documents: FAIL - ${error.message}`);
  process.exitCode = 1;
});
