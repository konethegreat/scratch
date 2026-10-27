import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeRemotive } from './remotive.js';
import { normalizeArbeitnow } from './arbeitnow.js';
import { normalizeJobicy } from './jobicy.js';
import { FEED_SOURCES, sourceById } from './index.js';

const fixture = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));

test('remotive fixture normalizes every row', () => {
  const rows = normalizeRemotive(fixture('remotive'));
  assert.equal(rows.length, 3);
  assert.equal(rows[0].title, 'Senior Frontend Engineer');
  assert.equal(rows[0].company, 'Acme Labs');
  assert.equal(rows[0].datePosted, '2026-10-20');
  assert.equal(rows[0].applyUrl, 'https://remotive.com/remote-jobs/software-development/senior-frontend-engineer-1001');
  assert.match(rows[0].description, /React/);
  assert.equal(rows[0].remote, true);
});

test('arbeitnow fixture normalizes unix dates and remote flags', () => {
  const rows = normalizeArbeitnow(fixture('arbeitnow'));
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.sourceId), ['backend-engineer-cape-town-123', 'support-engineer-remote-456']);
  assert.equal(rows[0].datePosted, '2025-10-20');
  assert.equal(rows[1].remote, true);
});

test('jobicy fixture normalizes salary text', () => {
  const rows = normalizeJobicy(fixture('jobicy'));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].salaryText, 'USD 60 000 - 80 000');
});

test('a missing root array is a FeedShapeError', () => {
  assert.throws(() => normalizeRemotive({}), /Remotive/);
  assert.throws(() => normalizeArbeitnow({ jobs: [] }), /Arbeitnow/);
  assert.throws(() => normalizeJobicy({ jobs: {} }), /Jobicy/);
});

test('an empty array is a valid empty result', () => {
  assert.deepEqual(normalizeRemotive({ jobs: [] }), []);
});

test('invalid rows are dropped and fields are bounded', () => {
  const rows = normalizeRemotive({ jobs: [
    { id: 1, title: '', company_name: 'No title' },
    { id: 2, title: 'Dev', company_name: 'Acme', url: 'javascript:alert(1)', tags: 'not-an-array' }
  ] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].applyUrl, '');
  assert.deepEqual(rows[0].tags, []);
});

test('the registry exposes three sources with unique ids', () => {
  assert.deepEqual(FEED_SOURCES.map((source) => source.id), ['remotive', 'arbeitnow', 'jobicy']);
  assert.equal(sourceById('jobicy').label, 'Jobicy');
  assert.equal(sourceById('nope'), null);
});
