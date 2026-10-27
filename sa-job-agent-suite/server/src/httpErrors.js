// HTTP adapter for the shared error contract (packages/core/src/errors.js).
// Every route answers failures through sendError so the desktop UI, the demo
// and the future web port all read the same fields.

import { randomUUID } from 'node:crypto';
import { AppError, ERROR_CODES, statusForCode, toUserError } from '@sajas/core/errors';

export const REQUEST_ID_HEADER = 'X-Request-Id';

/** Give every request an id that appears in the body and the response header. */
export function requestContext(req, res, next) {
  req.id = `local-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  res.setHeader(REQUEST_ID_HEADER, req.id);
  next();
}

export function errorBody(err, requestId, { success = true } = {}) {
  const payload = toUserError(err, { requestId });
  const status = err instanceof AppError ? err.status : statusForCode(payload.code);
  const body = { error: payload.message, ...payload };
  if (success === false) body.success = false;
  return { status, body };
}

export function sendError(res, err, { status, success = true } = {}) {
  const derived = errorBody(err, res.req?.id ?? null, { success });
  return res.status(status ?? derived.status).json(derived.body);
}

function helper(code) {
  return (res, message, { success = true, ...opts } = {}) =>
    sendError(res, new AppError(code, message, opts), { success });
}

export const badRequest = helper(ERROR_CODES.VALIDATION);
export const notFound = helper(ERROR_CODES.NOT_FOUND);
export const conflict = helper(ERROR_CODES.CONFLICT);
export const forbidden = helper(ERROR_CODES.FORBIDDEN);

/** Terminal middleware: a thrown route error becomes a contract response. */
export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  return sendError(res, err);
}
