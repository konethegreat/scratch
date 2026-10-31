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

test('a non-object record rejects the import', () => {
  for (const bad of ['text', 42, null, ['array'], true]) {
    assert.throws(
      () => sanitiseBackupData(stores({ broken: bad })),
      (error) => error.code === 'VALIDATION',
      `record ${JSON.stringify(bad)} was accepted`
    );
  }
});

test('a __proto__ key cannot change Object.prototype', () => {
  const payload = JSON.parse('{"j":{"title":"A","__proto__":{"polluted":true}}}');
  const data = sanitiseBackupData(stores(payload));
  assert.equal({}.polluted, undefined);
  assert.equal(Object.hasOwn(data.jobs.j, '__proto__'), false);
  assert.equal(data.jobs.j.title, 'A');
});

test('long strings are clipped and a realistic record survives unchanged', () => {
  const profile = { fullName: 'Thandi Mokoena', email: 'thandi@example.test', baseCv: 'x'.repeat(1_500_000) };
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
  assert.equal(data.profile.current.fullName, 'Thandi Mokoena');
  assert.equal(data.profile.current.baseCv.length, 1_000_000, 'an oversized field is clipped, not imported whole');
  assert.deepEqual({ ...data.jobs['job-1'], id: undefined }, { ...job, id: undefined });
  assert.deepEqual(data.answers.q1, { id: 'q1', question: 'Notice period?', answer: 'One month', normalized: 'notice period' });
  assert.equal(data.memory.dossier.insights[0].text, 'Prefers remote');
  assert.equal(data.usage.days.days['2026-10-30'].calls, 2);
});