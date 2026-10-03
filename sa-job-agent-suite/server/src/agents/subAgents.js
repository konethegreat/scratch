// ── Parallel sub-agents (T4) ───────────────────────────────────────────────────
// Turns serial tailoring into bounded parallel bursts. Two layers of fan-out:
//   1. Research fan-out — for the jobs we're about to tailor, spawn the research
//      sub-agent for each (bounded) so company briefs are gathered concurrently.
//   2. Tailor fan-out — run Agent 2 across the jobs with a bounded pool, passing
//      each its pre-fetched brief so research isn't repeated.
//
// Concurrency is the cost cap (resolveTailorConcurrency clamps it). Everything is
// best-effort: a failing job is logged and reverted, never aborting the batch. This
// module NEVER runs Agent 3 / never submits — same human-on-the-loop guarantee as
// the rest of the suite.

import { getProfile, getJobs, updateJob, addLog } from '../db/helper.js';
import { runDocumentTailorAgent } from './agent2-tailor.js';
import { researchCompany, researchFanoutReady } from './companyResearch.js';
import { mapPool, resolveTailorConcurrency } from './pool.js';

const MAX_BATCH = 10; // hard cap on jobs per batch (matches the routine auto-tailor cap)

/**
 * Tailors a set of jobs concurrently.
 * @param {string[]} jobIds  IDs to tailor (already existing in the DB).
 * @param {object}   [opts]
 * @param {number}   [opts.concurrency]  Override the profile/tier concurrency.
 * @param {string}   [opts.trigger]      For logging: 'manual' | 'routine' | …
 * @returns {Promise<{ requested, tailored, failed, concurrency }>}
 */
export async function tailorJobsConcurrently(jobIds, opts = {}) {
  const profile = getProfile();
  const ids = Array.from(new Set((jobIds || []).filter(Boolean))).slice(0, MAX_BATCH);
  const concurrency = opts.concurrency != null
    ? Math.max(1, Math.min(5, parseInt(opts.concurrency, 10) || 1))
    : resolveTailorConcurrency(profile);
  const trigger = opts.trigger || 'manual';

  const result = { requested: ids.length, tailored: 0, failed: 0, concurrency };
  if (!ids.length) return result;

  // Resolve the jobs (skip any that vanished).
  const jobsById = new Map(getJobs().map((j) => [j.id, j]));
  const jobs = ids.map((id) => jobsById.get(id)).filter(Boolean);
  if (!jobs.length) return result;

  addLog(`🧵 Tailoring ${jobs.length} job(s) with ${concurrency} in parallel (${trigger}).`, 'system');

  // ── Phase 1: research fan-out (only if enabled + Anthropic key) ──────────────
  // Briefs are gathered concurrently so the slow web-search step overlaps across
  // jobs instead of running one-by-one inside each tailor call.
  const briefs = new Map();
  if (researchFanoutReady(profile)) {
    addLog(`🔎 Researching ${jobs.length} employer(s) in parallel…`, 'system');
    const research = await mapPool(jobs, (job) => researchCompany(profile, job), concurrency);
    research.forEach((r, i) => { briefs.set(jobs[i].id, (r.ok && r.value) ? r.value : ''); });
  }

  // ── Phase 2: tailor fan-out ──────────────────────────────────────────────────
  const outcomes = await mapPool(jobs, async (job) => {
    // Tag for the "Ready to apply" tray and flip status before work starts so the
    // UI reflects in-flight tailoring (updateJob merges, so Agent 2's own writes
    // are preserved).
    updateJob(job.id, { status: 'tailoring' });
    try {
      await runDocumentTailorAgent(job.id, { researchBrief: briefs.get(job.id) || '' });
      return true;
    } catch (err) {
      addLog(`Batch tailor failed for "${job.title}" — ${err.message}`, 'error');
      // Revert only if nothing was saved (mirror the single-job route's behaviour).
      const current = getJobs().find((j) => j.id === job.id);
      if (current && !current.tailoredCvText) updateJob(job.id, { status: 'found' });
      throw err;
    }
  }, concurrency);

  for (const o of outcomes) (o.ok ? result.tailored++ : result.failed++);
  addLog(`🧵 Batch tailoring complete — ${result.tailored} done, ${result.failed} failed.`, 'system');
  return result;
}
