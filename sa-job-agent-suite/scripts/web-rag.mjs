// Offline proof that Ask Documents works end to end in the browser: local
// retrieval, a mocked Anthropic stream, citations, a no-match refusal, the
// document check, the budget stop, and no key to our origin.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startStaticServer } from './lib/staticServer.mjs';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'client/dist');
const KEY = ['sk', 'ant', 'api03', 'Q'.repeat(40)].join('-');
const TODAY = new Date().toISOString().slice(0, 10);

const PROFILE = {
  fullName: 'Kone Tshivhinda',
  email: 'test@example.com',
  baseCv: 'Kone Tshivhinda. Software developer with ten years of experience building web systems and leading small teams in South Africa.',
  applicationProfile: { noticePeriod: '30 days', rightToWorkSA: 'Yes' },
  dailyBudgetUSD: 5,
  usePromptCaching: true
};
const JOB = {
  id: 'job-e2e', title: 'Full Stack Developer', company: 'Acme',
  location: 'Cape Town', description: 'Build web applications with React and Node.',
  applyUrl: 'https://example.com/apply', datePosted: '2026-10-20',
  matchScore: 88, status: 'tailored', notes: '', source: 'Manual',
  tailoredCvText: 'Kone Tshivhinda. Tailored for Acme. Led a team of forty engineers at a payments company.',
  tailoredCoverLetterText: 'Dear Acme, I build reliable web systems and would welcome the conversation.',
  dateAdded: '2026-10-20'
};
const ANSWER = { id: 'ans-e2e', question: 'Notice period?', answer: '30 days.' };
const DECOY = 'Weekend hiking in the Drakensberg mountains and photographing birds.';
const MEMORY = {
  insights: [{ id: 'i1', category: 'preference', text: DECOY }],
  employers: [], applications: []
};

function sse(text) {
  const chunks = text.match(/[\s\S]{1,32}/g) || [''];
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

// Mock the retrieval header so every mocked answer cites a real chunk. The
// title and section never contain a pipe, which keeps the match on the real
// header instead of the example tag in the system prompt.
const TAG_RE = /\[Doc: ([^|\]]+?) \| Section: [^|]+? \| Chunk: (\d+) \| Version: [0-9a-f]+\]/;

async function seed(page) {
  await page.evaluate(async ({ profile, job, answer, memory }) => {
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
      const tx = db.transaction(['profile', 'jobs', 'answers', 'memory', 'meta'], 'readwrite');
      tx.objectStore('profile').put(profile, 'current');
      tx.objectStore('jobs').put(job, job.id);
      tx.objectStore('answers').put(answer, answer.id);
      tx.objectStore('memory').put(memory, 'dossier');
      tx.objectStore('meta').put({ onboarded: true }, 'app');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }, { profile: PROFILE, job: JOB, answer: ANSWER, memory: MEMORY });
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

    const errors = [];
    const requests = [];
    const anthropicHeaders = [];
    const anthropicBodies = [];
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
      const raw = request.postData() || '';
      anthropicBodies.push(raw);
      const tag = TAG_RE.exec(raw);
      assert.ok(tag, 'the request did not include a retrieved chunk header');
      const citation = `[Doc: ${tag[1]} | Chunk: ${tag[2]}]`;
      const text = raw.includes('[DOCUMENT UNDER REVIEW]')
        ? JSON.stringify({
          supported: false,
          unsupported_claims: ['Led a team of forty engineers at a payments company.'],
          cited_sources: [citation]
        })
        : JSON.stringify({
          is_supported_by_context: true,
          answer: `Kone has ten years of experience building web systems. ${citation}`,
          cited_sources: [citation]
        });
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

    await page.getByRole('button', { name: /Ask Documents/i }).click();
    await page.getByText(/documents? and \d+ passages? ready/).waitFor({ timeout: 20_000 });
    assert.match(await page.getByTestId('ask-status').textContent(), /documents? and \d+ passages? ready/);

    const beforeAsk = requests.length;
    await page.getByTestId('ask-question').fill('How many years of experience does Kone have?');
    await page.getByTestId('ask-submit').click();
    await page.getByTestId('ask-answer').waitFor({ timeout: 60_000 });
    assert.match(await page.getByTestId('ask-answer').textContent(), /ten years/);
    assert.ok(await page.getByTestId('ask-citations').count() === 1);

    const early = requests.slice(0, beforeAsk).map((request) => request.url);
    assert.equal(early.some((url) => /\/assets\/ai-[^/]+\.js$/.test(url)), false, 'the Anthropic SDK loaded before asking');
    assert.ok(requests.some((request) => /\/assets\/ai-[^/]+\.js$/.test(request.url)), 'the SDK chunk never loaded');

    const firstBody = anthropicBodies[0];
    assert.match(firstBody, /Kone Tshivhinda/);
    assert.equal(firstBody.includes(DECOY), false, 'an unrelated document reached the model');
    assert.equal(firstBody.includes('sk-ant-api03'), false, 'the key appeared in the mock request body');

    const callsBeforeRefusal = anthropicBodies.length;
    await page.getByTestId('ask-question').fill('zzzx qqqw');
    await page.getByTestId('ask-submit').click();
    await page.getByTestId('ask-refusal').waitFor({ timeout: 20_000 });
    assert.match(await page.getByTestId('ask-refusal').textContent(), /does not contain sufficient information/);
    assert.equal(anthropicBodies.length, callsBeforeRefusal, 'a no-match refusal called the model');

    await page.getByTestId('ask-check-job').selectOption(JOB.id);
    await page.getByTestId('ask-check-document').selectOption('cv');
    await page.getByTestId('ask-check-submit').click();
    await page.getByTestId('ask-check-result').waitFor({ timeout: 60_000 });
    assert.match(await page.getByTestId('ask-check-result').textContent(), /Led a team of forty engineers/);

    await forceBudget(page);
    const callsBeforeBudget = anthropicBodies.length;
    await page.getByTestId('ask-question').fill('How many years of experience does Kone have?');
    await page.getByTestId('ask-submit').click();
    await page.getByText(/Daily AI budget reached/i).first().waitFor({ timeout: 20_000 });
    assert.equal(anthropicBodies.length, callsBeforeBudget, 'a budget stop still called the model');
    const help = page.getByRole('link', { name: /Get help/i });
    assert.match(await help.getAttribute('href'), /^mailto:erictshivhinda@gmail\.com/);

    assert.equal((await page.content()).includes(KEY), false, 'the key appeared in the DOM');
    for (const request of requests) {
      assert.equal(request.url.includes(KEY), false, 'the key appeared in a request URL');
      assert.equal(request.body.includes(KEY), false, 'the key appeared in a request body');
    }
    assert.ok(anthropicHeaders.length >= 2, 'the Anthropic host was not called');
    for (const headers of anthropicHeaders) {
      assert.equal(headers['anthropic-dangerous-direct-browser-access'], 'true');
    }
    assert.deepEqual(errors, [], `console errors: ${errors.join(' | ')}`);

    console.log('web-rag: ok');
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
