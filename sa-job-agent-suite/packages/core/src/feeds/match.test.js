// packages/core/src/feeds/match.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeText, fingerprint, splitList, dedupeJobs, filterJobs, scoreJob, trackerFingerprints
} from './match.js';

const job = (over = {}) => ({
  source: 'remotive', sourceId: '1', title: 'Senior React Engineer', company: 'Acme Labs',
  location: 'Cape Town', description: 'React and Node.js', applyUrl: 'https://x.test/1',
  datePosted: '2026-10-20', remote: false, tags: [], salaryText: '', ...over
});

test('normalizeText lowercases, strips punctuation and diacritics', () => {
  assert.equal(normalizeText('  Développeur, Sénior  '), 'developpeur senior');
});

test('fingerprint ignores legal suffixes and punctuation', () => {
  assert.equal(fingerprint('Senior Dev', 'Acme (Pty) Ltd'), fingerprint('senior dev', 'ACME'));
  assert.equal(fingerprint('Senior Dev', 'Acme'), fingerprint('Senior-Dev', 'acme'));
});

test('splitList trims and drops empty entries', () => {
  assert.deepEqual(splitList(' React, Node ,, '), ['React', 'Node']);
  assert.deepEqual(splitList(''), []);
});

test('dedupe merges the same job from two sources', () => {
  const merged = dedupeJobs([
    job({ source: 'remotive', description: 'short' }),
    job({ source: 'jobicy', description: 'a much longer description', applyUrl: '' })
  ]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].sources, ['remotive', 'jobicy']);
  assert.equal(merged[0].description, 'a much longer description');
  assert.equal(merged[0].applyUrl, 'https://x.test/1');
});

test('score favours title hits and caps', () => {
  assert.equal(scoreJob(job(), []), 50);
  assert.equal(scoreJob(job(), ['react']), 25);
  assert.equal(scoreJob(job(), ['react', 'engineer', 'node']), 60);
});

test('filters match keywords and locations, including remote', () => {
  const rows = [job(), job({ title: 'Chef', company: 'Bistro', location: 'Durban', description: 'food' })];
  assert.equal(filterJobs(rows, { keywords: ['react'], locations: [] }).length, 1);
  assert.equal(filterJobs(rows, { keywords: [], locations: ['Cape Town'] }).length, 1);
  const remote = job({ location: 'Worldwide', remote: true });
  assert.equal(filterJobs([remote], { locations: ['remote'] }).length, 1);
  assert.equal(filterJobs(rows, { keywords: ['react'], locations: [], onlyMatches: false }).length, 2);
});

test('trackerFingerprints exposes a set of existing jobs', () => {
  const set = trackerFingerprints([job()]);
  assert.equal(set.has(fingerprint('Senior React Engineer', 'Acme Labs')), true);
});
