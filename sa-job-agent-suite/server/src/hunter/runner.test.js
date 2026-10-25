import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchTestBrowser } from '../testSupport/browser.js';
import { fetchSourcePage } from './runner.js';

let browser = null;
before(async () => { browser = await launchTestBrowser(); });
after(async () => { if (browser) await browser.close(); });

// A minimal source for the harness. extractInPage is serialised into the page,
// so it must be self-contained.
const fakeSource = {
  id: 'fake',
  name: 'Fake Board',
  origin: 'https://fixture.test',
  waitIdleMs: 50,
  pagination: { param: 'page', firstValue: 1, step: 1, verified: false },
  buildUrl: (q, pageNo) =>
    `https://fixture.test/jobs?k=${encodeURIComponent(q.keyword)}${pageNo > 1 ? `&page=${pageNo}` : ''}`,
  extractInPage: ({ location, origin }) =>
    Array.from(document.querySelectorAll('li.job')).map((li) => ({
      title: li.textContent.trim(),
      company: 'Acme',
      location: location || 'South Africa',
      description: '',
      applyUrl: origin + '/j/' + li.getAttribute('data-id'),
      datePosted: 'Recently',
      source: 'Fake Board',
    })),
};

const html = (title, body) => `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`;

async function withPage(handler, fn) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const requested = [];
  await page.route('**/*', (route) => {
    requested.push(route.request().url());
    return handler(route);
  });
  try {
    return await fn(page, requested);
  } finally {
    await context.close();
  }
}

test('runner: fetchSourcePage returns the extracted items and meta for a fixture page', async (t) => {
  if (!browser) return t.skip('no browser available');
  await withPage(
    (route) => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: html('Developer jobs', '<ul><li class="job" data-id="1">Dev One</li><li class="job" data-id="2">Dev Two</li></ul>'),
    }),
    async (page) => {
      const { items, meta } = await fetchSourcePage(page, fakeSource, { keyword: 'developer', location: 'Cape Town' }, 1);
      assert.equal(items.length, 2);
      assert.equal(items[0].title, 'Dev One');
      assert.equal(items[0].location, 'Cape Town');
      assert.equal(items[1].applyUrl, 'https://fixture.test/j/2');
      assert.equal(meta.url, 'https://fixture.test/jobs?k=developer');
      assert.equal(meta.title, 'Developer jobs');
      assert.equal(meta.httpStatus, 200);
      assert.equal(meta.blocked, false);
      assert.equal(meta.blockKind, null);
      assert.equal(meta.error, null);
      assert.equal(typeof meta.ms, 'number');
    },
  );
});

test('runner: a challenge page yields blocked with no items and no evaluate error', async (t) => {
  if (!browser) return t.skip('no browser available');
  const source = {
    ...fakeSource,
    extractInPage: () => { throw new Error('extractInPage must not run on a blocked page'); },
  };
  await withPage(
    (route) => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: html('Just a moment...', '<p>Checking your browser before accessing the site.</p>'),
    }),
    async (page) => {
      const { items, meta } = await fetchSourcePage(page, source, { keyword: 'developer', location: null }, 1);
      assert.deepEqual(items, []);
      assert.equal(meta.blocked, true);
      assert.equal(meta.blockKind, 'challenge');
      assert.equal(meta.error, null);
    },
  );
});

test('runner: a rate-limited response is blocked as rate-limit', async (t) => {
  if (!browser) return t.skip('no browser available');
  await withPage(
    (route) => route.fulfill({ status: 429, contentType: 'text/html', body: html('Slow down', '<p>Too many requests</p>') }),
    async (page) => {
      const { items, meta } = await fetchSourcePage(page, fakeSource, { keyword: 'developer', location: null }, 1);
      assert.deepEqual(items, []);
      assert.equal(meta.blocked, true);
      assert.equal(meta.blockKind, 'rate-limit');
      assert.equal(meta.httpStatus, 429);
    },
  );
});

test('runner: a navigation abort yields meta.error and does not throw', async (t) => {
  if (!browser) return t.skip('no browser available');
  await withPage(
    (route) => route.abort('connectionrefused'),
    async (page) => {
      const { items, meta } = await fetchSourcePage(page, fakeSource, { keyword: 'developer', location: null }, 1);
      assert.deepEqual(items, []);
      assert.equal(meta.blocked, false);
      assert.equal(typeof meta.error, 'string');
      assert.ok(meta.error.length > 0);
      assert.equal(meta.url, 'https://fixture.test/jobs?k=developer');
    },
  );
});

test('runner: a navigation timeout yields meta.error and does not throw', async (t) => {
  if (!browser) return t.skip('no browser available');
  await withPage(
    () => new Promise(() => {}), // never answers
    async (page) => {
      const { items, meta } = await fetchSourcePage(page, fakeSource, { keyword: 'developer', location: null }, 1, { timeoutMs: 300 });
      assert.deepEqual(items, []);
      assert.match(meta.error, /timeout/i);
    },
  );
});

test('runner: the page number is passed through buildUrl', async (t) => {
  if (!browser) return t.skip('no browser available');
  await withPage(
    (route) => route.fulfill({ status: 200, contentType: 'text/html', body: html('Page', '<ul><li class="job" data-id="9">Nine</li></ul>') }),
    async (page, requested) => {
      const { items, meta } = await fetchSourcePage(page, fakeSource, { keyword: 'developer', location: null }, 3);
      assert.equal(meta.url, 'https://fixture.test/jobs?k=developer&page=3');
      assert.ok(requested.includes('https://fixture.test/jobs?k=developer&page=3'));
      assert.equal(items.length, 1);
    },
  );
});
