import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { AppError, ERROR_CODES } from '@sajas/core/errors';
import {
  requestContext,
  errorBody,
  sendError,
  badRequest,
  notFound,
  conflict,
  forbidden,
  errorHandler
} from './httpErrors.js';

function fakeRes(id = 'local-test1234') {
  return {
    req: { id },
    statusCode: null,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    headersSent: false
  };
}

test('requestContext calls next', () => {
  const res = fakeRes();
  let called = false;
  requestContext({}, res, () => { called = true; });
  assert.equal(called, true);
});

test('requestContext generates a local-… id and exposes it as X-Request-Id', () => {
  const req = {};
  const res = fakeRes();
  requestContext(req, res, () => {});
  assert.match(req.id, /^local-[0-9a-f]{12}$/);
  assert.equal(res.headers['X-Request-Id'], req.id);
});

test('sendError derives status and the full wire shape from an AppError', () => {
  const res = fakeRes('local-abc');
  sendError(res, new AppError(ERROR_CODES.NOT_FOUND, 'Job not found.'));
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, 'Job not found.');
  assert.equal(res.body.message, 'Job not found.');
  assert.equal(res.body.code, 'NOT_FOUND');
  assert.equal(res.body.retryable, false);
  assert.equal(res.body.requestId, 'local-abc');
  assert.ok(res.body.hint.length > 0);
  assert.equal(Object.hasOwn(res.body, 'details'), false);
  assert.equal(res.headers['X-Request-Id'], res.body.requestId);
});

test('sendError maps a plain error to 500 UNKNOWN with no stack', () => {
  const res = fakeRes();
  sendError(res, new Error('boom'));
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.code, 'UNKNOWN');
  assert.equal(res.body.message, 'boom');
  assert.equal(Object.hasOwn(res.body, 'details'), false);
  assert.ok(!JSON.stringify(res.body).includes('    at '));
});

test('sendError preserves an integer upstream 4xx and maps 413 to VALIDATION', () => {
  const res = fakeRes('local-up413');
  sendError(res, { status: 413, message: 'too large' });
  assert.equal(res.statusCode, 413);
  assert.equal(res.body.error, res.body.message);
  assert.equal(res.body.code, 'VALIDATION');
  assert.equal(res.body.retryable, false);
  assert.ok(res.body.hint.length > 0);
  assert.equal(res.body.requestId, 'local-up413');
  assert.equal(res.headers['X-Request-Id'], res.body.requestId);
});

test('sendError honours an explicit status and the legacy success flag', () => {
  const res = fakeRes();
  sendError(res, new AppError(ERROR_CODES.CONFLICT, 'busy'), { status: 423, success: false });
  assert.equal(res.statusCode, 423);
  assert.equal(res.body.success, false);
  assert.equal(res.body.code, 'CONFLICT');
});

test('the 4xx helpers map to the right status and code', () => {
  for (const [helper, status, code] of [
    [badRequest, 400, 'VALIDATION'],
    [notFound, 404, 'NOT_FOUND'],
    [conflict, 409, 'CONFLICT'],
    [forbidden, 403, 'FORBIDDEN']
  ]) {
    const res = fakeRes();
    helper(res, 'nope');
    assert.equal(res.statusCode, status, code);
    assert.equal(res.body.code, code);
    assert.equal(res.body.error, 'nope');
  }
});

test('a helper passes AppError options through and keeps success:false', () => {
  const res = fakeRes();
  conflict(res, 'busy', { success: false, hint: 'Wait.', details: 'owner=hunt' });
  assert.equal(res.body.success, false);
  assert.equal(res.body.hint, 'Wait.');
  assert.equal(res.body.details, 'owner=hunt');
});

test('key-shaped text never reaches the response body', () => {
  const key = 'sk-' + 'ant-api03-' + 'B'.repeat(40);
  const { body } = errorBody(new AppError('UNKNOWN', `bad ${key}`), 'local-x');
  assert.ok(!JSON.stringify(body).includes(key));
  assert.ok(body.message.includes('redacted-key'));
});

test('sendError synthesises and mirrors an id when res.req has no id', () => {
  const res = fakeRes();
  delete res.req.id;
  sendError(res, new AppError(ERROR_CODES.NOT_FOUND, 'gone'));
  assert.equal(res.headers['X-Request-Id'], res.body.requestId);
  assert.match(res.body.requestId, /^local-/);
});

test('errorHandler logs a 5xx with the request id and scrubbed message', () => {
  const key = 'sk-' + 'ant-api03-' + 'C'.repeat(40);
  const res = fakeRes('local-log1234567');
  const captured = [];
  const originalError = console.error;
  console.error = (line) => { captured.push(line); };
  try {
    errorHandler(new Error('boom ' + key), res.req, res, () => {});
  } finally {
    console.error = originalError;
  }
  assert.equal(res.statusCode, 500);
  assert.equal(captured.length, 1);
  const line = captured[0];
  assert.ok(line.includes('local-log1234567'));
  assert.ok(line.includes('redacted-key'));
  assert.ok(!line.includes(key));
  assert.ok(!line.includes('    at '));
});

test('errorHandler does not log a 4xx', () => {
  const res = fakeRes('local-log1234567');
  const captured = [];
  const originalError = console.error;
  console.error = (line) => { captured.push(line); };
  try {
    errorHandler(new AppError(ERROR_CODES.RATE_LIMITED, 'slow down'), res.req, res, () => {});
  } finally {
    console.error = originalError;
  }
  assert.equal(res.statusCode, 429);
  assert.equal(captured.length, 0);
});

test('errorHandler mirrors a synthesised id when no request id is present', () => {
  const res = fakeRes();
  res.req = {};
  const captured = [];
  const originalError = console.error;
  console.error = (line) => { captured.push(line); };
  try {
    errorHandler(new Error('boom'), {}, res, () => {});
  } finally {
    console.error = originalError;
  }
  assert.equal(res.statusCode, 500);
  assert.equal(res.headers['X-Request-Id'], res.body.requestId);
  assert.match(res.body.requestId, /^local-/);
});

test('errorHandler flattens newlines out of the 5xx log line', () => {
  const res = fakeRes();
  res.req = { id: 'local-flat123456' };
  const captured = [];
  const originalError = console.error;
  console.error = (line) => { captured.push(line); };
  try {
    errorHandler(new Error('boom\n    at fake frame'), res.req, res, () => {});
  } finally {
    console.error = originalError;
  }
  assert.equal(captured.length, 1);
  assert.ok(!captured[0].includes('\n'));
});

test('errorHandler answers a thrown route error with the contract', async () => {
  const app = express();
  app.use(requestContext);
  app.get('/boom', () => { throw new AppError(ERROR_CODES.RATE_LIMITED, 'slow down'); });
  app.use(errorHandler);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/boom`);
    const body = await response.json();
    assert.equal(response.status, 429);
    assert.equal(body.code, 'RATE_LIMITED');
    assert.match(body.requestId, /^local-/);
    assert.equal(response.headers.get('x-request-id'), body.requestId);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
