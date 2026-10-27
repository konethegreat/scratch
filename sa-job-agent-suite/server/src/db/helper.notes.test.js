// Employer notes and the memory digest feed the tailor prompts from the server
// store, so their tests stay beside the helper. helper.js reads DB_PATH at
// import time, so the env is set BEFORE the dynamic import.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sajas-helper-notes-'));
process.env.DB_PATH = path.join(dir, 'db.json');
process.env.KEYS_PATH = path.join(dir, 'keys.json');

const helper = await import('./helper.js');

test('buildEmployerNotes returns \'\' for an unknown company', () => {
  assert.equal(helper.buildEmployerNotes('Nonexistent Corp'), '');
  assert.equal(helper.buildEmployerNotes(''), '');
  assert.equal(helper.buildEmployerNotes(undefined), '');
});

test('buildEmployerNotes returns the formatted notes for a known company, and the digest no longer carries them', () => {
  helper.upsertEmployerNote({ company: 'Initech', note: 'values punctuality' });
  helper.upsertEmployerNote({ company: 'Initech', note: 'uses TypeScript' });
  assert.equal(
    helper.buildEmployerNotes('Initech'),
    'Employer notes:\n- Initech: values punctuality | uses TypeScript'
  );
  // Company-independent digest form used by the system block.
  assert.ok(!helper.buildMemoryDigest({ maxInsights: 12 }).includes('Initech'));
});

test('buildMemoryDigest({ company }) still emits the Employer notes line for a known company; buildMemoryDigest({}) does not', () => {
  // Agent 3 smart-fill relies on the company-specific form of the digest.
  helper.upsertEmployerNote({ company: 'Hooli', note: 'prefers formal tone' });
  const withCompany = helper.buildMemoryDigest({ company: 'Hooli' });
  assert.ok(withCompany.includes('Employer notes:'));
  assert.ok(withCompany.includes('- Hooli: prefers formal tone'));
  const without = helper.buildMemoryDigest({});
  assert.ok(!without.includes('Employer notes:'));
  assert.ok(!without.includes('Hooli'));
  // A company with no notes adds nothing.
  assert.ok(!helper.buildMemoryDigest({ company: 'Unknown Ltd' }).includes('Employer notes:'));
});
