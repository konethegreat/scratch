// Messages crossing the app, the worker and the page. Every one carries a
// source, a version and the live nonce; anything else is ignored before it can
// reach a handler.
import { cleanSubmission } from '@sajas/core/apply';

export const BRIDGE_VERSION = 1;
export const APP_SOURCE = 'sajas-app';
export const EXTENSION_SOURCE = 'sajas-extension';
export const RESULT_CAP = 50;

const APP_TYPES = new Set(['sajas:hello', 'sajas:packet', 'sajas:results-request', 'sajas:results-ack']);
const WORKER_TYPES = new Set(['sajas:ready', 'sajas:ack', 'sajas:results', 'sajas:results-acked']);
const KEY_SHAPE = /\b(?:sk|rk)[-_](?:ant|or|proj|svcacct|admin|live|test)[-_][A-Za-z0-9_-]{8,}/i;
const LABEL_CAP = 120;
const HOST = /^[a-z0-9.-]+$/;

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, cap) => String(value == null ? '' : value).trim().slice(0, cap);
const nonceOf = (data) => typeof data.nonce === 'string' && data.nonce.length > 0 && data.nonce.length <= 80;

function valid(data, source, types) {
  if (!isRecord(data)) return false;
  if (data.source !== source || data.version !== BRIDGE_VERSION || !types.has(data.type)) return false;
  if (!nonceOf(data)) return false;
  if (data.type === 'sajas:packet') return isRecord(data.packet);
  if (data.type === 'sajas:results-ack') return Array.isArray(data.ids);
  if (data.type === 'sajas:results') return Array.isArray(data.results);
  if (data.type === 'sajas:results-acked') return Array.isArray(data.ids);
  return true;
}

export function isAppMessage(data) {
  return valid(data, APP_SOURCE, APP_TYPES);
}

export function isWorkerMessage(data) {
  return valid(data, EXTENSION_SOURCE, WORKER_TYPES);
}

export function resultFrom(raw = {}) {
  if (!isRecord(raw)) throw new TypeError('That result was not a record.');
  const id = text(raw.id || raw.packetId, 80);
  const packetId = text(raw.packetId || raw.id, 80);
  const jobId = text(raw.jobId, 80);
  const site = text(raw.site, 200).toLowerCase().replace(/\.$/, '');
  const submittedAt = text(raw.submittedAt, 40);
  if (!id || !packetId) throw new TypeError('That result has no packet id.');
  if (!jobId) throw new TypeError('That result has no job.');
  if (!site || !HOST.test(site)) throw new TypeError('That result has no site.');
  if (!submittedAt || Number.isNaN(Date.parse(submittedAt))) throw new TypeError('That result has no valid time.');
  const clean = cleanSubmission({ fields: raw.fields, confirmation: raw.confirmation });
  const fields = clean.fields.filter((field) => !KEY_SHAPE.test(field.value));
  const warnings = (Array.isArray(raw.warnings) ? raw.warnings : [])
    .slice(0, 30)
    .map((warning) => text(warning, LABEL_CAP))
    .filter((warning) => warning && !KEY_SHAPE.test(warning));
  return { id, packetId, jobId, site, submittedAt, confirmation: clean.confirmation, fields, warnings };
}
