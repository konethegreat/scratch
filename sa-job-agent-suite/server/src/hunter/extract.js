// Runs every free extraction strategy on one loaded page, validates the rows
// through one schema gate and returns the strategy with the most valid rows.
import { validateJobCards } from '@sajas/core/scrape';
import { mapStructured } from './structured.js';
import { extractSemanticCards, snapshotCandidatesInPage } from './semanticDom.js';

export const STRATEGY_ORDER = Object.freeze(['structured', 'dom', 'semantic']);

const errorText = (err) => err?.message || String(err) || 'strategy failed';
const empty = (error) => ({ raw: 0, valid: [], rejected: [], rejectReasons: [], error });

export function chooseStrategy(strategies = {}) {
  let winner = null;
  for (const name of STRATEGY_ORDER) {
    const entry = strategies[name];
    if (!entry || !Array.isArray(entry.valid) || entry.valid.length === 0) continue;
    if (!winner || entry.valid.length > winner.valid.length) winner = { name, ...entry };
  }
  return winner;
}

export function mergeRejectReasons(lists = []) {
  const counts = new Map();
  for (const list of lists) {
    for (const reason of Array.isArray(list) ? list : []) {
      counts.set(reason, (counts.get(reason) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([reason]) => reason);
}

export function strategySummary(strategies = {}) {
  const out = {};
  for (const [name, entry] of Object.entries(strategies)) {
    out[name] = {
      raw: entry?.raw || 0,
      valid: Array.isArray(entry?.valid) ? entry.valid.length : 0,
      rejected: Array.isArray(entry?.rejected) ? entry.rejected.length : 0,
      error: entry?.error || null
    };
  }
  return out;
}

function record(name, produce, strategies, options) {
  try {
    const raw = produce();
    const list = Array.isArray(raw) ? raw : [];
    const { valid, rejected, rejectReasons } = validateJobCards(
      list.slice(0, options.maxCards),
      { linkless: options.linkless }
    );
    strategies[name] = { raw: list.length, valid, rejected, rejectReasons, error: null };
  } catch (err) {
    strategies[name] = empty(errorText(err));
  }
}

export async function extractPage({ page, source, query = {}, captured = null, aiExtract = null, maxCards = 80 } = {}) {
  const options = { maxCards, linkless: !!source?.linkless };
  const origin = source?.origin || captured?.origin || '';
  const strategies = {};

  record('structured', () => mapStructured(captured?.payloads || [], { source, origin }), strategies, options);

  try {
    const raw = await page.evaluate(source.extractInPage, {
      keyword: query?.keyword,
      location: query?.location ?? null,
      origin
    });
    record('dom', () => raw, strategies, options);
  } catch (err) {
    strategies.dom = empty(errorText(err));
  }

  try {
    const snapshot = await page.evaluate(snapshotCandidatesInPage, { maxCards });
    record('semantic', () => extractSemanticCards(snapshot, {
      origin,
      linkless: options.linkless,
      maxCards
    }), strategies, options);
  } catch (err) {
    strategies.semantic = empty(errorText(err));
  }

  let winner = chooseStrategy(strategies);
  if (!winner && typeof aiExtract === 'function') {
    try {
      const raw = await aiExtract({ page, source, query });
      record('ai', () => raw, strategies, options);
      if (strategies.ai.valid.length) winner = { name: 'ai', ...strategies.ai };
    } catch (err) {
      strategies.ai = empty(errorText(err));
    }
  }

  const rejectReasons = mergeRejectReasons(Object.values(strategies).map((entry) => entry.rejectReasons));
  if (winner) {
    return {
      items: winner.valid.slice(0, maxCards),
      strategy: winner.name,
      valid: winner.valid.length,
      rejected: winner.rejected.length,
      rejectReasons: winner.rejectReasons.length ? winner.rejectReasons : rejectReasons,
      strategies: strategySummary(strategies)
    };
  }
  return {
    items: [],
    strategy: 'none',
    valid: 0,
    rejected: Object.values(strategies).reduce((total, entry) => total + (entry.rejected?.length || 0), 0),
    rejectReasons,
    strategies: strategySummary(strategies)
  };
}
