import { withPageParam } from './util.js';

/**
 * LinkedIn (public guest search, SA-locked). URL, selectors and field logic are
 * moved verbatim from the original `scrapeLinkedInJobs` in agents/agent1-hunter.js;
 * only the page parameter is new.
 * `extractInPage` is serialised into the page by page.evaluate, so it must stay
 * fully self-contained (no closures, no imports).
 */
const pagination = { param: 'start', firstValue: 0, step: 25, verified: false };

/** @type {import('../registry.js').HunterSource} */
const linkedin = {
  id: 'linkedin',
  name: 'LinkedIn',
  tier: 'major',
  scope: 'oncePerKeyword',
  origin: 'https://www.linkedin.com',
  needsLogin: true,
  saCheck: 'strict',
  waitIdleMs: 10000,
  pagination,
  canary: { keyword: 'developer', location: null, minItems: 3 },

  buildUrl({ keyword }, pageNo = 1) {
    // The location parameter is intentionally not used in the URL.
    // We lock to South Africa via geoId=103644278 only — passing a city name
    // (e.g. "Johannesburg") alongside the geoId causes LinkedIn to resolve the
    // city name globally and can return US/UK results. The geoId alone is enough.
    const geoId = '103644278'; // South Africa
    const url = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(keyword)}&location=South+Africa&geoId=${geoId}&sortBy=DD&f_WT=1%2C2%2C3%2C4`;
    return withPageParam(url, pagination, pageNo);
  },

  extractInPage: ({ origin }) => {
    const items = [];

    // LinkedIn shows different HTML depending on whether the user is logged in.
    // Logged-in view uses job-card-container; guest view uses base-card.
    const loggedInCards = document.querySelectorAll(
      '.job-card-container, .jobs-search-results__list-item, [data-job-id]'
    );
    const guestCards = document.querySelectorAll(
      '.base-card, .job-search-card, .jobs-search__results-list li'
    );
    const cards = loggedInCards.length > 0 ? loggedInCards : guestCards;

    cards.forEach(card => {
      // Title
      let titleEl =
        card.querySelector('.job-card-list__title') ||
        card.querySelector('.job-card-container__title') ||
        card.querySelector('h3.base-search-card__title, .base-search-card__title') ||
        card.querySelector('h3, h2');

      // Company
      let companyEl =
        card.querySelector('.job-card-container__company-name') ||
        card.querySelector('.job-card-container__primary-description') ||
        card.querySelector('h4.base-search-card__subtitle, .base-search-card__subtitle') ||
        card.querySelector('h4');

      // Location — LinkedIn logged-in puts location in metadata items
      let locationEl =
        card.querySelector('.job-card-container__metadata-item--at-top') ||
        card.querySelector('.job-card-container__metadata-item') ||
        card.querySelector('.job-search-card__location, [class*="job-search-card__location"]');

      // Link
      let linkEl =
        card.querySelector('a.job-card-list__title') ||
        card.querySelector('a.job-card-container__link') ||
        card.querySelector('a.base-card__full-link') ||
        card.querySelector('a[href*="/jobs/view/"]') ||
        card.querySelector('a[href]');

      const title = titleEl ? titleEl.textContent.trim() : null;
      if (!title || title.length < 4) return;

      let url = linkEl ? (linkEl.getAttribute('href') || '') : '';
      if (url.startsWith('/')) url = origin + url;
      // Strip LinkedIn tracking params — keep only the job URL
      try { url = new URL(url).origin + new URL(url).pathname; } catch {}

      items.push({
        title,
        company: companyEl ? companyEl.textContent.trim() : 'Confidential',
        location: locationEl ? locationEl.textContent.trim() : 'South Africa',
        description: '',
        applyUrl: url,
        datePosted: 'Recently',
        source: 'LinkedIn'
      });
    });
    return items;
  },
};

export default linkedin;
