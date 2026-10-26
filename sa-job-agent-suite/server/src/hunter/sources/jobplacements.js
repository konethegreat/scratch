import { buildPlacementsUrl, extractPlacements } from './_placements.js';

/**
 * Job Placements. Shares the platform engine with Executive Placements
 * (`_placements.js`), matching the original `scrapePlacements` used by both.
 */
const pagination = { param: 'page', firstValue: 1, step: 1, verified: false };

/** @type {import('../registry.js').HunterSource} */
const jobplacements = {
  id: 'jobplacements',
  name: 'Job Placements',
  tier: 'secondary',
  scope: 'oncePerKeyword',
  origin: 'https://www.jobplacements.com',
  saCheck: 'none',
  waitIdleMs: 7000,
  pagination,
  canary: { keyword: 'developer', location: null, minItems: 3 },

  buildUrl({ keyword }, pageNo = 1) {
    return buildPlacementsUrl('https://www.jobplacements.com', keyword, pagination, pageNo);
  },

  extractInPage: extractPlacements,
};

export default jobplacements;
