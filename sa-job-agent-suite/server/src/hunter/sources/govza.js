import { withPageParam } from './util.js';

/**
 * South African Government Vacancies (nationalgovernment.co.za). URL, selectors
 * and field logic are moved verbatim from the original `scrapeGovJobs` in
 * agents/agent1-hunter.js; only the origin interpolation, the keyword argument
 * (now taken from `extractInPage`'s arg instead of a second evaluate argument)
 * and the page parameter are new. Government jobs are nationwide, so the source
 * is `noLocation`.
 * `extractInPage` is serialised into the page by page.evaluate, so it must stay
 * fully self-contained (no closures, no imports).
 */
const pagination = { param: 'page', firstValue: 1, step: 1, verified: false };

/** @type {import('../registry.js').HunterSource} */
const govza = {
  id: 'govza',
  name: 'Govt SA',
  tier: 'secondary',
  scope: 'noLocation',
  origin: 'https://www.nationalgovernment.co.za',
  skipJsonLd: true,
  saCheck: 'none',
  waitIdleMs: 3000,
  pagination,
  canary: { keyword: 'developer', location: null, minItems: 3 },

  buildUrl(query, pageNo = 1) {
    const url = 'https://www.nationalgovernment.co.za/units/view/1/Government-Vacancies';
    return withPageParam(url, pagination, pageNo);
  },

  extractInPage: ({ keyword, origin }) => {
    const items = [];
    const kw = (keyword || '').toLowerCase();
    const words = kw.split(' ').filter(w => w.length > 3);

    // Scan links whose text matches the keyword
    document.querySelectorAll('a[href]').forEach(link => {
      const text = (link.textContent || '').trim();
      if (text.length < 5 || text.length > 200) return;
      const textLower = text.toLowerCase();
      if (!textLower.includes(kw) && !words.some(w => textLower.includes(w))) return;
      let url = link.getAttribute('href') || '';
      if (url.startsWith('/')) url = origin + url;
      if (!url.startsWith('http')) return;
      items.push({
        title: text,
        company: 'South African Government',
        location: 'South Africa',
        description: 'Government vacancy — check the linked page for full requirements and application instructions. Applications may require email, post, or hand-delivery as specified in the circular.',
        applyUrl: url,
        datePosted: 'Recently',
        source: 'Govt SA'
      });
    });

    // Also scan tables (common format for government vacancy listings)
    document.querySelectorAll('table tr').forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length < 2) return;
      const titleCell = cells[0];
      const linkEl = titleCell.querySelector('a') || row.querySelector('a');
      const text = titleCell.textContent.trim();
      if (text.length < 5) return;
      const textLower = text.toLowerCase();
      if (!textLower.includes(kw) && !words.some(w => textLower.includes(w))) return;
      let url = linkEl ? (linkEl.getAttribute('href') || '') : '';
      if (url.startsWith('/')) url = origin + url;
      if (!url.startsWith('http')) return;
      items.push({
        title: text.substring(0, 100),
        company: cells[1] ? cells[1].textContent.trim().substring(0, 80) || 'South African Government' : 'South African Government',
        location: 'South Africa',
        description: 'Government vacancy — check the linked page for full requirements and application instructions. Applications may require email, post, or hand-delivery as specified in the circular.',
        applyUrl: url,
        datePosted: cells[2] ? cells[2].textContent.trim() : 'Recently',
        source: 'Govt SA'
      });
    });

    return items.slice(0, 25);
  },
};

export default govza;
