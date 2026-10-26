import { withPageParam } from './util.js';

/**
 * CareerJunction SA. URL, selectors and field logic are moved verbatim from the
 * original `scrapeCareerJunction` in agents/agent1-hunter.js; only the page
 * parameter is new.
 * `extractInPage` is serialised into the page by page.evaluate, so it must stay
 * fully self-contained (no closures, no imports).
 */
const pagination = { param: 'page', firstValue: 1, step: 1, verified: false };

/** @type {import('../registry.js').HunterSource} */
const careerjunction = {
  id: 'careerjunction',
  name: 'CareerJunction',
  tier: 'major',
  scope: 'perLocation',
  origin: 'https://www.careerjunction.co.za',
  saCheck: 'none',
  waitIdleMs: 7000,
  pagination,
  canary: { keyword: 'developer', location: 'Johannesburg', minItems: 3 },

  buildUrl({ keyword, location }, pageNo = 1) {
    const url = `https://www.careerjunction.co.za/jobs/results/?k=${encodeURIComponent(keyword)}&radius=50&l=${encodeURIComponent(location)}`;
    return withPageParam(url, pagination, pageNo);
  },

  extractInPage: ({ location: loc, origin }) => {
    const items = [];
    const cards = document.querySelectorAll(
      '.job-result, .listing, [class*="job-card"], [class*="result-card"], ' +
      '[class*="search-result"], [class*="position"], article[class]'
    );
    cards.forEach(card => {
      const titleEl = card.querySelector('h2 a, h3 a, .title a, a[class*="title"], [class*="position-title"] a');
      const companyEl = card.querySelector('[class*="company"], [class*="employer"], [class*="recruiter"]');
      const locationEl = card.querySelector('[class*="location"], [class*="area"]');
      const descEl = card.querySelector('[class*="description"], [class*="snippet"], p');
      const dateEl = card.querySelector('[class*="date"], [class*="posted"], time');
      if (titleEl && titleEl.textContent.trim().length > 3) {
        let url = titleEl.getAttribute('href') || '';
        if (url.startsWith('/')) url = origin + url;
        items.push({
          title: titleEl.textContent.trim(),
          company: companyEl ? companyEl.textContent.trim() : 'Confidential',
          location: locationEl ? locationEl.textContent.trim() : (loc + ', South Africa'),
          description: descEl ? descEl.textContent.trim().substring(0, 500) : '',
          applyUrl: url,
          datePosted: dateEl ? dateEl.textContent.trim() : 'Recently',
          source: 'CareerJunction'
        });
      }
    });
    return items;
  },
};

export default careerjunction;
