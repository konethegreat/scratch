// healthStore persists through db/helper.js, which reads DB_PATH at import
// time, so the temp paths are set BEFORE the dynamic imports.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sajas-health-'));
process.env.DB_PATH = path.join(dir, 'db.json');
process.env.KEYS_PATH = path.join(dir, 'keys.json');

const store = await import('./healthStore.js');
const { computeStatus, emptyEntry } = await import('./health.js');
const helper = await import('../db/helper.js');

const rawDb = () => JSON.parse(fs.readFileSync(process.env.DB_PATH, 'utf-8'));
const hunt = (over = {}) => ({
  at: '2026-10-25T10:00:00.000Z', kind: 'hunt', pages: 1, raw: 8, withTitle: 8, withUrl: 8,
  withCompany: 8, withLocation: 8, httpStatus: 200, blocked: false, blockKind: null,
  error: null, ms: 10, via: 'css', stopReason: 'done', ...over
});

test('unknown id returns an empty entry without writing', () => {
  helper.readDb(); // first read creates db.json with defaults
  const before = fs.readFileSync(process.env.DB_PATH, 'utf-8');
  const e = store.getHealthEntry('nobody');
  assert.deepEqual(e, emptyEntry());
  assert.deepEqual(store.getAllHealth(), {});
  const after = fs.readFileSync(process.env.DB_PATH, 'utf-8');
  assert.equal(after, before);
  assert.equal('nobody' in (JSON.parse(after).sourceHealth || {}), false);
});

test('recordRun persists and getHealthEntry round-trips', () => {
  const out = store.recordRun('pnet', hunt());
  assert.equal(out.runs.length, 1);
  const again = store.getHealthEntry('pnet');
  assert.deepEqual(again, out);
  assert.equal(rawDb().sourceHealth.pnet.runs[0].raw, 8);
  assert.equal(again.lastSuccessAt, '2026-10-25T10:00:00.000Z');
  assert.ok('pnet' in store.getAllHealth());
});

test('recordCanary stores the canary and pushes a canary run', () => {
  const canary = { at: '2026-10-25T11:00:00.000Z', pass: false, reasons: ['no cards'], raw: 0, ms: 7 };
  const e = store.recordCanary('pnet', canary);
  assert.deepEqual(e.canary, canary);
  assert.equal(e.runs.at(-1).kind, 'canary');
  assert.equal(e.circuit.open, false);
  assert.equal(computeStatus(e).status, 'broken');
});

test('setEnabled(false) persists and computeStatus reads disabled', () => {
  store.setEnabled('indeed', false);
  assert.equal(rawDb().sourceHealth.indeed.enabled, false);
  assert.equal(computeStatus(store.getHealthEntry('indeed')).status, 'disabled');
  store.setEnabled('indeed', true);
  assert.equal(store.getHealthEntry('indeed').enabled, true);
});

test('resetCircuit clears circuit and consecutiveBroken', () => {
  for (let i = 0; i < 3; i++) {
    store.recordRun('gumtree', hunt({ raw: 0, withTitle: 0, withUrl: 0, withCompany: 0, withLocation: 0, error: 'x' }));
  }
  const open = store.getHealthEntry('gumtree');
  assert.equal(open.circuit.open, true);
  assert.equal(open.consecutiveBroken, 3);
  const e = store.resetCircuit('gumtree');
  assert.equal(e.circuit.open, false);
  assert.equal(e.consecutiveBroken, 0);
  assert.equal(e.cooldownUntil, null);
  assert.equal(store.getHealthEntry('gumtree').circuit.open, false);
  assert.equal(store.getHealthEntry('gumtree').runs.length, 3);
});

test('db.json written by older versions (no sourceHealth) still loads', () => {
  fs.writeFileSync(process.env.DB_PATH, JSON.stringify({ profile: { fullName: 'Old' }, jobs: [] }));
  assert.deepEqual(store.getAllHealth(), {});
  assert.deepEqual(helper.readDb().sourceHealth, {});
  assert.equal(helper.readDb().profile.useAiExtractFallback, true);
  // a non-object value is repaired too
  fs.writeFileSync(process.env.DB_PATH, JSON.stringify({ sourceHealth: [1, 2] }));
  assert.deepEqual(helper.readDb().sourceHealth, {});
  store.recordRun('pnet', hunt());
  assert.equal(store.getHealthEntry('pnet').runs.length, 1);
});
