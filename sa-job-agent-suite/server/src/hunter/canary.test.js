// canary.js records through healthStore, which reads DB_PATH at import time, so
// the temp paths are set BEFORE the dynamic imports.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchTestBrowser } from '../testSupport/browser.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sajas-canary-'));
process.env.DB_PATH = path.join(dir, 'db.json');
process.env.KEYS_PATH = path.join(dir, 'keys.json');

const { runCanary, runCanaries, canaryStartRefusal } = await import('./canary.js');
const store = await import('./healthStore.js');

let browser = null;
before(async () => { browser = await launchTestBrowser(); });
after(async () => {
  if (browser) await browser.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

// extractInPage is serialised into the page, so it must be self-contained.
const canarySource = (over = {}) => ({
  id: 'fixture',
  name: 'Fixture Board',
  tier: 'major',
  scope: 'perLocation',
  origin: 'https://fixture.test',
  waitIdleMs: 0,
  pagination: { param: 'page', firstValue: 1, step: 1, verified: false },
  canary: { keyword: 'developer', location: 'Johannesburg', minItems: 3 },
  buildUrl: (query, pageNo) => `https://fixture.test/jobs?k=${encodeURIComponent(query.keyword)}&p=${pageNo}`,
  extractInPage: () => Array.from(document.querySelectorAll('li.card')).map((li) => ({
    title: li.getAttribute('data-title') || '',
    company: 'Acme',
    location: 'Johannesburg',
    description: '',
    applyUrl: li.getAttribute('data-url') || '',
    datePosted: 'Recently',
    source: 'Fixture Board',
  })),
  ...over,
});

const html = (cards, title = 'Developer jobs') =>
  `<!doctype html><html><head><title>${title}</title></head><body><ul>${cards}</ul></body></html>`;
const card = (i, { title = `Developer ${i}`, url = `https://fixture.test/j/${i}` } = {}) =>
  `<li class="card" data-title="${title}" data-url="${url}"></li>`;
const fourCards = [1, 2, 3, 4].map((i) => card(i)).join('');

async function withPage(body, fn) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route('**/*', (route) => route.fulfill({ status: 200, contentType: 'text/html', body }));
  try {
    return await fn(page);
  } finally {
    await context.close();
  }
}

test('canary: a healthy fixture passes with raw >= minItems', async (t) => {
  if (!browser) return t.skip('no browser available');
  await withPage(html(fourCards), async (page) => {
    const result = await runCanary(page, canarySource());
    assert.equal(result.pass, true);
    assert.deepEqual(result.reasons, []);
    assert.equal(result.raw, 4);
    assert.equal(result.blocked, false);
    assert.equal(result.error, null);
    assert.equal(typeof result.ms, 'number');
    assert.ok(!Number.isNaN(Date.parse(result.at)));
  });
});

test('canary: a drifted fixture fails with the expected-at-least reason', async (t) => {
  if (!browser) return t.skip('no browser available');
  await withPage(html(card(1)), async (page) => {
    const result = await runCanary(page, canarySource());
    assert.equal(result.pass, false);
    assert.deepEqual(result.reasons, ['returned 1 items, expected at least 3']);
    assert.equal(result.raw, 1);
    assert.equal(result.blocked, false);
  });
});

test('canary: a challenge page fails as blocked and short-circuits the other checks', async (t) => {
  if (!browser) return t.skip('no browser available');
  await withPage(html(fourCards, 'Just a moment...'), async (page) => {
    const result = await runCanary(page, canarySource());
    assert.equal(result.pass, false);
    assert.deepEqual(result.reasons, ['blocked: challenge']);
    assert.equal(result.blocked, true);
    assert.equal(result.raw, 0);
    assert.equal(result.error, null);
  });
});

test('canary: cards missing a link fail the completeness check', async (t) => {
  if (!browser) return t.skip('no browser available');
  const cards = [
    card(1), card(2),
    card(3, { url: '' }), card(4, { url: '' }),
  ].join('');
  const source = canarySource({ canary: { keyword: 'developer', location: null, minItems: 1 } });
  await withPage(html(cards), async (page) => {
    const result = await runCanary(page, source);
    assert.equal(result.pass, false);
    assert.deepEqual(result.reasons, ['only 50% of items have title and link']);
    assert.equal(result.raw, 4);
  });
});

test('canary: a linkless source checks title completeness only', async (t) => {
  if (!browser) return t.skip('no browser available');
  const cards = [1, 2, 3].map((i) => card(i, { url: '' })).join('');
  const source = canarySource({ linkless: true });
  await withPage(html(cards), async (page) => {
    const result = await runCanary(page, source);
    assert.equal(result.pass, true, result.reasons.join('; '));
    assert.equal(result.raw, 3);
  });
});

test('canary: runCanary never throws, even with a missing page', async () => {
  const result = await runCanary(null, canarySource());
  assert.equal(result.pass, false);
  assert.equal(result.reasons.length, 1);
  assert.match(result.reasons[0], /^error: /);
  assert.equal(result.blocked, false);
  assert.equal(typeof result.error, 'string');
});

// A Node-side page double: extractInPage runs in-process, so it may close over
// `items` here (the real sources are serialised into the browser instead).
const nodePage = (items) => ({
  goto: async () => ({ status: () => 200 }),
  waitForLoadState: async () => {},
  title: async () => 'Developer jobs',
  url: () => 'https://fixture.test/jobs',
  evaluate: async (fn, arg) => (arg === undefined ? '' : fn(arg)),
  close: async () => {},
});

const cards = (n) => Array.from({ length: n }, (_, i) => ({
  title: `Developer ${i}`,
  company: 'Acme',
  location: 'Johannesburg',
  description: '',
  applyUrl: `https://fixture.test/j/${i}`,
  datePosted: 'Recently',
  source: 'Fixture Board',
}));

const nodeSource = (id, count) => ({
  ...canarySource(),
  id,
  name: `Fixture ${id}`,
  canary: { keyword: 'developer', location: 'Johannesburg', minItems: 2 },
  buildUrl: (query) => `https://fixture.test/${id}?k=${encodeURIComponent(query.keyword)}`,
  extractInPage: () => cards(count),
});

test('canary: runCanaries records results, skips disabled sources and calls onResult per source', async () => {
  const sources = [nodeSource('canary-a', 4), nodeSource('canary-b', 1), nodeSource('canary-off', 4)];
  store.setEnabled('canary-off', false);
  const closed = [];
  const newPage = async () => ({ ...nodePage(), close: async () => { closed.push(true); } });
  const sleeps = [];
  const seen = [];

  const results = await runCanaries({
    ids: ['canary-a', 'canary-b', 'canary-off'],
    newPage,
    sleep: async (ms) => { sleeps.push(ms); },
    onResult: (id, result) => seen.push([id, result.pass]),
    sources,
  });

  assert.deepEqual(Object.keys(results), ['canary-a', 'canary-b']);
  assert.equal(results['canary-a'].pass, true);
  assert.equal(results['canary-b'].pass, false);
  assert.deepEqual(results['canary-b'].reasons, ['returned 1 items, expected at least 2']);
  assert.equal(results['canary-off'], undefined, 'a disabled source is never tested');
  assert.deepEqual(seen, [['canary-a', true], ['canary-b', false]]);
  assert.deepEqual(sleeps, [2000], 'sources are 2 s apart, with no delay outside the pair');
  assert.equal(closed.length, 2, 'every page it opened is closed');

  const a = store.getHealthEntry('canary-a');
  assert.equal(a.canary.pass, true);
  assert.equal(a.runs.at(-1).kind, 'canary');
  assert.equal(a.runs.at(-1).raw, 4);
  const b = store.getHealthEntry('canary-b');
  assert.equal(b.canary.pass, false);
  assert.deepEqual(b.canary.reasons, ['returned 1 items, expected at least 2']);
  const off = store.getHealthEntry('canary-off');
  assert.equal(off.canary, null);
  assert.equal(off.runs.length, 0, 'a disabled source records nothing at all');
});

test('canary: a page that cannot be created is recorded as an error and the run continues', async () => {
  let calls = 0;
  const results = await runCanaries({
    sources: [nodeSource('canary-ok', 2), nodeSource('canary-crash', 2)],
    newPage: async () => {
      calls += 1;
      if (calls === 1) return nodePage();
      throw new Error('browser crashed');
    },
    sleep: async () => {},
  });
  assert.equal(results['canary-ok'].pass, true);
  assert.equal(results['canary-crash'].pass, false);
  assert.deepEqual(results['canary-crash'].reasons, ['error: browser crashed']);
  assert.equal(store.getHealthEntry('canary-crash').canary.pass, false);
});

test('canary: canaryStartRefusal prefers the running-test refusal, then the browser owner', () => {
  assert.equal(canaryStartRefusal({ testing: false, browserBusy: null }), null);
  assert.deepEqual(
    canaryStartRefusal({ testing: true, browserBusy: 'hunt' }),
    { status: 409, error: 'A source test is already running.' }
  );
  assert.deepEqual(
    canaryStartRefusal({ testing: false, browserBusy: 'hunt' }),
    { status: 409, error: 'A browser job is already running (hunt).' }
  );
});
