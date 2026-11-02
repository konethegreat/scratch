// Offline proof that a text CV is stored, read on this device with no key and
// no network beyond the local static server, reviewed, and saved without
// wiping fields the CV did not contain.
import assert from 'node:assert/strict';
import path from 'node:path';
import { startStaticServer } from './lib/staticServer.mjs';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'client/dist');
const CV_TEXT = [
  'Thandi Mokoena',
  'Senior Backend Engineer',
  'Cape Town',
  'thandi@example.test | +27 21 555 0100',
  '',
  'PROFILE',
  'Backend engineer with eight years building payment systems in South Africa.',
  '',
  'SKILLS',
  'Java, Spring Boot, PostgreSQL, AWS',
  '',
  'LANGUAGES',
  'English, isiXhosa',
  '',
  'EXPERIENCE',
  'Senior Backend Engineer | Acme Payments (Pty) Ltd | Cape Town',
  '2020 - Present',
  '- Led the payments platform migration.',
  'Backend Engineer | Beta Bank',
  '2016 - 2020',
  '- Built settlement services.',
  '',
  'EDUCATION',
  'BSc Computer Science, University of Cape Town, 2012'
].join('\n');

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
      tx.objectStore('profile').put({
        fullName: 'Thandi Mokoena',
        v: 2,
        skills: ['Excel'],
        baseCv: 'CV text that was already saved on this device.',
        certifications: [{ name: 'Old Cert', issuer: '', year: '' }]
      }, 'current');
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

    const stored = await vault(page);
    assert.equal(stored.documents.length, 1);
    assert.equal(stored.documents[0].text.includes('Senior Backend Engineer'), true);

    await page.getByTestId('cv-intake-local').click();
    await page.getByTestId('cv-intake-review').waitFor({ timeout: 15_000 });
    const review = await page.getByTestId('cv-intake-review').innerText();
    assert.match(review, /Read on this device\. Nothing was sent anywhere\./);
    assert.equal(await page.getByTestId('cv-intake-fullName').inputValue(), 'Thandi Mokoena');
    assert.equal(await page.getByTestId('cv-intake-email').inputValue(), 'thandi@example.test');
    assert.equal(await page.getByTestId('cv-intake-city').inputValue(), 'Cape Town');
    assert.match(await page.getByTestId('cv-intake-unread').innerText(), /certifications/);
    assert.match(review, /2 role\(s\)/);
    assert.match(review, /1 qualification\(s\)/);
    assert.match(review, /Java/);

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
      return (await readProfile()).workHistory?.length === 2;
    }, null, { timeout: 15_000 });

    const saved = (await vault(page)).profile;
    assert.equal(saved.fullName, 'Thandi Mokoena');
    assert.equal(saved.workHistory.length, 2);
    assert.equal(saved.workHistory[0].current, true);
    assert.equal(saved.workHistory[0].company, 'Acme Payments (Pty) Ltd');
    assert.equal(saved.workHistory[1].title, 'Backend Engineer');
    assert.equal(saved.education[0].institution, 'University of Cape Town');
    // Skills merge instead of replacing what was already on this device.
    assert.deepEqual([...saved.skills].sort(), ['AWS', 'Excel', 'Java', 'PostgreSQL', 'Spring Boot']);
    // A group the CV did not contain stays untouched, and so does a base CV
    // the person did not ask to replace.
    assert.equal(saved.certifications[0].name, 'Old Cert');
    assert.equal(saved.baseCv, 'CV text that was already saved on this device.');

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
