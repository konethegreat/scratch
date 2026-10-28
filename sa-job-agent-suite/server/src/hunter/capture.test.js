import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchTestBrowser } from '../testSupport/browser.js';
import {
  createCollector, installCapture, parseStateEntries, collectPageData
} from './capture.js';

const response = (url, type, body) => ({
  url: () => url,
  headers: () => (type ? { 'content-type': type } : {}),
  body: async () => Buffer.from(body)
});
const xml = 'https://jobs.test';

test('the collector keeps same-origin JSON and ignores the rest', async () => {
  const collector = createCollector({ origin: xml });
  collector.collect(response(`${xml}/api/jobs`, 'application/json; charset=utf-8', '[{"title":"Dev"}]'));
  collector.collect(response(`${xml}/api/feed`, 'application/ld+json', '{"a":1}'));
  collector.collect(response(`${xml}/api/page`, 'text/html', '<p>x</p>'));
  collector.collect(response('https://other.test/api/jobs', 'application/json', '[{"title":"No"}]'));
  await collector.settle();
  assert.equal(collector.payloads.length, 2);
  assert.equal(collector.payloads[0].kind, 'xhr');
  assert.deepEqual(collector.payloads[1].json, { a: 1 });
});

test('the collector caps responses, malformed bodies and body failures', async () => {
  const collector = createCollector({ origin: xml, limits: { maxResponses: 2, maxResponseBytes: 10, maxTotalBytes: 100 } });
  collector.collect(response(`${xml}/api/big`, 'application/json', '{"too":"large"}'));
  const broken = { url: () => `${xml}/api/broken`, headers: () => ({ 'content-type': 'application/json' }), body: async () => { throw new Error('detached'); } };
  collector.collect(broken);
  collector.collect(response(`${xml}/api/bad`, 'application/json', 'not json'));
  collector.collect(response(`${xml}/api/one`, 'application/json', '{"a":1}'));
  collector.collect(response(`${xml}/api/two`, 'application/json', '{"b":2}'));
  collector.collect(response(`${xml}/api/three`, 'application/json', '{"c":3}'));
  await collector.settle();
  assert.equal(collector.payloads.length, 2);
  assert.equal(collector.state.malformed, 1);
  assert.ok(collector.state.skipped >= 2);
});

test('the total cap stops collection', async () => {
  const collector = createCollector({ origin: xml, limits: { maxResponseBytes: 100, maxTotalBytes: 10 } });
  collector.collect(response(`${xml}/a`, 'application/json', '{"a":1}'));
  collector.collect(response(`${xml}/b`, 'application/json', '{"b":2}'));
  await collector.settle();
  assert.equal(collector.payloads.length, 1);
  assert.equal(collector.state.stopped, true);
});

test('state entries are parsed strictly and malformed payloads are counted', () => {
  const { payloads, malformed } = parseStateEntries([
    { kind: '__NEXT_DATA__', text: '{"props":{}}' },
    { kind: 'jsonld', text: '{"@type":"JobPosting"}' },
    { kind: 'jsonld', text: '{broken' },
    { kind: '__NUXT__', text: '   ' },
    { kind: '__APOLLO_STATE__', text: '[]' }
  ]);
  assert.equal(payloads.length, 3);
  assert.equal(payloads[0].kind, '__NEXT_DATA__');
  assert.equal(malformed, 1);
});

test('collectPageData never throws without a page or collector', async () => {
  assert.deepEqual(await collectPageData({}), { payloads: [], malformed: 0, skipped: 0, origin: '' });
  assert.deepEqual(await collectPageData({ page: { evaluate: async () => { throw new Error('no'); } }, collector: createCollector({ origin: xml }) }), {
    payloads: [], malformed: 0, skipped: 0, origin: 'https://jobs.test'
  });
});

let browser = null;
before(async () => { browser = await launchTestBrowser(); });
after(async () => { if (browser) await browser.close(); });

test('installCapture runs before navigation and collectPageData reads state and JSON-LD', async (t) => {
  if (!browser) return t.skip('no browser available');
  const context = await browser.newContext();
  const page = await context.newPage();
  const requests = [];
  await page.route('**/*', (route) => {
    const url = route.request().url();
    requests.push(url);
    if (url.endsWith('/api/jobs')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"jobs":[{"title":"Backend Developer"}]}' });
    }
    return route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<!doctype html><html><head><title>Jobs</title>
        <script type="application/ld+json">{"@type":"JobPosting","title":"Frontend Developer"}</script>
        <script id="__NEXT_DATA__" type="application/json">{"props":{"jobs":[]}}</script>
        </head><body><script>fetch('/api/jobs')</script></body></html>`
    });
  });
  try {
    const collector = createCollector({ origin: 'https://fixture.test' });
    const detach = installCapture(page, collector);
    await page.goto('https://fixture.test/jobs', { waitUntil: 'networkidle' });
    const captured = await collectPageData({ page, collector, origin: 'https://fixture.test' });
    detach();
    assert.ok(requests.includes('https://fixture.test/api/jobs'));
    assert.equal(captured.payloads.filter((p) => p.kind === 'xhr').length, 1);
    assert.equal(captured.payloads.filter((p) => p.kind === 'jsonld').length, 1);
    assert.equal(captured.payloads.filter((p) => p.kind === '__NEXT_DATA__').length, 1);
    assert.equal(captured.malformed, 0);
  } finally {
    await context.close();
  }
});
