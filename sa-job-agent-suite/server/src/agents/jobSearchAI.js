import Anthropic from '@anthropic-ai/sdk';
import { addLog, addUsage, budgetStatus, budgetMessage, SEARCH_DEPTHS } from '../db/helper.js';
import { fromAnthropicUsage } from '../db/costs.js';
import { extractJson } from './llm.js';
// Junk repost-aggregator list — owned by the link validator (single link-policy
// owner); used here so the prompt tells Claude to avoid those hosts at source.
import { JUNK_AGGREGATOR_HOSTS as JUNK_AGGREGATORS } from './linkValidator.js';

/**
 * AI-powered job search for Agent 1 using Anthropic's server-side `web_search`
 * tool. This is GROUNDED search — Claude queries the live web and returns the
 * real source URLs it found, with citations — so (unlike asking a plain LLM for
 * jobs) it does not invent listings. We still instruct it explicitly never to
 * fabricate a job or URL, and we drop any result without a real http(s) link.
 *
 * Requires an Anthropic API key (independent of the tailoring provider).
 * Web search is billed at ~$10 / 1,000 searches plus tokens, so every search is
 * bounded by `max_uses` and metered into the AI usage ledger.
 *
 * Search depth (profile.searchDepth — the "thoroughness" dial, also set by the
 * performance presets):
 *   light    → 2 searches/keyword, up to 10 results        (Token Saver)
 *   standard → 5 searches/keyword, up to 20 results        (Balanced)
 *   deep     → 8 searches/keyword, up to 25 results, PLUS a second follow-up
 *              round per keyword that targets boards/ATS not yet covered
 *              (Maximum — the "look thoroughly" mode)
 */
const DEPTH_SETTINGS = {
  light:    { maxUses: 2, maxResults: 10, maxTokens: 3000, secondRound: false },
  standard: { maxUses: 5, maxResults: 20, maxTokens: 4096, secondRound: false },
  deep:     { maxUses: 8, maxResults: 25, maxTokens: 6000, secondRound: true }
};

export function resolveSearchDepth(profile = {}) {
  const d = String(profile.searchDepth || '').trim();
  return SEARCH_DEPTHS.includes(d) ? d : 'standard';
}


// Recognise the board/site a posting URL lives on, so every AI-search result
// carries real provenance (obscure aggregators become visible instead of all
// being labelled "AI Search") and major boards can be ranked first.
const BOARD_HOSTS = [
  [/(^|\.)linkedin\./i,         'LinkedIn'],
  [/(^|\.)indeed\./i,          'Indeed SA'],
  [/(^|\.)pnet\.co\.za/i,      'PNet'],
  [/(^|\.)careerjunction\.co\.za/i, 'CareerJunction'],
  [/(^|\.)careers24\.com/i,    'Careers24'],
  [/(^|\.)glassdoor\./i,       'Glassdoor'],
  [/(^|\.)simplyhired\./i,     'SimplyHired'],
  [/greenhouse\.io/i,          'Greenhouse'],
  [/lever\.co/i,               'Lever'],
  [/myworkdayjobs\.com/i,      'Workday'],
  [/workable\.com/i,           'Workable'],
  [/smartrecruiters\.com/i,    'SmartRecruiters'],
];

// Major, reputable boards/ATS we want to surface first.
const MAJOR_SOURCES = new Set([
  'LinkedIn', 'Indeed SA', 'PNet', 'CareerJunction',
  'Greenhouse', 'Lever', 'Workday', 'Workable', 'SmartRecruiters',
]);

export function sourceFromUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    for (const [re, name] of BOARD_HOSTS) if (re.test(host)) return name;
    return host; // employer's own careers/ATS domain, e.g. "careers.acme.co.za"
  } catch {
    return 'AI Search';
  }
}

// Sort key: 0 = major board (surface first so it wins de-duplication over
// obscure sites), 1 = everything else.
function boardRank(source) {
  return MAJOR_SOURCES.has(source) ? 0 : 1;
}

// NOTE: link quality is decided in ONE place — the hunter's link validator
// (`linkValidator.validateJobs`), which shape-checks, junk-host-strips and
// (when enabled) probes each link for liveness before the job is saved. We keep
// whatever http(s) URL Claude returns and let that single validation layer
// strip search/category/junk-aggregator links and drop only confirmed-dead
// ones. The prompt below still pushes Claude hard toward original-board links
// so junk rarely arrives in the first place.

function budgetBlocked(label) {
  const b = budgetStatus();
  if (!b.exceeded) return false;
  addLog(`[${label}] Skipped — ${budgetMessage(b)}`, 'error');
  return true;
}

function buildPrompt(keyword, locText, maxResults) {
  return `You are a South African job-search assistant with live web search. Find CURRENT, real job vacancies.

Search the web for "${keyword}" jobs located in or near: ${locText} (South Africa only).
Run MULTIPLE DIFFERENT search queries (vary the board, phrasing and location) to cover as much of the market as your search budget allows — do not stop after one query.

STRONGLY PREFER the major, reputable South African job boards and employer career pages:
LinkedIn, PNet, Indeed, CareerJunction, and the employer's own careers/ATS site
(Greenhouse, Lever, Workday, Workable, SmartRecruiters).

Then return ONLY a JSON array (no prose, no markdown) of up to ${maxResults} REAL vacancies you actually found, each shaped exactly:
{"title":"...","company":"...","location":"City, Province","applyUrl":"https://link-to-this-posting","source":"the board or site name, e.g. LinkedIn","description":"1-2 sentence summary","datePosted":"e.g. 2 days ago or 2026-06-01"}

Rules:
- Only include jobs you actually found via search. NEVER invent a job, company, or URL.
- "applyUrl" must be the vacancy's page on the ORIGINAL board or the employer's own ATS — ideally the exact posting (with its job/posting id) where the Apply button lives. The job's own page on a major board (LinkedIn/PNet/Indeed/CareerJunction) is perfectly acceptable.
- NEVER use links from low-quality scrape/repost aggregators (${JUNK_AGGREGATORS.slice(0, 8).join(', ')}, and similar). If a search result is on one of those, find the SAME job on the original board or employer site; if you can't, still include the job but set "applyUrl" to "".
- Do NOT return a generic search-results URL (e.g. /search, /jobs?q=, /browse, or a bare domain). If the ONLY link you have for a real job is a search page, still include the job but set "applyUrl" to "" — do NOT drop good vacancies just because the link isn't perfect.
- "source" is the human name of the site the link is on (e.g. "LinkedIn", "PNet", "Greenhouse"). Favour the major boards above.
- South African locations only. Exclude anything outside South Africa.
- If you found fewer than ${maxResults}, return fewer. If you found none, return [].
- Output the JSON array and nothing else.`;
}

// Runs one assistant turn to completion, continuing through 'pause_turn' stops
// (long server-side searches). Meters every response into the usage ledger.
async function runSearchTurns(anthropic, model, messages, tools, { maxTokens, bucket, maxTurns = 5 }) {
  let final = null;
  for (let turn = 0; turn < maxTurns; turn++) {
    const resp = await anthropic.messages.create({ model, max_tokens: maxTokens, messages, tools });
    addUsage({ ...fromAnthropicUsage(model, resp.usage || {}), bucket });
    if (resp.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: resp.content });
      continue;
    }
    final = resp;
    break;
  }
  return final;
}

function textOf(resp) {
  return ((resp && resp.content) || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

// Parses + normalises one round's JSON array into job objects.
function parseJobs(text, locText) {
  const arr = extractJson(text);
  if (!Array.isArray(arr)) return null;
  return arr
    .filter((j) => j && j.title && String(j.title).trim().length > 3)
    .map((j) => {
      const applyUrl = (j.applyUrl && /^https?:\/\//i.test(String(j.applyUrl))) ? String(j.applyUrl).trim() : '';
      // Trust the URL host for provenance; fall back to Claude's self-reported
      // source, then to a generic label for linkless leads.
      const source = applyUrl
        ? sourceFromUrl(applyUrl)
        : ((j.source && String(j.source).trim()) || 'AI Search');
      return {
        title:       String(j.title).trim(),
        company:     (j.company && String(j.company).trim()) || 'Confidential',
        location:    (j.location && String(j.location).trim()) || locText,
        description: (j.description && String(j.description).trim()) || '',
        applyUrl,
        datePosted:  j.datePosted || 'Recently',
        source
      };
    });
}

const dedupeKey = (j) => `${j.title.toLowerCase().trim()}::${j.company.toLowerCase().trim()}`;

export async function huntViaClaudeSearch(profile, keyword, locations, maxResultsOverride = 0) {
  const apiKey = profile.anthropicApiKey;
  if (!apiKey || apiKey.includes('your_')) {
    addLog('[AI Search] Skipped — add an Anthropic API key in Settings to enable Claude web-search job hunting.', 'agent1');
    return [];
  }
  if (budgetBlocked('AI Search')) return [];

  const depth = resolveSearchDepth(profile);
  const cfg = DEPTH_SETTINGS[depth];
  const maxResults = maxResultsOverride > 0 ? maxResultsOverride : cfg.maxResults;

  const model = (profile.aiSearchModel || '').trim() || 'claude-sonnet-4-6';
  const anthropic = new Anthropic({ apiKey });
  const locText = (locations && locations.length) ? locations.join(', ') : 'South Africa';

  const tools = [{
    type: 'web_search_20250305', name: 'web_search', max_uses: cfg.maxUses,
    user_location: { type: 'approximate', country: 'ZA', timezone: 'Africa/Johannesburg' }
  }];

  try {
    addLog(`[AI Search] Searching the web via Claude for "${keyword}" in ${locText}… (depth: ${depth})`, 'agent1');
    const messages = [{ role: 'user', content: buildPrompt(keyword, locText, maxResults) }];
    const final = await runSearchTurns(anthropic, model, messages, tools, { maxTokens: cfg.maxTokens, bucket: 'ai-search' });
    if (!final) {
      addLog('[AI Search] Search kept pausing without completing — skipping this keyword.', 'error');
      return [];
    }

    const jobs = parseJobs(textOf(final), locText);
    if (!jobs) {
      addLog('[AI Search] Claude returned no usable JSON array for this keyword.', 'error');
      return [];
    }

    // ── Deep mode: a second, differently-targeted round per keyword ──────────
    // Continues the same conversation so Claude knows what it already returned,
    // with a fresh search budget aimed at boards/employers not yet covered.
    // This is the "look thoroughly" half of the Hunter fix.
    if (cfg.secondRound && !budgetBlocked('AI Search · deep round')) {
      try {
        messages.push({ role: 'assistant', content: final.content });
        messages.push({
          role: 'user',
          content: `Good. Now search AGAIN with DIFFERENT queries for the same goal ("${keyword}" in ${locText}): target boards and employer ATS pages your previous searches did NOT cover (e.g. PNet, CareerJunction, Indeed, employer Greenhouse/Lever/Workday/Workable careers pages, university/bank/telecoms career portals). Return ONLY a JSON array (same exact shape and rules as before) of up to ${maxResults} ADDITIONAL real vacancies that were NOT in your previous answer. If you find none, return [].`
        });
        const tools2 = [{ ...tools[0], max_uses: Math.max(3, Math.floor(cfg.maxUses / 2)) }];
        const final2 = await runSearchTurns(anthropic, model, messages, tools2, { maxTokens: cfg.maxTokens, bucket: 'ai-search' });
        const extra = final2 ? parseJobs(textOf(final2), locText) : null;
        if (extra && extra.length) {
          const seen = new Set(jobs.map(dedupeKey));
          const fresh = extra.filter((j) => !seen.has(dedupeKey(j)));
          if (fresh.length) {
            addLog(`[AI Search] Deep round added ${fresh.length} more vacancy(ies) for "${keyword}".`, 'agent1');
            jobs.push(...fresh);
          }
        }
      } catch (err) {
        addLog(`[AI Search] Deep round skipped (${err.message}).`, 'system');
      }
    }

    // Major boards first → they win de-duplication over obscure aggregators.
    jobs.sort((a, b) => boardRank(a.source) - boardRank(b.source));

    addLog(`[AI Search] Claude returned ${jobs.length} real vacancy(ies) for "${keyword}".`, 'agent1');
    return jobs;
  } catch (err) {
    // Common causes: web search not enabled for the org in the Console, model
    // without web-search support, or an invalid key. Surface a clear hint.
    addLog(`[AI Search] Error: ${err.message}. (Ensure web search is enabled in your Anthropic Console and the key is valid.)`, 'error');
    return [];
  }
}

/**
 * Link repair: for a job we kept WITHOUT a usable direct link (the hunter saved
 * it as a lead), ask Claude — with live web search — to find the single direct
 * posting URL for THIS exact vacancy. Grounded so it can't fabricate; returns
 * '' when no real posting URL is found. Anthropic-only (needs the web_search
 * tool); the hunter gates this behind `profile.useLinkRepair` and a per-run cap
 * because each call is a billed search. The hunter then re-validates whatever
 * URL comes back, so a hallucinated/dead link can never slip through.
 *
 * @returns {Promise<string>} a verified-shape http(s) URL, or '' if none found.
 */
export async function findDirectPostingUrl(profile, job) {
  const apiKey = profile.anthropicApiKey;
  if (!apiKey || apiKey.includes('your_')) return '';
  if (!job || !job.title) return '';
  if (budgetBlocked('Link repair')) return '';

  const model = (profile.aiSearchModel || '').trim() || 'claude-sonnet-4-6';
  const anthropic = new Anthropic({ apiKey });
  const prompt = `Find the SINGLE direct application/posting URL for this EXACT South African job vacancy and return ONLY that URL.

Title: ${job.title}
Company: ${job.company || ''}
Location: ${job.location || 'South Africa'}

Rules:
- Search the web and return the EXACT direct link to THIS specific vacancy — the page showing this one job with its Apply button (the URL must contain a unique job/posting id).
- Prefer the ORIGINAL board or the employer's own ATS. NEVER return a link on a scrape/repost aggregator (${JUNK_AGGREGATORS.slice(0, 6).join(', ')}, etc.).
- NEVER invent or guess a URL. If you cannot find the direct posting for THIS exact job, reply with the single word: NONE
- Do NOT return a homepage, careers landing page, category page, or search-results URL.
- Output only the URL (or NONE). No prose, no markdown.`;

  const messages = [{ role: 'user', content: prompt }];
  const tools = [{
    type: 'web_search_20250305', name: 'web_search', max_uses: 3,
    user_location: { type: 'approximate', country: 'ZA', timezone: 'Africa/Johannesburg' }
  }];

  try {
    const final = await runSearchTurns(anthropic, model, messages, tools, { maxTokens: 1024, bucket: 'link-repair', maxTurns: 4 });
    if (!final) return '';

    const text = ((final.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join(' '));

    const m = text.match(/https?:\/\/[^\s"'<>)\]]+/i);
    const url = m ? m[0].replace(/[.,;]+$/, '') : '';
    return /^https?:\/\//i.test(url) ? url : '';
  } catch {
    return '';
  }
}
