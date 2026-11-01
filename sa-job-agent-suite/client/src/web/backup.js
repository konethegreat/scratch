// Field-level cleaning for imported web backups. The export format is a keyed
// map per store; every record is rebuilt from JSON-safe values before it can
// replace what is already on this device.
import { AppError, ERROR_CODES } from '@sajas/core/errors';
import { webLink } from './links.js';

const STORE_NAMES = Object.freeze(['profile', 'jobs', 'answers', 'memory', 'usage', 'meta']);
const MAX_DEPTH = 8;
// Shared with profile writes, so a value the app accepts is always a value a
// backup can restore.
export const MAX_FIELD_LENGTH = 1_000_000;
const BLOCKED_FIELDS = Object.freeze(['__proto__', 'constructor', 'prototype']);
const SECRET_FIELD = /api[_-]?key|keyvault|anthropic[_-]?key|secret[_-]?key|api[_-]?token|access[_-]?token/i;
const PROFILE_URL_FIELDS = Object.freeze(['linkedInUrl', 'portfolioUrl']);
const TRACKER_STATUSES = Object.freeze(['found', 'tailoring', 'tailored', 'applied', 'interviewing', 'offer', 'rejected']);
const APPLICATION_SCALAR_FIELDS = Object.freeze([
  'id', 'jobId', 'title', 'company', 'appliedAt', 'outcome', 'delivery', 'submittedBy', 'site'
]);
const APPLICATION_LIST_FIELDS = Object.freeze(['transcript', 'documents', 'fields']);
const COUNTER_FIELDS = Object.freeze([
  'calls', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'webSearches', 'estCostUSD'
]);
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

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
    if (value.length > MAX_FIELD_LENGTH) {
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
    job.applyUrl = webLink(job.applyUrl);
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
      profile[key] = webLink(field);
    }
  }
  return profile;
}

function requireObjectArray(value, store) {
  if (!Array.isArray(value)) throw invalidRecord(store);
  for (const entry of value) {
    if (!isPlainObject(entry)) throw invalidRecord(store);
  }
  return value;
}

// The memory panel renders these fields directly, so an object where a string
// belongs would crash React on every load. Indexed containers (transcript,
// documents, fields) keep their shape but must still hold flat records.
function cleanInsight(entry) {
  if (!isPlainObject(entry)) throw invalidRecord('memory');
  if (entry.text !== undefined && typeof entry.text !== 'string') throw invalidRecord('memory');
  if (entry.category !== undefined && typeof entry.category !== 'string') throw invalidRecord('memory');
  for (const value of Object.values(entry)) {
    if (value !== null && typeof value === 'object') throw invalidRecord('memory');
  }
  return entry;
}

function cleanEmployer(entry) {
  if (!isPlainObject(entry)) throw invalidRecord('memory');
  if (entry.company !== undefined && typeof entry.company !== 'string') throw invalidRecord('memory');
  if (entry.applications !== undefined && typeof entry.applications !== 'number') throw invalidRecord('memory');
  if (entry.notes !== undefined) {
    if (!Array.isArray(entry.notes)) throw invalidRecord('memory');
    for (const note of entry.notes) {
      if (typeof note !== 'string') throw invalidRecord('memory');
    }
  }
  for (const [key, value] of Object.entries(entry)) {
    if (key === 'notes') continue;
    if (value !== null && typeof value === 'object') throw invalidRecord('memory');
  }
  return entry;
}

function cleanApplication(entry) {
  if (!isPlainObject(entry)) throw invalidRecord('memory');
  for (const field of APPLICATION_SCALAR_FIELDS) {
    const value = entry[field];
    if (value !== null && value !== undefined && typeof value === 'object') throw invalidRecord('memory');
  }
  if (entry.salarySnapshot !== undefined && entry.salarySnapshot !== null) {
    if (!isPlainObject(entry.salarySnapshot)) throw invalidRecord('memory');
    assertScalars(entry.salarySnapshot, 'memory');
  }
  for (const field of APPLICATION_LIST_FIELDS) {
    if (entry[field] === undefined) continue;
    for (const item of requireObjectArray(entry[field], 'memory')) assertScalars(item, 'memory');
  }
  if (entry.confirmation !== undefined && entry.confirmation !== null) {
    if (!isPlainObject(entry.confirmation)) throw invalidRecord('memory');
    assertScalars(entry.confirmation, 'memory');
  }
  for (const [key, value] of Object.entries(entry)) {
    if (APPLICATION_SCALAR_FIELDS.includes(key) || APPLICATION_LIST_FIELDS.includes(key)) continue;
    if (key === 'salarySnapshot' || key === 'confirmation') continue;
    if (value !== null && typeof value === 'object') throw invalidRecord('memory');
  }
  return entry;
}

function cleanMemoryRecord(value) {
  const memory = cleanValue(value);
  if (memory.version !== undefined && typeof memory.version !== 'number') throw invalidRecord('memory');
  if (memory.updatedAt !== undefined && typeof memory.updatedAt !== 'string') throw invalidRecord('memory');
  if (memory.insights !== undefined) {
    memory.insights = requireObjectArray(memory.insights, 'memory').map(cleanInsight);
  }
  if (memory.employers !== undefined) {
    memory.employers = requireObjectArray(memory.employers, 'memory').map(cleanEmployer);
  }
  if (memory.applications !== undefined) {
    memory.applications = requireObjectArray(memory.applications, 'memory').map(cleanApplication);
  }
  if (memory.lastDream !== undefined && memory.lastDream !== null) {
    if (!isPlainObject(memory.lastDream)) throw invalidRecord('memory');
    assertScalars(memory.lastDream, 'memory');
  }
  return memory;
}

function cleanCounters(record) {
  for (const field of COUNTER_FIELDS) {
    if (record[field] === undefined) continue;
    if (typeof record[field] !== 'number' || !Number.isFinite(record[field])) throw invalidRecord('usage');
  }
  for (const [key, value] of Object.entries(record)) {
    if (key === 'byBucket' || key === 'byTask') continue;
    if (value !== null && typeof value === 'object') throw invalidRecord('usage');
  }
}

// The usage panel formats every cost and count as a number, so a stored string
// or null would throw on render and take the whole app down with it.
function cleanUsageRecord(value) {
  const usage = cleanValue(value);
  if (!isPlainObject(usage.days)) throw invalidRecord('usage');
  for (const [date, day] of Object.entries(usage.days)) {
    if (!DAY_KEY.test(date)) throw invalidRecord('usage');
    if (!isPlainObject(day)) throw invalidRecord('usage');
    for (const group of ['byBucket', 'byTask']) {
      const counters = day[group];
      if (counters === undefined) continue;
      if (!isPlainObject(counters)) throw invalidRecord('usage');
      for (const entry of Object.values(counters)) {
        if (!isPlainObject(entry)) throw invalidRecord('usage');
        cleanCounters(entry);
      }
    }
    cleanCounters(day);
  }
  return usage;
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
      } else if (store === 'memory' && key === 'dossier') {
        clean[key] = cleanMemoryRecord(value);
      } else if (store === 'usage' && key === 'days') {
        clean[key] = cleanUsageRecord(value);
      } else if (store === 'answers' || store === 'meta') {
        const record = cleanValue(value);
        assertScalars(record, store);
        clean[key] = record;
      } else {
        clean[key] = cleanValue(value);
      }
    }
    out[store] = clean;
  }
  return out;
}