import { normalizeText } from '../text.js';
import { isSouthAfrican } from '../jobs/location.js';

export { normalizeText };

const LEGAL_SUFFIX = /(?:^|\s)(?:pty\s+ltd|pty|ltd|inc|llc|cc|co|corp)$/;

export function fingerprint(title, company) {
  const head = normalizeText(title);
  const full = normalizeText(company);
  const stripped = full.replace(LEGAL_SUFFIX, '').trim();
  return `${head}|${stripped || full}`;
}

export function trackerFingerprints(jobs = []) {
  return new Set(jobs.map((entry) => fingerprint(entry.title, entry.company)));
}

export function splitList(value) {
  return String(value == null ? '' : value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function phrasePattern(phrase) {
  const parts = normalizeText(phrase).split(' ').filter(Boolean);
  if (!parts.length) return null;
  return new RegExp(`(?:^|\\s)${parts.map(escapeRegExp).join('\\s+')}(?:\\s|$)`, 'i');
}

function hits(haystack, phrase) {
  const pattern = phrasePattern(phrase);
  return Boolean(pattern && pattern.test(haystack));
}

export function scoreJob(job, keywords = []) {
  const phrases = keywords.map(normalizeText).filter(Boolean);
  if (!phrases.length) return 50;
  const title = normalizeText(job.title);
  const description = normalizeText(job.description);
  let titleHits = 0;
  let descriptionHits = 0;
  for (const phrase of phrases) {
    if (hits(title, phrase)) titleHits += 1;
    else if (hits(description, phrase)) descriptionHits += 1;
  }
  return Math.min(75, titleHits * 25) + Math.min(25, descriptionHits * 10);
}

const REMOTE_WORDS = new Set(['remote', 'anywhere', 'worldwide']);

function matchesLocations(job, locations) {
  if (!locations.length) return true;
  const haystack = normalizeText(`${job.location || ''} ${job.description || ''}`);
  return locations.some((value) => {
    const phrase = normalizeText(value);
    if (!phrase) return false;
    if (job.remote && REMOTE_WORDS.has(phrase)) return true;
    return hits(haystack, phrase);
  });
}

function matchesKeywords(job, keywords) {
  if (!keywords.length) return true;
  return keywords.some((value) => hits(normalizeText(job.title), value)
    || hits(normalizeText(job.description), value));
}

function byScore(a, b) {
  if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
  if (a.datePosted !== b.datePosted) return String(b.datePosted).localeCompare(String(a.datePosted));
  return String(a.title).localeCompare(String(b.title));
}

export function filterJobs(jobs = [], { keywords = [], locations = [], onlyMatches = true, saOnly = true } = {}) {
  const keywordList = keywords.map((value) => String(value).trim()).filter(Boolean);
  const locationList = locations.map((value) => String(value).trim()).filter(Boolean);
  const scoped = saOnly ? jobs.filter((job) => isSouthAfrican(job.location)) : jobs;
  const scored = scoped.map((job) => ({ ...job, matchScore: scoreJob(job, keywordList) }));
  const kept = onlyMatches
    ? scored.filter((job) => matchesKeywords(job, keywordList) && matchesLocations(job, locationList))
    : scored;
  return kept.sort(byScore);
}

function earlier(a, b) {
  if (!a) return b || '';
  if (!b) return a;
  return a < b ? a : b;
}

export function dedupeJobs(jobs = []) {
  const merged = new Map();
  for (const job of jobs) {
    const key = fingerprint(job.title, job.company);
    const current = merged.get(key);
    if (!current) {
      merged.set(key, { ...job, sources: [job.source] });
      continue;
    }
    merged.set(key, {
      ...current,
      sources: [...new Set([...current.sources, job.source])],
      description: job.description.length > current.description.length ? job.description : current.description,
      applyUrl: current.applyUrl || job.applyUrl,
      datePosted: earlier(current.datePosted, job.datePosted),
      remote: current.remote || job.remote,
      tags: [...new Set([...current.tags, ...job.tags])].slice(0, 10),
      salaryText: current.salaryText || job.salaryText
    });
  }
  return [...merged.values()];
}
