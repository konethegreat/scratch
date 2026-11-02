// Offline proof that the hosted app exposes the shared application-answer
// vocabulary, saves it to this browser, reloads it, and never asks for the
// server-only pending queue.
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
      const tx = db.transaction(['profile', 'answers', 'meta'], 'readwrite');
      tx.objectStore('profile').put({ fullName: 'Thandi Mokoena', v: 2 }, 'current');
      tx.objectStore('answers').put({
        id: 'q1', question: 'Notice period?', answer: 'One month', normalized: 'notice period'
      }, 'q1');
      tx.objectStore('meta').put({ onboarded: true }, 'app');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  });
}

async function profile(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('sajas-web');
    request.onsuccess = () => {
      const get = request.result.transaction('profile', 'readonly').objectStore('profile').get('current');
      get.onsuccess = () => resolve(get.result || {});
      get.onerror = () => reject(get.error);
    };
    request.onerror = () => reject(request.error);
  }));
}

async function countPendingCalls(page) {
  await page.evaluate(() => {
    const original = window.fetch;
    window.__pendingCalls = 0;
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (String(url).includes('/application/pending')) window.__pendingCalls += 1;
      return original(input, init);
    };
  });
}

async function openAnswers(page) {
  await page.getByRole('button', { name: /Profile & Settings/i }).first().click();
  await page.getByRole('button', { name: 'Application Answers', exact: true }).click();
  await page.getByRole('heading', { name: 'Standard application answers', exact: true }).waitFor({ timeout: 15_000 });
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

    await countPendingCalls(page);
    await openAnswers(page);

    // The whole vocabulary is on screen, including the questions that used to
    // live only in the desktop app.
    const licence = page.getByTestId('application-answer-driversLicense');
    assert.equal(await licence.evaluate((element) => element.tagName), 'SELECT');
    assert.ok((await licence.locator('option').allTextContents()).includes('Code EB'));
    for (const key of ['rightToWorkSA', 'noticePeriod', 'expectedSalary', 'highestQualification', 'languages', 'availabilityDate']) {
      assert.equal(await page.getByTestId(`application-answer-${key}`).count(), 1, `missing ${key}`);
    }

    // The imported answer bank shows, but its server delete control does not.
    assert.equal(await page.getByText('Saved answers (1)', { exact: true }).count(), 1);
    assert.equal(await page.getByTitle('Delete saved answer').count(), 0);
    assert.equal(await page.getByText('Questions to answer', { exact: false }).count(), 0);
    assert.equal(await page.evaluate(() => window.__pendingCalls), 0, 'the hosted app asked for the pending queue');

    await page.getByTestId('application-answer-noticePeriod').fill('30 days');
    await page.getByTestId('application-answer-expectedSalary').fill('R 55 000 per month');
    await page.getByTestId('application-answer-driversLicense').selectOption('Code B');
    await page.getByTestId('application-answer-languages').fill('English, isiZulu');
    await page.getByRole('button', { name: 'Save configuration', exact: true }).click();

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
      return (await readProfile()).applicationProfile?.noticePeriod === '30 days';
    }, null, { timeout: 15_000 });

    const saved = await profile(page);
    assert.deepEqual(saved.applicationProfile, {
      noticePeriod: '30 days',
      expectedSalary: 'R 55 000 per month',
      driversLicense: 'Code B',
      languages: 'English, isiZulu'
    });
    assert.equal(await page.evaluate(() => window.__pendingCalls), 0, 'saving asked for the pending queue');

    // A reload keeps the answers and still never syncs the pending queue.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /Enter the Suite/i }).first().click({ timeout: 20_000 });
    await countPendingCalls(page);
    await openAnswers(page);
    assert.equal(await page.getByTestId('application-answer-noticePeriod').inputValue(), '30 days');
    assert.equal(await page.getByTestId('application-answer-driversLicense').inputValue(), 'Code B');
    assert.equal(await page.evaluate(() => window.__pendingCalls), 0, 'the reload asked for the pending queue');

    assert.deepEqual(foreign, [], `requests left the local origin: ${foreign.join(', ')}`);
    console.log('web-answers: PASS');
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((error) => {
  console.error(`web-answers: FAIL - ${error.message}`);
  process.exitCode = 1;
});
