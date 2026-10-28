// Agent 1 — Job Hunter (SA-focused multi-source scraper).
import { v4 as uuidv4 } from 'uuid';
import { addJob, addLog, getProfile, getHunterState } from '../db/helper.js';
import { huntViaClaudeSearch, findDirectPostingUrl } from './jobSearchAI.js';
import { validateJobs, validateLink, createProbeContext } from './linkValidator.js';
import { hasAnthropicKey } from './llm.js';
import { withTask } from '../telemetry.js';
import { SOURCES } from '../hunter/registry.js';
import { fetchSourcePage } from '../hunter/runner.js';
import { crawlPages, pageCapForDepth, defaultKeyOf } from '../hunter/crawl.js';
import { computeStatus, shouldSkip, summariseRun, baselineRaw } from '../hunter/health.js';
import { getHealthEntry, recordRun } from '../hunter/healthStore.js';
import { extractJobsFromPage } from '../hunter/aiExtract.js';
import { tryAcquireBrowser, browserOwner } from '../hunter/browserLock.js';
import { openProfileContext } from '../hunter/browser.js';
import { createPacer } from '../hunter/pacing.js';
import { mergeRejectReasons } from '../hunter/extract.js';
import { describeRejected, gateJobsByLocation } from './jobLocationGate.js';

// Max AI link-repair attempts per run (each is a billed grounded search), only
// when profile.useLinkRepair is on AND an Anthropic key is present.
const LINK_REPAIR_CAP = 6;

// Max raw cards processed per page load — guards against a runaway page.
const MAX_CARDS_PER_PAGE = 80;

// Max AI page-extractor attempts per run, shared across every source.
const EXTRACT_CAP = 6;

// Pacing between requests, kept from the original scraper loop.
const DEFAULT_DELAYS = Object.freeze({ betweenQueriesMs: 2000, betweenSourcesMs: 1500 });

// Test-only seams (ruling T7-f). These are the only hooks the pipeline has.
let testSources = null;
let testContext = null;
let testDelays = null;

/** Tests only: replace the registry (null restores SOURCES). */
export function __setSourcesForTests(sources) {
  testSources = Array.isArray(sources) ? sources : null;
}

/** Tests only: borrow an already-open browser context (the hunter never closes it). */
export function __setContextForTests(context) {
  testContext = context || null;
}

/** Tests only: override the inter-query/inter-source delays (null restores defaults). */
export function __setDelaysForTests(delays) {
  testDelays = delays && typeof delays === 'object'
    ? {
      betweenQueriesMs: Math.max(0, Number(delays.betweenQueriesMs) || 0),
      betweenSourcesMs: Math.max(0, Number(delays.betweenSourcesMs) || 0)
    }
    : null;
}

/**
 * The queries one source runs for a keyword/location matrix.
 * perLocation -> keyword x location; oncePerKeyword and noLocation -> keyword x [null].
 */
export function queriesFor(source, keywords, locations) {
  const kws = Array.isArray(keywords) ? keywords : [];
  const locs = Array.isArray(locations) ? locations : [];
  if (source?.scope === 'perLocation') {
    return kws.flatMap((keyword) => locs.map((location) => ({ keyword, location })));
  }
  return kws.map((keyword) => ({ keyword, location: null }));
}

/** A registry source is enabled unless its health entry was turned off. */
export function sourceEnabled(_profile, id) {
  return getHealthEntry(id).enabled !== false;
}

function emptyResult(extra = {}) {
  return {
    totalFound: 0,
    totalSaved: 0,
    perSource: {},
    linkStats: { live: 0, unverified: 0, noLink: 0, dead: 0, repaired: 0 },
    perSourceStats: {},
    stopped: false,
    ...extra
  };
}

const sleep = (ms) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

/** Parse a value to an int within [min, max], falling back to `fallback`. */
function clampInt(value, fallback, min, max) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

/**
 * Normalizes relative dates into YYYY-MM-DD strings.
 */
function parseDate(dateStr) {
  if (!dateStr) return new Date().toISOString().split('T')[0];
  const normalized = dateStr.toLowerCase().trim();

  if (normalized.includes('today') || normalized.includes('just now') || normalized.includes('hour') || normalized.includes('minute')) {
    return new Date().toISOString().split('T')[0];
  }

  if (normalized.includes('yesterday') || normalized === '1 day ago') {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
  }

  const daysMatch = normalized.match(/(\d+)\s*day/);
  if (daysMatch) {
    const d = new Date();
    d.setDate(d.getDate() - parseInt(daysMatch[1], 10));
    return d.toISOString().split('T')[0];
  }

  const weeksMatch = normalized.match(/(\d+)\s*week/);
  if (weeksMatch) {
    const d = new Date();
    d.setDate(d.getDate() - parseInt(weeksMatch[1], 10) * 7);
    return d.toISOString().split('T')[0];
  }

  const monthsMatch = normalized.match(/(\d+)\s*month/);
  if (monthsMatch) {
    const d = new Date();
    d.setMonth(d.getMonth() - parseInt(monthsMatch[1], 10));
    return d.toISOString().split('T')[0];
  }

  return new Date().toISOString().split('T')[0];
}

// Minimum score a job must reach to be saved. With token-aware scoring, a single
// keyword word in the title scores 18, so any relevant title match passes;
// description-only matches need more. Kept low on purpose — the prior threshold
// of 25 with exact-phrase matching filtered out almost everything.
const SCORE_THRESHOLD = 18;

// Words too generic to count as a keyword signal on their own.
const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'a', 'an', 'of', 'in', 'to', 'jobs', 'job', 'role', 'position', 'vacancy']);

/**
 * Calculates a match score (0-100) based on keyword presence in title and
 * description. Token-aware: a multi-word keyword like "Software Engineer" is
 * scored on the full phrase AND its individual words, so titles such as
 * "Senior Engineer" or "Software Developer" still match. This is deliberately
 * lenient — the previous exact-phrase-only matching returned almost nothing for
 * sources with empty descriptions (LinkedIn, Google, Gumtree).
 */
function calculateMatchScore(title, description, targetKeywords) {
  const titleLower = (title || '').toLowerCase();
  const descLower = (description || '').toLowerCase();
  const phrases = targetKeywords.split(',').map(k => k.trim().toLowerCase()).filter(k => k.length >= 2);

  let score = 0;

  for (const phrase of phrases) {
    const words = phrase.split(/\s+/).filter(w => w.length >= 3 && !STOPWORDS.has(w));

    if (titleLower.includes(phrase)) {
      score += 45;                                              // exact phrase in title
    } else if (words.length && words.every(w => titleLower.includes(w))) {
      score += 32;                                              // all words present in title
    } else if (words.some(w => titleLower.includes(w))) {
      score += 18;                                              // some words in title
    } else if (descLower.includes(phrase)) {
      score += 14;                                              // exact phrase in description
    } else if (words.length && words.every(w => descLower.includes(w))) {
      score += 9;                                               // all words in description
    } else if (words.some(w => descLower.includes(w))) {
      score += 4;                                               // some words in description
    }
  }

  // Tech stack bonuses (additive, not the primary signal)
  const techTerms = ['react', 'node', 'javascript', 'typescript', 'python', 'java', 'angular', 'vue', 'docker', 'kubernetes', 'aws', 'azure', 'devops', 'sql', '.net', 'c#', 'go', 'rust'];
  for (const tech of techTerms) {
    if (descLower.includes(tech) || titleLower.includes(tech)) {
      score += 3;
    }
  }

  if (descLower.includes('remote') && targetKeywords.toLowerCase().includes('remote')) {
    score += 5;
  }

  return Math.min(Math.max(score, 0), 100);
}

/**
 * Main entry point: Runs Agent 1 Job Hunter across all sources.
 */
export function runJobHunterAgent(...args) {
  return withTask('hunt', () => runJobHunterAgentInner(...args));
}

async function runJobHunterAgentInner() {
  // The route normally acquires 'hunt' before calling us. Direct callers (tests,
  // routines) acquire it themselves — but never steal it from another kind.
  const owner = browserOwner();
  if (owner && owner !== 'hunt') {
    const error = `A browser job is already running (${owner}).`;
    addLog(error, 'error');
    return emptyResult({ error });
  }
  let releaseLock = null;
  if (owner !== 'hunt') {
    releaseLock = tryAcquireBrowser('hunt');
    if (!releaseLock) {
      const busyOwner = browserOwner() || 'another job';
      const error = `A browser job is already running (${busyOwner}).`;
      addLog(error, 'error');
      return emptyResult({ error });
    }
  }
  try {
    return await runHunt();
  } finally {
    if (releaseLock) releaseLock();
  }
}

async function runHunt() {
  const profile = getProfile();
  const keywords = (profile.keywords || '').split(',').map(k => k.trim()).filter(Boolean);
  const locations = (profile.locations || '').split(',').map(l => l.trim()).filter(Boolean);

  if (keywords.length === 0 || locations.length === 0) {
    addLog('Cannot start hunter: keywords and locations must both be set in Profile & Settings.', 'error');
    return emptyResult({ error: 'Missing keywords or locations.' });
  }

  addLog('=== Agent 1: Job Hunter Starting ===', 'agent1');
  addLog(`Keywords: ${keywords.join(', ')}`, 'agent1');
  addLog(`Locations: ${locations.join(', ')}`, 'agent1');

  const delays = testDelays || DEFAULT_DELAYS;
  let context = testContext;
  let ownsContext = false;
  let totalFound = 0;
  let totalSaved = 0;
  const perSource = {}; // source name → jobs saved
  const perSourceStats = {}; // source name → run summary for the UI

  const maxKw = clampInt(profile.maxKeywords, 3, 1, 10);
  const maxLoc = clampInt(profile.maxLocations, 2, 1, 8);

  // ── Link validation / repair setup (shared by both phases) ─────────────────
  // Validation (default ON) shape-checks every candidate and, when on, probes it
  // for liveness before saving — only CONFIRMED-dead links are dropped (see
  // linkValidator.js). We probe through a browser-grade Playwright request
  // context (realistic TLS/headers) so bot-walls cause far fewer false
  // "unverified" flags than a raw fetch would.
  const linkCheck = profile.useLinkValidation !== false;
  const probeRequest = linkCheck ? await createProbeContext() : null;

  // Optional AI link repair: when a job is kept WITHOUT a usable link, ask Claude
  // (grounded) for the real posting URL. Gated + capped because each is billed.
  const repairReady = profile.useLinkRepair === true && hasAnthropicKey(profile);
  const repairState = { left: repairReady ? LINK_REPAIR_CAP : 0 };

  // Run-level link health, surfaced in the dashboard Run Summary.
  const linkStats = { live: 0, unverified: 0, noLink: 0, dead: 0, repaired: 0 };

  // Persists a validated batch: optional AI repair of linkless leads, dedupe via
  // addJob, per-source + link-health tallies, one log line each. Declared inside
  // the run so it closes over the counters above (incl. reassigning totalSaved).
  async function finalizeAndSave(kept, droppedCount, perSourceKey) {
    linkStats.dead += droppedCount;
    for (const job of kept) {
      if (job.linkStatus === 'no-link' && repairState.left > 0) {
        repairState.left--;
        try {
          const url = await findDirectPostingUrl(profile, job);
          if (url) {
            const v = await validateLink(url, { checkLiveness: linkCheck, requestContext: probeRequest });
            if (v.verdict === 'keep' && v.linkStatus !== 'no-link' && !v.strip) {
              job.applyUrl = url;
              job.linkStatus = v.linkStatus;
              job.linkCheckedAt = new Date().toISOString();
              linkStats.repaired++;
              addLog(`   ↻ Repaired link via AI: ${job.title.slice(0, 50)} → ${url.slice(0, 70)} [${v.linkStatus || 'ok'}]`, 'agent1');
            }
          }
        } catch { /* best-effort — leave it as a lead */ }
      }
      const saved = addJob(job);
      if (saved) {
        totalSaved++;
        perSource[perSourceKey] = (perSource[perSourceKey] || 0) + 1;
        const bucket = job.linkStatus === 'live' ? 'live' : job.linkStatus === 'unverified' ? 'unverified' : 'noLink';
        linkStats[bucket]++;
        const tag = job.linkStatus && job.linkStatus !== 'live' ? ` [${job.linkStatus}]` : '';
        addLog(`✅ [${job.matchScore}] ${job.title} at ${job.company} — ${job.location} (${job.source || perSourceKey})${tag}`, 'agent1');
      }
    }
  }

  // ── Phase 0: AI web-search engine (primary) ────────────────────────────────
  // Uses Claude's grounded web_search. This is the reliable engine — the
  // registry scrapers below are a best-effort fallback that bot-walls break.
  if (profile.useAiSearch !== false) {
    const aiKeywords = keywords.slice(0, maxKw);
    const aiLocations = locations.slice(0, maxLoc);
    addLog('--- AI Search (Claude grounded web search) ---', 'agent1');
    perSource['AI Search'] = 0;
    for (const keyword of aiKeywords) {
      if (getHunterState().stopRequested) { addLog('🛑 Stop requested — halting AI search.', 'agent1'); break; }
      try {
        const aiJobs = await huntViaClaudeSearch(profile, keyword, aiLocations);
        totalFound += aiJobs.length;

        // The prompt asks for South Africa; this gate is the guarantee.
        const { kept: aiKept, rejected: aiRejected } = gateJobsByLocation(aiJobs, 'soft');
        if (aiRejected.length > 0) {
          const sample = aiRejected.slice(0, 2).map((job) => `"${job.title}" (${job.location})`).join(', ');
          addLog(`[AI Search] Rejected ${describeRejected(aiRejected)}. Samples: ${sample}`, 'agent1');
        }

        // Build scored candidates first, then validate their links as a batch.
        const candidates = [];
        for (const job of aiKept) {
          if (!job.title || job.title.length < 4) continue;
          const matchScore = calculateMatchScore(job.title, job.description, profile.keywords);
          if (matchScore < SCORE_THRESHOLD) continue;
          candidates.push({
            id: uuidv4(),
            title: job.title,
            company: job.company,
            location: job.location,
            description: job.description || `${job.title} at ${job.company} — ${job.location}`,
            applyUrl: job.applyUrl,
            datePosted: parseDate(job.datePosted),
            matchScore,
            status: 'found',
            source: job.source,
            locationVerdict: job.locationVerdict,
            province: job.province,
            tailoredCvText: '',
            tailoredCoverLetterText: '',
            dateAdded: new Date().toISOString().split('T')[0]
          });
        }

        const { kept, dropped } = await validateJobs(candidates, { checkLiveness: linkCheck, requestContext: probeRequest, label: `AI Search · "${keyword}"` });
        await finalizeAndSave(kept, dropped.length, 'AI Search');
      } catch (err) {
        addLog(`[AI Search] Error for "${keyword}": ${err.message}`, 'error');
      }
    }
  } else {
    addLog('AI Search is disabled in Settings — using scrapers only.', 'agent1');
  }

  try {
    if (context) {
      addLog('Using the injected browser context (test run).', 'agent1');
    } else {
      addLog('Launching browser context...', 'agent1');
      context = await openProfileContext();
      addLog('Using the persistent browser profile.', 'agent1');
      ownsContext = true;
    }

    // Limit the keyword × location matrix to avoid excessive requests. These
    // caps are user-configurable from Profile & Settings (maxKeywords /
    // maxLocations); they fall back to sensible defaults when unset.
    const searchKeywords = keywords.slice(0, maxKw);
    const searchLocations = locations.slice(0, maxLoc);
    addLog(`Run matrix: ${searchKeywords.length} keyword(s) × ${searchLocations.length} location(s) per per-location source.`, 'agent1');

    const sources = testSources || SOURCES;
    addLog(`Sources: ${sources.map(s => s.name).join(', ')}`, 'agent1');

    const maxPages = pageCapForDepth(profile.searchDepth);
    let extractLeft = EXTRACT_CAP;
    const extractorReady = profile.useAiExtractFallback !== false && hasAnthropicKey(profile);
    const pacer = createPacer();

    for (const source of sources) {
      if (getHunterState().stopRequested) { addLog('🛑 Stop requested — halting before next source.', 'agent1'); break; }

      let healthEntry;
      try {
        healthEntry = getHealthEntry(source.id);
      } catch (err) {
        // Health I/O must never abort the scrape phase.
        addLog(`[${source.name}] Health read failed: ${err.message}`, 'system');
        healthEntry = {};
      }
      const skip = shouldSkip(healthEntry);
      if (skip.skip) {
        addLog(`⏭ ${source.name} skipped: ${skip.reason}`, 'agent1');
        perSourceStats[source.name] = {
          pages: 0,
          raw: 0,
          saved: 0,
          stopReason: 'skipped',
          via: 'none',
          status: computeStatus(healthEntry).status,
          skipped: skip.reason
        };
        continue;
      }

      addLog(`--- Scanning ${source.name} ---`, 'agent1');
      perSource[source.name] = perSource[source.name] || 0;

      const startedAt = Date.now();
      const queries = queriesFor(source, searchKeywords, searchLocations);
      const baseline = baselineRaw(healthEntry.runs);
      const statusBefore = computeStatus(healthEntry).status;
      // Tier-3 extractor: only when the AI path is ready and this source either
      // used to return cards or already looks broken/degraded.
      const allowExtract = extractorReady
        && (baseline.median >= 3 || statusBefore === 'broken' || statusBefore === 'degraded');

      let pagesTotal = 0;
      let blocked = false;
      let blockKind = null;
      let lastHttpStatus = null;
      let lastError = null;
      let threw = null;
      const stopReasons = [];
      const healthItems = [];
      const healthSeen = new Set();
      const strategiesSeen = new Set();
      const rejectReasonLists = [];
      let rejectedTotal = 0;
      let duplicateValid = 0;

      let page = null;
      try {
        page = await context.newPage();
        let queryIndex = 0;

        for (const query of queries) {
          if (getHunterState().stopRequested) break;
          const extractOnFirstPage = queryIndex === 0;

          const crawl = await crawlPages({
            fetchPage: async (pageNo) => {
              const allowAiHere = extractOnFirstPage && pageNo === 1 && allowExtract && extractLeft > 0;
              const aiExtract = allowAiHere
                ? async () => {
                  extractLeft -= 1;
                  const extracted = await extractJobsFromPage(profile, page, source, query);
                  if (extracted.items.length) {
                    addLog(`[${source.name}] AI extractor recovered ${extracted.items.length} card(s)`, 'agent1');
                  }
                  return extracted.items;
                }
                : null;
              const { items, meta } = await fetchSourcePage(page, source, query, pageNo, {
                pacer,
                aiExtract,
                maxCards: MAX_CARDS_PER_PAGE
              });
              if (meta.strategy && meta.strategy !== 'none') strategiesSeen.add(meta.strategy);
              if (meta.rejected > 0) {
                rejectedTotal += meta.rejected;
                rejectReasonLists.push(meta.rejectReasons);
                addLog(`[${source.name}] ${meta.rejected} card(s) rejected before saving${meta.rejectReasons[0] ? `: ${meta.rejectReasons[0]}` : ''}`, 'agent1');
              }
              return { items, meta };
            },
            maxPages,
            shouldStop: () => Boolean(getHunterState().stopRequested),
            delayMs: delays.betweenQueriesMs
          });
          queryIndex += 1;

          pagesTotal += crawl.pages.length;
          stopReasons.push(crawl.stopReason);
          for (const pageEntry of crawl.pages) {
            const meta = pageEntry.meta;
            if (!meta) continue;
            if (meta.httpStatus != null) lastHttpStatus = meta.httpStatus;
            if (meta.blocked) {
              blocked = true;
              blockKind = meta.blockKind || blockKind;
            }
            if (meta.error) lastError = meta.error;
          }

          // Raw cards for the health record: post-validation, de-duplicated
          // across pages (crawlPages) and across this source's queries.
          for (const item of crawl.items) {
            const key = defaultKeyOf(item);
            if (healthSeen.has(key)) { duplicateValid += 1; continue; }
            healthSeen.add(key);
            healthItems.push(item);
          }
          totalFound += crawl.items.length;

          let belowThreshold = 0;
          const belowSamples = [];
          const candidates = [];
          const { kept: located, rejected: notSA } = gateJobsByLocation(crawl.items, source.saCheck || 'soft');
          for (const job of located) {
            if (!job.title || job.title.length < 4) continue;

            const matchScore = calculateMatchScore(job.title, job.description, profile.keywords);
            if (matchScore < SCORE_THRESHOLD) {
              belowThreshold++;
              if (belowSamples.length < 3) belowSamples.push(`"${job.title}" (${matchScore})`);
              continue;
            }

            candidates.push({
              id: uuidv4(),
              title: job.title,
              company: job.company,
              location: job.location,
              description: job.description || `${job.title} at ${job.company} - ${job.location}`,
              applyUrl: job.applyUrl || '',
              datePosted: parseDate(job.datePosted),
              matchScore,
              status: 'found',
              source: job.source,
              locationVerdict: job.locationVerdict,
              province: job.province,
              tailoredCvText: '',
              tailoredCoverLetterText: '',
              dateAdded: new Date().toISOString().split('T')[0]
            });
          }

          // Validate this source's candidate links before saving (drops only
          // confirmed-dead links; search/category links kept as linkless leads).
          const { kept, dropped } = await validateJobs(candidates, { checkLiveness: linkCheck, requestContext: probeRequest, label: source.name });
          await finalizeAndSave(kept, dropped.length, source.name);
          if (notSA.length > 0) {
            const sample = notSA.slice(0, 2).map((job) => `"${job.title}" (${job.location})`).join(', ');
            addLog(`[${source.name}] Rejected ${describeRejected(notSA)}. Samples: ${sample}`, 'agent1');
          }
          if (belowThreshold > 0) {
            addLog(`[${source.name}] ${belowThreshold} card(s) below score ${SCORE_THRESHOLD}. Samples: ${belowSamples.join(', ')}`, 'agent1');
          }

          await sleep(delays.betweenQueriesMs);
        }
      } catch (err) {
        threw = err;
        addLog(`[${source.name}] Error: ${err.message}`, 'error');
      } finally {
        if (page) { try { await page.close(); } catch {} }
      }

      // One health record per source per run, aggregated over its queries.
      let stopReason;
      if (threw) stopReason = 'error';
      else if (stopReasons.length) {
        const unique = [...new Set(stopReasons)];
        stopReason = unique.length === 1 ? unique[0] : 'mixed';
      } else {
        stopReason = getHunterState().stopRequested ? 'stopped' : 'exhausted';
      }

      // Stop pressed before the first page: the source was never tested, so
      // record no run (three such stops must not open the circuit) and skip
      // the between-sources sleep and the health write.
      if (!threw && pagesTotal === 0 && stopReason === 'stopped') {
        perSourceStats[source.name] = {
          pages: 0,
          raw: 0,
          saved: perSource[source.name] || 0,
          stopReason: 'stopped',
          via: 'none',
          status: statusBefore
        };
        continue;
      }

      const strategies = [...strategiesSeen].filter((name) => name && name !== 'none');
      const via = strategies.length === 0 ? 'none' : strategies.length === 1 ? strategies[0] : 'mixed';
      const runError = threw
        ? (threw.message || String(threw))
        : (stopReason === 'error' ? lastError : null);
      const rejectReasons = mergeRejectReasons(rejectReasonLists);
      const run = summariseRun({
        kind: 'hunt',
        items: healthItems,
        pages: pagesTotal,
        httpStatus: lastHttpStatus,
        blocked,
        blockKind,
        error: runError,
        ms: Date.now() - startedAt,
        via,
        strategy: strategies.length === 1 ? strategies[0] : (strategies.length ? 'mixed' : 'none'),
        valid: healthItems.length + duplicateValid,
        rejected: rejectedTotal,
        rejectReasons,
        stopReason,
        expectsUrl: !source.linkless
      });
      let updated;
      try {
        updated = recordRun(source.id, run);
      } catch (err) {
        // A failed health write must not abort the remaining sources.
        addLog(`[${source.name}] Health write failed: ${err.message}`, 'system');
        updated = healthEntry;
      }
      perSourceStats[source.name] = {
        pages: pagesTotal,
        raw: healthItems.length,
        saved: perSource[source.name] || 0,
        stopReason,
        via,
        status: computeStatus(updated).status
      };

      await sleep(delays.betweenSourcesMs);
    }

    const breakdown = Object.entries(perSource)
      .filter(([, n]) => n > 0)
      .map(([name, n]) => `${name}: ${n}`)
      .join(', ') || 'none';
    addLog(`Saved-by-source → ${breakdown}`, 'agent1');
    const stopped = getHunterState().stopRequested;
    addLog(`=== Agent 1 ${stopped ? 'Stopped' : 'Complete'}! Scraped ${totalFound} raw listings, saved ${totalSaved} new matches ===`, 'agent1');
    if (linkCheck && totalSaved > 0) {
      addLog(`Link health → ${linkStats.live} verified live, ${linkStats.unverified} unverified, ${linkStats.noLink} lead(s) without a link${linkStats.repaired ? `, ${linkStats.repaired} AI-repaired` : ''}; ${linkStats.dead} confirmed-dead dropped.`, 'agent1');
    }

  } catch (error) {
    addLog(`Fatal error in Agent 1: ${error.message}`, 'error');
    console.error(error);
  } finally {
    if (probeRequest) { try { await probeRequest.dispose(); } catch {} }
    if (context && ownsContext) {
      try { await context.close(); } catch {}
      addLog('Browser context closed.', 'agent1');
    }
  }

  return {
    totalFound,
    totalSaved,
    perSource,
    linkStats,
    perSourceStats,
    stopped: Boolean(getHunterState().stopRequested)
  };
}

/**
 * Launches a visible browser with the persistent profile so the user can sign
 * in to LinkedIn, Indeed, and other sites once. Sessions are saved and reused
 * by all future headless scraping runs.
 */
export async function setupBrowserSession() {
  addLog('Opening browser for manual login setup. Sign in to all SA job sites, then close the window.', 'system');
  addLog('Sites opening: LinkedIn, Indeed SA, PNet, CareerJunction, Gumtree SA', 'system');

  let context;
  try {
    context = await openProfileContext({ headless: false, viewport: null });

    // Open a tab for every site that benefits from a logged-in session.
    // Government/public sites (NationalGovernment, Adzuna, Google) don't need login.
    const loginSites = [
      { name: 'LinkedIn',        url: 'https://www.linkedin.com/login' },
      { name: 'Indeed SA',       url: 'https://za.indeed.com/account/login' },
      { name: 'PNet',            url: 'https://www.pnet.co.za' },
      { name: 'CareerJunction',  url: 'https://www.careerjunction.co.za' },
      { name: 'Gumtree SA',      url: 'https://www.gumtree.co.za/t-login-register.html' },
    ];

    for (const site of loginSites) {
      try {
        const tab = await context.newPage();
        await tab.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        addLog(`Opened ${site.name} login tab.`, 'system');
      } catch (err) {
        addLog(`Could not open ${site.name}: ${err.message}`, 'error');
      }
    }

    // Wait until the user closes the browser window
    await new Promise(resolve => {
      context.once('close', resolve);
      setTimeout(resolve, 30 * 60 * 1000); // 30-min safety timeout
    });

    addLog('Browser setup complete. Sessions saved — all future scraping runs will reuse these logins.', 'system');
  } catch (err) {
    addLog(`Browser setup error: ${err.message}`, 'error');
  } finally {
    if (context) { try { await context.close(); } catch {} }
  }
}

// Sites and their login-detection strategy used by checkLoginStatuses()
const LOGIN_CHECK_SITES = [
  {
    key: 'linkedin',
    name: 'LinkedIn',
    url: 'https://www.linkedin.com/feed/',
    isLoggedIn: (page) => {
      const u = page.url();
      return !u.includes('/login') && !u.includes('/authwall') && !u.includes('/uas/');
    },
  },
  {
    key: 'indeedSa',
    name: 'Indeed SA',
    url: 'https://za.indeed.com/account/view?hl=en',
    isLoggedIn: (page) => {
      const u = page.url();
      return !u.includes('/account/login') && !u.includes('/account/register');
    },
  },
  {
    key: 'pnet',
    name: 'PNet',
    url: 'https://www.pnet.co.za',
    isLoggedIn: (page) => page.evaluate(() => {
      const header = document.querySelector('nav, header');
      if (!header) return true;
      return !Array.from(header.querySelectorAll('a, button'))
        .some(el => /^(sign\s?in|log\s?in)$/i.test(el.textContent.trim()));
    }),
  },
  {
    key: 'careerJunction',
    name: 'CareerJunction',
    url: 'https://www.careerjunction.co.za',
    isLoggedIn: (page) => page.evaluate(() =>
      !Array.from(document.querySelectorAll('a, button'))
        .some(el => /^(sign\s?in|log\s?in)$/i.test(el.textContent.trim()))
    ),
  },
  {
    key: 'gumtreeSa',
    name: 'Gumtree SA',
    url: 'https://www.gumtree.co.za/t-account.html',
    isLoggedIn: (page) => {
      const u = page.url();
      return !u.includes('login') && !u.includes('register');
    },
  },
];

/**
 * Checks login status for the SA job sites that benefit from a session, by
 * launching a headless browser with the persistent profile and navigating to
 * auth-gated URLs. Returns { linkedin, indeedSa, pnet, careerJunction,
 * gumtreeSa } where true = logged in.
 */
export async function checkLoginStatuses() {
  const statuses = {};
  let context;
  try {
    context = await openProfileContext({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });

    await Promise.all(LOGIN_CHECK_SITES.map(async (site) => {
      const page = await context.newPage();
      try {
        await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 12000 });
        statuses[site.key] = Boolean(await site.isLoggedIn(page));
      } catch {
        statuses[site.key] = false;
      } finally {
        await page.close().catch(() => {});
      }
    }));
  } finally {
    if (context) { try { await context.close(); } catch {} }
  }
  return statuses;
}

// End of Agent 1 — Job Hunter.
