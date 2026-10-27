import { FeedShapeError, makeRawJob, looksRemote } from './shape.js';

const LIMIT = 300;

export function normalizeRemotive(raw) {
  if (!raw || !Array.isArray(raw.jobs)) throw new FeedShapeError('Remotive', 'expected jobs[]');
  return raw.jobs
    .map((row) => makeRawJob('remotive', {
      sourceId: row.id ?? row.url,
      title: row.title,
      company: row.company_name,
      location: row.candidate_required_location,
      description: row.description,
      applyUrl: row.url,
      datePosted: row.publication_date,
      remote: looksRemote(row.candidate_required_location),
      tags: row.tags,
      salaryText: row.salary
    }))
    .filter(Boolean)
    .slice(0, LIMIT);
}
