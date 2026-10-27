// Browser usage ledger. Mirrors the desktop server's /usage summary shape so the
// existing Usage panel needs no second format.
import { estimateCostUSD } from '@sajas/core/costs';
import { STORES } from './vault.js';

const KEEP_DAYS = 14;
const ZERO = {
  calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
  cacheWriteTokens: 0, webSearches: 0, estCostUSD: 0
};

function emptyDay() {
  return { ...ZERO, byBucket: {}, byTask: {} };
}

function add(target, usage, cost) {
  target.calls += 1;
  target.inputTokens += usage.inputTokens || 0;
  target.outputTokens += usage.outputTokens || 0;
  target.cacheReadTokens += usage.cacheReadTokens || 0;
  target.cacheWriteTokens += usage.cacheWriteTokens || 0;
  target.webSearches += usage.webSearches || 0;
  target.estCostUSD += cost;
}

export function createUsageLedger({ vault, now = () => new Date() }) {
  const todayKey = () => now().toISOString().slice(0, 10);

  async function days() {
    const stored = await vault.get(STORES.usage, 'days', { days: {} });
    const source = stored && typeof stored === 'object' && stored.days && typeof stored.days === 'object'
      ? stored.days
      : {};
    return { ...source };
  }

  async function save(map) {
    const keys = Object.keys(map).sort();
    while (keys.length > KEEP_DAYS) delete map[keys.shift()];
    await vault.put(STORES.usage, 'days', { days: map });
  }

  async function record({ model = '', bucket = 'core', ...tokens } = {}) {
    try {
      const cost = estimateCostUSD({ model, ...tokens });
      const map = await days();
      const key = todayKey();
      const day = map[key] || emptyDay();
      add(day, tokens, cost);
      day.byBucket[bucket] = day.byBucket[bucket] || { ...ZERO };
      add(day.byBucket[bucket], tokens, cost);
      map[key] = day;
      await save(map);
      return cost;
    } catch {
      return 0;
    }
  }

  async function summary(profile = {}) {
    const map = await days();
    const today = map[todayKey()] || emptyDay();
    const history = Object.keys(map).sort().slice(-14).map((date) => ({
      date,
      estCostUSD: map[date].estCostUSD || 0,
      calls: map[date].calls || 0
    }));
    const last7CostUSD = history.slice(-7).reduce((sum, day) => sum + day.estCostUSD, 0);
    const capUSD = Number(profile.dailyBudgetUSD) || 0;
    const spentUSD = today.estCostUSD || 0;
    return {
      today: { ...emptyDay(), ...today, date: todayKey(), byBucket: { ...(today.byBucket || {}) } },
      history,
      last7CostUSD,
      budget: { capUSD, spentUSD, exceeded: capUSD > 0 && spentUSD >= capUSD }
    };
  }

  async function budget(profile = {}) {
    return (await summary(profile)).budget;
  }

  async function clear() {
    await vault.put(STORES.usage, 'days', { days: {} });
  }

  return { record, summary, budget, clear };
}
