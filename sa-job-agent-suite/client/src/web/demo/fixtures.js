// Seed assembly for the demo. Version 3 adds the richer persona, 20 employers
// and four sample documents, and it is seeded only into the demo's own vault.
import { STORES } from '../vault.js';
import * as persona from './persona.js';
import * as jobs from './jobs.js';

export const DEMO_SEED_VERSION = 3;

function clone(value) {
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

export function buildDemoSeed(now = new Date()) {
  const today = (now instanceof Date ? now : new Date(now)).toISOString().slice(0, 10);
  return {
    profile: { current: clone(persona.DEMO_PROFILE) },
    jobs: Object.fromEntries(jobs.DEMO_JOBS.map((job) => [job.id, clone(job)])),
    answers: Object.fromEntries(persona.DEMO_ANSWERS.map((answer) => [answer.id, clone(answer)])),
    documents: Object.fromEntries(persona.DEMO_DOCUMENTS.map((document) => [document.id, clone(document)])),
    memory: { dossier: clone(persona.DEMO_MEMORY) },
    usage: {
      days: {
        days: {
          [today]: {
            calls: 10, inputTokens: 26800, outputTokens: 6400,
            cacheReadTokens: 1400, cacheWriteTokens: 900, webSearches: 0, estCostUSD: 0.29,
            byBucket: {
              tailor: { calls: 4, inputTokens: 12400, outputTokens: 3200, cacheReadTokens: 0, cacheWriteTokens: 900, webSearches: 0, estCostUSD: 0.15 },
              rag: { calls: 4, inputTokens: 9600, outputTokens: 2400, cacheReadTokens: 1400, cacheWriteTokens: 0, webSearches: 0, estCostUSD: 0.1 },
              ground: { calls: 2, inputTokens: 4800, outputTokens: 800, cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 0, estCostUSD: 0.04 }
            },
            byTask: {}
          }
        }
      }
    },
    meta: { app: { onboarded: true, demoSeed: DEMO_SEED_VERSION } },
    activity: persona.DEMO_ACTIVITY.map((entry) => ({ ...entry }))
  };
}

export async function seedDemoVault(vault, now = new Date()) {
  if (!vault) throw new Error('A vault is required to seed the demo.');
  const meta = (await vault.get(STORES.meta, 'app', {})) || {};
  if (meta.demoSeed === DEMO_SEED_VERSION) return false;
  const seed = buildDemoSeed(now);
  const stores = [
    STORES.profile, STORES.jobs, STORES.answers, STORES.documents,
    STORES.memory, STORES.usage, STORES.meta
  ];
  for (const store of stores) await vault.clear(store);
  for (const store of [STORES.profile, STORES.jobs, STORES.answers, STORES.documents, STORES.memory, STORES.usage]) {
    for (const [key, value] of Object.entries(seed[store])) await vault.put(store, key, value);
  }
  await vault.put(STORES.meta, 'app', seed.meta.app);
  return true;
}
