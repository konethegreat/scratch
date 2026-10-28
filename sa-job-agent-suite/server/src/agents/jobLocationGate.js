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
