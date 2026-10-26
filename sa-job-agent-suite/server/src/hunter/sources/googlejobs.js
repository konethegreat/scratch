import { withPageParam } from './util.js';

/**
 * Google Jobs (via Google Search). URL, selectors and field logic are moved
 * verbatim from the original `scrapeGoogleJobs` in agents/agent1-hunter.js; only
 * the page parameter (infinite scroll, so single page) is new.
 * Google Jobs cards never expose a direct apply link, so this source is
 * `linkless` and emits `applyUrl: ''` (same ruling as before).
 * `extractInPage` is serialised into the page by page.evaluate, so it must stay
 * fully self-contained (no closures, no imports).
 */
const pagination = { param: null, firstValue: 1, step: 1, verified: false };

/** @type {import('../registry.js').HunterSource} */
const googlejobs = {
  id: 'googlejobs',
  name: 'Google Jobs',
  tier: 'secondary',
  scope: 'perLocation',
  origin: 'https://www.google.com',
  skipJsonLd: true,
  linkless: true,
  saCheck: 'strict',
  waitIdleMs: 4000,
  pagination,
  canary: { keyword: 'developer', location: 'Johannesburg', minItems: 3 },

  buildUrl({ keyword, location }, pageNo = 1) {
    // Explicitly include "South Africa" in the query — Google's job widget geo-infers
    // from the server location (typically US) if not specified.
    const url = `https://www.google.com/search?q=${encodeURIComponent(keyword + ' jobs ' + location + ' South Africa')}&ibp=htl;jobs&gl=za&hl=en-ZA`;
    return withPageParam(url, pagination, pageNo);
  },

  extractInPage: () => {
    const items = [];
    // Google Jobs cards
    const cards = document.querySelectorAll('.iFjolb, [jscontroller] li, .PwjeAc');
    cards.forEach(card => {
      const titleEl = card.querySelector('.BjJfJf, [class*="BjJfJf"], .sH3zFd, div[role="heading"]');
      const companyEl = card.querySelector('.vNEEBe, [class*="vNEEBe"], .nJlDiv');
      const locationEl = card.querySelector('.Qk80Jf, [class*="Qk80Jf"], .pwO9Le');

      if (titleEl && titleEl.textContent && titleEl.textContent.trim().length > 3) {
        // Google Jobs cards don't expose a direct employer apply URL on the
        // search results page. Leave applyUrl empty so Agent 3 rejects it
        // cleanly instead of navigating to a Google search page.
        items.push({
          title: titleEl.textContent.trim(),
          company: companyEl ? companyEl.textContent.trim() : 'Confidential',
          location: locationEl ? locationEl.textContent.trim() : 'South Africa',
          description: '',
          applyUrl: '',
          datePosted: 'Recently',
          source: 'Google Jobs'
        });
      }
    });
    return items;
  },
};

export default googlejobs;
