import { withPageParam } from './util.js';

/**
 * Adzuna SA. URL, selectors and field logic are moved verbatim from the original
 * `scrapeAdzunaSA` in agents/agent1-hunter.js; only the origin interpolation and
 * the page parameter are new.
 * `extractInPage` is serialised into the page by page.evaluate, so it must stay
 * fully self-contained (no closures, no imports).
 */
const pagination = { param: 'p', firstValue: 1, step: 1, verified: false };

/** @type {import('../registry.js').HunterSource} */
const adzuna = {
  id: 'adzuna',
  name: 'Adzuna SA',
  tier: 'secondary',
  scope: 'perLocation',
  origin: 'https://www.adzuna.co.za',
  saCheck: 'soft',
  waitIdleMs: 7000,
  pagination,
  canary: { keyword: 'developer', location: 'Johannesburg', minItems: 3 },

  buildUrl({ keyword, location }, pageNo = 1) {
    const url = `https://www.adzuna.co.za/search?q=${encodeURIComponent(keyword)}&w=${encodeURIComponent(location)}`;
    return withPageParam(url, pagination, pageNo);
  },

  extractInPage: ({ location: loc, origin }) => {
    const items = [];
    const cards = document.querySelectorAll('article, .job, [class*="result"], [class*="listing"], [class*="advert"]');
    cards.forEach(card => {
      const titleEl = card.querySelector('h2 a, h3 a, a[class*="title"], [itemprop="title"] a, .job-title a');
      const companyEl = card.querySelector('[class*="company"], [class*="employer"], [itemprop="hiringOrganization"]');
      const locationEl = card.querySelector('[class*="location"], [itemprop="addressLocality"]');
      const descEl = card.querySelector('[class*="description"], [class*="snippet"], p');
      const dateEl = card.querySelector('time, [class*="date"], [class*="posted"]');
      if (titleEl && titleEl.textContent.trim().length > 3) {
        let url = titleEl.getAttribute('href') || '';
        if (url.startsWith('/')) url = origin + url;
        items.push({
          title: titleEl.textContent.trim(),
          company: companyEl ? companyEl.textContent.trim() : 'Confidential',
          location: locationEl ? locationEl.textContent.trim() : (loc + ', South Africa'),
          description: descEl ? descEl.textContent.trim().substring(0, 500) : '',
          applyUrl: url,
          datePosted: dateEl ? (dateEl.getAttribute('datetime') || dateEl.textContent.trim()) : 'Recently',
          source: 'Adzuna SA'
        });
      }
    });
    return items;
  },
};

export default adzuna;
