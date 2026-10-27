import { FeedShapeError, makeRawJob, looksRemote } from './shape.js';

const LIMIT = 300;

export function normalizeArbeitnow(raw) {
  if (!raw || !Array.isArray(raw.data)) throw new FeedShapeError('Arbeitnow', 'expected data[]');
  return raw.data
    .map((row) => makeRawJob('arbeitnow', {
      sourceId: row.slug ?? row.url,
      title: row.title,
      company: row.company_name,
      location: row.location,
      description: row.description,
      applyUrl: row.url,
      datePosted: row.created_at,
      remote: row.remote === true || looksRemote(row.location, row.title),
      tags: row.tags,
      salaryText: ''
    }))
    .filter(Boolean)
    .slice(0, LIMIT);
}
