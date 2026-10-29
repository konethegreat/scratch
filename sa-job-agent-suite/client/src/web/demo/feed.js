// Local feed results for the demo. No fetch, no retry and no cache: the rows are
// fixtures shaped exactly like createFeedClient results.
import { FEED_SOURCES, sourceById } from '@sajas/core/feeds';
import { AppError, ERROR_CODES } from '@sajas/core/errors';
import { DEMO_FEEDS } from './fixtures.js';

export function createDemoFeedClient({ datasets = DEMO_FEEDS, now = () => new Date() } = {}) {
  async function load(id) {
    const source = sourceById(id);
    if (!source) {
      throw new AppError(ERROR_CODES.FEED_FAILED, `There is no feed called ${id}.`, { retryable: false });
    }
    return {
      source: id,
      label: source.label,
      jobs: (datasets[id] || []).map((job) => ({ ...job })),
      fetchedAt: now().toISOString(),
      cached: false
    };
  }

  return {
    load,
    async loadAll() {
      const results = await Promise.all(FEED_SOURCES.map((source) => load(source.id)));
      return { results, errors: [] };
    },
    clear() {
      // Fixtures are static, so there is no cache to drop.
    }
  };
}

let shared = null;

export function getDemoFeedClient() {
  if (!shared) shared = createDemoFeedClient();
  return shared;
}

export function clearDemoFeedCache() {
  shared?.clear();
  shared = null;
}
