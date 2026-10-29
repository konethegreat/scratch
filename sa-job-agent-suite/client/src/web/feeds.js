// Browser-only feed client. No key, no profile data, and no persistence: results
// live in a module-level cache for this tab only.
import { FEED_SOURCES, sourceById } from '@sajas/core/feeds';
import { AppError, ERROR_CODES, toUserError } from '@sajas/core/errors';
import { isDemoMode } from './demo/mode.js';

const DEFAULTS = {
  timeoutMs: 20000,
  retryDelayMs: 750,
  cacheTtlMs: 15 * 60 * 1000
};

const RETRY_HINT = 'Retry this feed; the other feeds still work.';
const CHANGE_HINT = 'Try another feed; this one may have changed its API.';

function retryableStatus(status) {
  return status === 429 || status >= 500;
}

function offlineNow() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function failure(message, { retryable, hint, details } = {}) {
  return new AppError(ERROR_CODES.FEED_FAILED, message, {
    retryable,
    hint: hint || (retryable ? RETRY_HINT : CHANGE_HINT),
    details
  });
}

export function createFeedClient(options = {}) {
  const config = { ...DEFAULTS, ...options };
  const fetchImpl = config.fetchImpl || ((...args) => globalThis.fetch(...args));
  const now = config.now || (() => Date.now());
  const sleep = config.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const cache = new Map();
  // Bumped by clear() so a load that was already in flight cannot repopulate
  // the cache after a wipe.
  let cacheGeneration = 0;

  async function request(source) {
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (attempt > 0) await sleep(config.retryDelayMs);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);
      try {
        const response = await fetchImpl(source.endpoint, {
          signal: controller.signal,
          headers: { Accept: 'application/json' }
        });
        if (!response.ok) {
          const retryable = retryableStatus(response.status);
          const error = failure(`${source.label} rejected the request (HTTP ${response.status}).`, { retryable });
          if (attempt === 0 && retryable) { lastError = error; continue; }
          throw error;
        }
        let raw;
        try {
          raw = await response.json();
        } catch (error) {
          // The timeout can fire between response headers and the body read, so
          // an abort there is a timeout rather than an unreadable response.
          if (error?.name === 'AbortError' || controller.signal.aborted) {
            throw failure(`${source.label} did not respond in time.`, { retryable: true });
          }
          throw failure(`${source.label} sent a response this app could not read.`, { retryable: false });
        }
        try {
          return source.normalize(raw);
        } catch (error) {
          throw failure(error.message, {
            retryable: false,
            details: `${error.name}: ${error.detail || 'unexpected payload'}`
          });
        }
      } catch (error) {
        if (error instanceof AppError) {
          if (attempt === 0 && error.retryable) { lastError = error; continue; }
          throw error;
        }
        const timedOut = error?.name === 'AbortError';
        const mapped = offlineNow()
          ? new AppError(ERROR_CODES.NETWORK_OFFLINE, 'You are offline.', {
            retryable: true,
            hint: 'Reconnect, then retry this feed.'
          })
          : timedOut
            ? failure(`${source.label} did not respond in time.`, { retryable: true })
            : new AppError(ERROR_CODES.CORS_BLOCKED, `This browser blocked the request to ${source.label}.`, {
              retryable: true,
              hint: 'Retry once. If it keeps failing, the feed may be down or blocking this site.'
            });
        if (attempt === 0) { lastError = mapped; continue; }
        throw mapped;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError || failure('The feed did not respond.', { retryable: true });
  }

  async function load(id, { force = false } = {}) {
    const source = sourceById(id);
    if (!source) throw failure(`There is no feed called ${id}.`, { retryable: false });
    const entry = cache.get(id);
    if (!force && entry && now() - entry.at < config.cacheTtlMs) {
      return { source: id, label: source.label, jobs: entry.jobs, fetchedAt: new Date(entry.at).toISOString(), cached: true };
    }
    const startedGeneration = cacheGeneration;
    const jobs = await request(source);
    const at = now();
    // A clear() during the request means this result must not re-enter the cache.
    if (startedGeneration === cacheGeneration) cache.set(id, { at, jobs });
    return { source: id, label: source.label, jobs, fetchedAt: new Date(at).toISOString(), cached: false };
  }

  async function loadAll({ force = false } = {}) {
    const settled = await Promise.all(FEED_SOURCES.map(async (source) => {
      try {
        return { result: await load(source.id, { force }) };
      } catch (error) {
        return { source: source.id, label: source.label, error: toUserError(error) };
      }
    }));
    return {
      results: settled.filter((entry) => entry.result).map((entry) => entry.result),
      errors: settled.filter((entry) => entry.error)
    };
  }

  function clear() {
    cacheGeneration += 1;
    cache.clear();
  }

  return { load, loadAll, clear };
}

let shared = null;

export async function getFeedClient() {
  if (isDemoMode()) {
    const { getDemoFeedClient } = await import('./demo/feed.js');
    return getDemoFeedClient();
  }
  if (!shared) shared = createFeedClient();
  return shared;
}

export async function clearFeedCache() {
  shared?.clear();
  if (isDemoMode()) {
    const { clearDemoFeedCache } = await import('./demo/feed.js');
    clearDemoFeedCache();
  }
}
