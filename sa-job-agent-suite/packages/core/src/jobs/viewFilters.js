// Pure filter contract for both job views. The client stores and renders; this
// module decides what is visible and never mutates a job.
import { PROVINCES, jobLocationVerdict, jobProvince, jobRemote } from './location.js';

export const DEFAULT_VIEW_FILTERS = Object.freeze({
  q: '',
  status: 'all',
  province: 'all',
  source: 'all',
  minScore: 0,
  link: 'all',
  remoteOnly: false,
  addedWithin: 'any',
  saOnly: true
});

const STATUSES = new Set(['all', 'found', 'tailored', 'applied', 'interviewing', 'offer', 'rejected']);
const LINKS = new Set(['all', 'live', 'no-link']);
const WINDOWS = new Set(['any', '7', '30']);

function boundedScore(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

export function normalizeViewFilters(input) {
  const raw = input && typeof input === 'object' ? input : {};
  return {
    q: typeof raw.q === 'string' ? raw.q.slice(0, 200) : '',
    status: STATUSES.has(raw.status) ? raw.status : 'all',
    province: PROVINCES.includes(raw.province) ? raw.province : 'all',
    source: typeof raw.source === 'string' && raw.source ? raw.source : 'all',
    minScore: boundedScore(raw.minScore),
    link: LINKS.has(raw.link) ? raw.link : 'all',
    remoteOnly: raw.remoteOnly === true,
    addedWithin: WINDOWS.has(raw.addedWithin) ? raw.addedWithin : 'any',
    saOnly: raw.saOnly !== false
  };
}

function daysSince(dateAdded, now) {
  const time = Date.parse(dateAdded);
  if (!Number.isFinite(time)) return null;
  return (now - time) / 86_400_000;
}

function matchesLink(job, link) {
  if (link === 'live') return job.linkStatus === 'live';
  if (link === 'no-link') return job.linkStatus !== 'live';
  return true;
}

export function filterJobsForView(jobs = [], input = {}, now = Date.now()) {
  const filters = normalizeViewFilters(input);
  const query = filters.q.trim().toLowerCase();
  const visible = [];
  let hiddenForeign = 0;
  let total = 0;

  for (const job of jobs) {
    total += 1;
    if (filters.saOnly && jobLocationVerdict(job) === 'foreign') {
      hiddenForeign += 1;
      continue;
    }
    if (filters.status !== 'all' && job.status !== filters.status) continue;
    if (filters.province !== 'all' && jobProvince(job) !== filters.province) continue;
    if (filters.source !== 'all' && job.source !== filters.source) continue;
    if ((Number(job.matchScore) || 0) < filters.minScore) continue;
    if (!matchesLink(job, filters.link)) continue;
    if (filters.remoteOnly && !jobRemote(job)) continue;
    if (filters.addedWithin !== 'any') {
      const days = daysSince(job.dateAdded, now);
      if (days === null || days > Number(filters.addedWithin)) continue;
    }
    if (query) {
      const haystack = `${job.title || ''} ${job.company || ''} ${job.location || ''} ${job.source || ''}`.toLowerCase();
      if (!haystack.includes(query)) continue;
    }
    visible.push(job);
  }

  return { visible, hiddenForeign, total };
}

export function activeFilterCount(input) {
  const filters = normalizeViewFilters(input);
  let count = 0;
  if (filters.q.trim()) count += 1;
  if (filters.status !== 'all') count += 1;
  if (filters.province !== 'all') count += 1;
  if (filters.source !== 'all') count += 1;
  if (filters.minScore > 0) count += 1;
  if (filters.link !== 'all') count += 1;
  if (filters.remoteOnly) count += 1;
  if (filters.addedWithin !== 'any') count += 1;
  if (filters.saOnly !== DEFAULT_VIEW_FILTERS.saOnly) count += 1;
  return count;
}
