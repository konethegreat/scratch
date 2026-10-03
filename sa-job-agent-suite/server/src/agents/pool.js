// ── Bounded concurrency pool (T4) ──────────────────────────────────────────────
// A tiny, dependency-free fan-out helper used to turn serial agent work (tailoring
// one job at a time) into bounded parallel bursts. Kept free of any imports so the
// pure logic is trivially unit-testable in isolation — the heavier orchestrators
// (subAgents.js, routineRunner.js) build on top of it.
//
// SAFETY / COST: the whole point of bounding concurrency is backpressure. Never run
// this unbounded — every worker is (potentially) a paid AI call, so the pool size
// is the cost cap. resolveTailorConcurrency() clamps the user/tier value into a
// sane range so a typo or a hostile tier value can't fan out hundreds of calls.

/**
 * Clamps an integer into [min,max], falling back to dflt for non-numbers.
 */
export function clampConcurrency(v, { min = 1, max = 5, dflt = 3 } = {}) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return dflt;
  return Math.max(min, Math.min(max, n));
}

/**
 * Resolves the effective tailoring concurrency from the profile, clamped to a hard
 * ceiling. This is where a tier gate would lower the ceiling (e.g. free=1, pro=3,
 * top=5) — for now it just enforces a safe global cap.
 */
export function resolveTailorConcurrency(profile = {}) {
  return clampConcurrency(profile.tailorConcurrency, { min: 1, max: 5, dflt: 3 });
}

/**
 * Runs `worker(item, index)` over `items` with at most `concurrency` in flight at
 * once. Resolves to an array of per-item results in the ORIGINAL order, each shaped
 * `{ ok, value }` or `{ ok:false, error }` — so one failing worker never rejects the
 * whole batch (best-effort fan-out, matching the rest of the suite's error model).
 *
 * Backpressure is structural: exactly `concurrency` workers advance the shared
 * cursor, so no more than that many run at any instant regardless of item count.
 */
export async function mapPool(items, worker, concurrency = 3) {
  const list = Array.isArray(items) ? items : [];
  const size = Math.max(1, Math.min(parseInt(concurrency, 10) || 1, list.length || 1));
  const results = new Array(list.length);
  let cursor = 0;

  async function runLane() {
    while (true) {
      const i = cursor++;
      if (i >= list.length) return;
      try {
        results[i] = { ok: true, value: await worker(list[i], i) };
      } catch (error) {
        results[i] = { ok: false, error };
      }
    }
  }

  const lanes = [];
  for (let l = 0; l < size; l++) lanes.push(runLane());
  await Promise.all(lanes);
  return results;
}
