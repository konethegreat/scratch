import test from 'node:test';
import assert from 'node:assert/strict';
import { matchFields, normaliseLabel } from './matcher.js';

const packet = {
  version: 2,
  packetId: 'p1',
  createdAt: '2026-11-01T10:00:00.000Z',
  job: { id: 'j1', title: 'Engineer', company: 'Acme', site: 'localhost', applyUrl: 'http://localhost/job' },
  identity: [],
  questions: [],
  fields: [
    { key: 'firstName', label: 'First name', value: 'Thandi', source: 'profile' },
    { key: 'lastName', label: 'Last name', value: 'Mokoena', source: 'profile' },
    { key: 'email', label: 'Email address', value: 'thandi@example.test', source: 'profile' },
    { key: 'noticePeriod', label: 'Notice period', value: '30 days', source: 'profile' },
    { key: 'expectedSalary', label: 'Expected salary', value: 'R 55 000 per month', source: 'profile' }
  ],
  attachments: [
    { key: 'tailored-cv', kind: 'tailored-cv', label: 'Tailored CV', fileName: 'thandi-cv.pdf', mime: 'application/pdf', size: 10, dataBase64: 'JVBERi0xLjQK' }
  ],
  checklist: [],
  warnings: []
};

const field = (over) => ({
  id: '', name: '', label: '', placeholder: '', autocomplete: '', type: 'text',
  required: false, visible: true, disabled: false, options: [], ...over
});

test('normaliseLabel folds case, punctuation and spacing', () => {
  assert.equal(normaliseLabel('  First   Name* '), 'first name');
  assert.equal(normaliseLabel('E-mail:'), 'e mail');
});

test('canonical labels and autocomplete tokens match', () => {
  const result = matchFields(packet, [
    field({ id: 'f1', label: 'First name' }),
    field({ id: 'f2', label: 'Surname' }),
    field({ id: 'f3', name: 'email', label: 'Your email address', autocomplete: 'email' }),
    field({ id: 'f4', label: 'Notice period (days)' }),
    field({ id: 'f5', label: 'Expected salary' })
  ]);
  assert.deepEqual(result.fills.map((fill) => [fill.fieldId, fill.key, fill.value]), [
    ['f1', 'firstName', 'Thandi'],
    ['f2', 'lastName', 'Mokoena'],
    ['f3', 'email', 'thandi@example.test'],
    ['f4', 'noticePeriod', '30 days'],
    ['f5', 'expectedSalary', 'R 55 000 per month']
  ]);
  assert.equal(result.skipped.length, 0);
});

test('unknown, sensitive, disabled, invisible and honeypot fields are skipped', () => {
  const result = matchFields(packet, [
    field({ id: 's1', label: 'Preferred pronouns' }),
    field({ id: 's2', label: 'Password', type: 'password' }),
    field({ id: 's3', label: 'First name', disabled: true }),
    field({ id: 's4', label: 'Email address', visible: false }),
    field({ id: 's5', label: 'Email address', name: '__hp_website' })
  ]);
  assert.deepEqual(result.fills, []);
  assert.deepEqual(result.skipped.map((skip) => [skip.fieldId, skip.reason]), [
    ['s1', 'unknown'],
    ['s2', 'sensitive'],
    ['s3', 'disabled'],
    ['s4', 'invisible'],
    ['s5', 'honeypot']
  ]);
});

test('selects and radios match by option label or value', () => {
  const withAnswers = {
    ...packet,
    fields: [
      ...packet.fields,
      { key: 'rightToWorkSA', label: 'Right to work in South Africa', value: 'Yes', source: 'profile' },
      { key: 'gender', label: 'Gender', value: 'Female', source: 'profile' }
    ]
  };
  const result = matchFields(withAnswers, [
    field({
      id: 'r1', label: 'Do you have the right to work in South Africa?', type: 'select',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]
    }),
    field({
      id: 'r2', label: 'Gender', type: 'radio',
      options: [{ value: 'Female', label: 'Female' }, { value: 'Male', label: 'Male' }]
    })
  ]);
  assert.equal(result.fills.find((fill) => fill.fieldId === 'r1').value, 'yes');
  assert.equal(result.fills.find((fill) => fill.fieldId === 'r2').value, 'Female');
});

test('a select with no matching option is not guessed', () => {
  const result = matchFields(packet, [
    field({
      id: 'q1', label: 'Expected salary', type: 'select',
      options: [{ value: 'junior', label: 'Junior band' }, { value: 'senior', label: 'Senior band' }]
    })
  ]);
  assert.deepEqual(result.fills, []);
  assert.equal(result.skipped[0].reason, 'no answer');
});

test('file inputs take the tailored CV and a matching document', () => {
  const withDocument = {
    ...packet,
    attachments: [
      ...packet.attachments,
      { key: 'doc-id', kind: 'document', label: 'Certified ID', fileName: 'id.pdf', mime: 'application/pdf', size: 4, dataBase64: 'JVBERi0=' }
    ]
  };
  const result = matchFields(withDocument, [
    field({ id: 'u1', label: 'Resume', type: 'file' }),
    field({ id: 'u2', label: 'Certified ID copy', type: 'file' }),
    field({ id: 'u3', label: 'Portfolio upload', type: 'file' })
  ]);
  assert.deepEqual(result.attachments, [
    { fieldId: 'u1', label: 'Resume', attachmentKey: 'tailored-cv' },
    { fieldId: 'u2', label: 'Certified ID copy', attachmentKey: 'doc-id' }
  ]);
  assert.deepEqual(result.skipped, [{ fieldId: 'u3', label: 'Portfolio upload', reason: 'no attachment' }]);
});

test('a CAPTCHA is reported and never filled', () => {
  const result = matchFields(packet, [field({ id: 'c1', label: 'I am not a robot', type: 'checkbox' })], { captcha: true });
  assert.equal(result.captcha, true);
  assert.deepEqual(result.fills, []);
  assert.equal(result.skipped[0].reason, 'captcha');
});
