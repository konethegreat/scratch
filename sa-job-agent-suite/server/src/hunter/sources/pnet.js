import { withPageParam } from './util.js';

/**
 * PNet SA. URL, selectors and field logic are moved verbatim from the original
 * `scrapePNet` in agents/agent1-hunter.js; only the page parameter is new.
 * `extractInPage` is serialised into the page by page.evaluate, so it must stay
 * fully self-contained (no closures, no imports).
 */
const pagination = { param: 'page', firstValue: 1, step: 1, verified: false };

/** @type {import('../registry.js').HunterSource} */
const pnet = {
  id: 'pnet',
  name: 'PNet',
  tier: 'major',
  scope: 'perLocation',
  origin: 'https://www.pnet.co.za',
  saCheck: 'none',
  waitIdleMs: 7000,
  pagination,
  canary: { keyword: 'developer', location: 'Johannesburg', minItems: 3 },

  buildUrl({ keyword, location }, pageNo = 1) {
    const url = `https://www.pnet.co.za/jobs/?k=${encodeURIComponent(keyword)}&l=${encodeURIComponent(location)}`;
    return withPageParam(url, pagination, pageNo);
  },

  extractInPage: ({ location: loc, origin }) => {
    const items = [];
    const cards = document.querySelectorAll(
      '.item, .job-item, [class*="job-result"], [class*="result-item"], ' +
      '[class*="listing-item"], [class*="search-result"], article[class]'
    );
    cards.forEach(card => {
      const titleEl = card.querySelector('h2 a, h3 a, a[class*="title"], [class*="title"] a');
      const companyEl = card.querySelector('[class*="company"], [class*="employer"]');
      const locationEl = card.querySelector('[class*="location"], [class*="region"], [class*="area"]');
      const descEl = card.querySelector('[class*="description"], p');
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
          source: 'PNet'
        });
      }
    });
    return items;
  },
};

export default pnet;
