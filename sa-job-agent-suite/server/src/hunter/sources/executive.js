import { buildPlacementsUrl, extractPlacements } from './_placements.js';

/**
 * Executive Placements. Shares the platform engine with Job Placements
 * (`_placements.js`), matching the original `scrapePlacements` used by both.
 */
const pagination = { param: 'page', firstValue: 1, step: 1, verified: false };

/** @type {import('../registry.js').HunterSource} */
const executive = {
  id: 'executive',
  name: 'Executive Placements',
  tier: 'secondary',
  scope: 'oncePerKeyword',
  origin: 'https://www.executiveplacements.com',
  saCheck: 'none',
  waitIdleMs: 7000,
  pagination,
  canary: { keyword: 'developer', location: null, minItems: 3 },

  buildUrl({ keyword }, pageNo = 1) {
    return buildPlacementsUrl('https://www.executiveplacements.com', keyword, pagination, pageNo);
  },

  extractInPage: extractPlacements,
};

export default executive;
