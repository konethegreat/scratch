// Field-level cleaning for imported web backups. The export format is a keyed
// map per store; every record is rebuilt from JSON-safe values before it can
// replace what is already on this device.
import { AppError, ERROR_CODES } from '@sajas/core/errors';
import { httpUrl } from '@sajas/core/feeds';

const STORE_NAMES = Object.freeze(['profile', 'jobs', 'answers', 'memory', 'usage', 'meta']);
const MAX_DEPTH = 8;
const MAX_STRING = 1_000_000;
const BLOCKED_FIELDS = Object.freeze(['__proto__', 'constructor', 'prototype']);
const SECRET_FIELD = /api[_-]?key|keyvault|anthropic[_-]?key|secret[_-]?key|api[_-]?token|access[_-]?token/i;
const PROFILE_URL_FIELDS = Object.freeze(['linkedInUrl', 'portfolioUrl']);
const TRACKER_STATUSES = Object.freeze(['found', 'tailoring', 'tailored', 'applied', 'interviewing', 'offer', 'rejected']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function invalidRecord(store) {
  return new AppError(ERROR_CODES.VALIDATION, `That backup has an invalid ${store} record.`);
}

// Key-shaped fields are never restored: a hand-edited file must not be able to
// plant key material in the vault, where a later export would pick it up.
function isBlockedField(key) {
  return BLOCKED_FIELDS.includes(key) || key === 'hasAnthropicKey' || SECRET_FIELD.test(key);
}

function cleanValue(value, depth = 0) {
  if (typeof value === 'string') {
    if (value.length > MAX_STRING) {
      throw new AppError(ERROR_CODES.VALIDATION, 'That backup has a field that is too large to import.');
    }
    return value;
  }
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

// Text that the UI renders directly must stay scalar, or React would be handed
// an object child and the panel would crash on every load.
function assertScalars(record, store) {
  for (const value of Object.values(record)) {
    if (value !== null && typeof value === 'object') throw invalidRecord(store);
  }
}

function cleanJob(value) {
  const job = cleanValue(value);
  if (job.applyUrl !== undefined) {
    if (typeof job.applyUrl !== 'string') throw invalidRecord('jobs');
    job.applyUrl = httpUrl(job.applyUrl);
  }
  if (job.matchScore !== undefined) {
    if (typeof job.matchScore !== 'number' && typeof job.matchScore !== 'string') throw invalidRecord('jobs');
    const score = Number(job.matchScore);
    job.matchScore = Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0;
  }
  if (job.status !== undefined && !TRACKER_STATUSES.includes(job.status)) job.status = 'found';
  assertScalars(job, 'jobs');
  return job;
}

function cleanProfile(value) {
  const profile = cleanValue(value);
  for (const [key, field] of Object.entries(profile)) {
    if (key === 'applicationProfile') {
      if (!isPlainObject(field)) throw invalidRecord('profile');
      assertScalars(field, 'profile');
      continue;
    }
    if (field !== null && typeof field === 'object') throw invalidRecord('profile');
    if (PROFILE_URL_FIELDS.includes(key)) {
      profile[key] = typeof field === 'string' ? httpUrl(field) : '';
    }
  }
  return profile;
}

export function sanitiseBackupData(data) {
  if (!isPlainObject(data)) {
    throw new AppError(ERROR_CODES.VALIDATION, 'That backup has no data.');
  }
  const out = {};
  for (const store of STORE_NAMES) {
    const records = data[store];
    if (!isPlainObject(records)) {
      throw new AppError(ERROR_CODES.VALIDATION, `That backup is missing or has invalid ${store} data.`);
    }
    const clean = {};
    for (const [key, value] of Object.entries(records)) {
      if (isBlockedField(key)) continue;
      if (!isPlainObject(value)) throw invalidRecord(store);
      if (store === 'jobs') {
        clean[key] = cleanJob(value);
      } else if (store === 'profile') {
        clean[key] = cleanProfile(value);
      } else if (store === 'answers' || store === 'meta') {
        const record = cleanValue(value);
        assertScalars(record, store);
        clean[key] = record;
      } else {
        // Memory and usage are structured by design, so they keep nested data.
        clean[key] = cleanValue(value);
      }
    }
    out[store] = clean;
  }
  return out;
}