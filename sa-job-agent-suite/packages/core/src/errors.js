// Typed errors and the one user-facing error contract shared by the desktop
// server, the web port and the client. Every message is scrubbed on the way out.

import { scrubSecrets } from './secrets.js';

export const ERROR_CODES = Object.freeze({
  KEY_INVALID: 'KEY_INVALID',
  KEY_ADMIN: 'KEY_ADMIN',
  AUTH_REJECTED: 'AUTH_REJECTED',
  KEY_PERMISSION: 'KEY_PERMISSION',
  RATE_LIMITED: 'RATE_LIMITED',
  SPEND_CAP: 'SPEND_CAP',
  OVERLOADED: 'OVERLOADED',
  BUDGET_EXCEEDED: 'BUDGET_EXCEEDED',
  NETWORK_OFFLINE: 'NETWORK_OFFLINE',
  CORS_BLOCKED: 'CORS_BLOCKED',
  STORAGE_FULL: 'STORAGE_FULL',
  STORAGE_UNAVAILABLE: 'STORAGE_UNAVAILABLE',
  FEED_FAILED: 'FEED_FAILED',
  GROUNDING_FAILED: 'GROUNDING_FAILED',
  VALIDATION: 'VALIDATION',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  FORBIDDEN: 'FORBIDDEN',
  NOT_SUPPORTED_IN_WEB: 'NOT_SUPPORTED_IN_WEB',
  UNKNOWN: 'UNKNOWN'
});

const CATALOG = {
  KEY_INVALID: {
    message: 'The Anthropic API key is missing or not valid.',
    hint: 'Open Profile & Settings and paste a standard API key (it starts with sk-ant-api).',
    retryable: false,
    status: 400
  },
  KEY_ADMIN: {
    message: 'Anthropic admin keys cannot make model calls.',
    hint: 'Create a standard API key in the Anthropic Console and use that instead.',
    retryable: false,
    status: 400
  },
  AUTH_REJECTED: {
    message: 'Anthropic rejected this API key.',
    hint: 'Check the key in Profile & Settings, or create a new one in the Anthropic Console.',
    retryable: false,
    status: 401
  },
  KEY_PERMISSION: {
    message: 'This API key is not allowed to use that model or feature.',
    hint: 'Enable the model in the Anthropic Console, or choose a different model in Profile & Settings.',
    retryable: false,
    status: 403
  },
  RATE_LIMITED: {
    message: 'Anthropic is rate-limiting this key.',
    hint: 'Wait about a minute, then retry.',
    retryable: true,
    status: 429
  },
  SPEND_CAP: {
    message: 'The Anthropic account behind this key has reached its spend limit.',
    hint: 'Raise or reset the limit in the Anthropic Console, or use a different API key.',
    retryable: false,
    status: 429
  },
  OVERLOADED: {
    message: 'Anthropic is temporarily busy.',
    hint: 'Retry in a moment.',
    retryable: true,
    status: 503
  },
  BUDGET_EXCEEDED: {
    message: 'The daily AI budget has been reached.',
    hint: 'Raise the daily budget in Settings, or wait until tomorrow.',
    retryable: false,
    status: 402
  },
  NETWORK_OFFLINE: {
    message: 'Could not reach the service.',
    hint: 'Check your connection, then retry. Nothing was saved.',
    retryable: true,
    status: 502
  },
  CORS_BLOCKED: {
    message: 'The browser blocked the request to the service.',
    hint: 'Allow the API host in your browser or proxy, then retry.',
    retryable: true,
    status: 502
  },
  STORAGE_FULL: {
    message: 'This browser is out of space for your data.',
    hint: 'Export your data, then delete old applications or documents.',
    retryable: false,
    status: 507
  },
  STORAGE_UNAVAILABLE: {
    message: 'Local storage is unavailable.',
    hint: 'Allow site data for this page (private windows block it), then reload.',
    retryable: false,
    status: 503
  },
  FEED_FAILED: {
    message: 'A job feed did not respond.',
    hint: 'Retry this feed; the other feeds still work.',
    retryable: true,
    status: 502
  },
  GROUNDING_FAILED: {
    message: 'The answer cited a source that was not retrieved, so it was not shown.',
    hint: 'Review the cited sources and try again.',
    retryable: true,
    status: 422
  },
  VALIDATION: {
    message: 'Some details were rejected.',
    hint: 'Check the highlighted values and try again.',
    retryable: false,
    status: 400
  },
  NOT_FOUND: {
    message: 'That item could not be found.',
    hint: 'Refresh the page — it may have been deleted.',
    retryable: false,
    status: 404
  },
  CONFLICT: {
    message: 'That action is already in progress.',
    hint: 'Wait for the current run to finish, then try again.',
    retryable: true,
    status: 409
  },
  FORBIDDEN: {
    message: 'That action is not allowed here.',
    hint: 'This action is not available from here. Reload the app and try again.',
    retryable: false,
    status: 403
  },
  NOT_SUPPORTED_IN_WEB: {
    message: 'This action is not available in the web app.',
    hint: 'Open SA-JAS Desktop (the Runner) to use it.',
    retryable: false,
    status: 501
  },
  UNKNOWN: {
    message: 'Something went wrong.',
    hint: 'Retry. If it keeps happening, copy the diagnostics from the error and check the Activity Logs.',
    retryable: true,
    status: 500
  }
};

export class ClaudeAuthError extends Error {
  constructor(message = 'Anthropic rejected the API key. Check it in Settings.', status) {
    super(message);
    this.name = 'ClaudeAuthError';
    if (status != null) this.status = status;
  }
}

/** A valid key that is not allowed to use a model or feature (HTTP 403). */
export class ClaudePermissionError extends Error {
  constructor(message = 'This API key is not allowed to use that model or feature.', status = 403) {
    super(message);
    this.name = 'ClaudePermissionError';
    this.status = status;
  }
}

export class ClaudeRefusalError extends Error {
  constructor(message = 'Claude declined this request.', details) {
    super(message);
    this.name = 'ClaudeRefusalError';
    if (details !== undefined) this.details = details;
  }
}

/** The supplied key is malformed or the wrong kind (rejected before any request). */
export class ClaudeKeyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ClaudeKeyError';
  }
}

/** An error that already carries a contract code. */
export class AppError extends Error {
  constructor(code, message, { hint, retryable, status, details, cause } = {}) {
    super(message || undefined, cause ? { cause } : undefined);
    this.name = 'AppError';
    this.code = Object.hasOwn(ERROR_CODES, code) ? code : ERROR_CODES.UNKNOWN;
    const entry = CATALOG[this.code];
    if (hint !== undefined) this.hint = hint;
    this.retryable = retryable ?? entry.retryable;
    this.status = status ?? entry.status;
    if (details !== undefined) this.details = details;
  }
}

export function statusForCode(code) {
  return CATALOG[code]?.status ?? CATALOG.UNKNOWN.status;
}

function newRequestId() {
  const uuid = globalThis.crypto?.randomUUID?.();
  const raw = uuid || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `local-${raw.replace(/-/g, '').slice(0, 12)}`;
}

function text(value, fallback = '') {
  const source = typeof value === 'string' || value == null ? value : stringify(value);
  return scrubSecrets(String(source ?? fallback)).trim();
}

function stringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function finalize(code, message, opts, context) {
  const safeCode = Object.hasOwn(ERROR_CODES, code) ? code : ERROR_CODES.UNKNOWN;
  const entry = CATALOG[safeCode];
  const payload = {
    code: safeCode,
    message: text(message) || text(context.fallback) || entry.message,
    hint: text(opts.hint) || entry.hint,
    retryable: opts.retryable ?? entry.retryable,
    requestId: String(context.requestId || opts.requestId || newRequestId())
  };
  const details = text(opts.details);
  if (details) payload.details = details.slice(0, 2000);
  return payload;
}

/** A 400, 402 or 429 that is a spend cap, not a validation error or transient rate limit. */
export function isSpendCapError(err) {
  const type = err?.error?.type || err?.type;
  if (type === 'billing_error') return true;
  // Raw API bodies nest the text at error.message; the SDK also copies it up.
  const message = [err?.error?.message, err?.message].filter(Boolean).join(' ');
  return /spend(?:ing)? (?:cap|limit)|credit balance|billing/i.test(message);
}

function isPermissionError(err) {
  const type = err?.error?.type || err?.type;
  return type === 'permission_error' || /permission_error/i.test(String(err?.message || ''));
}

function isConnectionError(err, message) {
  if (err?.name === 'APIConnectionError') return true;
  if (/ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|fetch failed|Failed to fetch|Load failed|network error/i.test(message)) return true;
  return err instanceof TypeError && /fetch|network|load failed/i.test(message);
}

function offline(context) {
  if (context.online === false) return true;
  return context.online === undefined
    && typeof navigator !== 'undefined'
    && navigator.onLine === false;
}

/**
 * Map any thrown value or already-shaped error object to the user-facing
 * contract. Idempotent: a payload that already carries one of our codes is
 * normalised with defaults, not wrapped again.
 */
export function toUserError(err, context = {}) {
  context = context ?? {};
  if (err instanceof AppError) return finalize(err.code, err.message, err, context);

  if (err && typeof err === 'object' && typeof err.code === 'string' && Object.hasOwn(ERROR_CODES, err.code)) {
    return finalize(err.code, err.message || err.error, err, context);
  }

  const message = err?.message || '';
  const status = err?.status ?? err?.statusCode ?? null;

  if (err instanceof ClaudeKeyError) {
    const code = /admin/i.test(message) ? ERROR_CODES.KEY_ADMIN : ERROR_CODES.KEY_INVALID;
    return finalize(code, message, {}, context);
  }
  if (err instanceof ClaudePermissionError) return finalize(ERROR_CODES.KEY_PERMISSION, message, {}, context);
  if (err instanceof ClaudeAuthError) return finalize(ERROR_CODES.AUTH_REJECTED, message, {}, context);
  if (err instanceof ClaudeRefusalError) {
    return finalize(ERROR_CODES.UNKNOWN, message, {
      hint: 'Try again, or choose a different job or a shorter request.',
      retryable: false,
      details: err.details
    }, context);
  }
  if (err?.name === 'APIConnectionTimeoutError') {
    return finalize(ERROR_CODES.OVERLOADED, 'The AI service did not respond in time.', {}, context);
  }
  if (err?.name === 'QuotaExceededError') return finalize(ERROR_CODES.STORAGE_FULL, message, {}, context);
  if (err?.name === 'InvalidStateError') return finalize(ERROR_CODES.STORAGE_UNAVAILABLE, message, {}, context);

  if (isConnectionError(err, message)) {
    if (!offline(context) && context.crossOrigin === true) {
      return finalize(ERROR_CODES.CORS_BLOCKED, message, {}, context);
    }
    return finalize(ERROR_CODES.NETWORK_OFFLINE, message, {}, context);
  }

  // An exhausted credit balance arrives as a 400 invalid_request_error as well
  // as the documented 402/429, so classify it by body before the 400 fallback.
  if (status === 402 || ((status === 400 || status === 429) && isSpendCapError(err))) {
    return finalize(ERROR_CODES.SPEND_CAP, message, {}, context);
  }
  if (isPermissionError(err)) return finalize(ERROR_CODES.KEY_PERMISSION, message, {}, context);
  if (status === 401 || status === 403) return finalize(ERROR_CODES.AUTH_REJECTED, message, {}, context);
  if (status === 429) return finalize(ERROR_CODES.RATE_LIMITED, message, {}, context);
  if (status === 529 || (typeof status === 'number' && status >= 500)) {
    return finalize(ERROR_CODES.OVERLOADED, message, {}, context);
  }
  if (status === 404) return finalize(ERROR_CODES.NOT_FOUND, message, {}, context);
  if (status === 409) return finalize(ERROR_CODES.CONFLICT, message, {}, context);
  if (status === 413) return finalize(ERROR_CODES.VALIDATION, 'That upload is too large.', { hint: 'Reduce the file size and try again.' }, context);
  if (status === 415) return finalize(ERROR_CODES.VALIDATION, 'That file type is not supported.', { hint: 'Use a supported document format and try again.' }, context);
  if (status === 400 || status === 422) return finalize(ERROR_CODES.VALIDATION, message, {}, context);

  return finalize(ERROR_CODES.UNKNOWN, message, {}, context);
}
