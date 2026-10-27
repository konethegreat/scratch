import { FeedShapeError, makeRawJob, looksRemote } from './shape.js';

const LIMIT = 300;

function grouped(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function salaryText(row) {
  const min = row.annualSalaryMin ? grouped(row.annualSalaryMin) : '';
  const max = row.annualSalaryMax ? grouped(row.annualSalaryMax) : '';
  const range = min && max ? `${min} - ${max}` : (min || max);
  if (!range) return '';
  return [row.salaryCurrency, range].filter(Boolean).join(' ');
}

export function normalizeJobicy(raw) {
  if (!raw || !Array.isArray(raw.jobs)) throw new FeedShapeError('Jobicy', 'expected jobs[]');
  return raw.jobs
    .map((row) => makeRawJob('jobicy', {
      sourceId: row.id ?? row.url,
      title: row.jobTitle,
      company: row.companyName,
      location: row.jobGeo,
      description: row.jobDescription || row.jobExcerpt,
      applyUrl: row.url,
      datePosted: row.pubDate,
      remote: looksRemote(row.jobGeo, row.jobTitle),
      tags: row.jobIndustry,
      salaryText: salaryText(row)
    }))
    .filter(Boolean)
    .slice(0, LIMIT);
}
