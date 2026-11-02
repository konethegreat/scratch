// Offline proof that a photographed CV and a scanned PDF are read by the local
// OCR worker, stored, reviewed and saved with no key and no request that leaves
// the local static server.
import assert from 'node:assert/strict';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { startStaticServer } from './lib/staticServer.mjs';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'client/dist');
const LINES = [
  'Thandi Mokoena',
  'Senior Backend Engineer',
  'Cape Town',
  'thandi@example.test | +27 21 555 0100',
  '',
  'SKILLS',
  'Java, Spring Boot, PostgreSQL, AWS',
  '',
  'EXPERIENCE',
  'Senior Backend Engineer | Acme Payments (Pty) Ltd | Cape Town',
  '2020 - Present',
  '',
  'EDUCATION',
  'BSc Computer Science, University of Cape Town, 2012'
];

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
      tx.objectStore('profile').put({ fullName: 'Thandi Mokoena', v: 2, skills: [] }, 'current');
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
      request.onupgradeneeded = () => {
        const created = request.result;
        for (const store of ['profile', 'jobs', 'answers', 'memory', 'usage', 'meta', 'documents', 'keyVault']) {
          if (!created.objectStoreNames.contains(store)) created.createObjectStore(store);
        }
      };
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

async function waitForDocuments(page, count, timeout = 120_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const { documents } = await vault(page);
    if (documents.length >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`expected ${count} stored documents, timed out`);
}

async function photoPng(page) {
  const base64 = await page.evaluate((lines) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1500;
    canvas.height = 1200;
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#000000';
    context.font = 'bold 42px Arial';
    let y = 90;
    for (const line of lines) {
      if (line) {
        context.fillText(line, 60, y);
        y += 66;
      } else {
        y += 28;
      }
    }
    return canvas.toDataURL('image/png').split(',')[1];
  }, LINES);
  return Buffer.from(base64, 'base64');
}

async function scannedPdf(png) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const image = await pdf.embedPng(png);
  const scaled = image.scaleToFit(555, 802);
  page.drawImage(image, { x: 20, y: 20, width: scaled.width, height: scaled.height });
  return Buffer.from(await pdf.save());
}

async function expectPreview(page, timeout = 120_000) {
  await page.waitForFunction(() => {
    const preview = document.querySelector('[data-testid="cv-intake-preview"]');
    return Boolean(preview && preview.value.trim().length > 40);
  }, null, { timeout });
  return page.getByTestId('cv-intake-preview').inputValue();
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
    const local = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin !== origin) foreign.push(url.href);
      else local.push(url.pathname);
    });
    await page.goto(server.url, { waitUntil: 'domcontentloaded' });
    await seed(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /Enter the Suite/i }).first().click({ timeout: 20_000 });
    await page.getByRole('button', { name: /Profile & Settings/i }).first().click();
    await page.getByRole('button', { name: /Profile & CV/i }).click();

    const png = await photoPng(page);

    await page.getByTestId('cv-intake-file').setInputFiles({
      name: 'cv-photo.png', mimeType: 'image/png', buffer: png
    });
    const photoText = await expectPreview(page);
    assert.match(photoText, /Thandi/i);
    assert.match(photoText, /Mokoena/i);
    assert.match(photoText, /Cape Town/i);

    await waitForDocuments(page, 1);
    let stored = await vault(page);
    assert.equal(stored.documents.length, 1);
    assert.equal(stored.documents[0].mime, 'image/png');
    assert.match(stored.documents[0].text, /Mokoena/);

    await page.getByTestId('cv-intake-local').click();
    await page.getByTestId('cv-intake-review').waitFor({ timeout: 30_000 });
    assert.match(await page.getByTestId('cv-intake-fullName').inputValue(), /Thandi Mokoena/i);

    await page.getByTestId('cv-intake-save').click();
    await page.waitForFunction(async () => {
      const readProfile = () => new Promise((resolve, reject) => {
        const request = indexedDB.open('sajas-web');
        request.onsuccess = () => {
          const get = request.result.transaction('profile', 'readonly').objectStore('profile').get('current');
          get.onsuccess = () => resolve(get.result || {});
          get.onerror = () => reject(get.error);
        };
        request.onerror = () => reject(request.error);
      });
      return (await readProfile()).workHistory?.length === 1;
    }, null, { timeout: 20_000 });

    await page.getByTestId('cv-intake-file').setInputFiles({
      name: 'cv-scan.pdf', mimeType: 'application/pdf', buffer: await scannedPdf(png)
    });
    await waitForDocuments(page, 2);
    const scanText = await page.getByTestId('cv-intake-preview').inputValue();
    assert.match(scanText, /Thandi/i);
    assert.match(scanText, /Mokoena/i);

    stored = await vault(page);
    assert.equal(stored.documents.length, 2);
    const scanRecord = stored.documents.find((doc) => doc.mime === 'application/pdf');
    assert.ok(scanRecord.size > 1000, 'the scanned PDF bytes were not kept');
    assert.match(scanRecord.text, /Mokoena/);

    for (const asset of ['/ocr/worker.min.js', '/ocr/tesseract-core-simd-lstm.wasm.js', '/ocr/eng.traineddata.gz']) {
      assert.ok(local.includes(asset), `the local OCR asset ${asset} was never requested`);
    }
    assert.deepEqual(foreign, [], `requests left the local origin: ${foreign.join(', ')}`);
    console.log('web-cv-ocr: PASS');
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((error) => {
  console.error(`web-cv-ocr: FAIL - ${error.message}`);
  process.exitCode = 1;
});
