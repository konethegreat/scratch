import test from 'node:test';
import assert from 'node:assert/strict';
import { createVault } from '../vault.js';
import { createMemoryAdapter } from '../memoryAdapter.js';
import { validateJobCards } from '@sajas/core/scrape';
import { fingerprint } from '@sajas/core/feeds';
import { isSouthAfrican } from '@sajas/core/jobs';
import {
  DEMO_PERSONA, DEMO_PROFILE, DEMO_DOCUMENTS, DEMO_ANSWERS, DEMO_MEMORY,
  DEMO_QUESTION, DEMO_ACTIVITY
} from './persona.js';
import {
  DEMO_JOBS, DEMO_HUNTER_JOBS, DEMO_FEEDS, tailoredDocuments, salaryBand
} from './jobs.js';
import { DEMO_SEED_VERSION, buildDemoSeed, seedDemoVault } from './fixtures.js';

const SECTORS = ['Banking', 'Retail', 'Mining', 'Public works', 'Logistics', 'NGO', 'Technology'];

test('the persona is a complete fictional South African profile v2', () => {
  assert.equal(DEMO_PERSONA.fullName, 'Naledi Mokoena');
  assert.equal(DEMO_PROFILE.fullName, 'Naledi Mokoena');
  assert.equal(DEMO_PROFILE.v, 2);
  assert.equal(DEMO_PROFILE.salary.currentAmount, 38000);
  assert.equal(DEMO_PROFILE.salary.expectedAmount, 45000);
  assert.equal(DEMO_PROFILE.salary.negotiable, true);
  assert.ok(DEMO_PROFILE.workHistory.length >= 3);
  assert.ok(DEMO_PROFILE.education.length >= 1);
  assert.ok(DEMO_PROFILE.skills.length >= 8);
  assert.ok(DEMO_PROFILE.languages.length >= 3);
  assert.ok(DEMO_PROFILE.references.length >= 2);
  assert.ok(DEMO_PROFILE.preferences.roles.length >= 3);
  assert.equal(DEMO_PROFILE.eeOptIn, false);
  assert.equal(DEMO_PROFILE.applicationProfile.noticePeriod, '30 days');
  assert.equal(DEMO_PROFILE.applicationProfile.criminalRecord, 'Willing to undergo a criminal record check');
});

test('the persona holds four sample documents, all base64 text, one default CV', () => {
  assert.equal(DEMO_DOCUMENTS.length, 4);
  const cv = DEMO_DOCUMENTS.find((doc) => doc.kind === 'cv');
  assert.ok(cv);
  assert.equal(cv.isDefault, true);
  assert.match(cv.text, /Naledi Mokoena/);
  assert.match(cv.text, /accessibility dashboard/);
  for (const doc of DEMO_DOCUMENTS) {
    assert.ok(doc.id && doc.label && doc.fileName);
    assert.equal(doc.mime, 'text/plain');
    assert.ok(doc.size > 0);
    assert.ok(typeof doc.dataBase64 === 'string' && doc.dataBase64.length > 0);
    assert.ok(doc.dataBase64.length % 4 === 0);
    assert.ok(doc.uploadedAt);
    assert.ok(doc.text.length > 20);
  }
  assert.equal(DEMO_DOCUMENTS.filter((doc) => doc.isDefault).length, 1);
});

test('the answer bank is v2 and covers realistic SA questions', () => {
  assert.ok(DEMO_ANSWERS.length >= 14);
  const questions = new Set(DEMO_ANSWERS.map((answer) => answer.question.toLowerCase()));
  for (const wanted of [
    'notice period', 'right to work', 'expected salary', 'criminal record', 'credit check',
    'driver licence', 'relocate', 'highest qualification', 'languages', 'own vehicle'
  ]) {
    assert.ok([...questions].some((question) => question.includes(wanted)), wanted);
  }
  for (const answer of DEMO_ANSWERS) {
    assert.ok(answer.id && answer.question && answer.answer && answer.normalized);
    assert.ok(answer.category && answer.source);
    assert.equal(typeof answer.timesUsed, 'number');
    assert.ok('lastUsed' in answer);
    assert.ok(answer.createdAt);
  }
  assert.equal(new Set(DEMO_ANSWERS.map((answer) => answer.normalized)).size, DEMO_ANSWERS.length);
});

test('the dossier carries history, preferences and salary history', () => {
  assert.equal(DEMO_MEMORY.version, 2);
  assert.ok(DEMO_MEMORY.insights.length >= 8);
  assert.ok(DEMO_MEMORY.employers.length >= 8);
  assert.ok(DEMO_MEMORY.applications.length >= 5);
  assert.ok(DEMO_MEMORY.salaryHistory.length >= 2);
  assert.ok(DEMO_MEMORY.applyEvents.length >= 4);
  assert.ok(DEMO_ACTIVITY.length >= 8);
});

test('there are 20 fictional employers across seven sectors and eight provinces', () => {
  assert.equal(DEMO_JOBS.length, 20);
  assert.equal(new Set(DEMO_JOBS.map((job) => job.company)).size, 20);
  const sectors = new Set(DEMO_JOBS.map((job) => job.sector));
  for (const sector of SECTORS) assert.ok(sectors.has(sector), sector);
  const provinces = new Set(DEMO_JOBS.map((job) => job.province));
  for (const province of [
    'Gauteng', 'Western Cape', 'KwaZulu-Natal', 'North West',
    'Northern Cape', 'Mpumalanga', 'Limpopo', 'Eastern Cape'
  ]) {
    assert.ok(provinces.has(province), province);
  }
  for (const job of DEMO_JOBS) {
    assert.match(job.salaryBand, /^R \d{2} \d{3} to R \d{2} \d{3} per month$/);
    assert.ok(job.matchScore >= 0 && job.matchScore <= 100);
    assert.ok(job.description.length > 40);
    assert.ok(Array.isArray(job.questions) && job.questions.length >= 2);
    assert.ok(job.questions.every((question) => question.question && question.answer && question.normalized));
  }
  assert.equal(salaryBand(45000, 58000), 'R 45 000 to R 58 000 per month');
});

test('every link and email uses a reserved .test domain', () => {
  const urls = [
    ...DEMO_JOBS.map((job) => job.applyUrl),
    ...DEMO_HUNTER_JOBS.map((job) => job.applyUrl),
    ...Object.values(DEMO_FEEDS).flat().map((job) => job.applyUrl),
    DEMO_PROFILE.linkedInUrl,
    DEMO_PROFILE.portfolioUrl
  ];
  for (const url of urls) assert.match(new URL(url).hostname, /\.test$/, url);
  assert.match(DEMO_PROFILE.email, /@example\.test$/);
  for (const reference of DEMO_PROFILE.references) assert.match(reference.email, /@example\.test$/);
});

test('no placeholder employers, key shape or real-looking contact detail remains', () => {
  const text = JSON.stringify({
    DEMO_PERSONA, DEMO_PROFILE, DEMO_JOBS, DEMO_ANSWERS, DEMO_HUNTER_JOBS, DEMO_FEEDS, DEMO_DOCUMENTS
  });
  assert.equal(/\bsk-ant-/.test(text), false);
  assert.equal(/\+27\s*\d{2}\s*\d{3}/.test(text), false, 'a real-looking phone number');
  for (const name of ['Mostoeneng', 'Kone']) assert.equal(text.includes(name), false);
  for (const placeholder of ['Example Studio', 'Fable Fintech', 'Placeholder Health', 'Imaginary Retail', 'Sample Logistics']) {
    assert.equal(text.includes(placeholder), false, placeholder);
  }
});

test('every hunter job passes the shared card schema and the expected mix is stable', () => {
  const result = validateJobCards(DEMO_HUNTER_JOBS);
  assert.equal(result.rejected.length, 0);
  assert.equal(result.valid.length, DEMO_HUNTER_JOBS.length);
  assert.equal(DEMO_HUNTER_JOBS.length, 14);

  const tracked = new Set(DEMO_JOBS.map((job) => fingerprint(job.title, job.company)));
  const duplicates = DEMO_HUNTER_JOBS.filter((job) => tracked.has(fingerprint(job.title, job.company)));
  const foreign = DEMO_HUNTER_JOBS.filter((job) => !isSouthAfrican(job.location));
  const fresh = DEMO_HUNTER_JOBS.filter(
    (job) => isSouthAfrican(job.location) && !tracked.has(fingerprint(job.title, job.company))
  );
  assert.equal(duplicates.length, 3);
  assert.equal(foreign.length, 2);
  assert.equal(fresh.length, 9);
  assert.ok(foreign.some((job) => job.title === 'Frontend Developer'));
});

test('the three feeds include South African and foreign rows', () => {
  assert.deepEqual(Object.keys(DEMO_FEEDS).sort(), ['arbeitnow', 'jobicy', 'remotive']);
  const rows = Object.values(DEMO_FEEDS).flat();
  assert.ok(rows.length >= 9);
  assert.ok(rows.some((job) => !/south africa/i.test(job.location)), 'a foreign job for the SA filter');
  assert.ok(rows.some((job) => /south africa/i.test(job.location)), 'a South African job');
});

test('the seed is versioned, onboarded and carries every store including documents', () => {
  const seed = buildDemoSeed(new Date('2026-11-01T10:00:00Z'));
  assert.equal(seed.meta.app.demoSeed, DEMO_SEED_VERSION);
  assert.equal(seed.meta.app.onboarded, true);
  assert.match(seed.profile.current.baseCv, /accessibility dashboard/);
  assert.equal(Object.keys(seed.jobs).length, DEMO_JOBS.length);
  assert.equal(Object.keys(seed.documents).length, DEMO_DOCUMENTS.length);
  assert.ok(seed.usage.days.days['2026-11-01'].estCostUSD > 0);
  assert.ok(seed.activity.length > 0);
});

test('seeding is idempotent for a current version and rewrites a stale one', async () => {
  const fresh = createVault(createMemoryAdapter());
  assert.equal(await seedDemoVault(fresh, new Date('2026-11-01T10:00:00Z')), true);
  assert.equal(await seedDemoVault(fresh, new Date('2026-11-01T10:00:00Z')), false);
  assert.equal((await fresh.getAll('documents')).length, DEMO_DOCUMENTS.length);
  const stale = createVault(createMemoryAdapter({ meta: { app: { demoSeed: 0 } } }));
  assert.equal(await seedDemoVault(stale, new Date('2026-11-01T10:00:00Z')), true);
  assert.equal((await stale.get('meta', 'app')).demoSeed, DEMO_SEED_VERSION);
});

test('tailored documents name the job, the company and the persona', () => {
  const docs = tailoredDocuments({ title: 'Data Engineer', company: 'Highveld Haulage' });
  assert.match(docs.tailoredCvText, /Data Engineer/);
  assert.match(docs.tailoredCvText, /Highveld Haulage/);
  assert.match(docs.tailoredCvText, /Naledi Mokoena/);
  assert.match(docs.tailoredCoverLetterText, /Highveld Haulage/);
  assert.equal(DEMO_QUESTION, 'Which fictional project would you like to discuss?');
});
