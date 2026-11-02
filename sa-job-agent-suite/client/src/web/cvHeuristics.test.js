import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCvText } from './cvHeuristics.js';

const CLEAN_CV = `Nadi Mokoena
Senior Backend Engineer | Cape Town
nadi.mokoena@example.test | +27 71 234 5678
linkedin.com/in/nadimokoena | github.com/nadimokoena

PROFILE
Backend engineer with 8 years of experience building payment systems for South African banks.

SKILLS
Node.js, PostgreSQL, TypeScript, AWS, Docker

EXPERIENCE
Senior Backend Engineer | Acme Payments (Pty) Ltd | Cape Town
January 2021 - Present
- Built the payments API used by three banks
- Cut settlement time from two days to four hours

Backend Engineer | Beta Systems | Johannesburg
2018 - 2020
- Rebuilt the reconciliation service
- Mentored two juniors

EDUCATION
BSc Computer Science, University of Cape Town, 2016
National Senior Certificate, Rosebank High School, 2012

CERTIFICATIONS
AWS Certified Solutions Architect, Amazon Web Services, 2022

LANGUAGES
English (fluent), isiXhosa
`;

test('a clean CV is read into every profile group', () => {
  const { proposals, unread } = parseCvText(CLEAN_CV);

  assert.equal(proposals.fullName, 'Nadi Mokoena');
  assert.equal(proposals.headline, 'Senior Backend Engineer');
  assert.equal(proposals.email, 'nadi.mokoena@example.test');
  assert.equal(proposals.phone, '+27 71 234 5678');
  assert.equal(proposals.linkedInUrl, 'https://linkedin.com/in/nadimokoena');
  assert.equal(proposals.githubUrl, 'https://github.com/nadimokoena');
  assert.equal(proposals.city, 'Cape Town');
  assert.equal(proposals.province, 'Western Cape');
  assert.match(proposals.summary, /^Backend engineer with 8 years/);
  assert.deepEqual(proposals.skills, ['Node.js', 'PostgreSQL', 'TypeScript', 'AWS', 'Docker']);
  assert.deepEqual(proposals.languages, ['English', 'isiXhosa']);
  assert.equal(proposals.yearsExperience, 8);
  assert.equal(proposals.highestQualification, 'BSc Computer Science');

  assert.equal(proposals.workHistory.length, 2);
  const [first, second] = proposals.workHistory;
  assert.equal(first.title, 'Senior Backend Engineer');
  assert.equal(first.company, 'Acme Payments (Pty) Ltd');
  assert.equal(first.start, '2021');
  assert.equal(first.end, '');
  assert.equal(first.current, true);
  assert.equal(first.location, 'Cape Town');
  assert.equal(first.bullets.length, 2);
  assert.match(first.bullets[0], /payments API/);
  assert.equal(second.title, 'Backend Engineer');
  assert.equal(second.company, 'Beta Systems');
  assert.equal(second.start, '2018');
  assert.equal(second.end, '2020');
  assert.equal(second.current, false);
  assert.equal(second.location, 'Johannesburg');

  assert.equal(proposals.education.length, 2);
  assert.deepEqual(proposals.education[0], {
    institution: 'University of Cape Town', qualification: 'BSc', field: 'Computer Science', year: '2016', result: ''
  });
  assert.deepEqual(proposals.education[1], {
    institution: 'Rosebank High School', qualification: 'National Senior Certificate', field: '', year: '2012', result: ''
  });
  assert.deepEqual(proposals.certifications, [
    { name: 'AWS Certified Solutions Architect', issuer: 'Amazon Web Services', year: '2022' }
  ]);
  assert.deepEqual(unread, []);
});

test('a headerless CV still yields contact details, years and an inline skills list', () => {
  const { proposals, unread } = parseCvText(`Thabo Nkosi
thabo@example.test 082 555 0101
Customer service assistant with 3 years of experience.
Skills: customer service, stock control, cash handling`);

  assert.equal(proposals.fullName, 'Thabo Nkosi');
  assert.equal(proposals.email, 'thabo@example.test');
  assert.equal(proposals.phone, '082 555 0101');
  assert.equal(proposals.yearsExperience, 3);
  assert.deepEqual(proposals.skills, ['customer service', 'stock control', 'cash handling']);
  assert.equal(proposals.headline, '');
  assert.equal(proposals.summary, '');
  assert.equal(proposals.workHistory.length, 0);
  assert.ok(unread.includes('workHistory'));
  assert.ok(unread.includes('education'));
  assert.ok(unread.includes('headline'));
});

test('a letter with no CV content does not invent a name or a history', () => {
  const { proposals, unread } = parseCvText(`To whom it may concern
I am writing to apply for the position advertised on your website.`);

  assert.equal(proposals.fullName, '');
  assert.equal(proposals.email, '');
  assert.equal(proposals.phone, '');
  assert.deepEqual(proposals.workHistory, []);
  assert.deepEqual(proposals.education, []);
  assert.ok(unread.includes('name'));
  assert.ok(unread.includes('workHistory'));
});

test('identity and salary details are never proposed', () => {
  const { proposals } = parseCvText(`Name: Leroy Dlamini
ID Number: 9001015800083
Date of Birth: 1990-01-01
Gender: Male
Current salary: R45 000 per month`);

  assert.equal(proposals.fullName, 'Leroy Dlamini');
  assert.equal(proposals.phone, '');
  for (const forbidden of ['salary', 'idNumber', 'dateOfBirth', 'gender', 'eeRace', 'disability', 'criminalRecord']) {
    assert.equal(forbidden in proposals, false, forbidden);
  }
});

test('dates on their own line are joined to the role above them', () => {
  const { proposals } = parseCvText(`Lindiwe Khumalo
lindiwe@example.test

EXPERIENCE
Cashier
Shoprite, 2019-2021
Durban

EDUCATION
Matric, Durban High School, 2015`);

  assert.equal(proposals.workHistory.length, 1);
  assert.deepEqual(proposals.workHistory[0], {
    company: 'Shoprite', title: 'Cashier', start: '2019', end: '2021', current: false, location: 'Durban', bullets: []
  });
  assert.equal(proposals.city, '');
  assert.equal(proposals.education[0].qualification, 'Matric');
  assert.equal(proposals.education[0].institution, 'Durban High School');
  assert.equal(proposals.highestQualification, 'Matric');
});

test('number words and open-ended dates are understood', () => {
  const { proposals } = parseCvText(`Sipho Ndlovu
sipho@example.test

PROFILE
Twelve years of experience in logistics.

EXPERIENCE
Warehouse Supervisor | Kago Logistics (Pty) Ltd
March 2015 to date
- Ran a team of 20 pickers`);

  assert.equal(proposals.yearsExperience, 12);
  assert.equal(proposals.workHistory[0].start, '2015');
  assert.equal(proposals.workHistory[0].current, true);
  assert.equal(proposals.workHistory[0].end, '');
});
