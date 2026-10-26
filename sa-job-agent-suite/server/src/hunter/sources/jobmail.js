import { withPageParam } from './util.js';

/**
 * JobMail SA. URL, selectors and field logic are moved verbatim from the original
 * `scrapeJobMail` in agents/agent1-hunter.js; only the origin interpolation and
 * the page parameter are new.
 * `extractInPage` is serialised into the page by page.evaluate, so it must stay
 * fully self-contained (no closures, no imports).
 */
const pagination = { param: 'page', firstValue: 1, step: 1, verified: false };

/** @type {import('../registry.js').HunterSource} */
const jobmail = {
  id: 'jobmail',
  name: 'JobMail',
  tier: 'secondary',
  scope: 'perLocation',
  origin: 'https://www.jobmail.co.za',
  saCheck: 'none',
  waitIdleMs: 7000,
  pagination,
  canary: { keyword: 'developer', location: 'Johannesburg', minItems: 3 },

  buildUrl({ keyword, location }, pageNo = 1) {
    const url = `https://www.jobmail.co.za/search?keyword=${encodeURIComponent(keyword)}&location=${encodeURIComponent(location)}`;
    return withPageParam(url, pagination, pageNo);
  },

  extractInPage: ({ location: loc, origin }) => {
    const items = [];
    const cards = document.querySelectorAll(
      '.job-listing, .job-result, .listing-item, [class*="job-card"], [class*="JobCard"], article[class]'
    );
    cards.forEach(card => {
      const titleEl = card.querySelector('h2 a, h3 a, a[class*="title"], [class*="job-title"] a');
      const companyEl = card.querySelector('[class*="company"], [class*="employer"]');
      const locationEl = card.querySelector('[class*="location"]');
      const descEl = card.querySelector('[class*="description"], [class*="snippet"], p');
      if (titleEl && titleEl.textContent.trim().length > 3) {
        let url = titleEl.getAttribute('href') || '';
        if (url.startsWith('/')) url = origin + url;
        items.push({
          title: titleEl.textContent.trim(),
          company: companyEl ? companyEl.textContent.trim() : 'Confidential',
          location: locationEl ? locationEl.textContent.trim() : (loc + ', South Africa'),
          description: descEl ? descEl.textContent.trim().substring(0, 500) : '',
          applyUrl: url,
          datePosted: 'Recently',
          source: 'JobMail'
        });
      }
    });
    return items;
  },
};

export default jobmail;
