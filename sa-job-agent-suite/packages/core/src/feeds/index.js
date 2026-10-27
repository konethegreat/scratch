import { normalizeRemotive } from './remotive.js';
import { normalizeArbeitnow } from './arbeitnow.js';
import { normalizeJobicy } from './jobicy.js';

export { normalizeRemotive, normalizeArbeitnow, normalizeJobicy };
export * from './shape.js';
export * from './match.js';

export const FEED_SOURCES = Object.freeze([
  {
    id: 'remotive',
    label: 'Remotive',
    endpoint: 'https://remotive.com/api/remote-jobs',
    home: 'https://remotive.com',
    normalize: normalizeRemotive
  },
  {
    id: 'arbeitnow',
    label: 'Arbeitnow',
    endpoint: 'https://www.arbeitnow.com/api/job-board-api',
    home: 'https://www.arbeitnow.com',
    normalize: normalizeArbeitnow
  },
  {
    id: 'jobicy',
    label: 'Jobicy',
    endpoint: 'https://jobicy.com/api/v2/remote-jobs',
    home: 'https://jobicy.com',
    normalize: normalizeJobicy
  }
]);

export function sourceById(id) {
  return FEED_SOURCES.find((source) => source.id === id) || null;
}

export function sourceLabel(id) {
  return sourceById(id)?.label || String(id || '');
}
