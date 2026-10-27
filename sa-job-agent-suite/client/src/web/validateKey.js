// Zero-knowledge key check: one GET from the browser to Anthropic's own API.
// The key appears only in the x-api-key header; nothing is sent to our origin.
import { AppError, ERROR_CODES, toUserError, isSpendCapError } from '@sajas/core/errors';
import { normalizeKeyInput, isAnthropicKeyShape, isAdminKeyShape } from '@sajas/core/secrets';

export const MODELS_PROBE_URL = 'https://api.anthropic.com/v1/models?limit=1';

const SPEND_CAP_MESSAGE = 'The Anthropic account behind this key has reached its spend or credit limit.';

// A 400 or 429 is ambiguous: the former is usually a rejected key and the
// latter a transient rate limit, but either can also be a permanent spend cap
// (an exhausted credit balance arrives as a 400 invalid_request_error).
// Anthropic names the latter in the body, so read it once and classify.
async function bodyIsSpendCap(res) {
  try {
    return isSpendCapError(await res.json());
  } catch {
    return false;
  }
}

export async function validateAnthropicKey(raw, { fetchImpl = globalThis.fetch, online } = {}) {
  const key = normalizeKeyInput(raw);
  if (isAdminKeyShape(key)) {
    throw new AppError(ERROR_CODES.KEY_ADMIN, 'That is an Anthropic Admin key. Create a standard API key in the Console and use that instead.');
  }
  if (!isAnthropicKeyShape(key)) {
    throw new AppError(ERROR_CODES.KEY_INVALID, 'That does not look like an Anthropic API key. It should start with sk-ant-api.');
  }

  let res;
  try {
    res = await fetchImpl(MODELS_PROBE_URL, {
      method: 'GET',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2026-10-21',
        'anthropic-dangerous-direct-browser-access': 'true'
      }
    });
  } catch (err) {
    const payload = toUserError(err, { crossOrigin: true, online });
    // A fetch that cannot be made always surfaces as a TypeError. Map even a
    // message our connection heuristics do not recognise to the network/CORS
    // contract rather than letting it fall through to UNKNOWN.
    if (err instanceof TypeError && payload.code === ERROR_CODES.UNKNOWN) {
      const code = online === true ? ERROR_CODES.CORS_BLOCKED : ERROR_CODES.NETWORK_OFFLINE;
      const offlinePayload = toUserError(new AppError(code, undefined), { crossOrigin: true, online });
      throw new AppError(offlinePayload.code, offlinePayload.message, {
        hint: offlinePayload.hint,
        retryable: offlinePayload.retryable
      });
    }
    throw new AppError(payload.code, payload.message, {
      hint: payload.hint,
      retryable: payload.retryable,
      details: payload.details
    });
  }

  if (res.ok) return true;
  if (res.status === 402) {
    throw new AppError(ERROR_CODES.SPEND_CAP, SPEND_CAP_MESSAGE);
  }
  if (res.status === 400 || res.status === 429) {
    if (await bodyIsSpendCap(res)) {
      throw new AppError(ERROR_CODES.SPEND_CAP, SPEND_CAP_MESSAGE);
    }
    if (res.status === 429) {
      throw new AppError(ERROR_CODES.RATE_LIMITED, 'Anthropic is rate-limiting this key right now.');
    }
  }
  if (res.status >= 500) {
    throw new AppError(ERROR_CODES.OVERLOADED, 'Anthropic is temporarily unavailable. Try again in a moment.');
  }
  if (res.status === 403) {
    throw new AppError(ERROR_CODES.KEY_PERMISSION, 'This key is valid but is not allowed to list models. Check its permissions in the Anthropic Console.');
  }
  throw new AppError(ERROR_CODES.AUTH_REJECTED, 'Anthropic rejected this key. Check that it is a standard API key, not an admin key.');
}
