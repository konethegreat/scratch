import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sajas-applied-'));
process.env.DB_PATH = path.join(dir, 'db.json');
process.env.KEYS_PATH = path.join(dir, 'keys.json');

const { recordApplication, readDb } = await import('./helper.js');

test('recordApplication keeps the submission shape and caps what it stores', () => {
  const rec = recordApplication({
    jobId: 'job-1',
    title: 'Developer',
    company: 'Example',
    delivery: 'web-guided',
    submittedBy: 'user',
    site: 'example.co.za',
    documents: [{ key: 'cv', label: 'Tailored CV', fileName: 'cv.pdf' }],
    fields: [{ label: 'Notice period', value: '30 days' }],
    confirmation: { confirmedAt: '2026-10-28T10:00:00.000Z', text: 'Application received' }
  });
  assert.equal(rec.delivery, 'web-guided');
  assert.equal(rec.site, 'example.co.za');
  assert.deepEqual(rec.documents, [{ key: 'cv', label: 'Tailored CV', fileName: 'cv.pdf' }]);
  assert.deepEqual(rec.fields, [{ label: 'Notice period', value: '30 days' }]);
  assert.equal(rec.confirmation.text, 'Application received');
  assert.equal(readDb().candidateMemory.applications.length, 1);
});

test('an existing application gains new submission details without losing its transcript', () => {
  recordApplication({ jobId: 'job-1', title: 'Developer', company: 'Example', transcript: [{ question: 'Q', answer: 'A' }] });
  const updated = recordApplication({
    jobId: 'job-1', title: 'Developer', company: 'Example',
    delivery: 'desktop-copilot', submittedBy: 'copilot-confirmed',
    site: 'example.co.za', fields: [{ label: 'Email', value: 'a@example.test' }]
  });
  assert.deepEqual(updated.transcript, [{ question: 'Q', answer: 'A' }]);
  assert.equal(updated.submittedBy, 'copilot-confirmed');
  assert.equal(readDb().candidateMemory.applications.length, 1);
});

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
