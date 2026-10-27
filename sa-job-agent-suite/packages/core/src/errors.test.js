import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ERROR_CODES,
  AppError,
  toUserError,
  statusForCode,
  ClaudeAuthError,
  ClaudeKeyError,
  ClaudePermissionError,
  ClaudeRefusalError
} from './errors.js';

const fakeKey = () => 'sk-' + 'ant-api03-' + 'A'.repeat(40);

test('the code union contains the spec codes and the three HTTP extensions', () => {
  for (const code of [
    'KEY_INVALID', 'KEY_ADMIN', 'AUTH_REJECTED', 'KEY_PERMISSION', 'RATE_LIMITED',
    'SPEND_CAP', 'OVERLOADED', 'BUDGET_EXCEEDED', 'NETWORK_OFFLINE', 'CORS_BLOCKED',
    'STORAGE_FULL', 'STORAGE_UNAVAILABLE', 'FEED_FAILED', 'VALIDATION',
    'NOT_SUPPORTED_IN_WEB', 'UNKNOWN', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT'
  ]) {
    assert.equal(ERROR_CODES[code], code);
  }
  assert.equal(Object.isFrozen(ERROR_CODES), true);
});

test('statusForCode maps every code to its HTTP status', () => {
  assert.equal(statusForCode('KEY_INVALID'), 400);
  assert.equal(statusForCode('KEY_ADMIN'), 400);
  assert.equal(statusForCode('AUTH_REJECTED'), 401);
  assert.equal(statusForCode('KEY_PERMISSION'), 403);
  assert.equal(statusForCode('SPEND_CAP'), 429);
  assert.equal(statusForCode('VALIDATION'), 400);
  assert.equal(statusForCode('FORBIDDEN'), 403);
  assert.equal(statusForCode('NOT_FOUND'), 404);
  assert.equal(statusForCode('CONFLICT'), 409);
  assert.equal(statusForCode('BUDGET_EXCEEDED'), 402);
  assert.equal(statusForCode('RATE_LIMITED'), 429);
  assert.equal(statusForCode('NOT_SUPPORTED_IN_WEB'), 501);
  assert.equal(statusForCode('OVERLOADED'), 503);
  assert.equal(statusForCode('UNKNOWN'), 500);
  assert.equal(statusForCode('NOT_A_CODE'), 500);
});

test('an auth failure is AUTH_REJECTED, not retryable, with a hint and request id', () => {
  const out = toUserError(new ClaudeAuthError(undefined, 401));
  assert.equal(out.code, ERROR_CODES.AUTH_REJECTED);
  assert.equal(out.retryable, false);
  assert.match(out.requestId, /^local-[a-z0-9]{1,12}$/);
  assert.ok(out.hint.length > 0);
  assert.equal(Object.hasOwn(out, 'details'), false);
});

test('a 403 permission_error is KEY_PERMISSION, not an invalid key', () => {
  const out = toUserError(new ClaudePermissionError());
  assert.equal(out.code, ERROR_CODES.KEY_PERMISSION);
  assert.equal(out.retryable, false);
  assert.match(out.hint, /console|model/i);
  const raw = toUserError(Object.assign(new Error('permission_error'), {
    status: 403,
    error: { type: 'permission_error' }
  }));
  assert.equal(raw.code, ERROR_CODES.KEY_PERMISSION);
});

test('a spend-cap 429 or a 402 is SPEND_CAP, not a transient rate limit', () => {
  const cap = toUserError(Object.assign(new Error('You have reached your spend limit'), { status: 429 }));
  assert.equal(cap.code, ERROR_CODES.SPEND_CAP);
  assert.equal(cap.retryable, false);
  assert.match(cap.hint, /console|limit/i);
  const billing = toUserError(Object.assign(new Error('billing_error'), { status: 402, error: { type: 'billing_error' } }));
  assert.equal(billing.code, ERROR_CODES.SPEND_CAP);
  assert.equal(toUserError(Object.assign(new Error('slow down'), { status: 429 })).code, ERROR_CODES.RATE_LIMITED);
});

test('a credit-balance 400 is SPEND_CAP, while an unrelated 400 stays VALIDATION', () => {
  const credit = {
    status: 400,
    error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' }
  };
  const cap = toUserError(credit);
  assert.equal(cap.code, ERROR_CODES.SPEND_CAP);
  assert.equal(cap.retryable, false);
  // The SDK surfaces the same body with the text on the error itself.
  assert.equal(toUserError(Object.assign(new Error(credit.error.message), credit)).code, ERROR_CODES.SPEND_CAP);
  const unrelated = {
    status: 400,
    error: { type: 'invalid_request_error', message: 'model: unknown model' }
  };
  assert.equal(toUserError(unrelated).code, ERROR_CODES.VALIDATION);
  assert.equal(toUserError(unrelated).retryable, false);
});

test('status codes map to the right family', () => {
  const status = (n) => toUserError(Object.assign(new Error(`http ${n}`), { status: n })).code;
  assert.equal(status(401), ERROR_CODES.AUTH_REJECTED);
  assert.equal(status(403), ERROR_CODES.AUTH_REJECTED);
  assert.equal(status(429), ERROR_CODES.RATE_LIMITED);
  assert.equal(status(529), ERROR_CODES.OVERLOADED);
  assert.equal(status(500), ERROR_CODES.OVERLOADED);
  assert.equal(status(400), ERROR_CODES.VALIDATION);
  assert.equal(status(404), ERROR_CODES.NOT_FOUND);
  assert.equal(status(409), ERROR_CODES.CONFLICT);
});

test('rate limits and overloads are retryable; budget and validation are not', () => {
  assert.equal(toUserError(Object.assign(new Error('slow'), { status: 429 })).retryable, true);
  assert.equal(toUserError(Object.assign(new Error('busy'), { status: 529 })).retryable, true);
  const budget = Object.assign(new Error('paused'), { code: 'BUDGET_EXCEEDED' });
  const out = toUserError(budget);
  assert.equal(out.code, ERROR_CODES.BUDGET_EXCEEDED);
  assert.equal(out.retryable, false);
  assert.equal(toUserError(Object.assign(new Error('bad'), { status: 400 })).retryable, false);
});

test('413 and 415 map to a non-retryable VALIDATION with upload-specific copy', () => {
  const tooLarge = toUserError({ status: 413, message: 'too large' });
  assert.equal(tooLarge.code, ERROR_CODES.VALIDATION);
  assert.equal(tooLarge.retryable, false);
  assert.match(tooLarge.message, /too large/i);
  assert.match(tooLarge.hint, /file size/i);
  const wrongType = toUserError({ status: 415, message: 'bad type' });
  assert.equal(wrongType.code, ERROR_CODES.VALIDATION);
  assert.equal(wrongType.retryable, false);
  assert.match(wrongType.hint, /supported document format/i);
});

test('local key errors split into KEY_ADMIN and KEY_INVALID', () => {
  const admin = toUserError(new ClaudeKeyError('That is an Admin key. Create a standard API key.'));
  assert.equal(admin.code, ERROR_CODES.KEY_ADMIN);
  const invalid = toUserError(new ClaudeKeyError('That does not look like an Anthropic API key.'));
  assert.equal(invalid.code, ERROR_CODES.KEY_INVALID);
  assert.equal(invalid.retryable, false);
});

test('a refusal stays user-readable and is not offered as a retry', () => {
  const out = toUserError(new ClaudeRefusalError('Claude declined this request.', 'policy'));
  assert.equal(out.code, ERROR_CODES.UNKNOWN);
  assert.equal(out.retryable, false);
  assert.equal(out.message, 'Claude declined this request.');
  assert.match(out.hint, /different job|shorter request/i);
});

test('object details are serialised, not flattened to [object Object]', () => {
  const info = toUserError(new ClaudeRefusalError('Declined.', { category: 'cyber', reason: 'policy' }));
  assert.equal(info.details.includes('[object Object]'), false);
  assert.match(info.details, /cyber/);
});

test('a null context is treated as an empty one', () => {
  const info = toUserError(new ClaudeRefusalError('Declined.'), null);
  assert.equal(info.code, 'UNKNOWN');
  assert.match(info.requestId, /^local-[a-z0-9]{1,12}$/);
});

test('connection failures split offline from CORS', () => {
  const failure = new TypeError('Failed to fetch');
  assert.equal(toUserError(failure, { online: false }).code, ERROR_CODES.NETWORK_OFFLINE);
  assert.equal(toUserError(failure, { crossOrigin: true }).code, ERROR_CODES.CORS_BLOCKED);
  assert.equal(toUserError(failure).code, ERROR_CODES.NETWORK_OFFLINE);
  assert.equal(toUserError(failure, { crossOrigin: true }).retryable, true);
});

test('storage failures are typed and not retryable', () => {
  const quota = Object.assign(new Error('full'), { name: 'QuotaExceededError' });
  const blocked = Object.assign(new Error('blocked'), { name: 'InvalidStateError' });
  assert.equal(toUserError(quota).code, ERROR_CODES.STORAGE_FULL);
  assert.equal(toUserError(blocked).code, ERROR_CODES.STORAGE_UNAVAILABLE);
  assert.equal(toUserError(quota).retryable, false);
});

test('an HTTP body already in the contract shape is normalised, not re-wrapped', () => {
  const out = toUserError({ code: 'FEED_FAILED', message: 'Remotive did not respond.' });
  assert.equal(out.code, ERROR_CODES.FEED_FAILED);
  assert.equal(out.message, 'Remotive did not respond.');
  assert.equal(out.retryable, true);
  assert.ok(out.hint.length > 0);
});

test('context.fallback supplies the message when the error has none', () => {
  const out = toUserError(new Error(''), { fallback: 'Could not save profile.' });
  assert.equal(out.code, ERROR_CODES.UNKNOWN);
  assert.equal(out.message, 'Could not save profile.');
});

test('request ids are honoured from context or from an existing payload', () => {
  assert.equal(toUserError(new Error('x'), { requestId: 'local-abc123' }).requestId, 'local-abc123');
  assert.equal(
    toUserError({ code: 'FEED_FAILED', message: 'x', requestId: 'local-frombody' }).requestId,
    'local-frombody'
  );
});

test('key-shaped text is scrubbed from message, hint and details', () => {
  const key = fakeKey();
  const out = toUserError(new AppError('UNKNOWN', `bad key ${key}`, { details: `trace ${key}` }));
  assert.ok(!out.message.includes(key));
  assert.ok(out.message.includes('redacted-key'));
  assert.ok(!out.details.includes(key));
});

test('AppError fills defaults from the catalog and falls back on unknown codes', () => {
  const rate = new AppError('RATE_LIMITED', 'slow down');
  assert.equal(rate.status, 429);
  assert.equal(rate.retryable, true);
  const unknown = new AppError('NOT_A_CODE', 'x');
  assert.equal(unknown.code, ERROR_CODES.UNKNOWN);
  assert.equal(unknown.status, 500);
});
