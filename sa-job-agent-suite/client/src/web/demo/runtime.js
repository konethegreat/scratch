// The demo runtime. It is built lazily on first entry, seeded from fixtures and
// cached for the tab. Nothing in this file reads the real vault or a key.
import { AppError, ERROR_CODES } from '@sajas/core/errors';
import { createVault } from '../vault.js';
import { createActivity } from '../activity.js';
import { createWebApi } from '../api.js';
import { createSessionAdapter, wipeDemoNamespace } from './sessionAdapter.js';
import { createSimulationRouter } from './simulationApi.js';
import { buildDemoSeed, seedDemoVault } from './fixtures.js';

let runtime = null;

function demoKeyStore() {
  return {
    hasKey: () => true,
    getKey: () => null,
    setKey() {
      throw new AppError(ERROR_CODES.KEY_INVALID, 'No key is used in demo mode. Add your key after you exit.');
    },
    clearMemory() {},
    touch() {},
    setIdleMinutes() {},
    getIdleMinutes: () => 0,
    async saveIdleMinutes() {},
    async loadIdleMinutes() { return 0; },
    isIdleExpired() { return false; },
    maybeForgetIdle() { return false; },
    async hasSavedKey() { return false; },
    async remember() {},
    async unlock() {},
    async forget() {},
    async panicWipe() {}
  };
}

export async function getDemoRuntime({ apiBase, now = () => new Date() } = {}) {
  if (runtime) return runtime;
  const adapter = createSessionAdapter();
  const vault = createVault(adapter);
  await seedDemoVault(vault, now());
  const keyStore = demoKeyStore();
  const activity = createActivity();
  for (const entry of buildDemoSeed(now()).activity) activity.add(entry.message, entry.type);
  const api = createWebApi({ apiBase, vault, keyStore, activity, now });
  const simulated = createSimulationRouter({ base: api, apiBase, vault, keyStore, activity, now });
  runtime = { vault, keyStore, activity, api: simulated, persistent: adapter.persistent };
  return runtime;
}

export async function resetDemoRuntime() {
  runtime = null;
  wipeDemoNamespace();
}
