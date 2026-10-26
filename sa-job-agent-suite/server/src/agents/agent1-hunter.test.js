// Tests for the registry-driven hunter pipeline. DB_PATH/KEYS_PATH must point at
// throwaway files BEFORE helper.js / agent1-hunter.js load. No test touches the
// network: the browser fulfils routed fixture HTML and the AI client is faked.
import test, { before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fakeClient } from '@sajas/core/testing';
import { MODEL_IDS } from '@sajas/core';
import { launchTestBrowser } from '../testSupport/browser.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sajas-hunter-'));
process.env.DB_PATH = path.join(dir, 'db.json');
process.env.KEYS_PATH = path.join(dir, 'keys.json');
delete process.env.SAJAS_DEMO_ORIGIN;

// Assembled at runtime: no key-shaped literals in the repo.
const KEY = 'sk-' + 'ant-api03-' + 'A'.repeat(40);

let agent1;
let helper;
let health;
let healthStore;
let browserLock;
let llm;
let browser = null;

before(async () => {
  helper = await import('../db/helper.js');
  health = await import('../hunter/health.js');
  healthStore = await import('../hunter/healthStore.js');
  browserLock = await import('../hunter/browserLock.js');
  llm = await import('./llm.js');
  agent1 = await import('./agent1-hunter.js');
  browser = await launchTestBrowser();
});

beforeEach(() => {
  llm.setClaudeClientForTests(null);
  agent1?.__setSourcesForTests?.(null);
  agent1?.__setContextForTests?.(null);
  agent1?.__setDelaysForTests?.(null);
  fs.rmSync(process.env.KEYS_PATH, { force: true });
  helper.writeDb({ ...helper.readDb(), jobs: [], sourceHealth: {} });
  helper.clearUsage();
  helper.setHunterState({ isRunning: false, stopRequested: false });
});

afterEach(() => {
  llm.setClaudeClientForTests(null);
  agent1?.__setSourcesForTests?.(null);
  agent1?.__setContextForTests?.(null);
  agent1?.__setDelaysForTests?.(null);
});

after(async () => {
  if (browser) await browser.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── fixtures ─────────────────────────────────────────────────────────────────

const card = (n, over = {}) => ({
  title: `Developer ${n}`,
  company: `Company ${n}`,
  location: 'Johannesburg',
  href: `/jobs/${n}`,
  ...over
});

const pageHtml = (cards, extra = '') => `<!doctype html><html><head><title>Fixture Jobs</title></head>
  <body><h1>Developer jobs</h1>
  ${cards.map((c) => `
    <div class="card">
      <a class="title" href="${c.href}">${c.title}</a>
      <span class="company">${c.company}</span>
      <span class="location">${c.location}</span>
    </div>`).join('\n')}
  ${extra}
  </body></html>`;

// Serialised into the page by Playwright, so it must stay self-contained.
function extractCards() {
  return Array.from(document.querySelectorAll('.card')).map((node) => {
    const link = node.querySelector('a.title');
    const absolute = link ? new URL(link.getAttribute('href') || '', document.baseURI).href : '';
    const company = node.querySelector('.company');
    const where = node.querySelector('.location');
    return {
      title: link ? link.textContent.trim() : '',
      company: company ? company.textContent.trim() : 'Confidential',
      location: where ? where.textContent.trim() : '',
      description: '',
      applyUrl: absolute,
      datePosted: 'Recently',
      source: 'Fixture Board'
    };
  });
}

// Serialised into the page by Playwright, so it must stay self-contained.
function fourLinklessCards() {
  return Array.from({ length: 4 }, (_, i) => ({
    title: `Developer ${i + 1}`,
    company: `Company ${i + 1}`,
    location: 'Johannesburg',
    description: '',
    applyUrl: '',
    datePosted: 'Recently',
    source: 'Linkless Board'
  }));
}

const fixtureSource = (over = {}) => {
  const id = over.id || 'fixture-board';
  const base = `https://fixture.test/${id}`;
  return {
    id,
    name: over.name || 'Fixture Board',
    tier: 'major',
    scope: over.scope || 'perLocation',
    origin: 'https://fixture.test',
    saCheck: over.saCheck || 'none',
    waitIdleMs: 0,
    pagination: { param: 'page', firstValue: 1, step: 1, verified: false },
    canary: { keyword: 'developer', location: 'Johannesburg', minItems: 1 },
    buildUrl: ({ keyword, location }, pageNo = 1) =>
      `${base}?q=${encodeURIComponent(keyword)}&l=${encodeURIComponent(location || '')}&page=${pageNo}`,
    extractInPage: extractCards,
    ...over
  };
};

const profile = (over = {}) => ({
  keywords: 'developer',
  locations: 'Johannesburg',
  maxKeywords: 10,
  maxLocations: 10,
  searchDepth: 'standard',
  useAiSearch: false,
  useLinkValidation: false,
  useLinkRepair: false,
  useAiExtractFallback: false,
  dailyBudgetUSD: 0,
  ...over
});

function resetDb(profileOverrides = {}) {
  helper.saveProfile(profile(profileOverrides));
  helper.writeDb({ ...helper.readDb(), jobs: [], sourceHealth: {} });
  helper.clearUsage();
  helper.setHunterState({ isRunning: false, stopRequested: false });
}

async function runHunter(t, { sources, handler, profile: profileOverrides = {}, seed } = {}) {
  if (!browser) {
    t.skip('no browser available');
    return null;
  }
  resetDb(profileOverrides);
  if (seed) seed();
  const context = await browser.newContext();
  try {
    await context.route('https://fixture.test/**', handler || ((route) => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: pageHtml([])
    })));
    agent1.__setSourcesForTests(sources);
    agent1.__setContextForTests(context);
    agent1.__setDelaysForTests({ betweenQueriesMs: 0, betweenSourcesMs: 0 });
    return await agent1.runJobHunterAgent();
  } finally {
    agent1.__setSourcesForTests(null);
    agent1.__setContextForTests(null);
    agent1.__setDelaysForTests(null);
    await context.close();
  }
}

const huntRun = (over = {}) => ({
  at: new Date().toISOString(),
  kind: 'hunt',
  pages: 1,
  raw: 5,
  withTitle: 5,
  withUrl: 5,
  withCompany: 5,
  withLocation: 5,
  httpStatus: 200,
  blocked: false,
  blockKind: null,
  error: null,
  ms: 1,
  via: 'dom',
  stopReason: 'page_cap',
  expectsUrl: true,
  ...over
});

const seedGoodBaseline = (id, { raw = 5, times = 2 } = {}) => {
  for (let i = 0; i < times; i++) healthStore.recordRun(id, huntRun({ raw }));
};

const savedJobs = () => helper.getJobs();

// ── pure helpers ─────────────────────────────────────────────────────────────

test('queriesFor expands perLocation sources over locations and others once per keyword', () => {
  const perLocation = { scope: 'perLocation' };
  const once = { scope: 'oncePerKeyword' };
  const none = { scope: 'noLocation' };

  assert.deepEqual(agent1.queriesFor(perLocation, ['dev', 'analyst'], ['Joburg', 'Cape Town']), [
    { keyword: 'dev', location: 'Joburg' },
    { keyword: 'dev', location: 'Cape Town' },
    { keyword: 'analyst', location: 'Joburg' },
    { keyword: 'analyst', location: 'Cape Town' }
  ]);
  assert.deepEqual(agent1.queriesFor(once, ['dev', 'analyst'], ['Joburg', 'Cape Town']), [
    { keyword: 'dev', location: null },
    { keyword: 'analyst', location: null }
  ]);
  assert.deepEqual(agent1.queriesFor(none, ['dev'], ['Joburg']), [
    { keyword: 'dev', location: null }
  ]);
});

test('sourceEnabled honours the health store\'s enabled flag', () => {
  assert.equal(agent1.sourceEnabled({}, 'fixture-enabled'), true);
  healthStore.setEnabled('fixture-enabled', false);
  assert.equal(agent1.sourceEnabled({}, 'fixture-enabled'), false);
  healthStore.setEnabled('fixture-enabled', true);
  assert.equal(agent1.sourceEnabled({}, 'fixture-enabled'), true);
});

// ── pipeline ─────────────────────────────────────────────────────────────────

test('a fixture source is crawled to the page cap and de-duplicated', async (t) => {
  const source = fixtureSource({ id: 'paged', name: 'Paged Board', scope: 'oncePerKeyword' });
  const pages = {
    1: [card(1), card(2), card(3)],
    2: [card(3), card(4)]
  };
  let fetched = 0;
  const result = await runHunter(t, {
    sources: [source],
    handler: (route) => {
      const url = new URL(route.request().url());
      const pageNo = Number(url.searchParams.get('page') || '1');
      fetched += 1;
      return route.fulfill({ status: 200, contentType: 'text/html', body: pageHtml(pages[pageNo] || []) });
    }
  });
  if (!result) return;

  assert.equal(fetched, 2, 'page 2 is fetched up to the standard depth cap');
  assert.equal(result.totalFound, 4, 'the duplicate card is counted once');
  assert.equal(result.totalSaved, 4);
  const stats = result.perSourceStats['Paged Board'];
  assert.equal(stats.pages, 2);
  assert.equal(stats.raw, 4);
  assert.equal(stats.saved, 4);
  assert.equal(stats.stopReason, 'page_cap');
  assert.equal(stats.via, 'dom');
  assert.equal(stats.status, 'healthy');
});

test('a source skipped by the circuit breaker is not browsed and is reported as skipped', async (t) => {
  const id = 'circuit-board';
  const source = fixtureSource({ id, name: 'Circuit Board', scope: 'oncePerKeyword' });
  const seed = () => {
    for (let i = 0; i < 3; i++) {
      healthStore.recordRun(id, huntRun({ raw: 0, withTitle: 0, withUrl: 0, withCompany: 0, withLocation: 0, error: 'layout broke' }));
    }
    const entry = healthStore.getHealthEntry(id);
    assert.equal(entry.circuit.open, true);
  };

  let browsed = 0;
  const result = await runHunter(t, {
    sources: [source],
    seed,
    handler: (route) => {
      browsed += 1;
      return route.fulfill({ status: 200, contentType: 'text/html', body: pageHtml([card(1)]) });
    }
  });
  if (!result) return;

  assert.equal(browsed, 0, 'a skipped source opens no page');
  assert.equal(result.totalFound, 0);
  assert.equal(result.totalSaved, 0);
  const stats = result.perSourceStats['Circuit Board'];
  assert.equal(stats.pages, 0);
  assert.equal(stats.raw, 0);
  assert.equal(stats.stopReason, 'skipped');
  assert.equal(stats.via, 'none');
  assert.equal(stats.status, 'broken');
  assert.match(stats.skipped, /circuit open/);
  assert.equal(healthStore.getHealthEntry(id).runs.length, 3, 'a skip does not append a run');
});

test('a source returning cards with no titles is recorded and shows broken afterwards', async (t) => {
  const id = 'untitled-board';
  const source = fixtureSource({
    id,
    name: 'Untitled Board',
    scope: 'oncePerKeyword',
    extractInPage: () => [{
      title: '',
      company: 'Acme',
      location: 'Johannesburg',
      description: '',
      applyUrl: 'https://fixture.test/jobs/untitled',
      datePosted: 'Recently'
    }]
  });
  const result = await runHunter(t, {
    sources: [source],
    handler: (route) => route.fulfill({ status: 200, contentType: 'text/html', body: pageHtml([]) })
  });
  if (!result) return;

  assert.equal(result.totalFound, 1);
  assert.equal(result.totalSaved, 0);
  assert.equal(result.perSourceStats['Untitled Board'].status, 'broken');
  const entry = healthStore.getHealthEntry(id);
  const run = entry.runs.at(-1);
  assert.equal(run.raw, 1);
  assert.equal(run.withTitle, 0);
  assert.equal(health.computeStatus(entry).status, 'broken');
});

test('a silent zero after a good baseline triggers the AI extractor (one request) and its anchor-verified jobs are saved with via ai-extract', async (t) => {
  const id = 'extractor-board';
  const source = fixtureSource({ id, name: 'Extractor Board', scope: 'oncePerKeyword' });
  const f = fakeClient([{
    id: 'msg_extract',
    type: 'message',
    role: 'assistant',
    model: MODEL_IDS.haiku,
    content: [{
      type: 'text',
      text: JSON.stringify({
        jobs: [{
          title: 'Senior Developer',
          company: 'Acme',
          location: 'Johannesburg',
          applyUrl: 'https://fixture.test/jobs/extracted',
          description: '',
          datePosted: ''
        }, {
          title: 'Invented Developer',
          company: 'Ghost',
          location: 'Johannesburg',
          applyUrl: 'https://invented.test/jobs/9',
          description: '',
          datePosted: ''
        }]
      })
    }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 5 }
  }]);
  llm.setClaudeClientForTests(f.client);

  const longText = 'Senior developer vacancies in Johannesburg with Acme and other employers. '.repeat(6);
  const result = await runHunter(t, {
    sources: [source],
    seed: () => seedGoodBaseline(id),
    profile: { useAiExtractFallback: true, anthropicApiKey: KEY },
    handler: (route) => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<!doctype html><html><head><title>Fixture Jobs</title></head><body>
        <p>${longText}</p>
        <a href="/jobs/extracted">Senior Developer at Acme</a>
      </body></html>`
    })
  });
  if (!result) return;

  assert.equal(f.calls.length, 1, 'exactly one extract request');
  assert.equal(result.totalSaved, 2);
  assert.equal(result.perSourceStats['Extractor Board'].via, 'ai-extract');
  const jobs = savedJobs();
  assert.equal(jobs.length, 2);
  const verified = jobs.find((j) => j.title === 'Senior Developer');
  assert.equal(verified.applyUrl, 'https://fixture.test/jobs/extracted');
  const invented = jobs.find((j) => j.title === 'Invented Developer');
  assert.equal(invented.applyUrl, '', 'the invented URL was dropped; the job stays as a lead');
});

test('with no key the zero stays zero, no request is made, and the source is recorded degraded/broken', async (t) => {
  const id = 'keyless-board';
  const source = fixtureSource({ id, name: 'Keyless Board', scope: 'oncePerKeyword' });
  const f = fakeClient([{ id: 'msg_unused', type: 'message', role: 'assistant', model: MODEL_IDS.haiku, content: [{ type: 'text', text: '{"jobs":[]}' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }]);
  llm.setClaudeClientForTests(f.client);

  const result = await runHunter(t, {
    sources: [source],
    seed: () => seedGoodBaseline(id),
    profile: { useAiExtractFallback: true }, // no key
    handler: (route) => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: pageHtml([], `<p>${'Nothing to see here. '.repeat(30)}</p>`)
    })
  });
  if (!result) return;

  assert.equal(f.calls.length, 0, 'no request without a key');
  assert.equal(result.totalFound, 0);
  assert.equal(result.totalSaved, 0);
  const stats = result.perSourceStats['Keyless Board'];
  assert.equal(stats.via, 'dom');
  assert.ok(['broken', 'degraded'].includes(stats.status), stats.status);
  assert.equal(healthStore.getHealthEntry(id).runs.at(-1).raw, 0);
});

test('stop requested mid-run halts before the next page and next source', async (t) => {
  const first = fixtureSource({ id: 'stop-a', name: 'Stop A', scope: 'oncePerKeyword' });
  const second = fixtureSource({ id: 'stop-b', name: 'Stop B', scope: 'oncePerKeyword' });
  const calls = { a: 0, b: 0 };
  const result = await runHunter(t, {
    sources: [first, second],
    profile: { searchDepth: 'deep' },
    handler: (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith('/stop-a')) {
        calls.a += 1;
        helper.setHunterState({ stopRequested: true });
        return route.fulfill({ status: 200, contentType: 'text/html', body: pageHtml([card(1)]) });
      }
      calls.b += 1;
      return route.fulfill({ status: 200, contentType: 'text/html', body: pageHtml([card(2)]) });
    }
  });
  if (!result) return;

  assert.equal(calls.a, 1, 'page 2 is not fetched after a stop request');
  assert.equal(calls.b, 0, 'the next source is not opened after a stop request');
  assert.equal(result.stopped, true);
  assert.equal(result.perSourceStats['Stop A'].stopReason, 'stopped');
  assert.equal('Stop B' in result.perSourceStats, false, 'a source never started has no stats');
});

test('a stop pressed before the first page records no run and leaves the source untested', async (t) => {
  const id = 'early-stop';
  let stopped = false;
  const source = fixtureSource({ id, name: 'Early Stop', scope: 'oncePerKeyword' });
  // The id accessor fires at the health read (line 517), after the per-source
  // stop check, so the run enters this source and then breaks at the query loop.
  Object.defineProperty(source, 'id', {
    configurable: true,
    get() {
      if (!stopped) {
        stopped = true;
        helper.setHunterState({ stopRequested: true });
      }
      return id;
    }
  });
  const second = fixtureSource({ id: 'after-stop', name: 'After Stop', scope: 'oncePerKeyword' });
  let requests = 0;
  const result = await runHunter(t, {
    sources: [source, second],
    handler: (route) => {
      requests += 1;
      return route.fulfill({ status: 200, contentType: 'text/html', body: pageHtml([card(1)]) });
    }
  });
  if (!result) return;

  assert.equal(healthStore.getHealthEntry(id).runs.length, 0, 'an early stop records no run');
  const stats = result.perSourceStats['Early Stop'];
  assert.equal(stats.pages, 0);
  assert.equal(stats.stopReason, 'stopped');
  assert.notEqual(stats.status, 'broken', 'an untested source is not broken');
  assert.equal(requests, 0, 'the next source makes no request');
});

test('a linkless source records expectsUrl:false and keeps no-link cards as healthy leads', async (t) => {
  const id = 'linkless-board';
  const source = fixtureSource({
    id,
    name: 'Linkless Board',
    scope: 'oncePerKeyword',
    linkless: true,
    skipJsonLd: true,
    extractInPage: fourLinklessCards
  });
  const result = await runHunter(t, {
    sources: [source],
    profile: { searchDepth: 'light' },
    handler: (route) => route.fulfill({ status: 200, contentType: 'text/html', body: pageHtml([]) })
  });
  if (!result) return;

  assert.equal(result.perSourceStats['Linkless Board'].status, 'healthy');
  assert.equal(result.totalSaved, 4, 'cards without links are kept as leads');
  const run = healthStore.getHealthEntry(id).runs.at(-1);
  assert.equal(run.expectsUrl, false);
  assert.equal(savedJobs().length, 4);
});

test('a throwing source does not stop the other sources', async (t) => {
  const bad = fixtureSource({
    id: 'throw-board',
    name: 'Throw Board',
    scope: 'oncePerKeyword',
    buildUrl: () => { throw new Error('boom'); }
  });
  const good = fixtureSource({ id: 'good-board', name: 'Good Board', scope: 'oncePerKeyword' });
  const result = await runHunter(t, {
    sources: [bad, good],
    handler: (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith('/good-board')) {
        return route.fulfill({ status: 200, contentType: 'text/html', body: pageHtml([card(7)]) });
      }
      return route.fulfill({ status: 200, contentType: 'text/html', body: pageHtml([]) });
    }
  });
  if (!result) return;

  assert.equal(result.totalSaved, 1, 'the healthy source still saves');
  assert.equal(result.perSourceStats['Throw Board'].status, 'broken');
  assert.equal(result.perSourceStats['Throw Board'].stopReason, 'error');
  assert.equal(result.perSourceStats['Good Board'].saved, 1);
  assert.equal(healthStore.getHealthEntry('good-board').runs.at(-1).raw, 1);
});

test('the hunter run holds the browser lock and releases it on failure', async (t) => {
  let ownerDuringBuild = null;
  let secondAcquire = null;
  const source = fixtureSource({
    id: 'lock-board',
    name: 'Lock Board',
    scope: 'oncePerKeyword',
    buildUrl: () => {
      ownerDuringBuild = browserLock.browserOwner();
      secondAcquire = browserLock.tryAcquireBrowser('apply');
      throw new Error('fail after the lock check');
    }
  });
  const result = await runHunter(t, { sources: [source] });
  if (!result) return;

  assert.equal(ownerDuringBuild, 'hunt');
  assert.equal(secondAcquire, null, 'another kind cannot take the lock mid-run');
  assert.equal(browserLock.browserOwner(), null, 'the failed run released the lock');
  const release = browserLock.tryAcquireBrowser('apply');
  assert.ok(release, 'the browser is free again');
  release();
});

test('SA filtering still rejects an explicitly foreign location for a strict source and keeps an unknown suburb for a soft source', async (t) => {
  const strict = fixtureSource({
    id: 'strict-board',
    name: 'Strict Board',
    scope: 'oncePerKeyword',
    saCheck: 'strict',
    extractInPage: () => [{
      title: 'Developer Lagos',
      company: 'Lagos Co',
      location: 'Lagos, Nigeria',
      description: '',
      applyUrl: 'https://fixture.test/jobs/lagos',
      datePosted: 'Recently'
    }]
  });
  const soft = fixtureSource({
    id: 'soft-board',
    name: 'Soft Board',
    scope: 'oncePerKeyword',
    saCheck: 'soft',
    extractInPage: () => [{
      title: 'Developer Somewhereville',
      company: 'Suburb Co',
      location: 'Somewhereville',
      description: '',
      applyUrl: 'https://fixture.test/jobs/suburb',
      datePosted: 'Recently'
    }]
  });
  const result = await runHunter(t, {
    sources: [strict, soft],
    handler: (route) => route.fulfill({ status: 200, contentType: 'text/html', body: pageHtml([]) })
  });
  if (!result) return;

  assert.equal(result.totalSaved, 1);
  const jobs = savedJobs();
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].title, 'Developer Somewhereville');
  assert.equal(result.perSourceStats['Strict Board'].saved, 0);
  assert.equal(result.perSourceStats['Soft Board'].saved, 1);
});
