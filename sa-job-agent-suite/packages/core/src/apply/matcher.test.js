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
  assert.equal(result.skipped[0].reason, 'no matching option');
});

test('reviewed question variants and common contact labels match', () => {
  const withAnswers = {
    ...packet,
    fields: [
      ...packet.fields,
      { key: 'phone', label: 'Phone number', value: '021 555 0100', source: 'profile' },
      { key: 'highestQualification', label: 'Highest qualification', value: 'BSc Computer Science', source: 'profile' },
      { key: 'driversLicense', label: "Driver's licence", value: 'Code B', source: 'profile' },
      { key: 'willingToRelocate', label: 'Willing to relocate', value: 'Yes', source: 'profile' },
      { key: 'rightToWorkSA', label: 'Right to work in South Africa', value: 'Yes', source: 'profile' },
      { key: 'yearsExperience', label: 'Years of experience', value: '5', source: 'profile' }
    ]
  };
  const result = matchFields(withAnswers, [
    field({ id: 'v1', label: 'Mobile phone number' }),
    field({ id: 'v2', label: 'Highest level of education' }),
    field({ id: 'v3', label: "Do you have a valid driver's licence?" }),
    field({ id: 'v4', label: 'Are you willing to relocate?' }),
    field({
      id: 'v5', label: 'SA citizen or permanent resident', type: 'select',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]
    }),
    field({
      id: 'v6', label: 'Years of relevant experience', type: 'select',
      options: [{ value: '0-2', label: '0-2 years' }, { value: '3-5', label: '3-5 years' }]
    })
  ]);
  assert.deepEqual(result.fills.map((fill) => [fill.fieldId, fill.key, fill.value]), [
    ['v1', 'phone', '021 555 0100'],
    ['v2', 'highestQualification', 'BSc Computer Science'],
    ['v3', 'driversLicense', 'Code B'],
    ['v4', 'willingToRelocate', 'Yes'],
    ['v5', 'rightToWorkSA', 'yes'],
    ['v6', 'yearsExperience', '3-5']
  ]);
});

test('broad, inverted and ambiguous labels are not guessed', () => {
  const result = matchFields(packet, [
    field({ id: 'x1', label: 'Company name' }),
    field({ id: 'x2', label: 'Name of previous employer' }),
    field({ id: 'x3', label: 'Do you require visa sponsorship?' }),
    field({ id: 'x4', label: 'Current salary expectation' })
  ]);
  assert.deepEqual(result.fills, []);
  assert.deepEqual(result.skipped.map((skip) => [skip.fieldId, skip.reason]), [
    ['x1', 'unknown'],
    ['x2', 'unknown'],
    ['x3', 'unknown'],
    ['x4', 'unknown']
  ]);
});

test('yes and no answers pick the page\'s own wording', () => {
  const withAnswers = {
    ...packet,
    fields: [
      ...packet.fields,
      { key: 'rightToWorkSA', label: 'Right to work in South Africa', value: 'Yes', source: 'profile' },
      { key: 'ownVehicle', label: 'Own vehicle', value: 'No', source: 'profile' }
    ]
  };
  const options = [
    { value: 'y', label: 'Yes, I do' },
    { value: 'n', label: 'No, I do not' }
  ];
  const result = matchFields(withAnswers, [
    field({ id: 'yn1', label: 'Do you have the right to work in South Africa?', type: 'radio', options }),
    field({ id: 'yn2', label: 'Do you have your own vehicle?', type: 'select', options })
  ]);
  assert.deepEqual(result.fills.map((fill) => [fill.fieldId, fill.value]), [['yn1', 'y'], ['yn2', 'n']]);
});

test('experience bands are read from the option itself, including its dash', () => {
  const withAnswer = (value) => ({
    ...packet,
    fields: [...packet.fields, { key: 'yearsExperience', label: 'Years of experience', value, source: 'profile' }]
  });
  const bands = [
    { value: '0-2', label: '0-2 years' },
    { value: '3-5', label: '3-5 years' },
    { value: '6+', label: '6+ years' }
  ];
  const choose = (value) => matchFields(withAnswer(value), [
    field({ id: 'ey', label: 'Years of relevant experience', type: 'select', options: bands })
  ]).fills[0]?.value;
  assert.equal(choose('2'), '0-2');
  assert.equal(choose('4'), '3-5');
  assert.equal(choose('9'), '6+');
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
