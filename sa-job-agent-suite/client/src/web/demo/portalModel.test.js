import test from 'node:test';
import assert from 'node:assert/strict';
import { portalSections, withEdits, submissionFields } from './portalModel.js';

const fields = [
  { key: 'fullName', label: 'Full name', value: 'Naledi Mokoena', source: 'profile' },
  { key: 'email', label: 'Email address', value: 'naledi@example.test', source: 'profile' },
  { key: 'noticePeriod', label: 'Notice period', value: '30 days', source: 'profile' },
  { key: 'rightToWorkSA', label: 'Right to work in South Africa', value: 'Yes', source: 'profile' },
  { key: 'bank:credit-check', label: 'Do you consent to a credit check?', value: 'Yes', source: 'answer-bank' }
];

test('fields are grouped into details, eligibility and employer questions', () => {
  const sections = portalSections(fields);
  assert.deepEqual(sections.map((section) => section.id), ['identity', 'eligibility', 'employer']);
  assert.deepEqual(sections[0].fields.map((field) => field.key), ['fullName', 'email']);
  assert.deepEqual(sections[1].fields.map((field) => field.key), ['noticePeriod', 'rightToWorkSA']);
  assert.deepEqual(sections[2].fields.map((field) => field.key), ['bank:credit-check']);
});

test('edits replace only known fields and are trimmed', () => {
  const edited = withEdits(fields, {
    fullName: '  Naledi M. Mokoena  ',
    'bank:credit-check': 'No',
    unknown: 'ignored'
  });
  assert.equal(edited.length, fields.length);
  assert.equal(edited.find((field) => field.key === 'fullName').value, 'Naledi M. Mokoena');
  assert.equal(edited.find((field) => field.key === 'bank:credit-check').value, 'No');
  assert.equal(edited.find((field) => field.key === 'email').value, 'naledi@example.test');
  assert.equal(edited.some((field) => field.key === 'unknown'), false);
});

test('submission fields carry labels, values and drop empty rows', () => {
  const edited = withEdits(fields, { rightToWorkSA: '   ' });
  assert.deepEqual(submissionFields(edited), [
    { label: 'Full name', value: 'Naledi Mokoena' },
    { label: 'Email address', value: 'naledi@example.test' },
    { label: 'Notice period', value: '30 days' },
    { label: 'Do you consent to a credit check?', value: 'Yes' }
  ]);
});
