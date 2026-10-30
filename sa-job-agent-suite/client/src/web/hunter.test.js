import test from 'node:test';
import assert from 'node:assert/strict';
import { planHunt, runHunt } from './hunter.js';

function job(title, company, location, extra = {}) {
  return {
    title,
    company,
    location,
    description: 'Build accessible interfaces with React and Node.',
    applyUrl: `https://${company.toLowerCase().replace(/\s+/g, '-')}.test/jobs`,
    source: 'remotive',
    datePosted: '2026-10-20',
    remote: false,
    tags: [],
    salaryText: '',
    ...extra
  };
}

test('planHunt dedupes, hides foreign rows and drops what the tracker holds', () => {
  const feedRows = [
    job('Frontend Engineer', 'Acme', 'Johannesburg'),
    job('Frontend Engineer', 'Acme', 'Johannesburg'),
    job('Backend Engineer', 'Karoo', 'Cape Town'),
    job('Designer', 'Studio Nine', 'Berlin')
  ];
  const plan = planHunt({
    profile: { keywords: 'frontend', locations: '', feedSaOnly: true },
    jobs: [{ title: 'Frontend Engineer', company: 'Acme' }],
    feeds: feedRows
  });
  assert.equal(plan.read, 3, 'the duplicate posting should merge');
  assert.equal(plan.hiddenForeign, 1);
  assert.equal(plan.matches, 1);
  assert.equal(plan.fresh.length, 0);
  assert.equal(plan.alreadyTracked, 1);
});

test('planHunt keeps every SA row when no keywords are set', () => {
  const plan = planHunt({
    profile: { keywords: '', locations: '' },
    jobs: [],
    feeds: [job('Frontend Engineer', 'Acme', 'Johannesburg'), job('Designer', 'Studio Nine', 'Berlin')]
  });
  assert.equal(plan.matches, 1);
  assert.equal(plan.fresh.length, 1);
  assert.equal(plan.hiddenForeign, 1);
});

test('runHunt saves fresh matches, counts races and reports per-source rows', async () => {
  const calls = [];
  const feeds = {
    loadAll: async ({ force }) => {
      assert.equal(force, true);
      return {
        results: [{
          source: 'remotive',
          label: 'Remotive',
          jobs: [
            job('Frontend Engineer', 'Acme', 'Cape Town'),
            job('Backend Engineer', 'Karoo', 'Durban'),
            job('Designer', 'Studio Nine', 'Berlin')
          ]
        }],
        errors: []
      };
    }
  };
  const result = await runHunt({
    feeds,
    profile: { keywords: 'engineer', locations: '' },
    jobs: [],
    save: async (entry) => {
      calls.push(entry.title);
      return entry.title === 'Backend Engineer' ? 'exists' : 'added';
    }
  });
  assert.deepEqual(calls.sort(), ['Backend Engineer', 'Frontend Engineer']);
  assert.equal(result.saved, 1);
  assert.equal(result.duplicates, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.matches, 2);
  assert.equal(result.read, 3);
  assert.deepEqual(result.perSource, [{ id: 'remotive', label: 'Remotive', count: 3 }]);
});

test('runHunt stops before saving the next job', async () => {
  let saved = 0;
  const result = await runHunt({
    feeds: {
      loadAll: async () => ({
        results: [{
          source: 'remotive',
          label: 'Remotive',
          jobs: [job('One Engineer', 'A', 'Cape Town'), job('Two Engineer', 'B', 'Cape Town')]
        }],
        errors: []
      })
    },
    profile: { keywords: 'engineer' },
    jobs: [],
    save: async () => { saved += 1; return 'added'; },
    isCancelled: () => saved >= 1
  });
  assert.equal(saved, 1);
  assert.equal(result.stopped, true);
  assert.equal(result.saved, 1);
});

test('runHunt reports when no feed answered', async () => {
  const result = await runHunt({
    feeds: {
      loadAll: async () => ({
        results: [],
        errors: [{ source: 'remotive', label: 'Remotive', error: { message: 'down' } }]
      })
    },
    profile: {},
    jobs: [],
    save: async () => 'added'
  });
  assert.equal(result.feeds, 0);
  assert.equal(result.read, 0);
  assert.equal(result.errors.length, 1);
});
