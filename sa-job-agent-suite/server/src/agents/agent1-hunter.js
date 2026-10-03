// Agent 1 — Job Hunter (SA-focused multi-source scraper).
import { chromium } from 'playwright';
import { v4 as uuidv4 } from 'uuid';
import { addJob, addLog, getProfile, getHunterState, BROWSER_PROFILE_PATH } from '../db/helper.js';
import { huntViaClaudeSearch, findDirectPostingUrl } from './jobSearchAI.js';
import { validateJobs, validateLink, createProbeContext } from './linkValidator.js';

// Max AI link-repair attempts per run (each is a billed grounded search), only
// when profile.useLinkRepair is on AND an Anthropic key is present.
const LINK_REPAIR_CAP = 6;

/** Parse a value to an int within [min, max], falling back to `fallback`. */
function clampInt(value, fallback, min, max) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

/**
 * Normalizes relative dates into YYYY-MM-DD strings.
 */
function parseDate(dateStr) {
  if (!dateStr) return new Date().toISOString().split('T')[0];
  const normalized = dateStr.toLowerCase().trim();

  if (normalized.includes('today') || normalized.includes('just now') || normalized.includes('hour') || normalized.includes('minute')) {
    return new Date().toISOString().split('T')[0];
  }

  if (normalized.includes('yesterday') || normalized === '1 day ago') {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
  }

  const daysMatch = normalized.match(/(\d+)\s*day/);
  if (daysMatch) {
    const d = new Date();
    d.setDate(d.getDate() - parseInt(daysMatch[1], 10));
    return d.toISOString().split('T')[0];
  }

  const weeksMatch = normalized.match(/(\d+)\s*week/);
  if (weeksMatch) {
    const d = new Date();
    d.setDate(d.getDate() - parseInt(weeksMatch[1], 10) * 7);
    return d.toISOString().split('T')[0];
  }

  const monthsMatch = normalized.match(/(\d+)\s*month/);
  if (monthsMatch) {
    const d = new Date();
    d.setMonth(d.getMonth() - parseInt(monthsMatch[1], 10));
    return d.toISOString().split('T')[0];
  }

  return new Date().toISOString().split('T')[0];
}

// Minimum score a job must reach to be saved. With token-aware scoring, a single
// keyword word in the title scores 18, so any relevant title match passes;
// description-only matches need more. Kept low on purpose — the prior threshold
// of 25 with exact-phrase matching filtered out almost everything.
const SCORE_THRESHOLD = 18;

// Sources that search globally — a bare/unknown location is most likely foreign,
// so STRICT validation applies (unknown → reject).
const STRICT_GLOBAL_SOURCES = new Set(['LinkedIn', 'Google Jobs']);

// SA-domain sources that occasionally surface foreign / "remote — worldwide"
// cross-posts. LENIENT validation applies (unknown → accept; reject only when a
// foreign place is explicitly named). SA-only boards not listed here are trusted
// by domain and skipped entirely for speed.
const SOFT_SA_CHECK_SOURCES = new Set(['Adzuna SA', 'Indeed SA']);

const SA_LOCATION_TERMS = [
  'south africa', 'johannesburg', 'cape town', 'durban', 'pretoria',
  'port elizabeth', 'gqeberha', 'bloemfontein', 'east london', 'nelspruit',
  'polokwane', 'sandton', 'midrand', 'centurion', 'soweto', 'roodepoort',
  'boksburg', 'germiston', 'benoni', 'rustenburg', 'pietermaritzburg',
  'gauteng', 'western cape', 'kwazulu-natal', 'kwazulu natal', 'eastern cape',
  'limpopo', 'mpumalanga', 'north west', 'free state', 'northern cape',
  'stellenbosch', 'paarl', 'george, south', 'alberton', 'kimberley',
  'welkom', 'thohoyandou', 'mthatha', 'potchefstroom', 'vereeniging',
  'vanderbijlpark', 'randburg', 'tembisa', 'edenvale', 'springs',
  ' za', '(za)', ', za'
];

// Obvious non-SA markers. If a location names one of these AND no SA term is
// present, the listing is rejected even from an SA-domain source. This catches
// "Remote, United States", "London, UK", "Lagos, Nigeria" cross-posts.
const FOREIGN_LOCATION_TERMS = [
  'united states', ' usa', '(usa)', ', us', 'united kingdom', ' uk', '(uk)',
  'london', 'india', 'bangalore', 'bengaluru', 'mumbai', 'nigeria', 'lagos',
  'kenya', 'nairobi', 'ghana', 'accra', 'egypt', 'cairo', 'australia',
  'canada', 'germany', 'netherlands', 'amsterdam', 'dubai', 'uae',
  'singapore', 'philippines', 'pakistan', 'europe', 'worldwide', 'anywhere',
  'emea', 'global'
];

// strict=true  → unknown locations are rejected (global sources).
// strict=false → unknown locations are accepted; only explicit foreign places
//                are rejected (SA-domain sources guarding against cross-posts).
function isSouthAfricanLocation(location, strict = true) {
  const loc = (location || '').toLowerCase().trim();
  // Blank, "Remote" or "South Africa" → pass through
  if (!loc || loc === 'remote' || loc === 'south africa') return true;
  if (SA_LOCATION_TERMS.some(term => loc.includes(term))) return true;
  // Explicit foreign marker → always reject.
  if (FOREIGN_LOCATION_TERMS.some(term => loc.includes(term))) return false;
  // Unknown location: reject for strict (global) sources, accept otherwise.
  return !strict;
}

// Words too generic to count as a keyword signal on their own.
const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'a', 'an', 'of', 'in', 'to', 'jobs', 'job', 'role', 'position', 'vacancy']);

/**
 * Calculates a match score (0-100) based on keyword presence in title and
 * description. Token-aware: a multi-word keyword like "Software Engineer" is
 * scored on the full phrase AND its individual words, so titles such as
 * "Senior Engineer" or "Software Developer" still match. This is deliberately
 * lenient — the previous exact-phrase-only matching returned almost nothing for
 * sources with empty descriptions (LinkedIn, Google, Gumtree).
 */
function calculateMatchScore(title, description, targetKeywords) {
  const titleLower = (title || '').toLowerCase();
  const descLower = (description || '').toLowerCase();
  const phrases = targetKeywords.split(',').map(k => k.trim().toLowerCase()).filter(k => k.length >= 2);

  let score = 0;

  for (const phrase of phrases) {
    const words = phrase.split(/\s+/).filter(w => w.length >= 3 && !STOPWORDS.has(w));

    if (titleLower.includes(phrase)) {
      score += 45;                                              // exact phrase in title
    } else if (words.length && words.every(w => titleLower.includes(w))) {
      score += 32;                                              // all words present in title
    } else if (words.some(w => titleLower.includes(w))) {
      score += 18;                                              // some words in title
    } else if (descLower.includes(phrase)) {
      score += 14;                                              // exact phrase in description
    } else if (words.length && words.every(w => descLower.includes(w))) {
      score += 9;                                               // all words in description
    } else if (words.some(w => descLower.includes(w))) {
      score += 4;                                               // some words in description
    }
  }

  // Tech stack bonuses (additive, not the primary signal)
  const techTerms = ['react', 'node', 'javascript', 'typescript', 'python', 'java', 'angular', 'vue', 'docker', 'kubernetes', 'aws', 'azure', 'devops', 'sql', '.net', 'c#', 'go', 'rust'];
  for (const tech of techTerms) {
    if (descLower.includes(tech) || titleLower.includes(tech)) {
      score += 3;
    }
  }

  if (descLower.includes('remote') && targetKeywords.toLowerCase().includes('remote')) {
    score += 5;
  }

  return Math.min(Math.max(score, 0), 100);
}

/**
 * Source 1: Scrape Indeed SA
 */
async function scrapeIndeedSA(page, keyword, location) {
  const jobs = [];
  // za.indeed.com is the SA subdomain — always SA results
  const searchUrl = `https://za.indeed.com/jobs?q=${encodeURIComponent(keyword)}&l=${encodeURIComponent(location)}`;

  try {
    addLog(`[Indeed SA] Searching: "${keyword}" in "${location}"`, 'agent1');
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    const pageTitle = await page.title();
    addLog(`[Indeed SA] Page loaded: "${pageTitle}"`, 'agent1');

    const scraped = await page.evaluate((loc) => {
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
          if (url.startsWith('/')) url = 'https://za.indeed.com' + url;
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
    }, location);

    addLog(`[Indeed SA] Found ${scraped.length} raw cards for "${keyword}" in "${location}"`, 'agent1');
    jobs.push(...scraped);
  } catch (err) {
    addLog(`[Indeed SA] Error: ${err.message}`, 'error');
  }

  return jobs;
}

/**
 * Source 3: Scrape LinkedIn Jobs (public search - no login required)
 */
async function scrapeLinkedInJobs(page, keyword) {
  // The location parameter is intentionally not used in the URL.
  // We lock to South Africa via geoId=103644278 only — passing a city name
  // (e.g. "Johannesburg") alongside the geoId causes LinkedIn to resolve the
  // city name globally and can return US/UK results. The geoId alone is enough.
  const geoId = '103644278'; // South Africa
  const searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(keyword)}&location=South+Africa&geoId=${geoId}&sortBy=DD&f_WT=1%2C2%2C3%2C4`;

  const jobs = [];
  try {
    addLog(`[LinkedIn] Searching: "${keyword}" in South Africa`, 'agent1');
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    // LinkedIn renders cards via JS — wait for network to settle
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    const pageTitle = await page.title();
    addLog(`[LinkedIn] Page loaded: "${pageTitle}"`, 'agent1');

    const scraped = await page.evaluate(() => {
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
        if (url.startsWith('/')) url = 'https://www.linkedin.com' + url;
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
    });

    addLog(`[LinkedIn] Found ${scraped.length} raw cards for "${keyword}"`, 'agent1');
    jobs.push(...scraped);
  } catch (err) {
    addLog(`[LinkedIn] Error: ${err.message}`, 'error');
  }

  return jobs;
}

/**
 * Source 4: Scrape Google Jobs (via Google Search)
 */
async function scrapeGoogleJobs(page, keyword, location) {
  const jobs = [];
  // Explicitly include "South Africa" in the query — Google's job widget geo-infers
  // from the server location (typically US) if not specified.
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(keyword + ' jobs ' + location + ' South Africa')}&ibp=htl;jobs&gl=za&hl=en-ZA`;

  try {
    addLog(`[Google Jobs] Searching: "${keyword}" in "${location}"`, 'agent1');
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const pageTitle = await page.title();
    addLog(`[Google Jobs] Page loaded: "${pageTitle}"`, 'agent1');
    await page.waitForTimeout(4000);

    const scraped = await page.evaluate(() => {
      const items = [];
      // Google Jobs cards
      const cards = document.querySelectorAll('.iFjolb, [jscontroller] li, .PwjeAc');

      cards.forEach(card => {
        const titleEl = card.querySelector('.BjJfJf, [class*="BjJfJf"], .sH3zFd, div[role="heading"]');
        const companyEl = card.querySelector('.vNEEBe, [class*="vNEEBe"], .nJlDiv');
        const locationEl = card.querySelector('.Qk80Jf, [class*="Qk80Jf"], .pwO9Le');

        if (titleEl && titleEl.textContent && titleEl.textContent.trim().length > 3) {
          // Google Jobs cards don't expose a direct employer apply URL on the
          // search results page. Leave applyUrl empty so Agent 3 rejects it
          // cleanly instead of navigating to a Google search page.
          items.push({
            title: titleEl.textContent.trim(),
            company: companyEl ? companyEl.textContent.trim() : 'Confidential',
            location: locationEl ? locationEl.textContent.trim() : 'South Africa',
            description: '',
            applyUrl: '',
            datePosted: 'Recently',
            source: 'Google Jobs'
          });
        }
      });
      return items;
    });

    addLog(`[Google Jobs] Found ${scraped.length} raw cards for "${keyword}" in "${location}"`, 'agent1');
    jobs.push(...scraped);
  } catch (err) {
    addLog(`[Google Jobs] Error: ${err.message}`, 'error');
  }

  return jobs;
}

/**
 * Source 5: Scrape JobMail SA
 */
async function scrapeJobMail(page, keyword, location) {
  const jobs = [];
  const searchUrl = `https://www.jobmail.co.za/search?keyword=${encodeURIComponent(keyword)}&location=${encodeURIComponent(location)}`;

  try {
    addLog(`[JobMail] Searching: "${keyword}" in "${location}"`, 'agent1');
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForLoadState('networkidle', { timeout: 7000 }).catch(() => {});
    const pageTitle = await page.title();
    addLog(`[JobMail] Page loaded: "${pageTitle}"`, 'agent1');

    const scraped = await page.evaluate((loc) => {
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
          if (url.startsWith('/')) url = 'https://www.jobmail.co.za' + url;
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
    }, location);

    addLog(`[JobMail] Found ${scraped.length} raw cards for "${keyword}" in "${location}"`, 'agent1');
    jobs.push(...scraped);
  } catch (err) {
    addLog(`[JobMail] Error: ${err.message}`, 'error');
  }

  return jobs;
}

/**
 * Source 6: PNet SA
 */
async function scrapePNet(page, keyword, location) {
  const jobs = [];
  const searchUrl = `https://www.pnet.co.za/jobs/?k=${encodeURIComponent(keyword)}&l=${encodeURIComponent(location)}`;

  try {
    addLog(`[PNet] Searching: "${keyword}" in "${location}"`, 'agent1');
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForLoadState('networkidle', { timeout: 7000 }).catch(() => {});
    const pageTitle = await page.title();
    addLog(`[PNet] Page loaded: "${pageTitle}"`, 'agent1');

    const scraped = await page.evaluate((loc) => {
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
          if (url.startsWith('/')) url = 'https://www.pnet.co.za' + url;
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
    }, location);

    addLog(`[PNet] Found ${scraped.length} raw cards for "${keyword}" in "${location}"`, 'agent1');
    jobs.push(...scraped);
  } catch (err) {
    addLog(`[PNet] Error: ${err.message}`, 'error');
  }

  return jobs;
}

/**
 * Source 7: CareerJunction SA
 */
async function scrapeCareerJunction(page, keyword, location) {
  const jobs = [];
  const searchUrl = `https://www.careerjunction.co.za/jobs/results/?k=${encodeURIComponent(keyword)}&radius=50&l=${encodeURIComponent(location)}`;

  try {
    addLog(`[CareerJunction] Searching: "${keyword}" in "${location}"`, 'agent1');
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForLoadState('networkidle', { timeout: 7000 }).catch(() => {});
    const pageTitle = await page.title();
    addLog(`[CareerJunction] Page loaded: "${pageTitle}"`, 'agent1');

    const scraped = await page.evaluate((loc) => {
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
          if (url.startsWith('/')) url = 'https://www.careerjunction.co.za' + url;
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
    }, location);

    addLog(`[CareerJunction] Found ${scraped.length} raw cards for "${keyword}" in "${location}"`, 'agent1');
    jobs.push(...scraped);
  } catch (err) {
    addLog(`[CareerJunction] Error: ${err.message}`, 'error');
  }

  return jobs;
}

/**
 * Source 8: Jobs.co.za
 */
async function scrapeJobsDotCoZa(page, keyword, location) {
  const jobs = [];
  const searchUrl = `https://www.jobs.co.za/search.html?q=${encodeURIComponent(keyword)}&l=${encodeURIComponent(location)}`;

  try {
    addLog(`[Jobs.co.za] Searching: "${keyword}" in "${location}"`, 'agent1');
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForLoadState('networkidle', { timeout: 7000 }).catch(() => {});
    const pageTitle = await page.title();
    addLog(`[Jobs.co.za] Page loaded: "${pageTitle}"`, 'agent1');

    const scraped = await page.evaluate((loc) => {
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
          if (url.startsWith('/')) url = 'https://www.jobs.co.za' + url;
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
    }, location);

    addLog(`[Jobs.co.za] Found ${scraped.length} raw cards for "${keyword}" in "${location}"`, 'agent1');
    jobs.push(...scraped);
  } catch (err) {
    addLog(`[Jobs.co.za] Error: ${err.message}`, 'error');
  }

  return jobs;
}

/**
 * Source 9: Gumtree Jobs SA
 */
async function scrapeGumtreeJobs(page, keyword, location) {
  const jobs = [];
  const slug = keyword.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const searchUrl = `https://www.gumtree.co.za/s-jobs/v1c8p1/${encodeURIComponent(slug)}/k0`;

  try {
    addLog(`[Gumtree SA] Searching: "${keyword}"`, 'agent1');
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const pageTitle = await page.title();
    addLog(`[Gumtree SA] Page loaded: "${pageTitle}"`, 'agent1');
    await page.waitForTimeout(3000);

    const scraped = await page.evaluate(() => {
      const items = [];
      const cards = document.querySelectorAll('.view-list-item, .tileV2, article[class*="listing"], [class*="listing-item"]');
      cards.forEach(card => {
        const titleEl = card.querySelector('.title a, h2 a, h3 a, a[class*="title"]');
        const locationEl = card.querySelector('[class*="location"], .location, [class*="area"]');
        const descEl = card.querySelector('[class*="description"], p');
        if (titleEl && titleEl.textContent && titleEl.textContent.trim().length > 3) {
          let url = titleEl.getAttribute('href') || '';
          if (url && url.startsWith('/')) url = 'https://www.gumtree.co.za' + url;
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
    });

    addLog(`[Gumtree SA] Found ${scraped.length} raw cards for "${keyword}"`, 'agent1');
    jobs.push(...scraped);
  } catch (err) {
    addLog(`[Gumtree SA] Error: ${err.message}`, 'error');
  }

  return jobs;
}

/**
 * Source 10: South African Government Vacancies (nationalgovernment.co.za)
 * Government jobs may require email, post, or hand delivery — applyUrl links to the vacancy page.
 * Only takes keyword (not location) since government jobs are nationwide.
 */
async function scrapeGovJobs(page, keyword) {
  const jobs = [];
  const searchUrl = 'https://www.nationalgovernment.co.za/units/view/1/Government-Vacancies';

  try {
    addLog(`[Govt SA] Loading National Government vacancies for "${keyword}"`, 'agent1');
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const pageTitle = await page.title();
    addLog(`[Govt SA] Page loaded: "${pageTitle}"`, 'agent1');
    await page.waitForTimeout(3000);

    const keywordLower = keyword.toLowerCase();
    const scraped = await page.evaluate((kw) => {
      const items = [];
      const words = kw.split(' ').filter(w => w.length > 3);

      // Scan links whose text matches the keyword
      document.querySelectorAll('a[href]').forEach(link => {
        const text = (link.textContent || '').trim();
        if (text.length < 5 || text.length > 200) return;
        const textLower = text.toLowerCase();
        if (!textLower.includes(kw) && !words.some(w => textLower.includes(w))) return;
        let url = link.getAttribute('href') || '';
        if (url.startsWith('/')) url = 'https://www.nationalgovernment.co.za' + url;
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
        if (url.startsWith('/')) url = 'https://www.nationalgovernment.co.za' + url;
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
    }, keywordLower);

    addLog(`[Govt SA] Found ${scraped.length} relevant entries for "${keyword}"`, 'agent1');
    jobs.push(...scraped);
  } catch (err) {
    addLog(`[Govt SA] Error: ${err.message}`, 'error');
  }

  return jobs;
}

/**
 * Source 11: Adzuna SA
 */
async function scrapeAdzunaSA(page, keyword, location) {
  const jobs = [];
  const searchUrl = `https://www.adzuna.co.za/search?q=${encodeURIComponent(keyword)}&w=${encodeURIComponent(location)}`;

  try {
    addLog(`[Adzuna SA] Searching: "${keyword}" in "${location}"`, 'agent1');
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForLoadState('networkidle', { timeout: 7000 }).catch(() => {});
    const pageTitle = await page.title();
    addLog(`[Adzuna SA] Page loaded: "${pageTitle}"`, 'agent1');

    const scraped = await page.evaluate((loc) => {
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
          if (url.startsWith('/')) url = 'https://www.adzuna.co.za' + url;
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
    }, location);

    addLog(`[Adzuna SA] Found ${scraped.length} raw cards for "${keyword}" in "${location}"`, 'agent1');
    jobs.push(...scraped);
  } catch (err) {
    addLog(`[Adzuna SA] Error: ${err.message}`, 'error');
  }

  return jobs;
}

/**
 * Universal fallback: extract schema.org/JobPosting structured data (JSON-LD)
 * embedded in the current page. Most modern SA job boards (PNet, Careers24,
 * Indeed, Adzuna, CareerJunction) embed this per listing, so it keeps the hunter
 * working even when a site changes its CSS class names and breaks the bespoke
 * selectors above. Runs against whatever page is already loaded.
 */
async function scrapeJsonLd(page, sourceName, fallbackLocation, originForRelative) {
  try {
    // Default relative-URL base to the page's own origin when not supplied.
    if (!originForRelative) {
      try { originForRelative = new URL(page.url()).origin; } catch {}
    }
    const items = await page.evaluate(() => {
      const out = [];
      const stripHtml = (s) => (s || '').toString().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const addrOf = (loc) => {
        if (!loc) return '';
        const a = loc.address || loc;
        if (typeof a === 'string') return a;
        if (typeof a !== 'object') return '';
        const country = a.addressCountry && (a.addressCountry.name || a.addressCountry);
        return [a.addressLocality, a.addressRegion, country].filter(Boolean).join(', ');
      };
      const pushPosting = (node) => {
        if (!node || typeof node !== 'object') return;
        const type = node['@type'];
        const isPosting = type === 'JobPosting' ||
          (Array.isArray(type) && type.includes('JobPosting'));
        if (!isPosting) return;
        const title = stripHtml(node.title);
        if (!title || title.length < 4) return;
        let company = '';
        if (node.hiringOrganization) {
          company = typeof node.hiringOrganization === 'string'
            ? node.hiringOrganization
            : (node.hiringOrganization.name || '');
        }
        let location = '';
        const jl = node.jobLocation;
        if (Array.isArray(jl)) location = jl.map(addrOf).filter(Boolean).join(' | ');
        else location = addrOf(jl);
        if (!location && node.jobLocationType === 'TELECOMMUTE') location = 'Remote';
        const url = node.url ||
          (node.mainEntityOfPage && (node.mainEntityOfPage['@id'] || node.mainEntityOfPage)) || '';
        out.push({
          title,
          company: (company || '').toString().trim(),
          location,
          description: stripHtml(node.description).substring(0, 500),
          applyUrl: (typeof url === 'string' ? url : ''),
          datePosted: node.datePosted || 'Recently'
        });
      };
      document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
        let data;
        try { data = JSON.parse(s.textContent); } catch { return; }
        const nodes = Array.isArray(data) ? data : (data['@graph'] ? data['@graph'] : [data]);
        nodes.forEach(pushPosting);
      });
      return out;
    });

    return items.map((it) => {
      let url = it.applyUrl || '';
      if (url.startsWith('/') && originForRelative) url = originForRelative + url;
      return {
        ...it,
        company: it.company || 'Confidential',
        location: it.location || fallbackLocation || 'South Africa',
        applyUrl: url,
        source: sourceName
      };
    });
  } catch {
    return [];
  }
}

/**
 * Source 12 & 13: Executive Placements / Job Placements (same platform engine).
 * Server-rendered JobList.asp — country defaults to South Africa, so results are
 * SA by default. Shared scraper, called once per board with its own origin.
 */
async function scrapePlacements(page, keyword, origin, sourceName) {
  const jobs = [];
  const searchUrl = `${origin}/JobList.asp?Keywords=${encodeURIComponent(keyword)}`;

  try {
    addLog(`[${sourceName}] Searching: "${keyword}"`, 'agent1');
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForLoadState('networkidle', { timeout: 7000 }).catch(() => {});
    const pageTitle = await page.title();
    addLog(`[${sourceName}] Page loaded: "${pageTitle}"`, 'agent1');

    const scraped = await page.evaluate((org) => {
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
    }, origin);

    addLog(`[${sourceName}] Found ${scraped.length} raw cards for "${keyword}"`, 'agent1');
    jobs.push(...scraped);
  } catch (err) {
    addLog(`[${sourceName}] Error: ${err.message}`, 'error');
  }

  return jobs;
}

async function scrapeExecutivePlacements(page, keyword) {
  return scrapePlacements(page, keyword, 'https://www.executiveplacements.com', 'Executive Placements');
}

async function scrapeJobPlacements(page, keyword) {
  return scrapePlacements(page, keyword, 'https://www.jobplacements.com', 'Job Placements');
}

/**
 * Main entry point: Runs Agent 1 Job Hunter across all sources.
 */
export async function runJobHunterAgent() {
  const profile = getProfile();
  const keywords = (profile.keywords || '').split(',').map(k => k.trim()).filter(Boolean);
  const locations = (profile.locations || '').split(',').map(l => l.trim()).filter(Boolean);

  if (keywords.length === 0 || locations.length === 0) {
    addLog('Cannot start hunter: keywords and locations must both be set in Profile & Settings.', 'error');
    return { totalFound: 0, totalSaved: 0, error: 'Missing keywords or locations.' };
  }

  addLog('=== Agent 1: Job Hunter Starting ===', 'agent1');
  addLog(`Keywords: ${keywords.join(', ')}`, 'agent1');
  addLog(`Locations: ${locations.join(', ')}`, 'agent1');

  let context;
  let totalFound = 0;
  let totalSaved = 0;
  let perSource = {}; // source name → jobs saved

  const maxKw = clampInt(profile.maxKeywords, 3, 1, 10);
  const maxLoc = clampInt(profile.maxLocations, 2, 1, 8);

  // ── Link validation / repair setup (shared by both phases) ─────────────────
  // Validation (default ON) shape-checks every candidate and, when on, probes it
  // for liveness before saving — only CONFIRMED-dead links are dropped (see
  // linkValidator.js). We probe through a browser-grade Playwright request
  // context (realistic TLS/headers) so bot-walls cause far fewer false
  // "unverified" flags than a raw fetch would.
  const linkCheck = profile.useLinkValidation !== false;
  const probeRequest = linkCheck ? await createProbeContext() : null;

  // Optional AI link repair: when a job is kept WITHOUT a usable link, ask Claude
  // (grounded) for the real posting URL. Gated + capped because each is billed.
  const repairReady = profile.useLinkRepair === true &&
    Boolean(profile.anthropicApiKey) && !String(profile.anthropicApiKey).includes('your_');
  const repairState = { left: repairReady ? LINK_REPAIR_CAP : 0 };

  // Run-level link health, surfaced in the dashboard Run Summary.
  const linkStats = { live: 0, unverified: 0, noLink: 0, dead: 0, repaired: 0 };

  // Persists a validated batch: optional AI repair of linkless leads, dedupe via
  // addJob, per-source + link-health tallies, one log line each. Declared inside
  // the run so it closes over the counters above (incl. reassigning totalSaved).
  async function finalizeAndSave(kept, droppedCount, perSourceKey) {
    linkStats.dead += droppedCount;
    for (const job of kept) {
      if (job.linkStatus === 'no-link' && repairState.left > 0) {
        repairState.left--;
        try {
          const url = await findDirectPostingUrl(profile, job);
          if (url) {
            const v = await validateLink(url, { checkLiveness: linkCheck, requestContext: probeRequest });
            if (v.verdict === 'keep' && v.linkStatus !== 'no-link' && !v.strip) {
              job.applyUrl = url;
              job.linkStatus = v.linkStatus;
              job.linkCheckedAt = new Date().toISOString();
              linkStats.repaired++;
              addLog(`   ↻ Repaired link via AI: ${job.title.slice(0, 50)} → ${url.slice(0, 70)} [${v.linkStatus || 'ok'}]`, 'agent1');
            }
          }
        } catch { /* best-effort — leave it as a lead */ }
      }
      const saved = addJob(job);
      if (saved) {
        totalSaved++;
        perSource[perSourceKey] = (perSource[perSourceKey] || 0) + 1;
        const bucket = job.linkStatus === 'live' ? 'live' : job.linkStatus === 'unverified' ? 'unverified' : 'noLink';
        linkStats[bucket]++;
        const tag = job.linkStatus && job.linkStatus !== 'live' ? ` [${job.linkStatus}]` : '';
        addLog(`✅ [${job.matchScore}] ${job.title} at ${job.company} — ${job.location} (${job.source || perSourceKey})${tag}`, 'agent1');
      }
    }
  }

  // ── Phase 0: AI web-search engine (primary) ────────────────────────────────
  // Uses Claude's grounded web_search. This is the reliable engine — the CSS
  // scrapers below are a best-effort fallback that bot-walls frequently break.
  if (profile.useAiSearch !== false) {
    const aiKeywords = keywords.slice(0, maxKw);
    const aiLocations = locations.slice(0, maxLoc);
    addLog('--- AI Search (Claude grounded web search) ---', 'agent1');
    perSource['AI Search'] = 0;
    for (const keyword of aiKeywords) {
      if (getHunterState().stopRequested) { addLog('🛑 Stop requested — halting AI search.', 'agent1'); break; }
      try {
        const aiJobs = await huntViaClaudeSearch(profile, keyword, aiLocations);
        totalFound += aiJobs.length;

        // Build scored candidates first, then validate their links as a batch.
        const candidates = [];
        for (const job of aiJobs) {
          if (!job.title || job.title.length < 4) continue;
          const matchScore = calculateMatchScore(job.title, job.description, profile.keywords);
          if (matchScore < SCORE_THRESHOLD) continue;
          candidates.push({
            id: uuidv4(),
            title: job.title,
            company: job.company,
            location: job.location,
            description: job.description || `${job.title} at ${job.company} — ${job.location}`,
            applyUrl: job.applyUrl,
            datePosted: parseDate(job.datePosted),
            matchScore,
            status: 'found',
            source: job.source,
            tailoredCvText: '',
            tailoredCoverLetterText: '',
            dateAdded: new Date().toISOString().split('T')[0]
          });
        }

        const { kept, dropped } = await validateJobs(candidates, { checkLiveness: linkCheck, requestContext: probeRequest, label: `AI Search · "${keyword}"` });
        await finalizeAndSave(kept, dropped.length, 'AI Search');
      } catch (err) {
        addLog(`[AI Search] Error for "${keyword}": ${err.message}`, 'error');
      }
    }
  } else {
    addLog('AI Search is disabled in Settings — using scrapers only.', 'agent1');
  }

  try {
    addLog('Launching browser context...', 'agent1');
    const launchOpts = {
      headless: true,
      args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-setuid-sandbox'],
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      viewport: { width: 1366, height: 768 },
      locale: 'en-ZA',
      timezoneId: 'Africa/Johannesburg'
    };
    try {
      context = await chromium.launchPersistentContext(BROWSER_PROFILE_PATH, { ...launchOpts, channel: 'chrome' });
      addLog('Using real Chrome with persistent session profile.', 'agent1');
    } catch {
      addLog('Chrome not found — falling back to bundled Chromium with persistent profile.', 'agent1');
      context = await chromium.launchPersistentContext(BROWSER_PROFILE_PATH, launchOpts);
    }

    // Limit the keyword × location matrix to avoid excessive requests. These
    // caps are user-configurable from Profile & Settings (maxKeywords /
    // maxLocations); they fall back to sensible defaults when unset.
    const maxKeywords = clampInt(profile.maxKeywords, 3, 1, 10);
    const maxLocations = clampInt(profile.maxLocations, 2, 1, 8);
    const searchKeywords = keywords.slice(0, maxKeywords);
    const searchLocations = locations.slice(0, maxLocations);
    addLog(`Run matrix: ${searchKeywords.length} keyword(s) × ${searchLocations.length} location(s) per per-location source.`, 'agent1');

    // Max raw cards processed per page load — guards against a runaway page.
    const MAX_CARDS_PER_PAGE = 80;

    // Order matters: `addJob` keeps the FIRST version of a duplicate job, so the
    // major, reputable boards run first and win the slot over obscure boards.
    // (Careers24 removed — its scraper was unreliably bot-walled.)
    const scraperSources = [
      // ── Major boards first ──────────────────────────────────────────────────
      // LinkedIn: SA-locked via geoId — no per-location loop needed
      { name: 'LinkedIn',             fn: scrapeLinkedInJobs, oncePerKeyword: true },
      { name: 'Indeed SA',            fn: scrapeIndeedSA },
      { name: 'PNet',                 fn: scrapePNet },
      { name: 'CareerJunction',       fn: scrapeCareerJunction },
      // ── Secondary / niche boards (fallback) ─────────────────────────────────
      // Google Jobs renders on google.com — no JobPosting JSON-LD to harvest.
      { name: 'Google Jobs',          fn: scrapeGoogleJobs, skipJsonLd: true },
      { name: 'Adzuna SA',            fn: scrapeAdzunaSA },
      { name: 'Executive Placements', fn: scrapeExecutivePlacements, oncePerKeyword: true },
      { name: 'Job Placements',       fn: scrapeJobPlacements, oncePerKeyword: true },
      { name: 'Govt SA',              fn: scrapeGovJobs, noLocation: true, skipJsonLd: true },
      { name: 'JobMail',              fn: scrapeJobMail },
      { name: 'Jobs.co.za',           fn: scrapeJobsDotCoZa },
      { name: 'Gumtree SA',           fn: scrapeGumtreeJobs }
    ];

    addLog(`Sources: ${scraperSources.map(s => s.name).join(', ')}`, 'agent1');

    for (const source of scraperSources) {
      if (getHunterState().stopRequested) { addLog('🛑 Stop requested — halting before next source.', 'agent1'); break; }
      addLog(`--- Scanning ${source.name} ---`, 'agent1');
      const page = await context.newPage();
      perSource[source.name] = perSource[source.name] || 0;

      for (const keyword of searchKeywords) {
        if (getHunterState().stopRequested) break;
        // noLocation: SA-wide scrape (no city param). oncePerKeyword: SA-locked globally.
        const locationList = (source.noLocation || source.oncePerKeyword) ? [null] : searchLocations;

        for (const location of locationList) {
          if (getHunterState().stopRequested) break;
          try {
            const rawJobs = (source.noLocation || source.oncePerKeyword)
              ? await source.fn(page, keyword)
              : await source.fn(page, keyword, location);

            // Universal JSON-LD fallback against the page that fn just loaded.
            let allRaw = rawJobs;
            if (!source.skipJsonLd) {
              const ld = await scrapeJsonLd(page, source.name, location || 'South Africa', source.origin);
              if (ld.length) {
                addLog(`[${source.name}] +${ld.length} listing(s) via JSON-LD structured data`, 'agent1');
                allRaw = rawJobs.concat(ld);
              }
            }
            if (allRaw.length > MAX_CARDS_PER_PAGE) allRaw = allRaw.slice(0, MAX_CARDS_PER_PAGE);
            totalFound += allRaw.length;

            let belowThreshold = 0;
            let notSA = 0;
            let belowSamples = [];
            const candidates = [];
            for (const job of allRaw) {
              if (!job.title || job.title.length < 4) continue;

              // Reject non-SA locations. LinkedIn/Google are already SA-geo-locked
              // by their query (geoId / gl=za), and SA-domain boards are SA by
              // definition — so we only reject when a foreign place is EXPLICITLY
              // named (lenient mode). Unknown/unlisted suburbs pass, which fixes
              // the over-filtering that dropped valid SA jobs in smaller towns.
              if ((STRICT_GLOBAL_SOURCES.has(job.source) || SOFT_SA_CHECK_SOURCES.has(job.source)) &&
                  !isSouthAfricanLocation(job.location, false)) {
                notSA++;
                continue;
              }

              const matchScore = calculateMatchScore(job.title, job.description, profile.keywords);

              if (matchScore < SCORE_THRESHOLD) {
                belowThreshold++;
                if (belowSamples.length < 3) belowSamples.push(`"${job.title}" (${matchScore})`);
                continue;
              }

              candidates.push({
                id: uuidv4(),
                title: job.title,
                company: job.company,
                location: job.location,
                description: job.description || `${job.title} at ${job.company} - ${job.location}`,
                applyUrl: job.applyUrl,
                datePosted: parseDate(job.datePosted),
                matchScore,
                status: 'found',
                source: job.source,
                tailoredCvText: '',
                tailoredCoverLetterText: '',
                dateAdded: new Date().toISOString().split('T')[0]
              });
            }

            // Validate this source's candidate links before saving (drops only
            // confirmed-dead links; search/category links kept as linkless leads).
            const { kept, dropped } = await validateJobs(candidates, { checkLiveness: linkCheck, requestContext: probeRequest, label: source.name });
            await finalizeAndSave(kept, dropped.length, source.name);
            if (notSA > 0) addLog(`[${source.name}] Rejected ${notSA} non-SA location job(s)`, 'agent1');
            if (belowThreshold > 0) {
              addLog(`[${source.name}] ${belowThreshold} card(s) below score ${SCORE_THRESHOLD}. Samples: ${belowSamples.join(', ')}`, 'agent1');
            }
          } catch (err) {
            const loc = location ? ` in "${location}"` : '';
            addLog(`Error in ${source.name} for "${keyword}"${loc}: ${err.message}`, 'error');
          }

          await new Promise(r => setTimeout(r, 2000));
        }
      }

      await page.close();
      await new Promise(r => setTimeout(r, 1500));
    }

    const breakdown = Object.entries(perSource)
      .filter(([, n]) => n > 0)
      .map(([name, n]) => `${name}: ${n}`)
      .join(', ') || 'none';
    addLog(`Saved-by-source → ${breakdown}`, 'agent1');
    const stopped = getHunterState().stopRequested;
    addLog(`=== Agent 1 ${stopped ? 'Stopped' : 'Complete'}! Scraped ${totalFound} raw listings, saved ${totalSaved} new matches ===`, 'agent1');
    if (linkCheck && totalSaved > 0) {
      addLog(`Link health → ${linkStats.live} verified live, ${linkStats.unverified} unverified, ${linkStats.noLink} lead(s) without a link${linkStats.repaired ? `, ${linkStats.repaired} AI-repaired` : ''}; ${linkStats.dead} confirmed-dead dropped.`, 'agent1');
    }

  } catch (error) {
    addLog(`Fatal error in Agent 1: ${error.message}`, 'error');
    console.error(error);
  } finally {
    if (probeRequest) { try { await probeRequest.dispose(); } catch {} }
    if (context) {
      try { await context.close(); } catch {}
      addLog('Browser context closed.', 'agent1');
    }
  }

  return { totalFound, totalSaved, perSource, linkStats, stopped: Boolean(getHunterState().stopRequested) };
}

/**
 * Launches a visible browser with the persistent profile so the user can sign
 * in to LinkedIn, Indeed, and other sites once. Sessions are saved and reused
 * by all future headless scraping runs.
 */
export async function setupBrowserSession() {
  addLog('Opening browser for manual login setup. Sign in to all SA job sites, then close the window.', 'system');
  addLog('Sites opening: LinkedIn, Indeed SA, PNet, CareerJunction, Gumtree SA', 'system');

  const launchOpts = { headless: false, args: ['--start-maximized'], viewport: null };
  let context;
  try {
    try {
      context = await chromium.launchPersistentContext(BROWSER_PROFILE_PATH, { ...launchOpts, channel: 'chrome' });
    } catch {
      context = await chromium.launchPersistentContext(BROWSER_PROFILE_PATH, launchOpts);
    }

    // Open a tab for every site that benefits from a logged-in session.
    // Government/public sites (NationalGovernment, Adzuna, Google) don't need login.
    const loginSites = [
      { name: 'LinkedIn',        url: 'https://www.linkedin.com/login' },
      { name: 'Indeed SA',       url: 'https://za.indeed.com/account/login' },
      { name: 'PNet',            url: 'https://www.pnet.co.za' },
      { name: 'CareerJunction',  url: 'https://www.careerjunction.co.za' },
      { name: 'Gumtree SA',      url: 'https://www.gumtree.co.za/t-login-register.html' },
    ];

    for (const site of loginSites) {
      try {
        const tab = await context.newPage();
        await tab.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        addLog(`Opened ${site.name} login tab.`, 'system');
      } catch (err) {
        addLog(`Could not open ${site.name}: ${err.message}`, 'error');
      }
    }

    // Wait until the user closes the browser window
    await new Promise(resolve => {
      context.once('close', resolve);
      setTimeout(resolve, 30 * 60 * 1000); // 30-min safety timeout
    });

    addLog('Browser setup complete. Sessions saved — all future scraping runs will reuse these logins.', 'system');
  } catch (err) {
    addLog(`Browser setup error: ${err.message}`, 'error');
  } finally {
    if (context) { try { await context.close(); } catch {} }
  }
}

// Sites and their login-detection strategy used by checkLoginStatuses()
const LOGIN_CHECK_SITES = [
  {
    key: 'linkedin',
    name: 'LinkedIn',
    url: 'https://www.linkedin.com/feed/',
    isLoggedIn: (page) => {
      const u = page.url();
      return !u.includes('/login') && !u.includes('/authwall') && !u.includes('/uas/');
    },
  },
  {
    key: 'indeedSa',
    name: 'Indeed SA',
    url: 'https://za.indeed.com/account/view?hl=en',
    isLoggedIn: (page) => {
      const u = page.url();
      return !u.includes('/account/login') && !u.includes('/account/register');
    },
  },
  {
    key: 'pnet',
    name: 'PNet',
    url: 'https://www.pnet.co.za',
    isLoggedIn: (page) => page.evaluate(() => {
      const header = document.querySelector('nav, header');
      if (!header) return true;
      return !Array.from(header.querySelectorAll('a, button'))
        .some(el => /^(sign\s?in|log\s?in)$/i.test(el.textContent.trim()));
    }),
  },
  {
    key: 'careerJunction',
    name: 'CareerJunction',
    url: 'https://www.careerjunction.co.za',
    isLoggedIn: (page) => page.evaluate(() =>
      !Array.from(document.querySelectorAll('a, button'))
        .some(el => /^(sign\s?in|log\s?in)$/i.test(el.textContent.trim()))
    ),
  },
  {
    key: 'gumtreeSa',
    name: 'Gumtree SA',
    url: 'https://www.gumtree.co.za/t-account.html',
    isLoggedIn: (page) => {
      const u = page.url();
      return !u.includes('login') && !u.includes('register');
    },
  },
];

/**
 * Checks login status for the SA job sites that benefit from a session, by
 * launching a headless browser with the persistent profile and navigating to
 * auth-gated URLs. Returns { linkedin, indeedSa, pnet, careerJunction,
 * gumtreeSa } where true = logged in.
 */
export async function checkLoginStatuses() {
  const statuses = {};
  let context;
  try {
    try {
      context = await chromium.launchPersistentContext(BROWSER_PROFILE_PATH, {
        headless: true,
        channel: 'chrome',
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
    } catch {
      context = await chromium.launchPersistentContext(BROWSER_PROFILE_PATH, {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
    }

    await Promise.all(LOGIN_CHECK_SITES.map(async (site) => {
      const page = await context.newPage();
      try {
        await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 12000 });
        statuses[site.key] = Boolean(await site.isLoggedIn(page));
      } catch {
        statuses[site.key] = false;
      } finally {
        await page.close().catch(() => {});
      }
    }));
  } finally {
    if (context) { try { await context.close(); } catch {} }
  }
  return statuses;
}

// End of Agent 1 — Job Hunter.
