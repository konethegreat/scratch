import test from 'node:test';
import assert from 'node:assert/strict';
import { LEGAL_SECTIONS, LEGAL_UPDATED } from './legal.js';

test('the four required notices are present and in order', () => {
  assert.deepEqual(
    LEGAL_SECTIONS.map((section) => section.id),
    ['terms', 'privacy', 'ai', 'ownership']
  );
  assert.deepEqual(
    LEGAL_SECTIONS.map((section) => section.title),
    ['Terms of use', 'Privacy notice (POPIA)', 'AI disclaimer', 'Ownership and licence']
  );
});

test('every section is complete and readable', () => {
  const ids = new Set();
  for (const section of LEGAL_SECTIONS) {
    assert.equal(ids.has(section.id), false, `duplicate section id ${section.id}`);
    ids.add(section.id);
    assert.ok(section.title.length > 3, `${section.id} has no title`);
    assert.ok(section.summary.length > 10, `${section.id} has no summary`);
    assert.ok(section.clauses.length >= 4, `${section.id} has too few clauses`);
    const headings = new Set();
    for (const clause of section.clauses) {
      assert.ok(clause.heading.length > 3, `${section.id} has a clause without a heading`);
      assert.equal(headings.has(clause.heading), false, `${section.id} repeats the heading ${clause.heading}`);
      headings.add(clause.heading);
      assert.ok(clause.body.length >= 40, `${section.id} / ${clause.heading} is too short to be useful`);
      assert.match(clause.body, /\.$/, `${section.id} / ${clause.heading} does not end in a full stop`);
      assert.equal(/\b(TBD|TODO|lorem ipsum)\b/i.test(clause.body), false, `${section.id} / ${clause.heading} is unfinished`);
      assert.equal(/http:\/\//.test(clause.body), false, `${section.id} links an insecure URL`);
    }
  }
});

test('the notice date is a written date, not an ISO stamp', () => {
  assert.match(LEGAL_UPDATED, /^\d{1,2} [A-Z][a-z]+ \d{4}$/);
});

test('the privacy notice names the regulator and the right to complain', () => {
  const privacy = LEGAL_SECTIONS.find((section) => section.id === 'privacy');
  const text = privacy.clauses.map((clause) => clause.body).join(' ');
  assert.match(text, /Information Regulator/);
  assert.match(text, /inforegulator\.org\.za/);
});

test('the ownership notice separates the MIT code from the reserved branding', () => {
  const ownership = LEGAL_SECTIONS.find((section) => section.id === 'ownership');
  const text = ownership.clauses.map((clause) => clause.body).join(' ');
  assert.match(text, /MIT/);
  assert.match(text, /TRADEMARK\.md/);
});
