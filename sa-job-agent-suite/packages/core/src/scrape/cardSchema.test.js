import test from 'node:test';
import assert from 'node:assert/strict';
import { CARD_LIMITS, isHttpUrl, validateJobCard, validateJobCards } from './cardSchema.js';

const card = (over = {}) => ({
  title: 'Senior Developer',
  company: 'Acme',
  location: 'Cape Town',
  description: 'Build things.',
  applyUrl: 'https://example.test/j/1',
  datePosted: 'Today',
  source: 'Example Board',
  ...over
});

test('a complete card is accepted and trimmed', () => {
  const result = validateJobCard(card({ title: '  Senior Developer  ' }));
  assert.equal(result.ok, true);
  assert.equal(result.value.title, 'Senior Developer');
  assert.equal(result.value.applyUrl, 'https://example.test/j/1');
  assert.equal(result.value.company, 'Acme');
  assert.deepEqual(result.issues, []);
});

test('title is required and bounded', () => {
  assert.equal(validateJobCard(card({ title: '' })).ok, false);
  assert.equal(validateJobCard(card({ title: 'Dev' })).issues[0].code, 'title-required');
  assert.equal(validateJobCard(card({ title: 'D'.repeat(CARD_LIMITS.titleMax + 1) })).issues[0].code, 'title-too-long');
  assert.equal(validateJobCard({ title: 42, applyUrl: 'https://x.test/1' }).ok, false);
});

test('applyUrl is required unless the source is linkless', () => {
  assert.equal(validateJobCard(card({ applyUrl: '' })).issues[0].code, 'url-required');
  assert.equal(validateJobCard({ title: 'Senior Developer' }).issues[0].code, 'url-required');
  const linkless = validateJobCard({ title: 'Senior Developer' }, { linkless: true });
  assert.equal(linkless.ok, true);
  assert.equal('applyUrl' in linkless.value, false);
});

test('applyUrl must be an absolute http(s) link', () => {
  for (const bad of ['/jobs/1', 'jobs/1', 'ftp://x.test/1', 'javascript:alert(1)', 'https://', 'x'.repeat(CARD_LIMITS.urlMax + 1)]) {
    assert.equal(validateJobCard(card({ applyUrl: bad })).issues[0].code, 'url-invalid', bad);
  }
  assert.equal(isHttpUrl('https://example.test/a'), true);
  assert.equal(isHttpUrl('http://example.test/a'), true);
  assert.equal(isHttpUrl('HTTPS://EXAMPLE.TEST/A'), true);
});

test('optional fields are dropped when empty or over the cap', () => {
  const result = validateJobCard(card({
    company: 'C'.repeat(CARD_LIMITS.companyMax + 1),
    location: '   ',
    description: 'D'.repeat(CARD_LIMITS.descriptionMax + 1),
    datePosted: 'T'.repeat(CARD_LIMITS.datePostedMax + 1),
    source: 'S'.repeat(CARD_LIMITS.sourceMax + 1)
  }));
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.value).sort(), ['applyUrl', 'title']);
});

test('unknown fields and non-object rows are dropped or rejected', () => {
  const result = validateJobCard(card({ salary: 'R100', id: 9 }));
  assert.equal('salary' in result.value, false);
  assert.equal('id' in result.value, false);
  for (const bad of [null, undefined, 42, 'job', []]) {
    assert.equal(validateJobCard(bad).issues[0].code, 'invalid-row');
  }
});

test('validateJobCards separates valid rows and summarises rejections', () => {
  const result = validateJobCards([
    card(),
    card({ title: 'Dev', applyUrl: 'https://example.test/j/2' }),
    { title: 'Senior Developer' },
    card({ title: '', applyUrl: 'not a url' })
  ]);
  assert.equal(result.valid.length, 1);
  assert.equal(result.rejected.length, 3);
  assert.ok(result.rejectReasons.length <= 3);
  assert.ok(result.rejectReasons.every((reason) => typeof reason === 'string' && reason.length > 0));
});

test('validateJobCards never throws on a missing list', () => {
  for (const value of [null, undefined, 42, {}]) {
    assert.deepEqual(validateJobCards(value), { valid: [], rejected: [], rejectReasons: [] });
  }
});
