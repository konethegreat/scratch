// The web twin of the desktop crawler. It reads the three public feeds from
// this browser, keeps what matches the profile, scores it, drops what the
// tracker already holds and saves the rest. No key and no server are involved.
import {
  dedupeJobs, filterJobs, fingerprint, sourceLabel, splitList, trackerFingerprints
} from '@sajas/core/feeds';
import { countForeignJobs } from '@sajas/core/jobs';

export const HUNT_SAVE_LIMIT = 60;

export function planHunt({ profile = {}, jobs = [], feeds = [] } = {}) {
  const merged = dedupeJobs(feeds);
  const keywords = splitList(profile.keywords);
  const locations = splitList(profile.locations);
  const saOnly = profile.feedSaOnly !== false;
  const matches = filterJobs(merged, { keywords, locations, onlyMatches: true, saOnly });
  const tracked = trackerFingerprints(jobs);
  const fresh = matches.filter((job) => !tracked.has(fingerprint(job.title, job.company)));
  return {
    read: merged.length,
    matches: matches.length,
    fresh,
    alreadyTracked: matches.length - fresh.length,
    hiddenForeign: saOnly ? countForeignJobs(merged) : 0,
    keywords,
    locations,
    saOnly
  };
}

export async function runHunt({
  feeds,
  profile = {},
  jobs = [],
  save,
  force = true,
  limit = HUNT_SAVE_LIMIT,
  isCancelled = () => false,
  onProgress = () => {}
} = {}) {
  if (!feeds?.loadAll) throw new Error('No feed client was supplied.');
  if (typeof save !== 'function') throw new Error('No save function was supplied.');

  onProgress({ stage: 'fetching' });
  const outcome = await feeds.loadAll({ force });
  const rows = outcome.results.flatMap((entry) => entry.jobs);

  onProgress({ stage: 'filtering', feeds: outcome.results.length });
  const plan = planHunt({ profile, jobs, feeds: rows });
  const targets = plan.fresh.slice(0, limit);

  let saved = 0;
  let duplicates = 0;
  let failed = 0;
  let stopped = false;
  onProgress({ stage: 'saving', total: targets.length, done: 0 });
  for (const job of targets) {
    if (isCancelled()) {
      stopped = true;
      break;
    }
    let result = 'failed';
    try {
      result = await save(job);
    } catch {
      result = 'failed';
    }
    if (result === 'added') saved += 1;
    else if (result === 'exists') duplicates += 1;
    else failed += 1;
    onProgress({ stage: 'saving', total: targets.length, done: saved + duplicates + failed });
  }

  return {
    read: plan.read,
    matches: plan.matches,
    saved,
    duplicates: plan.alreadyTracked + duplicates,
    failed,
    stopped,
    hiddenForeign: plan.hiddenForeign,
    skippedByLimit: plan.fresh.length - targets.length,
    limit,
    feeds: outcome.results.length,
    perSource: outcome.results.map((entry) => ({
      id: entry.source,
      label: entry.label || sourceLabel(entry.source),
      count: entry.jobs.length
    })),
    errors: outcome.errors
  };
}
