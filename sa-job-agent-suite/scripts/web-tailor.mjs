// Offline proof that web tailoring works end to end: key entry, a mocked
// Anthropic stream, saved documents, copy, print, the budget stop, support, and
// persistence. No request leaves the machine except the mocked Anthropic host.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startStaticServer } from './lib/staticServer.mjs';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'client/dist');
const KEY = ['sk', 'ant', 'api03', 'D'.repeat(40)].join('-');
const TODAY = new Date().toISOString().slice(0, 10);

const PROFILE = {
  fullName: 'Kone Tshivhinda',
  email: 'test@example.com',
  baseCv: 'Kone Tshivhinda. Software developer with ten years of experience building web systems and leading small teams in South Africa.',
  dailyBudgetUSD: 5,
  usePromptCaching: true
};

const JOB = {
  id: 'job-e2e', title: 'Full Stack Developer', company: 'Acme',
  location: 'Cape Town', description: 'Build web applications with React and Node.',
  applyUrl: 'https://example.com/apply', datePosted: '2026-10-20',
  matchScore: 88, status: 'found', notes: '', source: 'Manual',
  tailoredCvText: '', tailoredCoverLetterText: '', dateAdded: '2026-10-20'
};

function sse(text) {
  const chunks = text.match(/[\s\S]{1,24}/g) || [''];
  const events = [
    `event: message_start\ndata: ${JSON.stringify({
      type: 'message_start',
      message: {
        id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5',
        content: [], stop_reason: null, stop_sequence: null,
        usage: { input_tokens: 1200, output_tokens: 1 }
      }
    })}\n\n`,
    `event: content_block_start\ndata: ${JSON.stringify({
      type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' }
    })}\n\n`
  ];
  for (const chunk of chunks) {
    events.push(`event: content_block_delta\ndata: ${JSON.stringify({
      type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: chunk }
    })}\n\n`);
  }
  events.push(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`);
  events.push(`event: message_delta\ndata: ${JSON.stringify({
    type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 450 }
  })}\n\n`);
  events.push(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
  return events.join('');
}

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

async function forceBudget(page) {
  await page.evaluate(async ({ today }) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('sajas-web', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['profile', 'usage'], 'readwrite');
      const profiles = tx.objectStore('profile');
      const get = profiles.get('current');
      get.onsuccess = () => {
        profiles.put({ ...get.result, dailyBudgetUSD: 1 }, 'current');
        tx.objectStore('usage').put({
          days: {
            [today]: {
              calls: 1, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
              cacheWriteTokens: 0, webSearches: 0, estCostUSD: 25, byBucket: {}
            }
          }
        }, 'days');
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }, { today: TODAY });
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
    await context.addInitScript(() => { window.print = () => { window.__sajasPrinted = true; }; });

    const errors = [];
    const requests = [];
    const anthropicHeaders = [];
    const page = await context.newPage();
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('request', (request) => requests.push({ url: request.url(), body: request.postData() || '' }));

    await context.route('https://api.anthropic.com/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      anthropicHeaders.push(request.headers());
      if (url.pathname === '/v1/models') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
      let prompt = '';
      try { prompt = JSON.stringify(request.postDataJSON()?.messages || ''); } catch { /* no body */ }
      const text = prompt.includes('Tailored Cover Letter')
        ? '# Tailored Cover Letter\n\nDear Acme, I build reliable web systems.\n'
        : '# Tailored CV\n\nKone Tshivhinda\n\nBuilt web systems with React and Node.\n';
      return route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream', 'request-id': 'req_test' },
        body: sse(text)
      });
    });

    await page.goto(server.url, { waitUntil: 'networkidle' });
    await page.getByTestId('onboarding').waitFor({ timeout: 20_000 });
    await seed(page);

    await page.getByTestId('key-input').fill(KEY);
    await page.getByTestId('key-submit').click();
    await page.getByRole('button', { name: /Enter the Suite/i }).click({ timeout: 20_000 });

    const beforeTailor = requests.length;
    await page.getByRole('button', { name: /Document Tailor/i }).click();
    await page.getByRole('button', { name: /Full Stack Developer/i }).click();
    await page.getByTestId('optimise-cv').click();

    await page.getByTestId('tailored-cv').waitFor({ timeout: 60_000 });
    assert.match(await page.getByTestId('tailored-cv').locator('textarea').inputValue(), /# Tailored CV/);
    assert.match(await page.getByTestId('tailored-cover-letter').locator('textarea').inputValue(), /# Tailored Cover Letter/);
    assert.equal(await page.getByText('Your tailored CV and cover letter are ready.').count(), 1);

    // The Anthropic SDK must stay out of the initial bundle; the chunk is
    // fetched only when tailoring starts.
    const early = requests.slice(0, beforeTailor).map((request) => request.url);
    assert.equal(early.some((url) => /\/assets\/ai-[^/]+\.js$/.test(url)), false, 'the Anthropic SDK loaded before tailoring');

    await page.getByTestId('tailored-cv').getByRole('button', { name: /Copy/i }).click();
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(clipboard, /# Tailored CV/);

    const popupPromise = page.waitForEvent('popup');
    await page.getByTestId('tailored-cv').getByRole('button', { name: /Print/i }).click();
    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded');
    assert.match(await popup.locator('pre').textContent(), /# Tailored CV/);
    assert.equal(await popup.evaluate(() => window.__sajasPrinted), true);

    await forceBudget(page);
    await page.getByTestId('optimise-cv').click();
    const help = page.getByRole('link', { name: /Get help/i });
    await help.waitFor({ timeout: 20_000 });
    assert.match(await page.getByText(/Daily AI budget reached/i).first().textContent(), /Daily AI budget reached/);
    assert.match(await help.getAttribute('href'), /^mailto:erictshivhinda@gmail\.com/);
    assert.match(decodeURIComponent(await help.getAttribute('href')), /BUDGET_EXCEEDED/);
    assert.match(await page.getByTestId('tailored-cv').locator('textarea').inputValue(), /# Tailored CV/);

    await page.getByRole('button', { name: /Help & Support/i }).click();
    assert.ok(await page.locator('a[href="mailto:erictshivhinda@gmail.com"]').count() > 0);
    assert.ok(await page.locator('a[href="tel:+27813025435"]').count() > 0);
    assert.ok(await page.getByText('Common questions').count() > 0);
    assert.match(await page.getByTestId('support-report').getAttribute('href'), /^mailto:erictshivhinda@gmail\.com/);

    await page.getByRole('button', { name: /Home \/ About/i }).click();
    assert.ok(await page.getByRole('heading', { name: 'Support' }).count() > 0);
    assert.ok(await page.locator('#support a[href="mailto:erictshivhinda@gmail.com"]').count() > 0);

    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /Enter the Suite/i }).click({ timeout: 20_000 });
    await page.getByRole('button', { name: /Document Tailor/i }).click();
    await page.getByRole('button', { name: /Full Stack Developer/i }).click();
    assert.match(await page.getByTestId('tailored-cv').locator('textarea').inputValue(), /# Tailored CV/);

    assert.equal((await page.content()).includes(KEY), false, 'the key appeared in the DOM');
    const storage = await page.evaluate(async () => {
      const dump = { local: JSON.stringify(localStorage), session: JSON.stringify(sessionStorage) };
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('sajas-web', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const stores = ['profile', 'jobs', 'answers', 'memory', 'usage', 'meta', 'keyVault'];
      for (const store of stores) {
        dump[store] = await new Promise((resolve, reject) => {
          const tx = db.transaction(store, 'readonly').objectStore(store).getAll();
          tx.onsuccess = () => resolve(JSON.stringify(tx.result));
          tx.onerror = () => reject(tx.error);
        });
      }
      return dump;
    });
    assert.equal(JSON.stringify(storage).includes(KEY), false, 'the key reached persistent storage');

    for (const request of requests) {
      assert.equal(request.url.includes(KEY), false, 'the key appeared in a request URL');
      assert.equal(request.body.includes(KEY), false, 'the key appeared in a request body');
      assert.equal(request.url.startsWith('http://localhost:5000'), false, 'an API call escaped the in-page port');
    }
    assert.ok(anthropicHeaders.length >= 2, 'the Anthropic host was not called');
    for (const headers of anthropicHeaders) {
      assert.equal(headers['anthropic-dangerous-direct-browser-access'], 'true');
    }
    assert.deepEqual(errors, [], `console errors: ${errors.join(' | ')}`);

    console.log('web-tailor: ok');
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
