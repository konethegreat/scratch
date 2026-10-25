// Persistence for source health: db.json -> sourceHealth[id]. The model itself
// lives in health.js (pure); this file only reads, applies and writes.
import { readDb, writeDb } from '../db/helper.js';
import { emptyEntry, applyRun } from './health.js';

const normalise = (stored) => ({ ...emptyEntry(), ...(stored && typeof stored === 'object' ? stored : {}) });

export function getHealthEntry(id) {
  const all = readDb().sourceHealth || {};
  return normalise(all[id]);
}

export function getAllHealth() {
  const all = readDb().sourceHealth || {};
  const out = {};
  for (const id of Object.keys(all)) out[id] = normalise(all[id]);
  return out;
}

function update(id, fn) {
  const db = readDb();
  const all = { ...(db.sourceHealth || {}) };
  const next = fn(normalise(all[id]));
  all[id] = next;
  writeDb({ ...db, sourceHealth: all });
  return next;
}

export function recordRun(id, run) {
  return update(id, (entry) => applyRun(entry, run));
}

// Stores the latest canary result AND pushes a 'canary' RunRecord (a passing
// one closes the circuit; a failing one never opens it, only hunts count).
export function recordCanary(id, canary) {
  const reasons = Array.isArray(canary.reasons) ? canary.reasons : [];
  const text = reasons.join(' ');
  const blocked = canary.pass === false && /blocked|captcha|bot.?wall|cloudflare/i.test(text);
  const run = {
    at: canary.at,
    kind: 'canary',
    pages: 1,
    raw: canary.raw || 0,
    withTitle: 0,
    withUrl: 0,
    withCompany: 0,
    withLocation: 0,
    httpStatus: null,
    blocked,
    blockKind: blocked ? (/login/i.test(text) ? 'login' : 'captcha') : null,
    error: canary.pass ? null : (text || 'canary failed'),
    ms: canary.ms || 0,
    via: 'canary',
    stopReason: ''
  };
  return update(id, (entry) => ({ ...applyRun(entry, run), canary: { ...canary } }));
}

export function setEnabled(id, enabled) {
  return update(id, (entry) => ({ ...entry, enabled: !!enabled }));
}

export function resetCircuit(id) {
  return update(id, (entry) => ({
    ...entry,
    consecutiveBroken: 0,
    circuit: { open: false, openedAt: null, reason: '' },
    cooldownUntil: null
  }));
}
