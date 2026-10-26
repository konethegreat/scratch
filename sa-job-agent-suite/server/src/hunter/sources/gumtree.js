import { withPageParam } from './util.js';

/**
 * Gumtree SA (jobs section). URL, selectors and field logic are moved verbatim
 * from the original `scrapeGumtreeJobs` in agents/agent1-hunter.js; only the
 * origin interpolation is new. Gumtree paginates by path
 * (`/s-jobs/v1c8p1/<slug>/k0`) and `withPageParam` only handles query params, so
 * pagination stays single-page (`param: null`), exactly as today. The URL ignores
 * location while the scope remains `perLocation` to preserve run cadence.
 * `extractInPage` is serialised into the page by page.evaluate, so it must stay
 * fully self-contained (no closures, no imports).
 */
const pagination = { param: null, firstValue: 1, step: 1, verified: false };

/** @type {import('../registry.js').HunterSource} */
const gumtree = {
  id: 'gumtree',
  name: 'Gumtree SA',
  tier: 'secondary',
  scope: 'perLocation',
  origin: 'https://www.gumtree.co.za',
  saCheck: 'none',
  waitIdleMs: 3000,
  pagination,
  canary: { keyword: 'developer', location: 'Johannesburg', minItems: 3 },

  buildUrl({ keyword }, pageNo = 1) {
    const slug = keyword.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const url = `https://www.gumtree.co.za/s-jobs/v1c8p1/${encodeURIComponent(slug)}/k0`;
    return withPageParam(url, pagination, pageNo);
  },

  extractInPage: ({ origin }) => {
    const items = [];
    const cards = document.querySelectorAll('.view-list-item, .tileV2, article[class*="listing"], [class*="listing-item"]');
    cards.forEach(card => {
      const titleEl = card.querySelector('.title a, h2 a, h3 a, a[class*="title"]');
      const locationEl = card.querySelector('[class*="location"], .location, [class*="area"]');
      const descEl = card.querySelector('[class*="description"], p');
      if (titleEl && titleEl.textContent && titleEl.textContent.trim().length > 3) {
        let url = titleEl.getAttribute('href') || '';
        if (url && url.startsWith('/')) url = origin + url;
        items.push({
          title: titleEl.textContent.trim(),
          company: 'See listing',
          location: locationEl ? locationEl.textContent.trim() : 'South Africa',
          description: descEl ? descEl.textContent.trim().substring(0, 500) : '',
          applyUrl: url,
          datePosted: 'Recently',
          source: 'Gumtree SA'
        });
      }
    });
    return items;
  },
};

export default gumtree;
