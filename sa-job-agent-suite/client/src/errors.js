// Client-side error helpers: parse the server contract, keep the last 20
// failures in memory, and turn any entry into copyable diagnostics. Nothing
// here writes to disk or to the server.

import { AppError, ERROR_CODES, toUserError } from '@sajas/core/errors';

const MAX_RECENT = 20;

let recent = [];
const listeners = new Set();

function emit() {
  const snapshot = recent.slice();
  for (const fn of [...listeners]) fn(snapshot);
}

/**
 * Normalise a server response body. A body that already carries one of our
 * codes is kept; a legacy `{ error }` body gets a family from its status; an
 * empty body uses the caller's fallback.
 */
function codeForStatus(status) {
  if (status === 400 || status === 422) return ERROR_CODES.VALIDATION;
  if (status === 401) return ERROR_CODES.AUTH_REJECTED;
  if (status === 403) return ERROR_CODES.FORBIDDEN;
  if (status === 404) return ERROR_CODES.NOT_FOUND;
  if (status === 409) return ERROR_CODES.CONFLICT;
  if (status === 429) return ERROR_CODES.RATE_LIMITED;
  return ERROR_CODES.UNKNOWN;
}

export function contractFromBody(body, status, fallback) {
  const source = body && typeof body === 'object' ? body : {};
  if (source.code && Object.hasOwn(ERROR_CODES, source.code)) {
    return toUserError({
      code: source.code,
      message: source.message || source.error,
      hint: source.hint,
      retryable: source.retryable,
      details: source.details,
      requestId: source.requestId
    }, { requestId: source.requestId, fallback });
  }
  return toUserError(new AppError(codeForStatus(status), source.error || '', {
    retryable: Number.isFinite(status) && (status >= 500 || status === 429)
  }), { fallback });
}

/** Read a non-2xx response once and return its contract payload. */
export async function readResponseError(res, fallback) {
  const body = await res.json().catch(() => null);
  return contractFromBody(body, res.status, fallback);
}

/** One line for a toast: cause plus the fix. */
export function describeUserError(info) {
  const hint = String(info?.hint || '').trim();
  if (!hint || hint === info.message) return info.message;
  return `${info.message} ${hint}`;
}

/** Map any thrown value and put it at the front of the memory-only log. */
export function recordError(err, context = {}) {
  const entry = { ...toUserError(err, context), at: new Date().toISOString(), where: context.where || null };
  const [latest] = recent;
  if (latest && latest.code === entry.code && latest.where === entry.where && latest.message === entry.message) {
    recent = [{ ...latest, at: entry.at, count: (latest.count || 1) + 1 }, ...recent.slice(1)];
  } else {
    recent = [{ ...entry, count: 1 }, ...recent].slice(0, MAX_RECENT);
  }
  emit();
  return recent[0];
}

export function getRecentErrors() {
  return recent.slice();
}

export function subscribeErrors(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function clearRecentErrors() {
  recent = [];
  emit();
}

export function diagnosticsText(entry) {
  const lines = [
    'SA-JAS error diagnostics',
    `code: ${entry.code}`,
    `message: ${entry.message}`,
    `hint: ${entry.hint}`,
    `retryable: ${entry.retryable}`,
    `requestId: ${entry.requestId}`,
    `at: ${entry.at || new Date().toISOString()}`,
    `where: ${entry.where || 'unknown'}`
  ];
  if (entry.details) lines.push(`details: ${entry.details}`);
  return lines.join('\n');
}
