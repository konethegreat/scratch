import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_VIEW_FILTERS, normalizeViewFilters, filterJobsForView, activeFilterCount
} from './viewFilters.js';

const NOW = Date.parse('2026-10-28T12:00:00.000Z');

const job = (over = {}) => ({
  id: 'j1', title: 'Backend Developer', company: 'Acme', location: 'Cape Town',
  source: 'PNet', status: 'found', matchScore: 90, linkStatus: 'live',
  dateAdded: '2026-10-27', ...over
});

test('defaults are South Africa only and otherwise open', () => {
  assert.equal(DEFAULT_VIEW_FILTERS.saOnly, true);
  assert.deepEqual(normalizeViewFilters(undefined), { ...DEFAULT_VIEW_FILTERS });
});

test('normalizeViewFilters is total and rejects bad input', () => {
  assert.deepEqual(normalizeViewFilters(null), { ...DEFAULT_VIEW_FILTERS });
  assert.deepEqual(normalizeViewFilters('nonsense'), { ...DEFAULT_VIEW_FILTERS });
  assert.equal(normalizeViewFilters({ q: 42 }).q, '');
  assert.equal(normalizeViewFilters({ status: 'ghost' }).status, 'all');
  assert.equal(normalizeViewFilters({ province: 'Ghost' }).province, 'all');
  assert.equal(normalizeViewFilters({ province: 'Gauteng' }).province, 'Gauteng');
  assert.equal(normalizeViewFilters({ minScore: 'high' }).minScore, 0);
  assert.equal(normalizeViewFilters({ minScore: 240 }).minScore, 100);
  assert.equal(normalizeViewFilters({ minScore: -8 }).minScore, 0);
  assert.equal(normalizeViewFilters({ addedWithin: '99' }).addedWithin, 'any');
  assert.equal(normalizeViewFilters({ link: 'maybe' }).link, 'all');
  assert.equal(normalizeViewFilters({ remoteOnly: 'yes' }).remoteOnly, false);
  assert.equal(normalizeViewFilters({ saOnly: 'no' }).saOnly, true);
  assert.equal(normalizeViewFilters({ saOnly: false }).saOnly, false);
  assert.equal(normalizeViewFilters({ q: 'x'.repeat(500) }).q.length, 200);
});

test('foreign jobs are hidden and counted by default', () => {
  const rows = [job(), job({ id: 'j2', location: 'London, UK' })];
  const result = filterJobsForView(rows, DEFAULT_VIEW_FILTERS, NOW);
  assert.equal(result.visible.length, 1);
  assert.equal(result.hiddenForeign, 1);
  assert.equal(result.total, 2);
});

test('saOnly false reveals foreign jobs', () => {
  const rows = [job(), job({ id: 'j2', location: 'London, UK' })];
  const result = filterJobsForView(rows, { ...DEFAULT_VIEW_FILTERS, saOnly: false }, NOW);
  assert.equal(result.visible.length, 2);
  assert.equal(result.hiddenForeign, 0);
});

test('unknown locations stay visible', () => {
  const result = filterJobsForView([job({ location: 'Somewhereville' })], DEFAULT_VIEW_FILTERS, NOW);
  assert.equal(result.visible.length, 1);
});

test('search matches title, company, location and source', () => {
  const rows = [job(), job({ id: 'j2', title: 'Data Analyst', company: 'Beta', location: 'Durban', source: 'Indeed' })];
  assert.equal(filterJobsForView(rows, { q: 'analyst' }, NOW).visible.length, 1);
  assert.equal(filterJobsForView(rows, { q: 'beta' }, NOW).visible.length, 1);
  assert.equal(filterJobsForView(rows, { q: 'durban' }, NOW).visible.length, 1);
  assert.equal(filterJobsForView(rows, { q: 'indeed' }, NOW).visible.length, 1);
  assert.equal(filterJobsForView(rows, { q: 'zzz' }, NOW).visible.length, 0);
});

test('status, province and source filters combine', () => {
  const rows = [
    job(),
    job({ id: 'j2', location: 'Johannesburg', status: 'applied', source: 'Indeed' }),
    job({ id: 'j3', location: 'Durban', status: 'applied', source: 'PNet' })
  ];
  assert.equal(filterJobsForView(rows, { status: 'applied' }, NOW).visible.length, 2);
  assert.equal(filterJobsForView(rows, { province: 'Gauteng' }, NOW).visible.length, 1);
  assert.equal(filterJobsForView(rows, { province: 'KwaZulu-Natal' }, NOW).visible.length, 1);
  assert.equal(filterJobsForView(rows, { source: 'Indeed' }, NOW).visible.length, 1);
  assert.equal(filterJobsForView(rows, { status: 'applied', source: 'PNet' }, NOW).visible.length, 1);
});

test('stored province is trusted over the location text', () => {
  const result = filterJobsForView(
    [job({ location: 'London', province: 'Gauteng', locationVerdict: 'sa' })],
    { province: 'Gauteng' },
    NOW
  );
  assert.equal(result.visible.length, 1);
});

test('score, link, remote and date filters work', () => {
  const rows = [
    job(),
    job({ id: 'j2', matchScore: 55, linkStatus: 'dead', location: 'Durban' }),
    job({ id: 'j3', matchScore: 80, linkStatus: undefined, location: 'Remote', remote: true, dateAdded: '2026-10-10' })
  ];
  assert.equal(filterJobsForView(rows, { minScore: 80 }, NOW).visible.length, 2);
  assert.equal(filterJobsForView(rows, { link: 'live' }, NOW).visible.length, 1);
  assert.equal(filterJobsForView(rows, { link: 'no-link' }, NOW).visible.length, 2);
  assert.equal(filterJobsForView(rows, { remoteOnly: true }, NOW).visible.length, 1);
  assert.equal(filterJobsForView(rows, { addedWithin: '7' }, NOW).visible.length, 2);
  assert.equal(filterJobsForView(rows, { addedWithin: '30' }, NOW).visible.length, 3);
});

test('missing or invalid dates are kept only when the date filter is any', () => {
  const rows = [job({ dateAdded: undefined }), job({ id: 'j2', dateAdded: 'not-a-date' })];
  assert.equal(filterJobsForView(rows, { addedWithin: 'any' }, NOW).visible.length, 2);
  assert.equal(filterJobsForView(rows, { addedWithin: '7' }, NOW).visible.length, 0);
});

test('results keep the input order', () => {
  const rows = [job({ id: 'a', matchScore: 10 }), job({ id: 'b', matchScore: 90 })];
  assert.deepEqual(filterJobsForView(rows, {}, NOW).visible.map((row) => row.id), ['a', 'b']);
});

test('activeFilterCount counts deviations from the defaults', () => {
  assert.equal(activeFilterCount(DEFAULT_VIEW_FILTERS), 0);
  assert.equal(activeFilterCount({ q: 'dev' }), 1);
  assert.equal(activeFilterCount({ q: 'dev', minScore: 80, saOnly: false }), 3);
  assert.equal(activeFilterCount({ status: 'all', saOnly: true }), 0);
});
