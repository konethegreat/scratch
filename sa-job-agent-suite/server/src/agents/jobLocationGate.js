import { classifyLocation } from '@sajas/core/jobs';

// One gate for every hunter path: foreign is rejected for every source, unknown
// only for strict sources. The policy is the source's, never a hard-coded flag.
export function gateJobsByLocation(jobs = [], saCheck = 'soft') {
  const strict = saCheck === 'strict';
  const kept = [];
  const rejected = [];
  for (const job of jobs) {
    const info = classifyLocation(job?.location);
    const allowed = info.verdict === 'sa' || (!strict && info.verdict === 'unknown');
    const entry = { ...job, locationVerdict: info.verdict, province: info.province };
    (allowed ? kept : rejected).push(entry);
  }
  return { kept, rejected };
}

// Strict sources reject unconfirmed locations too, so the log must not call
// every rejection "outside South Africa".
export function describeRejected(jobs = []) {
  const foreign = jobs.filter((job) => job.locationVerdict === 'foreign').length;
  const unknown = jobs.length - foreign;
  const parts = [];
  if (foreign > 0) parts.push(`${foreign} outside South Africa`);
  if (unknown > 0) parts.push(`${unknown} with an unconfirmed location`);
  return parts.join(' and ');
}
