import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  crawlPages,
  pageCapForDepth,
  defaultKeyOf,
  PAGE_CAPS,
  DEFAULT_MIN_NEW_RATIO,
  DEFAULT_QUERY_TIME_BUDGET_MS,
} from './crawl.js';

const job = (id) => ({ title: `Job ${id}`, company: 'Acme', applyUrl: `https://example.test/jobs/${id}` });
const jobs = (...ids) => ids.map(job);

// Scripted fetchPage: pages[n-1] is the response for page n (empty page once the script ends).
function scripted(pages) {
  const calls = [];
  const fetchPage = async (pageNo) => {
    calls.push(pageNo);
    const page = pages[pageNo - 1];
    if (page instanceof Error) throw page;
    return page ?? { items: [] };
  };
  return { fetchPage, calls };
}
const noSleep = async () => {};

test('crawl: pageCapForDepth maps light/standard/deep and defaults to 2', () => {
  assert.equal(pageCapForDepth('light'), 1);
  assert.equal(pageCapForDepth('standard'), 2);
  assert.equal(pageCapForDepth('deep'), 4);
  assert.equal(pageCapForDepth('whatever'), 2);
  assert.equal(pageCapForDepth(undefined), 2);
  assert.equal(pageCapForDepth('toString'), 2); // no prototype-key leakage
  assert.deepEqual(PAGE_CAPS, { light: 1, standard: 2, deep: 4 });
  assert.equal(DEFAULT_MIN_NEW_RATIO, 0.25);
  assert.equal(DEFAULT_QUERY_TIME_BUDGET_MS, 60_000);
});

test('crawl: defaultKeyOf prefers the lower-cased applyUrl, else title::company', () => {
  assert.equal(defaultKeyOf({ applyUrl: 'HTTPS://Example.test/A', title: 'x', company: 'y' }), 'https://example.test/a');
  assert.equal(defaultKeyOf({ applyUrl: '', title: 'Dev', company: 'Acme' }), 'dev::acme');
  assert.equal(defaultKeyOf({ title: 'Dev' }), 'dev::');
});

test('crawl: fetches page 1 only when maxPages is 1 and reports page_cap', async () => {
  const { fetchPage, calls } = scripted([{ items: jobs(1, 2, 3) }, { items: jobs(4, 5, 6) }]);
  const r = await crawlPages({ fetchPage, maxPages: 1, sleep: noSleep });
  assert.deepEqual(calls, [1]);
  assert.equal(r.stopReason, 'page_cap');
  assert.equal(r.items.length, 3);
  assert.deepEqual(r.pages, [{ pageNo: 1, count: 3, newCount: 3 }]);
});

test('crawl: walks pages until an empty page and reports exhausted', async () => {
  const { fetchPage, calls } = scripted([{ items: jobs(1, 2) }, { items: jobs(3, 4) }, { items: [] }]);
  const r = await crawlPages({ fetchPage, maxPages: 5, sleep: noSleep });
  assert.deepEqual(calls, [1, 2, 3]);
  assert.equal(r.stopReason, 'exhausted');
  assert.equal(r.items.length, 4);
  assert.equal(r.pages.length, 3);
});

test('crawl: stops as saturated when a later page repeats the same items (0 new) and keeps earlier items', async () => {
  const { fetchPage, calls } = scripted([{ items: jobs(1, 2, 3, 4) }, { items: jobs(1, 2, 3, 4) }, { items: jobs(5) }]);
  const r = await crawlPages({ fetchPage, maxPages: 5, sleep: noSleep });
  assert.deepEqual(calls, [1, 2]);
  assert.equal(r.stopReason, 'saturated');
  assert.deepEqual(r.items.map((i) => i.title), ['Job 1', 'Job 2', 'Job 3', 'Job 4']);
  assert.deepEqual(r.pages.map((p) => p.newCount), [4, 0]);
});

test('crawl: a saturated page keeps its few new items', async () => {
  // 1 new of 5 = 0.2 < 0.25 -> saturated, but that new item is kept.
  const { fetchPage } = scripted([{ items: jobs(1, 2, 3, 4, 5) }, { items: jobs(1, 2, 3, 4, 6) }]);
  const r = await crawlPages({ fetchPage, maxPages: 5, sleep: noSleep });
  assert.equal(r.stopReason, 'saturated');
  assert.equal(r.items.length, 6);
});

test('crawl: a mostly-new second page is kept and the crawl continues', async () => {
  const { fetchPage, calls } = scripted([{ items: jobs(1, 2) }, { items: jobs(2, 3, 4, 5) }, { items: [] }]);
  const r = await crawlPages({ fetchPage, maxPages: 3, sleep: noSleep });
  assert.deepEqual(calls, [1, 2, 3]);
  assert.equal(r.stopReason, 'exhausted');
  assert.equal(r.items.length, 5);
  assert.deepEqual(r.pages.map((p) => p.newCount), [2, 3, 0]);
});

test('crawl: de-duplicates across pages preserving first occurrence order', async () => {
  const dupe = { ...job(2), title: 'Job 2 (later copy)' };
  const { fetchPage } = scripted([{ items: jobs(3, 2, 1) }, { items: [dupe, job(9), job(1)] }]);
  const r = await crawlPages({ fetchPage, maxPages: 2, sleep: noSleep });
  assert.deepEqual(r.items.map((i) => i.title), ['Job 3', 'Job 2', 'Job 1', 'Job 9']);
});

test('crawl: stops on a blocked page and returns what it had', async () => {
  const { fetchPage, calls } = scripted([
    { items: jobs(1, 2) },
    { items: [], meta: { blocked: true, blockKind: 'captcha' } },
    { items: jobs(3) },
  ]);
  const r = await crawlPages({ fetchPage, maxPages: 5, sleep: noSleep });
  assert.deepEqual(calls, [1, 2]);
  assert.equal(r.stopReason, 'blocked');
  assert.equal(r.items.length, 2);
  assert.equal(r.pages[1].meta.blockKind, 'captcha');
});

test('crawl: a blocked page contributes no items even if it returned some', async () => {
  const { fetchPage } = scripted([{ items: jobs(1), meta: { blocked: true } }]);
  const r = await crawlPages({ fetchPage, maxPages: 3, sleep: noSleep });
  assert.equal(r.stopReason, 'blocked');
  assert.deepEqual(r.items, []);
});

test('crawl: a thrown fetchPage on page 1 reports error with no items', async () => {
  const { fetchPage, calls } = scripted([new Error('boom')]);
  const r = await crawlPages({ fetchPage, maxPages: 3, sleep: noSleep });
  assert.deepEqual(calls, [1]);
  assert.equal(r.stopReason, 'error');
  assert.deepEqual(r.items, []);
  assert.deepEqual(r.pages, [{ pageNo: 1, count: 0, newCount: 0, meta: { error: 'boom' } }]);
});

test('crawl: a reported error alongside items still proceeds', async () => {
  const { fetchPage, calls } = scripted([{ items: jobs(1, 2), meta: { error: 'partial' } }, { items: [] }]);
  const r = await crawlPages({ fetchPage, maxPages: 3, sleep: noSleep });
  assert.deepEqual(calls, [1, 2]);
  assert.equal(r.stopReason, 'exhausted');
  assert.equal(r.items.length, 2);
});

test('crawl: stops when the time budget is exceeded (injected clock)', async () => {
  let t = 1000;
  const now = () => t;
  const calls = [];
  const fetchPage = async (pageNo) => {
    calls.push(pageNo);
    t += 40_000; // each page takes 40s
    return { items: [job(pageNo * 10), job(pageNo * 10 + 1)] };
  };
  const r = await crawlPages({ fetchPage, maxPages: 10, timeBudgetMs: 60_000, sleep: noSleep, now });
  assert.deepEqual(calls, [1, 2]); // 40s < 60s -> continue; 80s >= 60s -> stop
  assert.equal(r.stopReason, 'time');
  assert.equal(r.items.length, 4);
});

test('crawl: shouldStop before page 1 returns stopped without fetching', async () => {
  const { fetchPage, calls } = scripted([{ items: jobs(1) }]);
  const r = await crawlPages({ fetchPage, maxPages: 3, shouldStop: () => true, sleep: noSleep });
  assert.deepEqual(calls, []);
  assert.equal(r.stopReason, 'stopped');
  assert.deepEqual(r.items, []);
  assert.deepEqual(r.pages, []);
});

test('crawl: shouldStop between pages stops after the current page', async () => {
  let stop = false;
  const calls = [];
  const fetchPage = async (pageNo) => {
    calls.push(pageNo);
    if (pageNo === 2) stop = true; // user hits stop while page 2 is loading
    return { items: [job(pageNo * 10), job(pageNo * 10 + 1)] };
  };
  const r = await crawlPages({ fetchPage, maxPages: 5, shouldStop: () => stop, sleep: noSleep });
  assert.deepEqual(calls, [1, 2]);
  assert.equal(r.stopReason, 'stopped');
  assert.equal(r.items.length, 4); // page 2's items are kept
});

test('crawl: delay is applied between pages only (sleep called pageCount-1 times)', async () => {
  const sleeps = [];
  const { fetchPage, calls } = scripted([{ items: jobs(1, 2) }, { items: jobs(3, 4) }, { items: jobs(5, 6) }]);
  const r = await crawlPages({ fetchPage, maxPages: 3, delayMs: 750, sleep: async (ms) => { sleeps.push(ms); } });
  assert.deepEqual(calls, [1, 2, 3]);
  assert.equal(r.stopReason, 'page_cap');
  assert.deepEqual(sleeps, [750, 750]);
});

test('crawl: no sleep when delayMs is 0 or the crawl ends after page 1', async () => {
  let slept = 0;
  const sleep = async () => { slept += 1; };
  const a = scripted([{ items: jobs(1) }, { items: jobs(2) }]);
  await crawlPages({ fetchPage: a.fetchPage, maxPages: 2, sleep });
  const b = scripted([{ items: jobs(1) }]);
  await crawlPages({ fetchPage: b.fetchPage, maxPages: 1, delayMs: 500, sleep });
  assert.equal(slept, 0);
});

test('crawl: never fetches more than maxPages even if every page is full of new items', async () => {
  for (const maxPages of [1, 2, 4, 7]) {
    const calls = [];
    const fetchPage = async (pageNo) => {
      calls.push(pageNo);
      return { items: [job(pageNo * 100), job(pageNo * 100 + 1)] };
    };
    const r = await crawlPages({ fetchPage, maxPages, sleep: noSleep });
    assert.equal(calls.length, maxPages);
    assert.equal(r.stopReason, 'page_cap');
  }
});

test('crawl: a maxPages below 1 or not a finite number is clamped to a single page', async () => {
  for (const maxPages of [0, -3, NaN, undefined, Infinity]) {
    const { fetchPage, calls } = scripted([{ items: jobs(1, 2) }, { items: jobs(3, 4) }]);
    const r = await crawlPages({ fetchPage, maxPages, sleep: noSleep });
    assert.deepEqual(calls, [1], `maxPages=${maxPages}`);
    assert.equal(r.stopReason, 'page_cap');
  }
});

test('crawl: saturation is not evaluated on page 1', async () => {
  const { fetchPage } = scripted([{ items: [job(1), job(1), job(1), job(1)] }]);
  const r = await crawlPages({ fetchPage, maxPages: 3, sleep: noSleep });
  // Page 1 is full of duplicates but is never "saturated"; the crawl moves on and page 2 is empty.
  assert.equal(r.stopReason, 'exhausted');
  assert.equal(r.items.length, 1);
});

test('crawl: a custom keyOf is honoured', async () => {
  const { fetchPage } = scripted([
    { items: [{ id: 'a' }, { id: 'b' }] },
    { items: [{ id: 'a' }, { id: 'c' }, { id: 'd' }] },
  ]);
  const r = await crawlPages({ fetchPage, maxPages: 2, keyOf: (i) => i.id, sleep: noSleep });
  assert.deepEqual(r.items.map((i) => i.id), ['a', 'b', 'c', 'd']);
});
