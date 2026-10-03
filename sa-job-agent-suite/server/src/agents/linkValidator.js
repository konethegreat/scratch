import { request } from 'playwright';
import { addLog, getJobs, updateJob } from '../db/helper.js';
import { mapPool } from './pool.js';

// ── Link validation layer ───────────────────────────────────────────────────
// Goal: remove links that are genuinely useless — a CONFIRMED-dead posting
// (404/410/451 or an "expired/filled/closed" page) or a "link" that is really a
// search/category/home page — WITHOUT throwing away good jobs.
//
// Job boards are heavily bot-walled, so a blocked/timed-out/ambiguous check must
// NEVER be read as "dead". The earlier version of this module was far too
// aggressive — brittle per-board URL shapes that blanked real postings, plus
// treating every 4xx/5xx/redirect as dead — which gutted the grounded AI search
// and made the hunter look broken. This is the deliberately conservative
// rewrite: it errs toward KEEPING a job and just flagging confidence.
//
// Policy (one owner — used by both the AI-search phase and the scrapers):
//   • no link, or a "link" that is really a search/category/home page  → KEEP
//        the job as a lead, strip the unusable URL (linkStatus 'no-link'). A
//        linkless lead is still useful; Agent 3 simply won't open it (so it can
//        never "wander" onto a search page either).
//   • confirmed dead — 404/410/451 or an explicit "expired/filled" page  → DROP.
//   • blocked / rate-limited / timeout / 5xx / ambiguous redirect  → KEEP, flag
//        'unverified' (amber badge): we couldn't confirm, so we don't discard.
//   • reachable real posting  → KEEP, flag 'live' (green badge).

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

// Body text that means the advert is gone even when the server returns 200.
const EXPIRED_RE = /\b(no longer (available|accepting applications?|active|open)|this (job|position|vacancy|advert|posting) (has )?(expired|been (filled|closed|removed)|is no longer)|position (has been )?(filled|closed)|job (post(ing)?|advert)? ?not found|vacancy (has )?expired|this position is closed|advert(isement)? (has )?expired|posting (has )?expired|applications? (are )?(now )?closed)\b/i;

// Search / listing / auth landing pages (used for the shape check + as a
// redirect-target signal). Kept conservative — only obvious non-postings.
const LISTING_RE = /\b(search|browse|results?|find-?jobs?|job-?search|listings?)\b/;

// HTTP statuses we treat as a HIGH-CONFIDENCE dead posting. Everything else
// (401/403/405/429/5xx/999 …) is "couldn't confirm", not "dead".
const DEAD_STATUSES = new Set([404, 410, 451]);

// ── Junk-aggregator policy ───────────────────────────────────────────────────
// Low-quality scrape/repost aggregators. They re-list adverts from elsewhere
// behind redirect chains, login walls and long-expired pages — the "weird
// links" problem. A link on one of these is treated like a search-page link:
// the URL is STRIPPED and the job kept as a linkless lead (eligible for AI link
// repair), never dropped. Single owner of this list; jobSearchAI imports it to
// tell Claude not to return such links in the first place.
export const JUNK_AGGREGATOR_HOSTS = [
  'jooble', 'jobrapido', 'whatjobs', 'expertini', 'mitula', 'trovit',
  'jobomas', 'learn4good', 'bebee.com', 'jobtome', 'jobisjob', 'recruit.net',
  'jobgurus', 'jobleads', 'joblum', 'adzuna.com' /* non-SA adzuna; adzuna.co.za stays */
];

/** True when the URL's host belongs to a known junk repost-aggregator. */
export function isJunkAggregatorHost(rawUrl) {
  try {
    const host = new URL(String(rawUrl)).hostname.toLowerCase();
    return JUNK_AGGREGATOR_HOSTS.some((j) =>
      j.includes('.') ? (host === j || host.endsWith(`.${j}`)) : host.split('.').some((p) => p === j)
    );
  } catch {
    return false;
  }
}

/**
 * Is this URL specific enough to be a real single posting (vs a homepage,
 * category, or search page)? Deliberately LENIENT — it returns false ONLY for
 * clear non-postings (bare domain, search query, /search|/browse|/results,
 * "/in-place" category with no id). When it's not obviously one of those, we
 * accept it and let the liveness probe be the real filter.
 * @returns {boolean}
 */
export function classifyPostingUrl(rawUrl) {
  let u;
  try { u = new URL(String(rawUrl)); } catch { return false; }
  if (!/^https?:$/.test(u.protocol)) return false;

  const path = u.pathname.replace(/\/+$/, '');
  const full = (u.pathname + u.search).toLowerCase();

  if (!path || path === '/') return false;                                 // bare domain / homepage
  if (/[?&](q|query|keyword|keywords|search)=/.test(full)) return false;   // search query string
  if (LISTING_RE.test(full)) return false;                                 // /search, /browse, /results …
  if (/\/in-[a-z0-9-]+$/.test(path) && !/\d{4,}/.test(path)) return false; // "/in-cape-town" category, no id

  // Otherwise a real posting almost always carries an id somewhere, or a
  // job/vacancy path segment with something after it. Accept on either —
  // leniency is intentional, the liveness probe does the real work.
  const hasId = /\d{3,}/.test(full);
  const hasJobSeg = /\b(job|jobs|vacancy|vacancies|posting|position|positions|listing|opportunity|advert|adverts|career|careers|requisition|req|gh_jid|greenhouse|lever)\b\/[^/]+/.test(full);
  // An explicit job-id query param (Indeed jk=, ATS requisition ids, etc.) is a
  // strong posting signal even when the id has no 3-digit run — without this such
  // postings get stripped to linkless leads. Safe: search pages don't carry these.
  const hasIdParam = /[?&](jk|jobid|job_id|gh_jid|requisitionid|vacancyid|postingid|posting_id|currentjobid)=[a-z0-9._-]{4,}/i.test(full);
  return hasId || hasJobSeg || hasIdParam;
}

const REQ_HEADERS = { 'User-Agent': UA, 'Accept-Language': 'en-ZA,en;q=0.9', Accept: 'text/html,application/xhtml+xml' };

/**
 * Create a Playwright APIRequestContext for browser-grade liveness probing —
 * a realistic TLS fingerprint + headers that get past far more bot-walls than a
 * raw Node `fetch`, without launching a full browser window. Returns null on
 * failure (the caller falls back to global fetch). Dispose with `.dispose()`.
 */
export async function createProbeContext() {
  try {
    return await request.newContext({
      userAgent: UA,
      extraHTTPHeaders: { 'Accept-Language': 'en-ZA,en;q=0.9' },
      ignoreHTTPSErrors: true
    });
  } catch {
    return null;
  }
}

// Normalised single GET over either backend → { status, finalUrl, text() }.
async function fetchOnce(rawUrl, timeoutMs, requestContext) {
  if (requestContext) {
    const res = await requestContext.get(rawUrl, {
      timeout: timeoutMs,
      maxRedirects: 10,
      failOnStatusCode: false,
      headers: REQ_HEADERS
    });
    return { status: res.status(), finalUrl: res.url() || rawUrl, text: () => res.text() };
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(rawUrl, { redirect: 'follow', signal: ctl.signal, headers: REQ_HEADERS });
    return { status: res.status, finalUrl: res.url || rawUrl, text: () => res.text() };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Liveness probe for one URL. Never throws. CONSERVATIVE: only declares 'dead'
 * on a high-confidence signal (404/410/451, or an explicit expired/filled page).
 * Anything else — a wall, a hiccup, an ambiguous redirect — is 'unverified'.
 * Pass `requestContext` (from createProbeContext) for browser-grade requests;
 * otherwise it uses Node's global `fetch`.
 * @returns {Promise<{state:'live'|'dead'|'unverified', status:number|'ERR', finalUrl:string, reason:string}>}
 */
export async function probeLink(rawUrl, { timeoutMs = 10000, requestContext = null } = {}) {
  try {
    const r = await fetchOnce(rawUrl, timeoutMs, requestContext);
    const { status, finalUrl } = r;

    if (DEAD_STATUSES.has(status)) return { state: 'dead', status, finalUrl, reason: `http-${status}` };
    // Any other non-2xx (401/403/405/429/5xx/999 …) is a wall or a hiccup, not
    // proof the advert is gone → keep, flagged.
    if (status >= 400) return { state: 'unverified', status, finalUrl, reason: `http-${status}` };

    // 200, but the body says the advert is gone → dead (high confidence).
    let body = '';
    try { body = (await r.text()).slice(0, 60000); } catch {}
    if (body && EXPIRED_RE.test(body)) return { state: 'dead', status, finalUrl, reason: 'expired-text' };

    // Redirected onto a home / search / login page: often just a bot bounce,
    // sometimes a pulled advert — we can't be sure, so keep it flagged rather
    // than dropping a possibly-live job.
    try {
      const fp = new URL(finalUrl);
      const fpath = fp.pathname.replace(/\/+$/, '');
      if (!fpath || fpath === '/') return { state: 'unverified', status, finalUrl, reason: 'redirect-home' };
      if (LISTING_RE.test((fp.pathname + fp.search).toLowerCase()))
        return { state: 'unverified', status, finalUrl, reason: 'redirect-listing' };
    } catch {}

    return { state: 'live', status, finalUrl, reason: 'ok' };
  } catch (e) {
    // Network error / timeout: don't discard a possibly-good job on a transient
    // failure — keep it, flagged unverified.
    return { state: 'unverified', status: 'ERR', finalUrl: rawUrl, reason: e.name === 'AbortError' || e.name === 'TimeoutError' ? 'timeout' : (e.message || 'fetch-error') };
  }
}

/**
 * Decide the fate of one job's link. Combines shape + liveness.
 * @returns {Promise<{verdict:'keep'|'drop', linkStatus:string, strip?:boolean, finalUrl?:string, reason:string}>}
 *   - verdict 'drop'  → the posting is confirmed gone; remove the job.
 *   - strip:true      → the URL is unusable (search/category/home); clear it and
 *                       keep the job as a linkless lead.
 *   - linkStatus      → 'live' | 'unverified' | 'no-link' | 'dead'.
 */
export async function validateLink(applyUrl, { timeoutMs = 10000, checkLiveness = true, requestContext = null } = {}) {
  const url = (applyUrl || '').trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    return { verdict: 'keep', linkStatus: 'no-link', reason: 'no direct link — kept as a lead' };
  }
  if (isJunkAggregatorHost(url)) {
    // A repost-aggregator link is worse than none: it usually redirects through
    // ads to an expired page. Strip it, keep the job as a lead (AI link repair
    // can then find the original posting).
    return { verdict: 'keep', linkStatus: 'no-link', strip: true, reason: 'junk repost-aggregator link stripped — kept as lead' };
  }
  if (!classifyPostingUrl(url)) {
    // A search/category/home page, not a posting. Don't open Agent 3 onto it (it
    // would wander) — strip the link and keep the job as a lead.
    return { verdict: 'keep', linkStatus: 'no-link', strip: true, reason: 'not a direct posting (search/category) — link stripped, kept as lead' };
  }
  if (!checkLiveness) {
    // Validation off: shape is fine and we didn't probe → no badge (unchecked).
    return { verdict: 'keep', linkStatus: '', reason: 'shape ok (liveness check disabled)' };
  }
  const p = await probeLink(url, { timeoutMs, requestContext });
  if (p.state === 'dead')       return { verdict: 'drop', linkStatus: 'dead', finalUrl: p.finalUrl, reason: `${p.reason} (${p.status})` };
  if (p.state === 'unverified') return { verdict: 'keep', linkStatus: 'unverified', finalUrl: p.finalUrl, reason: p.reason };
  return { verdict: 'keep', linkStatus: 'live', finalUrl: p.finalUrl, reason: 'live posting' };
}

/**
 * Validate a batch of jobs (objects with `.applyUrl`). Returns
 * { kept, dropped }. Kept jobs gain `linkStatus` (+ `linkCheckedAt`); a job
 * whose link was an unusable search/category page keeps everything but has its
 * `applyUrl` cleared (linkStatus 'no-link'). Only confirmed-dead postings are
 * dropped. Bounded concurrency via pool.js. Best-effort: on any internal failure
 * it returns all jobs unchanged so hunting never breaks because validation
 * hiccuped, and a single worker error keeps that job (flagged unverified) rather
 * than silently losing it.
 */
export async function validateJobs(jobs = [], { concurrency = 5, timeoutMs = 10000, checkLiveness = true, requestContext = null, label = '' } = {}) {
  const list = Array.isArray(jobs) ? jobs : [];
  if (!list.length) return { kept: [], dropped: [] };
  try {
    const results = await mapPool(
      list,
      (job) => validateLink(job.applyUrl, { timeoutMs, checkLiveness, requestContext }),
      concurrency
    );

    const kept = [], dropped = [];
    const tally = { live: 0, unverified: 0, 'no-link': 0 };
    const now = new Date().toISOString();
    results.forEach((r, i) => {
      const job = list[i];
      // mapPool isolates per-item errors; on an internal error KEEP the job
      // (flagged unverified) rather than losing it.
      const v = r.ok ? r.value : { verdict: 'keep', linkStatus: 'unverified', reason: r.error?.message || 'validator-error' };
      if (v.verdict === 'drop') {
        dropped.push({ job, reason: v.reason, linkStatus: v.linkStatus });
        return;
      }
      tally[v.linkStatus] = (tally[v.linkStatus] || 0) + 1;
      kept.push({
        ...job,
        applyUrl: v.strip ? '' : job.applyUrl,
        linkStatus: v.linkStatus,
        linkCheckedAt: now
      });
    });

    if (label) {
      const parts = [];
      if (tally.live) parts.push(`${tally.live} live`);
      if (tally.unverified) parts.push(`${tally.unverified} unverified`);
      if (tally['no-link']) parts.push(`${tally['no-link']} lead(s) without a direct link`);
      addLog(`[Link check · ${label}] kept ${kept.length} (${parts.join(', ') || '—'}), dropped ${dropped.length} confirmed-dead.`, 'agent1');
      for (const d of dropped.slice(0, 8)) {
        addLog(`   ✗ dead: ${(d.job?.title || '').slice(0, 50)} — ${(d.job?.applyUrl || '').slice(0, 70)} (${d.reason})`, 'agent1');
      }
    }
    return { kept, dropped };
  } catch (err) {
    addLog(`[Link check] Skipped (${err.message}) — keeping all jobs unvalidated.`, 'system');
    return { kept: list, dropped: [] };
  }
}

/**
 * Re-check the links of jobs ALREADY in the database (postings go dead over
 * time) and update each job's `linkStatus` in place. Unlike the hunt-time gate
 * this NEVER deletes a job — a confirmed-dead link is just flagged
 * `linkStatus:'dead'` (red "Expired" badge) so the user decides whether to
 * remove or still try it. Skips jobs with no link and anything already applied.
 * Best-effort and browser-grade (creates + disposes its own probe context).
 *
 * @returns {Promise<{checked:number, live:number, unverified:number, dead:number, skipped:number}>}
 */
export async function revalidateJobLinks({ statuses = ['found', 'tailored', 'tailoring'], concurrency = 5, timeoutMs = 10000 } = {}) {
  const stats = { checked: 0, live: 0, unverified: 0, dead: 0, skipped: 0 };
  const all = getJobs();
  const targets = all.filter(
    (j) => statuses.includes(j.status) && j.applyUrl && /^https?:\/\//i.test(j.applyUrl)
  );
  stats.skipped = all.length - targets.length;

  if (!targets.length) {
    addLog(`[Re-check links] No applyable links to re-check (${stats.skipped} skipped).`, 'system');
    return stats;
  }

  addLog(`[Re-check links] Re-checking ${targets.length} saved job link(s)…`, 'system');
  const ctx = await createProbeContext();
  try {
    const results = await mapPool(targets, (job) => probeLink(job.applyUrl, { timeoutMs, requestContext: ctx }), concurrency);
    const now = new Date().toISOString();
    results.forEach((r, i) => {
      const job = targets[i];
      const state = r.ok ? r.value.state : 'unverified';
      const linkStatus = state === 'dead' ? 'dead' : state === 'live' ? 'live' : 'unverified';
      stats.checked++;
      stats[linkStatus === 'dead' ? 'dead' : linkStatus]++;
      updateJob(job.id, { linkStatus, linkCheckedAt: now });
    });
  } finally {
    if (ctx) { try { await ctx.dispose(); } catch {} }
  }

  addLog(`[Re-check links] Done — ${stats.live} live, ${stats.unverified} unverified, ${stats.dead} expired/dead (flagged, not removed).`, 'system');
  return stats;
}
