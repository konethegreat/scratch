// Zero-knowledge key check: one GET from the browser to Anthropic's own API.
// The key appears only in the x-api-key header; nothing is sent to our origin.
import { AppError, ERROR_CODES, toUserError } from '@sajas/core/errors';
import { normalizeKeyInput, isAnthropicKeyShape, isAdminKeyShape } from '@sajas/core/secrets';

export const MODELS_PROBE_URL = 'https://api.anthropic.com/v1/models?limit=1';

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
        'anthropic-version': '2023-06-01',
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
  if (res.status === 429) {
    throw new AppError(ERROR_CODES.RATE_LIMITED, 'Anthropic is rate-limiting this key right now.');
  }
  if (res.status >= 500) {
    throw new AppError(ERROR_CODES.OVERLOADED, 'Anthropic is temporarily unavailable. Try again in a moment.');
  }
  throw new AppError(ERROR_CODES.AUTH_REJECTED, 'Anthropic rejected this key. Check that it is a standard API key, not an admin key.');
}
