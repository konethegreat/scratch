import { withPageParam } from './util.js';

/**
 * Jobs.co.za. URL, selectors and field logic are moved verbatim from the original
 * `scrapeJobsDotCoZa` in agents/agent1-hunter.js; only the origin interpolation
 * and the page parameter are new.
 * `extractInPage` is serialised into the page by page.evaluate, so it must stay
 * fully self-contained (no closures, no imports).
 */
const pagination = { param: 'page', firstValue: 1, step: 1, verified: false };

/** @type {import('../registry.js').HunterSource} */
const jobscoza = {
  id: 'jobscoza',
  name: 'Jobs.co.za',
  tier: 'secondary',
  scope: 'perLocation',
  origin: 'https://www.jobs.co.za',
  saCheck: 'none',
  waitIdleMs: 7000,
  pagination,
  canary: { keyword: 'developer', location: 'Johannesburg', minItems: 3 },

  buildUrl({ keyword, location }, pageNo = 1) {
    const url = `https://www.jobs.co.za/search.html?q=${encodeURIComponent(keyword)}&l=${encodeURIComponent(location)}`;
    return withPageParam(url, pagination, pageNo);
  },

  extractInPage: ({ location: loc, origin }) => {
    const items = [];
    const cards = document.querySelectorAll('.job, .job-result, .listing, [class*="job-card"], article[class]');
    cards.forEach(card => {
      const titleEl = card.querySelector('h2 a, h3 a, a.position, .job-title a, a[class*="title"]');
      const companyEl = card.querySelector('[class*="company"], [class*="employer"], .company');
      const locationEl = card.querySelector('[class*="location"], .location');
      const descEl = card.querySelector('[class*="description"], [class*="snippet"], .description, p');
      const dateEl = card.querySelector('[class*="date"], .date, time');
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
          source: 'Jobs.co.za'
        });
      }
    });
    return items;
  },
};

export default jobscoza;
