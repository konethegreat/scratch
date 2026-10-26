import { withPageParam } from './util.js';

/**
 * Indeed SA (za.indeed.com). URL, selectors and field logic are moved verbatim
 * from the original `scrapeIndeedSA` in agents/agent1-hunter.js; only the page
 * parameter is new.
 * `extractInPage` is serialised into the page by page.evaluate, so it must stay
 * fully self-contained (no closures, no imports).
 */
const pagination = { param: 'start', firstValue: 0, step: 10, verified: false };

/** @type {import('../registry.js').HunterSource} */
const indeed = {
  id: 'indeed',
  name: 'Indeed SA',
  tier: 'major',
  scope: 'perLocation',
  origin: 'https://za.indeed.com',
  needsLogin: true,
  saCheck: 'soft',
  waitIdleMs: 8000,
  pagination,
  canary: { keyword: 'developer', location: 'Johannesburg', minItems: 3 },

  buildUrl({ keyword, location }, pageNo = 1) {
    const url = `https://za.indeed.com/jobs?q=${encodeURIComponent(keyword)}&l=${encodeURIComponent(location)}`;
    return withPageParam(url, pagination, pageNo);
  },

  extractInPage: ({ location: loc, origin }) => {
    const items = [];
    // Indeed SA uses a mix of old (.job_seen_beacon) and new (.tapItem) selectors
    const cards = document.querySelectorAll(
      '.job_seen_beacon, .result, [class*="tapItem"], [class*="cardOutline"], ' +
      '[data-jk], li[class*="job"]'
    );

    cards.forEach(card => {
      // Title: new Indeed wraps in span.jobTitle > a
      const titleEl =
        card.querySelector('[class*="jobTitle"] a') ||
        card.querySelector('h2 a[data-jk], h2 a[id^="job_"]') ||
        card.querySelector('h2 a, a[data-jk]');
      // Company
      const companyEl =
        card.querySelector('[data-testid="company-name"]') ||
        card.querySelector('[class*="companyName"]') ||
        card.querySelector('.company');
      // Location
      const locationEl =
        card.querySelector('[data-testid="text-location"]') ||
        card.querySelector('[class*="companyLocation"]') ||
        card.querySelector('[class*="location"]');
      // Snippet
      const descEl =
        card.querySelector('[class*="snippet"]') ||
        card.querySelector('.summary, td.snip');

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
          source: 'Indeed SA'
        });
      }
    });
    return items;
  },
};

export default indeed;
