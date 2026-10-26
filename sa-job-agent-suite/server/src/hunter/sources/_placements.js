import { withPageParam } from './util.js';

/**
 * Shared engine for Executive Placements and Job Placements: both boards run the
 * same platform, so they use one URL builder and one extraction routine. The URL,
 * selectors and field logic are moved verbatim from the original `scrapePlacements`
 * in agents/agent1-hunter.js (`scrapeExecutivePlacements` / `scrapeJobPlacements`
 * were thin wrappers around it); only the origin interpolation and the page
 * parameter are new.
 */

export function buildPlacementsUrl(origin, keyword, pagination, pageNo = 1) {
  const url = `${origin}/JobList.asp?Keywords=${encodeURIComponent(keyword)}`;
  return withPageParam(url, pagination, pageNo);
}

/**
 * `extractInPage` is serialised into the page by page.evaluate, so it must stay
 * fully self-contained (no closures, no imports).
 */
export const extractPlacements = ({ origin: org }) => {
  const items = [];
  const seen = new Set();
  // Each job card carries a "Details" anchor pointing at /Jobs/.../-<id>-Job-Search-...asp
  document.querySelectorAll('a[href*="-Job-Search-"]').forEach((a) => {
    let url = a.getAttribute('href') || '';
    if (!/\/Jobs\//i.test(url)) return;
    const idMatch = url.match(/-(\d+)-Job-Search-/i);
    const jobId = idMatch ? idMatch[1] : url;
    if (seen.has(jobId)) return;
    if (url.startsWith('/')) url = org + url;

    // Walk up to the smallest container that holds a bold title.
    let card = a;
    for (let i = 0; i < 6 && card.parentElement; i++) {
      card = card.parentElement;
      if (card.querySelector('strong, b, h2, h3')) break;
    }
    const titleEl = card.querySelector('strong, b, h2, h3');
    const title = titleEl ? titleEl.textContent.trim() : '';
    if (!title || title.length < 4) return;

    // Location heuristic: line right after the title in the card text.
    let location = 'South Africa';
    let description = '';
    const lines = (card.innerText || '').split('\n').map((s) => s.trim()).filter(Boolean);
    const ti = lines.findIndex((l) => l === title);
    if (ti !== -1 && lines[ti + 1]) {
      location = lines[ti + 1].replace(/\s+(today|yesterday|\d+\s+days?\s+ago)$/i, '').trim() || 'South Africa';
    }
    const descLine = lines.find((l) => l.length > 60);
    if (descLine) description = descLine.substring(0, 500);

    seen.add(jobId);
    items.push({
      title,
      company: 'See listing',
      location,
      description,
      applyUrl: url,
      datePosted: 'Recently',
      source: org.includes('executiveplacements') ? 'Executive Placements' : 'Job Placements'
    });
  });
  return items;
};
