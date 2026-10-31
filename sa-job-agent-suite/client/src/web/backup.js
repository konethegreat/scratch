// Field-level cleaning for imported web backups. The export format is a keyed
// map per store; every record is rebuilt from JSON-safe values before it can
// replace what is already on this device.
import { AppError, ERROR_CODES } from '@sajas/core/errors';
import { httpUrl } from '@sajas/core/feeds';

const MAX_DEPTH = 8;
const MAX_STRING = 1_000_000;
const BLOCKED_FIELDS = Object.freeze(['__proto__', 'constructor', 'prototype']);
const TRACKER_STATUSES = Object.freeze(['found', 'tailoring', 'tailored', 'applied', 'interviewing', 'offer', 'rejected']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Key-shaped fields are never restored: a hand-edited file must not be able to
// plant key material in the vault, where a later export would pick it up.
function isBlockedField(key) {
  return BLOCKED_FIELDS.includes(key)
    || key === 'hasAnthropicKey'
    || /api[_-]?key|keyvault/i.test(key);
}

function cleanValue(value, depth = 0) {
  if (typeof value === 'string') return value.slice(0, MAX_STRING);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH) return [];
    return value
      .map((item) => cleanValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (isPlainObject(value)) {
    if (depth >= MAX_DEPTH) return {};
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      if (isBlockedField(key)) continue;
      const cleaned = cleanValue(child, depth + 1);
      if (cleaned !== undefined) out[key] = cleaned;
    }
    return out;
  }
  return undefined;
}

function cleanJob(value) {
  const job = cleanValue(value);
  if (job.applyUrl !== undefined) job.applyUrl = httpUrl(job.applyUrl);
  if (job.status !== undefined && !TRACKER_STATUSES.includes(job.status)) job.status = 'found';
  if (job.matchScore !== undefined) {
    const score = Number(job.matchScore);
    job.matchScore = Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0;
  }
  return job;
}

export function sanitiseBackupData(data) {
  const out = {};
  for (const [store, records] of Object.entries(data)) {
    const clean = {};
    for (const [key, value] of Object.entries(records)) {
      if (BLOCKED_FIELDS.includes(key)) continue;
      if (!isPlainObject(value)) {
        throw new AppError(ERROR_CODES.VALIDATION, `That backup has an invalid ${store} record.`);
      }
      clean[key] = store === 'jobs' ? cleanJob(value) : cleanValue(value);
    }
    out[store] = clean;
  }
  return out;
}