import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { SOURCES, getSource } from '../registry.js';
import { launchTestBrowser } from '../../testSupport/browser.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const RECORDED_DIR = path.join(FIXTURES, 'recorded');
const QUERY = { keyword: 'software engineer', location: 'Johannesburg' };

/**
 * Live pages recorded by `scripts/hunter-record.mjs` for one source:
 * `<id>.html` or `<id>-*.html`, sorted. A missing directory (ENOENT) yields []
 * because the directory is gitignored, so a fresh checkout has none; any other
 * readdir failure (e.g. EACCES) is rethrown so an unreadable directory fails
 * loudly instead of reading as "no recordings". `dir` is a test seam.
 */
export function recordedFixtures(sourceId, dir = RECORDED_DIR) {
  let names;
  try {
    names = readdirSync(dir);
  } catch (err) {
    if (err?.code === 'ENOENT') return [];
    throw err;
  }
  const exact = `${sourceId}.html`;
  const prefix = `${sourceId}-`;
  return names
    .filter((name) => name === exact || (name.startsWith(prefix) && name.endsWith('.html')))
    .sort()
    .map((name) => path.join(dir, name));
}

// Page-1 URLs copied from today's scrapers in agents/agent1-hunter.js for
// ("software engineer", "Johannesburg"). Later tasks add one line per source.
const EXPECTED_PAGE1_URL = {
  linkedin: 'https://www.linkedin.com/jobs/search/?keywords=software%20engineer&location=South+Africa&geoId=103644278&sortBy=DD&f_WT=1%2C2%2C3%2C4',
  indeed: 'https://za.indeed.com/jobs?q=software%20engineer&l=Johannesburg',
  pnet: 'https://www.pnet.co.za/jobs/?k=software%20engineer&l=Johannesburg',
  careerjunction: 'https://www.careerjunction.co.za/jobs/results/?k=software%20engineer&radius=50&l=Johannesburg',
  googlejobs: 'https://www.google.com/search?q=software%20engineer%20jobs%20Johannesburg%20South%20Africa&ibp=htl;jobs&gl=za&hl=en-ZA',
  adzuna: 'https://www.adzuna.co.za/search?q=software%20engineer&w=Johannesburg',
  executive: 'https://www.executiveplacements.com/JobList.asp?Keywords=software%20engineer',
  jobplacements: 'https://www.jobplacements.com/JobList.asp?Keywords=software%20engineer',
  govza: 'https://www.nationalgovernment.co.za/units/view/1/Government-Vacancies',
  jobmail: 'https://www.jobmail.co.za/search?keyword=software%20engineer&location=Johannesburg',
  jobscoza: 'https://www.jobs.co.za/search.html?q=software%20engineer&l=Johannesburg',
  gumtree: 'https://www.gumtree.co.za/s-jobs/v1c8p1/software-engineer/k0',
};

// Number of valid cards the synthetic fixture holds (noise cards are not counted).
const EXPECTED_FIXTURE_ITEMS = {
  linkedin: 4,
  indeed: 4,
  pnet: 4,
  careerjunction: 4,
  googlejobs: 4,
  adzuna: 4,
  executive: 4,
  jobplacements: 4,
  govza: 4,
  jobmail: 4,
  jobscoza: 4,
  gumtree: 4,
};

let browser = null;
before(async () => { browser = await launchTestBrowser(); });
after(async () => { if (browser) await browser.close(); });

async function extractFromPath(source, filePath) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    // Recorded pages are real site HTML: never let them fetch live subresources.
    await page.route('**/*', (route) => route.abort());
    await page.setContent(readFileSync(filePath, 'utf8'));
    return await page.evaluate(source.extractInPage, { keyword: QUERY.keyword, location: QUERY.location, origin: source.origin });
  } finally {
    await context.close();
  }
}

async function extractFrom(source, file) {
  return extractFromPath(source, path.join(FIXTURES, file));
}

test('recordedFixtures lists only this source\'s .html recordings, sorted, and tolerates a missing directory', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'sajas-recorded-'));
  try {
    for (const name of [
      'linkedin.html',
      'linkedin-20251231.html',
      'linkedin-20260101.html',
      'linkedin.drifted.html',
      'linkedin.txt',
      'indeed.html',
      'indeed-20260101.html',
      'pnet.html.bak'
    ]) {
      writeFileSync(path.join(tmp, name), '<html></html>');
    }
    assert.deepEqual(
      recordedFixtures('linkedin', tmp).map((file) => path.basename(file)),
      ['linkedin-20251231.html', 'linkedin-20260101.html', 'linkedin.html']
    );
    assert.deepEqual(recordedFixtures('gumtree', tmp), [], 'another source has no recordings here');
    // Only ENOENT means "no recordings yet"; any other readdir failure is real.
    assert.throws(
      () => recordedFixtures('linkedin', path.join(tmp, 'linkedin.html')),
      (err) => err.code !== 'ENOENT',
      'an unreadable path fails loudly instead of reading as empty'
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  assert.deepEqual(recordedFixtures('linkedin', path.join(os.tmpdir(), 'sajas-no-such-recorded-dir')), []);
});

test('contract: source ids are unique, names are unique, tier/scope/saCheck are valid', () => {
  assert.ok(SOURCES.length >= 1);
  assert.equal(new Set(SOURCES.map((s) => s.id)).size, SOURCES.length, 'duplicate id');
  assert.equal(new Set(SOURCES.map((s) => s.name)).size, SOURCES.length, 'duplicate name');
  for (const s of SOURCES) {
    assert.match(s.id, /^[a-z0-9-]+$/);
    assert.ok(['major', 'secondary'].includes(s.tier), `${s.id}: tier`);
    assert.ok(['perLocation', 'oncePerKeyword', 'noLocation'].includes(s.scope), `${s.id}: scope`);
    assert.ok(['strict', 'soft', 'none'].includes(s.saCheck), `${s.id}: saCheck`);
    assert.match(s.origin, /^https:\/\/[^/]+$/, `${s.id}: origin`);
    assert.ok(Number.isInteger(s.waitIdleMs) && s.waitIdleMs >= 0, `${s.id}: waitIdleMs`);
    assert.equal(typeof s.buildUrl, 'function');
    assert.equal(typeof s.extractInPage, 'function');
    for (const flag of ['skipJsonLd', 'needsLogin', 'linkless']) {
      if (flag in s) assert.equal(typeof s[flag], 'boolean', `${s.id}: ${flag} must be a boolean when present`);
    }
    assert.equal(s.pagination.verified, false, `${s.id}: pagination is unverified against live sites`);
    assert.ok(s.pagination.param === null || typeof s.pagination.param === 'string');
    assert.ok(Number.isInteger(s.pagination.firstValue) && Number.isInteger(s.pagination.step));
    assert.equal(typeof s.canary.keyword, 'string');
    assert.ok(s.canary.location === null || typeof s.canary.location === 'string');
    assert.ok(Number.isInteger(s.canary.minItems) && s.canary.minItems >= 1);
    assert.equal(getSource(s.id), s);
  }
  assert.equal(getSource('nope'), undefined);
});

for (const source of SOURCES) {
  test(`contract[${source.id}]: buildUrl page 1 matches the expected URL for ("software engineer","Johannesburg")`, () => {
    assert.ok(EXPECTED_PAGE1_URL[source.id], `add an expected URL for ${source.id}`);
    assert.equal(source.buildUrl(QUERY, 1), EXPECTED_PAGE1_URL[source.id]);
  });

  test(`contract[${source.id}]: buildUrl page 2 differs from page 1 when pagination.param is set`, () => {
    const p1 = source.buildUrl(QUERY, 1);
    const p2 = source.buildUrl(QUERY, 2);
    if (source.pagination.param) {
      assert.notEqual(p2, p1);
      const want = `${source.pagination.param}=${source.pagination.firstValue + source.pagination.step}`;
      assert.ok(p2.includes(want), `${p2} should contain ${want}`);
      // replaced or appended exactly once
      assert.equal(p2.split(`${source.pagination.param}=`).length, 2);
    } else {
      assert.equal(p2, p1);
    }
  });

  test(`contract[${source.id}]: extractInPage on the fixture returns >= 3 well-formed items`, async (t) => {
    if (!browser) return t.skip('no browser available');
    const file = `${source.id}.html`;
    assert.ok(existsSync(path.join(FIXTURES, file)), `missing fixture ${file}`);
    const items = await extractFrom(source, file);
    assert.ok(items.length >= 3, `expected >= 3 items, got ${items.length}`);
    assert.equal(items.length, EXPECTED_FIXTURE_ITEMS[source.id], 'noise cards must not be extracted');
    for (const item of items) {
      assert.ok(item.title && item.title.length > 3);
      assert.equal(typeof item.applyUrl, 'string', 'applyUrl is always a string');
      if (source.linkless) {
        // Linkless sources (Google Jobs) never expose a direct apply link.
        assert.equal(item.applyUrl, '', 'linkless sources emit an empty applyUrl');
      } else {
        assert.match(item.applyUrl, /^https?:\/\//, 'applyUrl is absolute');
      }
      assert.equal(item.source, source.name);
      for (const k of ['company', 'location', 'description', 'datePosted']) assert.equal(typeof item[k], 'string');
    }
  });

  test(`contract[${source.id}]: extractInPage on the drifted fixture returns 0 items (selectors no longer match)`, async (t) => {
    if (!browser) return t.skip('no browser available');
    const file = `${source.id}.drifted.html`;
    assert.ok(existsSync(path.join(FIXTURES, file)), `missing fixture ${file}`);
    assert.deepEqual(await extractFrom(source, file), []);
  });

  test(`contract[${source.id}]: recorded live pages (when present) yield >= 1 well-formed item each`, async (t) => {
    const files = recordedFixtures(source.id);
    if (!files.length) return t.skip(`no recorded fixtures for ${source.id}`);
    if (!browser) return t.skip('no browser available');
    for (const file of files) {
      const label = path.basename(file);
      const items = await extractFromPath(source, file);
      assert.ok(items.length >= 1, `${label}: expected >= 1 item, got ${items.length}`);
      for (const item of items) {
        assert.ok(typeof item.title === 'string' && item.title.trim().length > 0, `${label}: empty title`);
        assert.equal(typeof item.applyUrl, 'string', `${label}: applyUrl is always a string`);
        if (!source.linkless) {
          assert.match(item.applyUrl, /^https?:\/\//, `${label}: applyUrl is absolute`);
        }
      }
    }
  });
}
