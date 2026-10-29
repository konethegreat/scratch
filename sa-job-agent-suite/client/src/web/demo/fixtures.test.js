import test from 'node:test';
import assert from 'node:assert/strict';
import { createVault } from '../vault.js';
import { createMemoryAdapter } from '../memoryAdapter.js';
import { validateJobCards } from '@sajas/core/scrape';
import {
  DEMO_SEED_VERSION, DEMO_QUESTION, DEMO_PROFILE, DEMO_JOBS, DEMO_ANSWERS,
  DEMO_HUNTER_JOBS, DEMO_FEEDS, buildDemoSeed, seedDemoVault, tailoredDocuments
} from './fixtures.js';

test('every link and email uses a reserved .test domain', () => {
  const urls = [
    ...DEMO_JOBS.map((job) => job.applyUrl),
    ...DEMO_HUNTER_JOBS.map((job) => job.applyUrl),
    ...Object.values(DEMO_FEEDS).flat().map((job) => job.applyUrl),
    DEMO_PROFILE.linkedInUrl,
    DEMO_PROFILE.portfolioUrl
  ];
  for (const url of urls) assert.match(new URL(url).hostname, /\.test$/, url);
  assert.match(DEMO_PROFILE.email, /@example\.test$/);
});

test('no key-shaped string or real-looking contact detail appears', () => {
  const text = JSON.stringify({ DEMO_PROFILE, DEMO_JOBS, DEMO_ANSWERS, DEMO_HUNTER_JOBS, DEMO_FEEDS });
  assert.equal(/sk-ant-/.test(text), false);
  assert.equal(/\+27\s*\d{2}\s*\d{3}/.test(text), false, 'a real-looking phone number');
  for (const name of ['Mostoeneng', 'Kone']) assert.equal(text.includes(name), false);
});

test('the five fictional employers exist and the feeds include a foreign row', () => {
  const companies = new Set(DEMO_JOBS.map((job) => job.company));
  for (const name of ['Example Studio', 'Fable Fintech', 'Sample Logistics', 'Placeholder Health', 'Imaginary Retail']) {
    assert.ok(companies.has(name), name);
  }
  const rows = Object.values(DEMO_FEEDS).flat();
  assert.ok(rows.some((job) => !/south africa/i.test(job.location)), 'a foreign job for the SA filter');
});

test('every hunter job passes the shared card schema', () => {
  const result = validateJobCards(DEMO_HUNTER_JOBS);
  assert.equal(result.rejected.length, 0);
  assert.equal(result.valid.length, DEMO_HUNTER_JOBS.length);
});

test('the seed is versioned, onboarded and carries every store', () => {
  const seed = buildDemoSeed(new Date('2026-10-28T10:00:00Z'));
  assert.equal(seed.meta.app.demoSeed, DEMO_SEED_VERSION);
  assert.equal(seed.meta.app.onboarded, true);
  assert.match(seed.profile.current.baseCv, /accessibility dashboard/);
  assert.equal(Object.keys(seed.jobs).length, DEMO_JOBS.length);
  assert.ok(seed.usage.days['2026-10-28'].estCostUSD > 0);
  assert.ok(seed.activity.length > 0);
});

test('seeding is idempotent for a current version and rewrites a stale one', async () => {
  const fresh = createVault(createMemoryAdapter());
  assert.equal(await seedDemoVault(fresh, new Date('2026-10-28T10:00:00Z')), true);
  assert.equal(await seedDemoVault(fresh, new Date('2026-10-28T10:00:00Z')), false);
  const stale = createVault(createMemoryAdapter({ meta: { app: { demoSeed: 0 } } }));
  assert.equal(await seedDemoVault(stale, new Date('2026-10-28T10:00:00Z')), true);
  assert.equal((await stale.get('meta', 'app')).demoSeed, DEMO_SEED_VERSION);
});

test('tailored documents name the job and company', () => {
  const docs = tailoredDocuments({ title: 'Data Engineer', company: 'Sample Logistics' });
  assert.match(docs.tailoredCvText, /Data Engineer/);
  assert.match(docs.tailoredCvText, /Sample Logistics/);
  assert.match(docs.tailoredCoverLetterText, /Sample Logistics/);
  assert.equal(DEMO_QUESTION, 'Which fictional project would you like to discuss?');
});
