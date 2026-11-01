import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanSubmission, summariseSubmission, SUBMISSION_DELIVERIES } from './submission.js';

const packet = {
  job: { site: 'za.example.co.za' },
  identity: [{ key: 'fullName', label: 'Full name', value: 'Thandi Mokoena' }],
  questions: [{ key: 'noticePeriod', label: 'Notice period', value: '30 days', source: 'profile' }],
  documents: [
    { key: 'cv', label: 'Tailored CV', fileName: 'cv.pdf', available: true },
    { key: 'id', label: 'ID', fileName: '', available: false }
  ]
};

test('a web submission keeps delivery, site, available documents and packet fields', () => {
  const submission = summariseSubmission(packet, { delivery: 'web-guided' });
  assert.equal(submission.delivery, 'web-guided');
  assert.equal(submission.submittedBy, 'user');
  assert.equal(submission.site, 'za.example.co.za');
  assert.deepEqual(submission.documents.map((doc) => doc.key), ['cv']);
  assert.deepEqual(submission.fields, [
    { label: 'Full name', value: 'Thandi Mokoena' },
    { label: 'Notice period', value: '30 days' }
  ]);
  assert.equal(submission.confirmation, null);
});

test('an unknown delivery or submitter is rejected', () => {
  assert.throws(() => summariseSubmission(packet, { delivery: 'magic' }), /delivery/);
  assert.throws(() => summariseSubmission(packet, { delivery: SUBMISSION_DELIVERIES[0], submittedBy: 'robot' }), /submitter/);
});

test('submission data is capped and empty rows are dropped', () => {
  const clean = cleanSubmission({
    documents: Array.from({ length: 30 }, (_, index) => ({ key: `d${index}`, label: 'Doc', fileName: 'f.pdf' })),
    fields: Array.from({ length: 100 }, (_, index) => ({ label: `Field ${index}`, value: 'V'.repeat(900) })),
    confirmation: { confirmedAt: '2026-10-28T10:00:00.000Z', text: 'T'.repeat(900) }
  });
  assert.equal(clean.documents.length, 20);
  assert.equal(clean.fields.length, 80);
  assert.equal(clean.fields[0].value.length, 500);
  assert.equal(clean.confirmation.text.length, 500);
  assert.deepEqual(cleanSubmission({ fields: [{ label: '', value: '' }] }).fields, []);
});

test('an extension delivery is accepted and keeps the user as submitter', () => {
  const packet = {
    job: { site: 'acme.example.test' },
    documents: [{ key: 'cv', label: 'Tailored CV', fileName: 'cv.pdf', available: true }],
    identity: [], questions: []
  };
  const submission = summariseSubmission(packet, {
    delivery: 'extension',
    fields: [{ label: 'Email address', value: 'thandi@example.test' }],
    confirmation: { confirmedAt: '2026-11-01T10:00:00.000Z', text: 'Submit application' }
  });
  assert.equal(submission.delivery, 'extension');
  assert.equal(submission.submittedBy, 'user');
  assert.deepEqual(submission.fields, [{ label: 'Email address', value: 'thandi@example.test' }]);
  assert.equal(submission.confirmation.text, 'Submit application');
});

test('a v2 packet can supply explicit documents and edited fields', () => {
  const submission = summariseSubmission(
    { job: { site: 'bokamosobank.test' }, identity: [], questions: [], fields: [], attachments: [] },
    {
      delivery: 'web-guided',
      submittedBy: 'copilot-confirmed',
      fields: [{ label: 'Phone number', value: '011 555 0100' }],
      documents: [{ key: 'demo-doc-cv', label: 'Base CV', fileName: 'Naledi-Mokoena-CV.txt', available: true }]
    }
  );
  assert.equal(submission.site, 'bokamosobank.test');
  assert.deepEqual(submission.documents, [
    { key: 'demo-doc-cv', label: 'Base CV', fileName: 'Naledi-Mokoena-CV.txt' }
  ]);
  assert.deepEqual(submission.fields, [{ label: 'Phone number', value: '011 555 0100' }]);
  assert.equal(submission.submittedBy, 'copilot-confirmed');
});
