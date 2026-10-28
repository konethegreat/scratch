import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApplyPacket, siteOf } from './packet.js';

const profile = {
  fullName: 'Thandi Mokoena',
  email: 'thandi@example.test',
  phone: '',
  linkedInUrl: 'https://www.linkedin.com/in/thandi',
  idNumber: '9001015000000',
  applicationProfile: {
    rightToWorkSA: 'Yes',
    currentSalary: 'R 45 000 per month',
    expectedSalary: '',
    noticePeriod: '30 days',
    eeRace: 'African'
  }
};

const job = { id: 'job-1', title: 'Developer', company: 'Example', applyUrl: 'https://ZA.Example.co.za/jobs/1' };

test('the packet carries declared identity and answers, never undeclared fields', () => {
  const packet = buildApplyPacket({ profile, job });
  assert.deepEqual(packet.identity.map((entry) => entry.key), ['fullName', 'email', 'linkedInUrl']);
  assert.deepEqual(packet.questions.map((entry) => entry.key), ['rightToWorkSA', 'eeRace', 'noticePeriod', 'currentSalary']);
  assert.equal(JSON.stringify(packet).includes('9001015000000'), false, 'an ID number reached the packet');
});

test('the packet names the site from the hostname, lowercased', () => {
  assert.equal(siteOf('https://ZA.Example.co.za/jobs/1'), 'za.example.co.za');
  assert.equal(siteOf('example.co.za/jobs/1'), 'example.co.za');
  assert.equal(siteOf(''), '');
  assert.equal(siteOf('not a url'), '');
  assert.equal(buildApplyPacket({ profile, job }).job.site, 'za.example.co.za');
});

test('saved answers are appended, deduplicated by question text, and labelled', () => {
  const packet = buildApplyPacket({
    profile,
    job,
    answerBank: [
      { question: 'Do you have a driver licence?', answer: 'Code B', normalized: 'driver licence' },
      { question: 'Notice period?', answer: 'Two weeks', normalized: 'notice period' },
      { question: 'Anything else?', answer: '', normalized: 'anything else' }
    ]
  });
  assert.deepEqual(packet.questions.slice(-1).map((entry) => entry.label), ['Do you have a driver licence?']);
  assert.equal(packet.questions.at(-1).source, 'answer-bank');
  assert.equal(packet.questions.filter((entry) => entry.label.toLowerCase().includes('notice')).length, 1);
});

test('missing essentials become plain-language warnings', () => {
  const packet = buildApplyPacket({ profile: {}, job: { id: 'j', title: 'T', company: 'C', applyUrl: '' } });
  assert.ok(packet.warnings.some((warning) => warning.includes('full name')));
  assert.ok(packet.warnings.some((warning) => warning.includes('email')));
  assert.ok(packet.warnings.some((warning) => warning.includes('current salary')));
  assert.ok(packet.warnings.some((warning) => warning.includes('No documents')));
  assert.ok(packet.warnings.some((warning) => warning.includes('no application link')));
});

test('values and labels are capped and documents list availability', () => {
  const packet = buildApplyPacket({
    profile: { fullName: 'N'.repeat(900), applicationProfile: { noticePeriod: 'V'.repeat(900) } },
    job,
    supportingDocs: [
      { key: 'cv', label: 'Tailored CV', fileName: 'cv.pdf', available: true },
      { key: 'id', label: 'ID Document / Passport', fileName: '', available: false }
    ]
  });
  assert.equal(packet.identity[0].value.length, 500);
  assert.equal(packet.questions[0].value.length, 500);
  assert.deepEqual(packet.documents.map((doc) => doc.available), [true, false]);
  assert.equal(packet.checklist.find((item) => item.key === 'documents-ready').done, false);
});
