// Pure pacing, Retry-After parsing and retry policy. All timing is injectable.
export const PACING_DEFAULTS = Object.freeze({
  minIntervalMs: 2000,
  jitterMs: 500,
  maxRetryAfterMs: 60000,
  retryDelaysMs: Object.freeze([5000, 15000])
});

const defaultSleep = (ms) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

export function parseRetryAfter(value, now = Date.now(), maxMs = PACING_DEFAULTS.maxRetryAfterMs) {
  const text = String(value ?? '').trim();
  if (!text) return 0;
  if (/^\d+$/.test(text)) return Math.min(Number(text) * 1000, maxMs);
  const when = Date.parse(text);
  if (Number.isNaN(when)) return 0;
  return Math.min(Math.max(when - now, 0), maxMs);
}

export function isTransientError(err) {
  const text = `${err?.name || ''} ${err?.message || err || ''}`.toLowerCase();
  return /timeout|econnreset|econnrefused|enotfound|eai_again|socket hang up|net::err_(connection|timed_out|network)/.test(text);
}

export function retryPlan({ status = null, error = null, attempt = 0, retryAfter = null, blocked = false, maxRetries = 2 } = {}) {
  if (blocked) return { retry: false, delayMs: 0 };
  if (attempt >= maxRetries) return { retry: false, delayMs: 0 };
  const transient = status == null ? isTransientError(error) : [408, 429, 503].includes(status);
  if (!transient) return { retry: false, delayMs: 0 };
  const header = parseRetryAfter(retryAfter);
  return { retry: true, delayMs: header || PACING_DEFAULTS.retryDelaysMs[attempt] || PACING_DEFAULTS.retryDelaysMs.at(-1) };
}

export function createPacer({
  minIntervalMs = PACING_DEFAULTS.minIntervalMs,
  jitterMs = PACING_DEFAULTS.jitterMs,
  now = Date.now,
  sleep = defaultSleep,
  random = Math.random
} = {}) {
  const last = new Map();
  return {
    async wait(host) {
      const key = String(host || '');
      const previous = last.get(key);
      if (previous != null) {
        const remaining = minIntervalMs + Math.floor(random() * jitterMs) - (now() - previous);
        if (remaining > 0) await sleep(remaining);
      }
      last.set(key, now());
    }
  };
}
