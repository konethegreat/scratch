import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitiseBackupData } from './backup.js';

function stores(jobs = {}, extra = {}) {
  return {
    profile: {},
    jobs,
    answers: {},
    memory: {},
    usage: {},
    meta: {},
    ...extra
  };
}

test('a job link is kept only when it is http or https', () => {
  const data = sanitiseBackupData(stores({
    a: { title: 'A', applyUrl: 'javascript:alert(1)' },
    b: { title: 'B', applyUrl: 'https://example.com/jobs/1' },
    c: { title: 'C', applyUrl: 'data:text/html,<script>alert(1)</script>' },
    d: { title: 'D', applyUrl: 'file:///etc/passwd' },
    e: { title: 'E', applyUrl: '/jobs/relative' }
  }));
  assert.equal(data.jobs.a.applyUrl, '');
  assert.equal(data.jobs.b.applyUrl, 'https://example.com/jobs/1');
  assert.equal(data.jobs.c.applyUrl, '');
  assert.equal(data.jobs.d.applyUrl, '');
  assert.equal(data.jobs.e.applyUrl, '');
});

test('profile links are cleaned like job links', () => {
  const data = sanitiseBackupData(stores({}, {
    profile: { current: {
      linkedInUrl: 'javascript:alert(1)',
      portfolioUrl: 'https://example.test/me',
      fullName: 'Thandi'
    } }
  }));
  assert.equal(data.profile.current.linkedInUrl, '');
  assert.equal(data.profile.current.portfolioUrl, 'https://example.test/me');
  assert.equal(data.profile.current.fullName, 'Thandi');
});

test('an unknown job status is reset and a score is clamped', () => {
  const data = sanitiseBackupData(stores({
    a: { title: 'A', status: 'hacked', matchScore: 150 },
    b: { title: 'B', status: 'applied', matchScore: '84' },
    c: { title: 'C', status: 'interviewing' },
    d: { title: 'D', matchScore: 'not a number' }
  }));
  assert.equal(data.jobs.a.status, 'found');
  assert.equal(data.jobs.a.matchScore, 100);
  assert.equal(data.jobs.b.status, 'applied');
  assert.equal(data.jobs.b.matchScore, 84);
  assert.equal(data.jobs.c.status, 'interviewing');
  assert.equal(data.jobs.c.matchScore, undefined, 'a missing score is not invented');
  assert.equal(data.jobs.d.matchScore, 0);
});

test('key material is stripped at any depth', () => {
  const data = sanitiseBackupData(stores({}, {
    profile: { current: { fullName: 'A', anthropicApiKey: 'secret', applicationProfile: { apiKey: 'secret' } } },
    answers: { q1: { question: 'Q', answer: 'A', api_key: 'secret' } },
    meta: { app: { onboarded: true, keyVault: { ciphertext: 'secret' }, hasAnthropicKey: true } }
  }));
  assert.deepEqual(data.profile.current, { fullName: 'A', applicationProfile: {} });
  assert.deepEqual(data.answers.q1, { question: 'Q', answer: 'A' });
  assert.deepEqual(data.meta.app, { onboarded: true });
});

test('key-shaped record ids are dropped, while the key-store meta record survives', () => {
  const data = sanitiseBackupData(stores({}, {
    meta: {
      key: { idleMinutes: 15, remembered: true },
      keyVault: { ciphertext: 'secret' },
      anthropicApiKey: { ciphertext: 'secret' }
    }
  }));
  assert.deepEqual(data.meta.key, { idleMinutes: 15, remembered: true });
  assert.equal(Object.hasOwn(data.meta, 'keyVault'), false);
  assert.equal(Object.hasOwn(data.meta, 'anthropicApiKey'), false);
});

test('an unknown store is ignored rather than trusted', () => {
  const data = sanitiseBackupData({ ...stores({}), keyVault: { anthropic: { ciphertext: 'secret' } } });
  assert.equal(Object.hasOwn(data, 'keyVault'), false);
});

test('a non-object record rejects the import', () => {
  for (const bad of ['text', 42, null, ['array'], true]) {
    assert.throws(
      () => sanitiseBackupData(stores({ broken: bad })),
      (error) => error.code === 'VALIDATION',
      `record ${JSON.stringify(bad)} was accepted`
    );
  }
});

test('missing or non-object store data rejects the import', () => {
  assert.throws(() => sanitiseBackupData({ ...stores({}), jobs: null }), (error) => error.code === 'VALIDATION');
  assert.throws(() => sanitiseBackupData({ ...stores({}), jobs: [] }), (error) => error.code === 'VALIDATION');
});

test('an object where the UI expects text rejects the import', () => {
  const cases = [
    { jobs: { j: { title: {} } } },
    { jobs: { j: { title: { text: 'A' } } } },
    { answers: { q: { question: 'Q', answer: [] } } },
    { profile: { current: { fullName: {} } } },
    { profile: { current: { applicationProfile: { noticePeriod: {} } } } },
    { meta: { app: { onboarded: {} } } }
  ];
  for (const extra of cases) {
    assert.throws(
      () => sanitiseBackupData(stores({}, extra)),
      (error) => error.code === 'VALIDATION',
      `${JSON.stringify(extra)} was accepted`
    );
  }
});

test('a link or score of the wrong type rejects instead of throwing a TypeError', () => {
  assert.throws(
    () => sanitiseBackupData(stores({ j: { applyUrl: { toString: 'x' } } })),
    (error) => error.code === 'VALIDATION'
  );
  assert.throws(
    () => sanitiseBackupData(stores({ j: { matchScore: {} } })),
    (error) => error.code === 'VALIDATION'
  );
});

test('a __proto__ key cannot change Object.prototype', () => {
  const payload = JSON.parse('{"j":{"title":"A","__proto__":{"polluted":true}}}');
  const data = sanitiseBackupData(stores(payload));
  assert.equal({}.polluted, undefined);
  assert.equal(Object.hasOwn(data.jobs.j, '__proto__'), false);
  assert.equal(data.jobs.j.title, 'A');
});

test('an oversized field is rejected instead of silently clipped', () => {
  const profile = { current: { fullName: 'Thandi', baseCv: 'x'.repeat(1_000_001) } };
  assert.throws(
    () => sanitiseBackupData(stores({}, { profile })),
    (error) => error.code === 'VALIDATION'
  );
});

test('a bare host is accepted as a link and normalised', () => {
  const data = sanitiseBackupData(stores({ a: { title: 'A', applyUrl: 'linkedin.com/jobs/1' } }, {
    profile: { current: { linkedInUrl: 'linkedin.com/in/thandi', portfolioUrl: 'not a link' } }
  }));
  assert.equal(data.jobs.a.applyUrl, 'https://linkedin.com/jobs/1');
  assert.equal(data.profile.current.linkedInUrl, 'https://linkedin.com/in/thandi');
  assert.equal(data.profile.current.portfolioUrl, '');
});

test('memory text that would crash the panel rejects the import', () => {
  const cases = [
    { insights: [{ id: 'i1', text: { text: 'Prefers remote' } }] },
    { insights: [{ id: 'i1', text: 'Prefers remote', category: {} }] },
    { employers: [{ id: 'e1', company: 'Acme', notes: [{}] }] },
    { employers: [{ id: 'e1', company: {}, applications: 1 }] },
    { employers: [{ id: 'e1', company: 'Acme', applications: 'two' }] },
    { applications: [{ id: 'a1', title: {}, company: 'Acme' }] },
    { applications: [{ id: 'a1', title: 'Engineer', transcript: ['not a record'] }] },
    { applications: [{ id: 'a1', title: 'Engineer', confirmation: { text: {} } }] },
    { lastDream: { at: {}, reinforced: 1 } }
  ];
  for (const dossier of cases) {
    assert.throws(
      () => sanitiseBackupData(stores({}, { memory: { dossier } })),
      (error) => error.code === 'VALIDATION',
      `${JSON.stringify(dossier)} was accepted`
    );
  }
});

test('a realistic dossier survives unchanged', () => {
  const dossier = {
    version: 1,
    updatedAt: '2026-10-30T10:00:00.000Z',
    insights: [{ id: 'i1', text: 'Strong in distributed systems', category: 'strength', source: 'manual', weight: 1 }],
    employers: [{ id: 'e1', company: 'Acme', normalized: 'acme', notes: ['Referred by Sipho'], applications: 1 }],
    applications: [{
      id: 'a1', jobId: 'job-1', title: 'Backend Engineer', company: 'Acme',
      appliedAt: '2026-10-30T10:00:00.000Z', outcome: 'applied', salarySnapshot: null,
      transcript: [], delivery: 'web-guided', submittedBy: 'user', site: 'example.test',
      documents: [{ key: 'cv', label: 'Tailored CV', fileName: 'cv.pdf' }],
      fields: [{ label: 'Email address', value: 'thandi@example.test' }],
      confirmation: null
    }],
    lastDream: { at: '2026-10-30T11:00:00.000Z', reinforced: 1, pruned: 0, added: 2 }
  };
  const data = sanitiseBackupData(stores({}, { memory: { dossier } }));
  assert.deepEqual(data.memory.dossier, dossier);
});

test('usage counters must be numbers so the panel can format them', () => {
  const cases = [
    { days: { days: { '2026-10-30': { calls: 2, estCostUSD: '0.5' } } } },
    { days: { days: { '2026-10-30': { calls: 2, estCostUSD: null } } } },
    { days: { days: { '2026-10-30': 'two calls' } } },
    { days: { days: { 'not-a-date': { calls: 1 } } } },
    { days: { days: { '2026-10-30': { calls: 1, byBucket: [] } } } },
    { days: { days: { '2026-10-30': { calls: 1, byTask: { tailor: 'one' } } } } }
  ];
  for (const usage of cases) {
    assert.throws(
      () => sanitiseBackupData(stores({}, { usage })),
      (error) => error.code === 'VALIDATION',
      `${JSON.stringify(usage)} was accepted`
    );
  }
});

test('a realistic usage record survives unchanged', () => {
  const zero = { calls: 1, inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 0, estCostUSD: 0.01 };
  const usage = { days: { days: { '2026-10-30': { ...zero, byBucket: { core: { ...zero } }, byTask: { tailor: { ...zero } } } } } };
  const data = sanitiseBackupData(stores({}, { usage }));
  assert.deepEqual(data.usage, usage);
});

test('a realistic export survives unchanged', () => {
  const profile = { fullName: 'Thandi Mokoena', email: 'thandi@example.test', baseCv: 'CV text', applicationProfile: { noticePeriod: '30 days' } };
  const job = {
    id: 'job-1', title: 'Backend Engineer', company: 'Acme', location: 'Cape Town',
    applyUrl: 'https://example.test/jobs/1', status: 'tailored', matchScore: 82,
    description: 'Build things', notes: 'Follow up', tailoredCvText: 'CV', tailoredCoverLetterText: 'Letter'
  };
  const data = sanitiseBackupData(stores({ 'job-1': job }, {
    profile: { current: profile },
    answers: { q1: { id: 'q1', question: 'Notice period?', answer: 'One month', normalized: 'notice period' } },
    memory: { dossier: { version: 1, insights: [{ id: 'i1', text: 'Prefers remote', category: 'preference' }] } },
    usage: { days: { days: { '2026-10-30': { calls: 2, inputTokens: 100, estCostUSD: 0.01 } } } }
  }));
  assert.deepEqual(data.profile.current, profile);
  assert.deepEqual(data.jobs['job-1'], job);
  assert.deepEqual(data.answers.q1, { id: 'q1', question: 'Notice period?', answer: 'One month', normalized: 'notice period' });
  assert.equal(data.memory.dossier.insights[0].text, 'Prefers remote');
  assert.equal(data.usage.days.days['2026-10-30'].calls, 2);
});