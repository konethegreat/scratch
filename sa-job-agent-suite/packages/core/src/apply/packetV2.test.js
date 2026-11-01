import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_ATTACHMENTS, PACKET_VERSION, buildApplyPacketV2, sanitisePacketV2
} from './packetV2.js';

const bytes = (text) => new TextEncoder().encode(text);
const profile = {
  v: 2,
  fullName: 'Thandi Mokoena',
  preferredName: 'Thandi',
  email: 'thandi@example.test',
  phone: '071 000 0000',
  linkedInUrl: 'https://linkedin.com/in/thandi',
  eeOptIn: false,
  yearsExperience: 8,
  highestQualification: 'BSc Computer Science',
  address: { city: 'Cape Town', province: 'Western Cape', postalCode: '8001' },
  salary: { currentAmount: 55000, currentPeriod: 'month', expectedAmount: 720000, expectedPeriod: 'year' },
  workHistory: [
    { company: 'Yoco', title: 'Senior Engineer', current: true },
    { company: 'Old Co', title: 'Engineer', current: false }
  ],
  applicationProfile: { noticePeriod: '30 days', eeRace: 'African', rightToWorkSA: 'Yes' }
};
const job = { id: 'j1', title: 'Backend Engineer', company: 'Acme', applyUrl: 'https://acme.example.test/jobs/1', tailoredCvText: '# CV' };

test('packet v2 carries version, id, canonical fields and formatted salaries', () => {
  const packet = buildApplyPacketV2({
    profile, job,
    now: () => new Date('2026-11-01T10:00:00.000Z'),
    newId: () => 'packet-1'
  });
  assert.equal(packet.version, PACKET_VERSION);
  assert.equal(packet.packetId, 'packet-1');
  assert.equal(packet.createdAt, '2026-11-01T10:00:00.000Z');
  assert.equal(packet.job.site, 'acme.example.test');
  assert.equal(packet.job.applyUrl, 'https://acme.example.test/jobs/1');
  const field = (key) => packet.fields.find((entry) => entry.key === key);
  assert.equal(field('firstName').value, 'Thandi');
  assert.equal(field('lastName').value, 'Mokoena');
  assert.equal(field('city').value, 'Cape Town');
  assert.equal(field('country').value, 'South Africa');
  assert.equal(field('currentCompany').value, 'Yoco');
  assert.equal(field('currentSalary').value, 'R 55 000 per month');
  assert.equal(field('expectedSalary').value, 'R 720 000 per year');
  assert.equal(field('noticePeriod').value, '30 days');
  assert.equal(field('rightToWorkSA').value, 'Yes');
  assert.equal(field('eeRace'), undefined, 'EE appeared without opt-in');
  assert.equal(JSON.stringify(packet).includes('anthropicApiKey'), false);
});

test('EE fields appear only after an explicit opt-in', () => {
  const packet = buildApplyPacketV2({ profile: { ...profile, eeOptIn: true }, job });
  assert.equal(packet.fields.find((entry) => entry.key === 'eeRace').value, 'African');
});

test('saved answers become canonical matcher fields once', () => {
  const packet = buildApplyPacketV2({
    profile, job,
    answerBank: [
      { question: 'Do you own a vehicle?', answer: 'Yes', normalized: 'own a vehicle' },
      { question: 'Notice period?', answer: 'Two weeks', normalized: 'notice period' }
    ]
  });
  assert.equal(packet.fields.filter((entry) => entry.key === 'bank:own a vehicle').length, 1);
  assert.equal(packet.fields.filter((entry) => entry.label.toLowerCase() === 'notice period?').length, 0);
});

test('attachments are validated, base64 encoded and capped', () => {
  const packet = buildApplyPacketV2({
    profile, job,
    attachments: [
      { key: 'tailored-cv', kind: 'tailored-cv', label: 'Tailored CV', fileName: 'cv.pdf', mime: 'application/pdf', bytes: bytes('%PDF-1.7\nCV') },
      { key: 'doc-1', kind: 'document', label: 'ID copy', fileName: 'id.pdf', mime: 'application/pdf', bytes: bytes('%PDF-1.7\nID') }
    ]
  });
  assert.equal(packet.attachments.length, 2);
  assert.equal(packet.attachments[0].size, 11);
  assert.equal(packet.attachments[0].dataBase64, Buffer.from('%PDF-1.7\nCV').toString('base64'));
  assert.equal(packet.attachments[0].kind, 'tailored-cv');
  assert.throws(
    () => buildApplyPacketV2({ profile, job, attachments: [{ key: 'x', kind: 'document', label: 'X', fileName: 'x.exe', mime: 'application/x-msdownload', bytes: bytes('MZ') }] }),
    /PDF, DOCX or text/
  );
  const many = Array.from({ length: MAX_ATTACHMENTS + 1 }, (_, index) => ({
    key: `d${index}`, kind: 'document', label: `D${index}`, fileName: 'd.txt', mime: 'text/plain', bytes: bytes('x')
  }));
  assert.throws(() => buildApplyPacketV2({ profile, job, attachments: many }), /up to 10/);
});

test('the sanitiser rebuilds a valid packet and drops unknown fields', () => {
  const packet = buildApplyPacketV2({ profile, job });
  const hostile = JSON.parse(JSON.stringify(packet));
  hostile.extra = 'x';
  hostile.identity[0].onClick = 'steal()';
  hostile.job.applyUrl = 'javascript:alert(1)';
  const clean = sanitisePacketV2(hostile);
  assert.equal('extra' in clean, false);
  assert.equal('onClick' in clean.identity[0], false);
  assert.equal(clean.job.applyUrl, '');
  assert.equal(clean.job.site, '');
});

test('the sanitiser rejects hostile attachments and versions', () => {
  const packet = buildApplyPacketV2({ profile, job });
  assert.throws(() => sanitisePacketV2({ ...packet, version: 1 }), /version/);
  assert.throws(
    () => sanitisePacketV2({ ...packet, attachments: [{ key: 'a', kind: 'document', label: 'A', fileName: 'a.pdf', mime: 'application/pdf', size: 99, dataBase64: 'AAAA' }] }),
    /size/
  );
  assert.throws(
    () => sanitisePacketV2({ ...packet, attachments: [{ key: 'a', kind: 'document', label: 'A', fileName: 'a.pdf', mime: 'application/pdf', size: 4, dataBase64: 'not base64!' }] }),
    /base64/
  );
});
