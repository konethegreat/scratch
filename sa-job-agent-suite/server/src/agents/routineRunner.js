// ── Routine Runner (T1) ───────────────────────────────────────────────────────
// A dependency-free scheduler for unattended, recurring runs. A single 60s tick
// evaluates each enabled routine and runs the ones that are due. On startup it
// does one catch-up pass so a routine whose scheduled time passed while the app
// was closed still runs (if catchUp is on).
//
// SAFETY MODEL (read before extending):
//   • Routines only ever run the Hunter and, optionally, the Tailor. They NEVER
//     run Agent 3 and NEVER submit an application — the human is always present
//     for the apply step. There is no auto-apply routine by design.
//   • Only ONE routine runs at a time (module `busy` flag), and a routine is
//     skipped (deferred to the next tick) if a manual Hunter or Apply session is
//     already running — so unattended work can't collide with the user.
//   • every_n_hours has a 1-hour floor (enforced in helper.js), the auto-tailor
//     count is capped, and tailoring is skipped silently when no provider key is
//     set — so a misconfigured routine can't quietly burn API credit.
//
// Everything here is best-effort: a thrown error is logged and recorded on the
// routine, never allowed to crash the server.

import {
  getRoutines,
  setRoutineRunState,
  getHunterState,
  setHunterState,
  getApplyState,
  getProfile,
  getJobs,
  updateJob,
  addLog
} from '../db/helper.js';
import { runJobHunterAgent } from './agent1-hunter.js';
import { tailorJobsConcurrently } from './subAgents.js';
import { dreamOverMemory } from './memoryReflect.js';

const TICK_MS = 60 * 1000;            // evaluate schedules once a minute
const CATCHUP_WINDOW_MS = 90 * 60 * 1000; // for catchUp:false, how late we may still fire

let tickTimer = null;
let busy = false; // only one routine executes at a time, across ticks

// ── Schedule evaluation ───────────────────────────────────────────────────────

function scheduledTimeToday(now, timeOfDay) {
  const [hh, mm] = String(timeOfDay || '07:00').split(':').map((x) => parseInt(x, 10));
  const d = new Date(now);
  d.setHours(hh || 0, mm || 0, 0, 0);
  return d;
}

/**
 * Is this routine due to run right now? Pure function of the routine + clock.
 * Daily/weekday catch-up is implicit: if the app was closed at the scheduled
 * time and opened later the same day, the "hasn't run since scheduled time"
 * check makes it due on the next tick (unless catchUp is off and the window
 * has passed).
 */
export function isDue(routine, now = new Date()) {
  if (!routine || !routine.enabled) return false;
  const { frequency, timeOfDay, everyHours } = routine.schedule || {};
  const last = routine.lastRun ? new Date(routine.lastRun) : null;

  if (frequency === 'every_n_hours') {
    const intervalMs = Math.max(1, parseInt(everyHours, 10) || 6) * 60 * 60 * 1000;
    if (!last) return true;
    return now.getTime() - last.getTime() >= intervalMs;
  }

  // daily / weekdays
  if (frequency === 'weekdays') {
    const day = now.getDay(); // 0 Sun … 6 Sat
    if (day === 0 || day === 6) return false;
  }
  const scheduled = scheduledTimeToday(now, timeOfDay);
  if (now < scheduled) return false;                  // not yet time today
  if (last && last >= scheduled) return false;        // already ran since today's slot
  if (!routine.catchUp && now.getTime() - scheduled.getTime() > CATCHUP_WINDOW_MS) {
    return false;                                     // missed window, catch-up disabled
  }
  return true;
}

// ── Execution ─────────────────────────────────────────────────────────────────

function tailorProviderReady(profile) {
  const provider = profile.aiProvider || 'gemini';
  const key = {
    gemini: profile.geminiApiKey,
    anthropic: profile.anthropicApiKey,
    openrouter: profile.openRouterApiKey
  }[provider];
  return Boolean(key && !String(key).includes('your_'));
}

/**
 * Runs one routine to completion. Honours the global concurrency guards.
 * `trigger` is 'schedule' | 'manual' | 'startup' for logging only.
 * Returns the result summary, or null if it was skipped.
 */
export async function runRoutine(routine, { trigger = 'schedule' } = {}) {
  if (!routine) return null;

  // Defer (don't consume the slot) if anything else is running.
  if (busy || getHunterState().isRunning || getApplyState().isRunning) {
    setRoutineRunState(routine.id, { lastStatus: 'skipped' });
    addLog(`Routine "${routine.name}" deferred — another run is in progress.`, 'system');
    return null;
  }

  busy = true;
  const startedAt = new Date().toISOString();
  setRoutineRunState(routine.id, { lastStatus: 'running' });
  addLog(`⏰ Routine "${routine.name}" started (${trigger}).`, 'system');

  const result = { trigger, startedAt, totalFound: 0, totalSaved: 0, tailored: 0, note: '' };

  try {
    // ── Dream-only routine: curate the dossier, no hunting/applying ───────────
    if (routine.type === 'dream') {
      const d = await dreamOverMemory(getProfile());
      result.dream = d;
      result.note = d.skipped
        ? `Dreaming skipped (${d.skipped}).`
        : `Reinforced ${d.reinforced}, pruned ${d.pruned}, added ${d.added}.`;
      result.finishedAt = new Date().toISOString();
      setRoutineRunState(routine.id, { lastRun: result.finishedAt, lastStatus: 'ok', lastResult: result });
      addLog(`✅ Routine "${routine.name}" finished — ${result.note}`, 'system');
      return result;
    }

    // Snapshot existing job IDs so we can tell which jobs THIS run discovered.
    const beforeIds = new Set(getJobs().map((j) => j.id));

    // ── Hunt ─────────────────────────────────────────────────────────────────
    setHunterState({ isRunning: true, startedAt, finishedAt: null, stopRequested: false });
    let huntResult;
    try {
      huntResult = await runJobHunterAgent();
    } finally {
      setHunterState({ isRunning: false, finishedAt: new Date().toISOString(), lastResult: huntResult || null, stopRequested: false });
    }
    result.totalFound = huntResult?.totalFound || 0;
    result.totalSaved = huntResult?.totalSaved || 0;

    // ── Optional auto-tailor of the top NEW matches ────────────────────────────
    if (routine.type === 'hunt_and_tailor' && (routine.autoTailorCount || 0) > 0) {
      const profile = getProfile();
      if (!tailorProviderReady(profile)) {
        result.note = 'Auto-tailor skipped: no AI provider key set.';
        addLog(`Routine "${routine.name}": ${result.note}`, 'system');
      } else {
        const newFound = getJobs()
          .filter((j) => !beforeIds.has(j.id) && j.status === 'found')
          .sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0))
          .slice(0, routine.autoTailorCount);

        if (newFound.length) {
          addLog(`Routine "${routine.name}": auto-tailoring ${newFound.length} top match(es).`, 'system');
          // Tag the queued jobs so the UI can surface a "Ready to apply" tray.
          // updateJob merges, so these survive Agent 2's own status writes.
          const queuedAt = new Date().toISOString();
          for (const job of newFound) {
            updateJob(job.id, { queuedByRoutine: queuedAt, routineName: routine.name });
          }
          // T4: fan the tailoring out concurrently (bounded by tailorConcurrency)
          // instead of one job at a time — the morning routine finishes far faster.
          const batch = await tailorJobsConcurrently(newFound.map((j) => j.id), { trigger: `routine:${routine.name}` });
          result.tailored += batch.tailored;
        }
      }
    }

    result.finishedAt = new Date().toISOString();
    setRoutineRunState(routine.id, { lastRun: result.finishedAt, lastStatus: 'ok', lastResult: result });
    addLog(`✅ Routine "${routine.name}" finished — saved ${result.totalSaved}, tailored ${result.tailored}.`, 'system');
    return result;
  } catch (err) {
    result.error = err.message;
    result.finishedAt = new Date().toISOString();
    setRoutineRunState(routine.id, { lastRun: result.finishedAt, lastStatus: 'error', lastResult: result });
    addLog(`Routine "${routine.name}" failed: ${err.message}`, 'error');
    return result;
  } finally {
    busy = false;
  }
}

/**
 * Manual "Run now" from the UI. Bypasses the schedule but keeps every safety
 * guard. Throws a friendly error if something else is already running.
 */
export async function runRoutineNow(routine) {
  if (busy || getHunterState().isRunning || getApplyState().isRunning) {
    throw new Error('Another run is in progress. Wait for it to finish, then try again.');
  }
  return runRoutine(routine, { trigger: 'manual' });
}

// ── Tick loop ─────────────────────────────────────────────────────────────────

async function tick(trigger = 'schedule') {
  if (busy) return; // a routine is mid-run; re-evaluate next tick
  const now = new Date();
  const due = getRoutines().filter((r) => isDue(r, now));
  if (!due.length) return;
  // Run at most one per tick; the rest are picked up on subsequent ticks so we
  // never stack unattended work.
  await runRoutine(due[0], { trigger });
}

export function startScheduler() {
  if (tickTimer) return;
  addLog('Routine scheduler online (checks every 60s).', 'system');
  // Startup catch-up: give the server a moment to settle, then evaluate once.
  setTimeout(() => { tick('startup').catch(() => {}); }, 8000);
  tickTimer = setInterval(() => { tick('schedule').catch(() => {}); }, TICK_MS);
}

export function stopScheduler() {
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
}
