import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  STATUSES, summariseRun, baselineRaw, computeStatus, shouldSkip, applyRun, emptyEntry
} from './health.js';

const HOUR = 3600 * 1000;
const NOW = Date.parse('2026-10-25T12:00:00.000Z');
let tick = 0;
const iso = (n) => new Date(Date.parse('2026-10-20T00:00:00.000Z') + n * 60000).toISOString();

// A RunRecord with sensible defaults; all `raw` cards complete unless overridden.
function run(over = {}) {
  const raw = over.raw ?? 10;
  return {
    at: iso(++tick), kind: 'hunt', pages: 1, raw,
    withTitle: raw, withUrl: raw, withCompany: raw, withLocation: raw,
    httpStatus: 200, blocked: false, blockKind: null, error: null, ms: 100, via: 'css', stopReason: 'done',
    ...over
  };
}
const entryWith = (runs, over = {}) => ({ ...emptyEntry(), runs, ...over });
const goodRuns = (n, raw = 10) => Array.from({ length: n }, () => run({ raw }));

describe('source health model', () => {

test('STATUSES lists every status', () => {
  assert.deepEqual(STATUSES, ['healthy', 'degraded', 'broken', 'blocked', 'needs-login', 'disabled', 'unknown']);
});

test('summariseRun counts completeness fields over non-empty strings', () => {
  const r = summariseRun({
    kind: 'hunt', pages: 2, ms: 50, via: 'css', stopReason: 'done', at: iso(1),
    items: [
      { title: 'A', applyUrl: 'https://x/1', company: 'Co', location: 'JHB' },
      { title: '  ', applyUrl: '', company: 'Co', location: '' },
      { title: 'C', applyUrl: 'https://x/3', company: null, location: undefined },
      { title: 42, applyUrl: 'https://x/4' }
    ]
  });
  assert.equal(r.kind, 'hunt');
  assert.equal(r.at, iso(1));
  assert.equal(r.pages, 2);
  assert.equal(r.raw, 4);
  assert.equal(r.withTitle, 2);
  assert.equal(r.withUrl, 3);
  assert.equal(r.withCompany, 2);
  assert.equal(r.withLocation, 1);
  assert.equal(r.blocked, false);
  assert.equal(r.error, null);
  assert.equal(r.httpStatus, null);
  assert.equal(r.blockKind, null);
  assert.equal(r.ms, 50);
});

test('baselineRaw is the median of the last successful hunt runs and ignores zero and canary runs', () => {
  assert.deepEqual(baselineRaw([]), { median: 0, samples: 0 });
  const runs = [
    run({ raw: 0 }),
    run({ raw: 100, kind: 'canary' }),
    run({ raw: 50, error: 'boom' }),
    run({ raw: 50, blocked: true }),
    run({ raw: 10 }), run({ raw: 30 }), run({ raw: 20 })
  ];
  assert.deepEqual(baselineRaw(runs), { median: 20, samples: 3 });
  // even count: average of the middle two, rounded
  assert.deepEqual(baselineRaw([run({ raw: 10 }), run({ raw: 15 })]), { median: 13, samples: 2 });
  // only the last 10 qualifying runs count
  const many = [run({ raw: 1000 }), run({ raw: 1000 }), ...goodRuns(10, 7)];
  assert.deepEqual(baselineRaw(many), { median: 7, samples: 10 });
});

test('computeStatus: disabled', () => {
  const s = computeStatus(entryWith(goodRuns(3), { enabled: false }));
  assert.equal(s.status, 'disabled');
});

test('computeStatus: unknown', () => {
  const s = computeStatus(emptyEntry());
  assert.equal(s.status, 'unknown');
  assert.equal(s.circuitOpen, false);
});

test('computeStatus: canary failure', () => {
  const hunts = goodRuns(3);
  const canary = { at: iso(10000), pass: false, reasons: ['no cards on fixture', 'title selector missing'], raw: 0, ms: 5 };
  const s = computeStatus(entryWith(hunts, { canary }));
  assert.equal(s.status, 'broken');
  assert.match(s.reason, /no cards on fixture/);
  assert.match(s.reason, /title selector missing/);
  // an older failing canary is superseded by a newer hunt run
  const old = { at: '2000-01-01T00:00:00.000Z', pass: false, reasons: ['x'], raw: 0, ms: 5 };
  assert.equal(computeStatus(entryWith(goodRuns(3), { canary: old })).status, 'healthy');
  // a passing canary never breaks anything
  const pass = { at: iso(10000), pass: true, reasons: [], raw: 3, ms: 5 };
  assert.equal(computeStatus(entryWith(goodRuns(3), { canary: pass })).status, 'healthy');
});

test('computeStatus: blocked', () => {
  const s = computeStatus(entryWith([...goodRuns(3), run({ raw: 0, blocked: true, blockKind: 'captcha' })]));
  assert.equal(s.status, 'blocked');
});

test('computeStatus: needs-login', () => {
  const s = computeStatus(entryWith([...goodRuns(3), run({ raw: 0, blocked: true, blockKind: 'login' })]));
  assert.equal(s.status, 'needs-login');
});

test('computeStatus: error', () => {
  const s = computeStatus(entryWith([run({ raw: 0, error: 'net::ERR_FAILED' })]));
  assert.equal(s.status, 'broken');
  assert.match(s.reason, /net::ERR_FAILED/);
});

test('computeStatus: silent zero after good baseline -> broken', () => {
  const s = computeStatus(entryWith([...goodRuns(3, 12), run({ raw: 0 })]));
  assert.equal(s.status, 'broken');
  assert.equal(s.reason, 'returned nothing; normally returns ~12');
  // the bad run must not pollute its own baseline: still broken with only 2 prior samples
  assert.equal(computeStatus(entryWith([...goodRuns(2, 12), run({ raw: 0 })])).status, 'broken');
});

test('computeStatus: zero with no baseline -> degraded', () => {
  const s = computeStatus(entryWith([run({ raw: 0 })]));
  assert.equal(s.status, 'degraded');
  assert.equal(s.reason, 'returned nothing (no baseline yet)');
  // one prior sample is not enough, and a tiny median (<3) is not enough
  assert.equal(computeStatus(entryWith([run({ raw: 12 }), run({ raw: 0 })])).status, 'degraded');
  assert.equal(computeStatus(entryWith([...goodRuns(3, 2), run({ raw: 0 })])).status, 'degraded');
});

test('computeStatus: cards without titles -> broken', () => {
  const s = computeStatus(entryWith([run({ raw: 10, withTitle: 5 })]));
  assert.equal(s.status, 'broken');
  assert.equal(s.reason, 'cards found but title/link missing: the page layout changed');
});

test('computeStatus: cards without links -> broken', () => {
  const s = computeStatus(entryWith([run({ raw: 10, withUrl: 7 })]));
  assert.equal(s.status, 'broken');
  assert.match(s.reason, /title\/link missing/);
});

test('computeStatus: missing company/location -> degraded', () => {
  assert.equal(computeStatus(entryWith([run({ raw: 10, withCompany: 4 })])).status, 'degraded');
  assert.equal(computeStatus(entryWith([run({ raw: 10, withLocation: 4 })])).status, 'degraded');
  // exactly 50% is fine
  assert.equal(computeStatus(entryWith([run({ raw: 10, withCompany: 5, withLocation: 5 })])).status, 'healthy');
});

test('computeStatus: yield collapse -> degraded', () => {
  const s = computeStatus(entryWith([...goodRuns(3, 30), run({ raw: 5 })]));
  assert.equal(s.status, 'degraded');
  assert.equal(s.reason, 'yield dropped to 5 from ~30');
  // needs 3 samples before it applies
  assert.equal(computeStatus(entryWith([...goodRuns(2, 30), run({ raw: 5 })])).status, 'healthy');
});

test('computeStatus: healthy', () => {
  const s = computeStatus(entryWith(goodRuns(4, 15)));
  assert.equal(s.status, 'healthy');
  assert.equal(s.circuitOpen, false);
  const open = computeStatus(entryWith(goodRuns(1), { circuit: { open: true, openedAt: iso(1), reason: 'x' } }));
  assert.equal(open.circuitOpen, true);
});

test('applyRun keeps only the last 20 runs and never mutates its input', () => {
  let e = emptyEntry();
  const frozen = Object.freeze({ ...e, runs: Object.freeze([]) });
  const out = applyRun(frozen, run(), NOW);
  assert.notEqual(out, frozen);
  assert.equal(frozen.runs.length, 0);
  for (let i = 0; i < 30; i++) e = applyRun(e, run({ raw: i + 1 }), NOW);
  assert.equal(e.runs.length, 20);
  assert.equal(e.runs[19].raw, 30);
  assert.equal(e.runs[0].raw, 11);
});

test('applyRun updates lastSuccessAt only for successful runs', () => {
  let e = applyRun(emptyEntry(), run({ raw: 5, at: iso(1) }), NOW);
  assert.equal(e.lastSuccessAt, iso(1));
  e = applyRun(e, run({ raw: 0, at: iso(2) }), NOW);
  e = applyRun(e, run({ raw: 5, error: 'x', at: iso(3) }), NOW);
  e = applyRun(e, run({ raw: 5, blocked: true, at: iso(4) }), NOW);
  assert.equal(e.lastSuccessAt, iso(1));
});

test('three consecutive broken hunts open the circuit; a healthy hunt closes it; blocked runs never count toward the circuit', () => {
  let e = emptyEntry();
  const broken = () => run({ raw: 0, error: 'selector gone' });
  e = applyRun(e, broken(), NOW);
  e = applyRun(e, broken(), NOW);
  assert.equal(e.consecutiveBroken, 2);
  assert.equal(e.circuit.open, false);
  e = applyRun(e, broken(), NOW);
  assert.equal(e.consecutiveBroken, 3);
  assert.equal(e.circuit.open, true);
  assert.match(e.circuit.reason, /selector gone/);
  assert.equal(typeof e.circuit.openedAt, 'string');
  assert.equal(shouldSkip(e, NOW).skip, true);

  e = applyRun(e, run({ raw: 10 }), NOW);
  assert.equal(e.consecutiveBroken, 0);
  assert.equal(e.circuit.open, false);
  assert.equal(e.circuit.openedAt, null);

  // blocked runs are not broken runs
  let b = emptyEntry();
  for (let i = 0; i < 5; i++) b = applyRun(b, run({ raw: 0, blocked: true, blockKind: 'captcha' }), NOW);
  assert.equal(b.consecutiveBroken, 0);
  assert.equal(b.circuit.open, false);
});

test('two consecutive blocked hunts set a 6 hour cooldown', () => {
  let e = applyRun(emptyEntry(), run({ raw: 0, blocked: true, blockKind: 'captcha' }), NOW);
  assert.equal(e.cooldownUntil, null);
  e = applyRun(e, run({ raw: 0, blocked: true, blockKind: 'captcha' }), NOW);
  assert.equal(e.cooldownUntil, new Date(NOW + 6 * HOUR).toISOString());
  assert.equal(shouldSkip(e, NOW + HOUR).skip, true);
  // a canary in between does not break "consecutive hunt" blocks
  let c = applyRun(emptyEntry(), run({ raw: 0, blocked: true }), NOW);
  c = applyRun(c, run({ kind: 'canary', raw: 0, error: 'nope' }), NOW);
  c = applyRun(c, run({ raw: 0, blocked: true }), NOW);
  assert.equal(c.cooldownUntil, new Date(NOW + 6 * HOUR).toISOString());
  // non-consecutive blocks do not
  let d = applyRun(emptyEntry(), run({ raw: 0, blocked: true }), NOW);
  d = applyRun(d, run({ raw: 10 }), NOW);
  d = applyRun(d, run({ raw: 0, blocked: true }), NOW);
  assert.equal(d.cooldownUntil, null);
});

test('a passing canary closes the circuit and clears the cooldown; a failing one does not open it', () => {
  let e = emptyEntry();
  for (let i = 0; i < 3; i++) e = applyRun(e, run({ raw: 0, error: 'x' }), NOW);
  e = { ...e, cooldownUntil: new Date(NOW + HOUR).toISOString() };
  assert.equal(e.circuit.open, true);
  const after = applyRun(e, run({ kind: 'canary', raw: 4 }), NOW);
  assert.equal(after.circuit.open, false);
  assert.equal(after.cooldownUntil, null);
  assert.equal(after.consecutiveBroken, 0);

  let f = emptyEntry();
  for (let i = 0; i < 5; i++) f = applyRun(f, run({ kind: 'canary', raw: 0, error: 'bad' }), NOW);
  assert.equal(f.circuit.open, false);
  assert.equal(f.consecutiveBroken, 0);
});

test('shouldSkip reports disabled, circuit and cooldown', () => {
  assert.deepEqual(shouldSkip(emptyEntry(), NOW), { skip: false, reason: '' });
  assert.deepEqual(shouldSkip({ ...emptyEntry(), enabled: false }, NOW), { skip: true, reason: 'disabled' });
  const c = { ...emptyEntry(), circuit: { open: true, openedAt: iso(1), reason: 'selector gone' } };
  assert.deepEqual(shouldSkip(c, NOW), { skip: true, reason: 'circuit open: selector gone' });
  const cd = { ...emptyEntry(), cooldownUntil: new Date(NOW + HOUR).toISOString() };
  assert.deepEqual(shouldSkip(cd, NOW), { skip: true, reason: 'cooling down after repeated blocks' });
  const past = { ...emptyEntry(), cooldownUntil: new Date(NOW - HOUR).toISOString() };
  assert.equal(shouldSkip(past, NOW).skip, false);
});

test('computeStatus: a linkless source (expectsUrl false) is healthy with titles and no links', () => {
  const linkless = (over = {}) => run({ raw: 20, withUrl: 0, expectsUrl: false, ...over });
  assert.equal(computeStatus(entryWith([linkless()])).status, 'healthy');
  // same run, expectsUrl true or omitted -> broken
  assert.equal(computeStatus(entryWith([linkless({ expectsUrl: true })])).status, 'broken');
  assert.equal(computeStatus(entryWith([run({ raw: 20, withUrl: 0 })])).status, 'broken');
  // titles missing still breaks a linkless run
  assert.equal(computeStatus(entryWith([linkless({ withTitle: 5 })])).status, 'broken');
});

test('applyRun on three linkless healthy hunts never opens the circuit', () => {
  let e = emptyEntry();
  for (let i = 0; i < 5; i++) e = applyRun(e, run({ raw: 20, withUrl: 0, expectsUrl: false }), NOW);
  assert.equal(e.consecutiveBroken, 0);
  assert.equal(e.circuit.open, false);
});

test('summariseRun stores expectsUrl (default true)', () => {
  assert.equal(summariseRun({ items: [] }).expectsUrl, true);
  assert.equal(summariseRun({ items: [], expectsUrl: false }).expectsUrl, false);
});

test('summariseRun does not count a Confidential company as filled', () => {
  const r = summariseRun({
    items: [
      { title: 'A', company: 'Confidential', location: 'Confidential' },
      { title: 'B', company: ' confidential ', location: 'JHB' },
      { title: 'C', company: 'Acme', location: 'CPT' }
    ]
  });
  assert.equal(r.withCompany, 1);
  assert.equal(r.withLocation, 3); // locations are not special-cased
});

test('login blocks never set a cooldown; challenge blocks do', () => {
  const blockedRun = (blockKind) => run({ raw: 0, blocked: true, blockKind });
  let login = applyRun(applyRun(emptyEntry(), blockedRun('login'), NOW), blockedRun('login'), NOW);
  assert.equal(login.cooldownUntil, null);
  assert.equal(shouldSkip(login, NOW).skip, false);
  assert.equal(computeStatus(login).status, 'needs-login');

  const challenge = applyRun(applyRun(emptyEntry(), blockedRun('challenge'), NOW), blockedRun('challenge'), NOW);
  assert.equal(challenge.cooldownUntil, new Date(NOW + 6 * HOUR).toISOString());

  const mixed = applyRun(applyRun(emptyEntry(), blockedRun('challenge'), NOW), blockedRun('login'), NOW);
  assert.equal(mixed.cooldownUntil, null);
});

test('computeStatus: missing completeness fields count as 0', () => {
  const bare = { at: iso(++tick), kind: 'hunt', raw: 10 };
  assert.equal(computeStatus(entryWith([bare])).status, 'broken');
  const titledOnly = { ...bare, withTitle: 10, withUrl: 10 };
  assert.equal(computeStatus(entryWith([titledOnly])).status, 'degraded');
});

test('computeStatus: a failing canary with an invalid or missing at is not ignored', () => {
  for (const at of ['not-a-date', undefined, null, '']) {
    const canary = { at, pass: false, reasons: ['selector gone'], raw: 0, ms: 1 };
    const s = computeStatus(entryWith(goodRuns(3), { canary }));
    assert.equal(s.status, 'broken', `at=${String(at)}`);
    assert.match(s.reason, /selector gone/);
  }
});

test('summariseRun stores strategy and quality counts with raw as attempts', () => {
  const r = summariseRun({
    kind: 'hunt', items: [{ title: 'Backend Developer', applyUrl: 'https://x/1' }],
    strategy: 'structured', valid: 1, rejected: 3, rejectReasons: ['3 rows with no apply link'], at: iso(900)
  });
  assert.equal(r.raw, 4);
  assert.equal(r.valid, 1);
  assert.equal(r.rejected, 3);
  assert.equal(r.strategy, 'structured');
  assert.deepEqual(r.rejectReasons, ['3 rows with no apply link']);
});

test('a high rejection ratio marks the source broken and names the count', () => {
  const entry = entryWith([run({ raw: 10, valid: 5, rejected: 5, rejectReasons: ['5 rows with no apply link'] })]);
  const { status, reason } = computeStatus(entry);
  assert.equal(status, 'broken');
  assert.match(reason, /5 of 10 cards failed validation/);
});

test('a moderate rejection ratio marks the source degraded with the top reason', () => {
  const entry = entryWith([run({ raw: 10, valid: 8, rejected: 2, rejectReasons: ['2 rows with no apply link'] })]);
  const { status, reason } = computeStatus(entry);
  assert.equal(status, 'degraded');
  assert.match(reason, /no apply link/);
});

test('a small sample is judged by completeness, not the ratio', () => {
  const entry = entryWith([run({ raw: 3, valid: 2, rejected: 1, withTitle: 2, withUrl: 2, withCompany: 2, withLocation: 2 })]);
  assert.equal(computeStatus(entry).status, 'healthy');
});

test('all rows rejected is never a success or a healthy status', () => {
  const before = { ...emptyEntry(), lastSuccessAt: null, consecutiveBroken: 0, runs: [] };
  const rejectedRun = run({ raw: 5, valid: 0, rejected: 5, rejectReasons: ['5 rows with no usable title'] });
  const next = applyRun(before, rejectedRun, NOW);
  assert.equal(next.lastSuccessAt, null);
  assert.equal(next.consecutiveBroken, 1);
  assert.equal(computeStatus(next).status, 'broken');
});

test('old run records without quality fields keep the previous behaviour', () => {
  const entry = entryWith(goodRuns(3));
  assert.equal(computeStatus(entry).status, 'healthy');
  assert.equal(baselineRaw(entry.runs).median, 10);
});

test('the baseline counts valid rows, not rejected attempts', () => {
  const runs = [run({ raw: 10, valid: 10, rejected: 0 }), run({ raw: 20, valid: 6, rejected: 14 }), run({ raw: 10, valid: 10, rejected: 0 })];
  assert.equal(baselineRaw(runs).median, 10);
});
});
