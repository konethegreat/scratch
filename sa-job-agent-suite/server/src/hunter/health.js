// Source health model (PURE: no imports, no I/O). Turns the recent run history
// of one job source into a status the UI can show and a circuit breaker the
// hunter can obey. Principle: a scraper that silently returns nothing must
// never read as healthy.

export const STATUSES = ['healthy', 'degraded', 'broken', 'blocked', 'needs-login', 'disabled', 'unknown'];

const MAX_RUNS = 20;
const BASELINE_WINDOW = 10;
const CIRCUIT_THRESHOLD = 3;
const COOLDOWN_MS = 6 * 3600 * 1000;

const filled = (v) => typeof v === 'string' && v.trim().length > 0;

// Build a RunRecord from the raw items a source returned (before scoring).
export function summariseRun({
  kind = 'hunt', items = [], pages = 0, httpStatus = null, blocked = false, blockKind = null,
  error = null, ms = 0, via = 'css', stopReason = '', at
} = {}) {
  const list = Array.isArray(items) ? items : [];
  const count = (pick) => list.reduce((n, it) => n + (it && filled(pick(it)) ? 1 : 0), 0);
  return {
    at: at || new Date().toISOString(),
    kind,
    pages,
    raw: list.length,
    withTitle: count((i) => i.title),
    withUrl: count((i) => i.applyUrl ?? i.url),
    withCompany: count((i) => i.company),
    withLocation: count((i) => i.location),
    httpStatus: httpStatus ?? null,
    blocked: !!blocked,
    blockKind: blockKind || null,
    error: error || null,
    ms,
    via,
    stopReason
  };
}

const isSuccess = (r) => !!r && r.raw > 0 && !r.error && !r.blocked;

// Median of `raw` over the last <=10 successful hunt runs with raw>0.
export function baselineRaw(runs) {
  const good = (Array.isArray(runs) ? runs : [])
    .filter((r) => r && r.kind === 'hunt' && r.raw > 0 && !r.error && !r.blocked)
    .slice(-BASELINE_WINDOW)
    .map((r) => r.raw)
    .sort((a, b) => a - b);
  if (!good.length) return { median: 0, samples: 0 };
  const mid = Math.floor(good.length / 2);
  const median = good.length % 2 ? good[mid] : Math.round((good[mid - 1] + good[mid]) / 2);
  return { median, samples: good.length };
}

export function emptyEntry() {
  return {
    enabled: true,
    runs: [],
    lastSuccessAt: null,
    consecutiveBroken: 0,
    circuit: { open: false, openedAt: null, reason: '' },
    cooldownUntil: null,
    canary: null
  };
}

const ts = (iso) => {
  const n = Date.parse(iso);
  return Number.isNaN(n) ? 0 : n;
};

export function computeStatus(entry, opts = {}) {
  const e = entry || emptyEntry();
  const circuitOpen = !!(e.circuit && e.circuit.open);
  const out = (status, reason) => ({ status, reason, circuitOpen });
  const runs = Array.isArray(e.runs) ? e.runs : [];

  if (e.enabled === false) return out('disabled', 'turned off');
  if (!runs.length) return out('unknown', 'no runs yet');

  // The newest HUNT run drives the status; canary records only matter through
  // entry.canary (the latest canary result).
  let idx = -1;
  for (let i = runs.length - 1; i >= 0; i--) {
    if (runs[i] && runs[i].kind === 'hunt') { idx = i; break; }
  }
  const newest = idx >= 0 ? runs[idx] : null;

  const canary = e.canary;
  if (canary && canary.pass === false && (!newest || ts(canary.at) > ts(newest.at))) {
    const why = Array.isArray(canary.reasons) && canary.reasons.length ? canary.reasons.join('; ') : 'canary failed';
    return out('broken', `canary failed: ${why}`);
  }

  if (!newest) return out('unknown', 'no hunt runs yet');

  if (newest.blocked) {
    return newest.blockKind === 'login'
      ? out('needs-login', 'a login is required: sign in via the login browser')
      : out('blocked', `blocked by the site${newest.blockKind ? ` (${newest.blockKind})` : ''}`);
  }
  if (newest.error && newest.raw === 0) return out('broken', `error: ${newest.error}`);

  // Baseline from the runs BEFORE the newest one, so a bad run cannot dilute its own baseline.
  const baseline = baselineRaw(runs.slice(0, idx));
  const raw = newest.raw;

  if (raw === 0) {
    if (baseline.median >= 3 && baseline.samples >= 2) {
      return out('broken', `returned nothing; normally returns ~${baseline.median}`);
    }
    return out('degraded', 'returned nothing (no baseline yet)');
  }
  if (newest.withTitle / raw < 0.8 || newest.withUrl / raw < 0.8) {
    return out('broken', 'cards found but title/link missing: the page layout changed');
  }
  if (newest.withCompany / raw < 0.5 || newest.withLocation / raw < 0.5) {
    return out('degraded', 'many cards are missing company or location');
  }
  if (baseline.samples >= 3 && raw < 0.3 * baseline.median) {
    return out('degraded', `yield dropped to ${raw} from ~${baseline.median}`);
  }
  void opts;
  return out('healthy', '');
}

export function shouldSkip(entry, now = Date.now()) {
  const e = entry || emptyEntry();
  if (e.enabled === false) return { skip: true, reason: 'disabled' };
  if (e.circuit && e.circuit.open) return { skip: true, reason: `circuit open: ${e.circuit.reason || 'repeated failures'}` };
  if (e.cooldownUntil && ts(e.cooldownUntil) > now) return { skip: true, reason: 'cooling down after repeated blocks' };
  return { skip: false, reason: '' };
}

// Append a run and update the breaker. Returns a NEW entry; the input is not mutated.
export function applyRun(entry, run, now = Date.now()) {
  const base = { ...emptyEntry(), ...(entry || {}) };
  const next = {
    ...base,
    runs: [...(base.runs || []), run].slice(-MAX_RUNS),
    circuit: { ...emptyEntry().circuit, ...(base.circuit || {}) }
  };
  if (isSuccess(run)) next.lastSuccessAt = run.at;

  if (run.kind === 'hunt') {
    const { status, reason } = computeStatus(next, { now });
    if (status === 'broken' && !run.blocked) {
      next.consecutiveBroken = (base.consecutiveBroken || 0) + 1;
      if (next.consecutiveBroken >= CIRCUIT_THRESHOLD && !next.circuit.open) {
        next.circuit = { open: true, openedAt: new Date(now).toISOString(), reason };
      }
    } else {
      next.consecutiveBroken = 0;
      next.circuit = { open: false, openedAt: null, reason: '' };
    }
    const hunts = next.runs.filter((r) => r.kind === 'hunt');
    const n = hunts.length;
    if (n >= 2 && hunts[n - 1].blocked && hunts[n - 2].blocked) {
      next.cooldownUntil = new Date(now + COOLDOWN_MS).toISOString();
    }
  } else if (run.kind === 'canary' && isSuccess(run)) {
    next.consecutiveBroken = 0;
    next.circuit = { open: false, openedAt: null, reason: '' };
    next.cooldownUntil = null;
  }
  return next;
}
