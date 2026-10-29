import { IS_WEB } from './env.js';
import { createIdbAdapter } from './idbAdapter.js';
import { createVault } from './vault.js';
import { createKeyStore } from './keyStore.js';
import { createActivity } from './activity.js';
import { createWebApi } from './api.js';
import { DEMO, REAL, getMode, setMode, subscribeMode, isDemoMode } from './demo/mode.js';

export const WEB_API_BASE = import.meta.env.VITE_SAJAS_API_BASE || 'http://localhost:5000/api';

function build() {
  const vault = createVault(createIdbAdapter());
  const keyStore = createKeyStore({ vault });
  const activity = createActivity();
  const api = createWebApi({ apiBase: WEB_API_BASE, vault, keyStore, activity });
  return { vault, keyStore, activity, api };
}

export const webRuntime = IS_WEB ? build() : null;

let demoPromise = null;

function loadDemo() {
  if (!demoPromise) {
    demoPromise = import('./demo/runtime.js').then(({ getDemoRuntime }) => getDemoRuntime({ apiBase: WEB_API_BASE }));
  }
  return demoPromise;
}

// One stable fetch handler. It reads the mode on every call, so the installed
// dispatcher never has to be replaced and a refresh restores the demo.
export function handleApi(input, init) {
  if (getMode() === DEMO) return loadDemo().then((runtime) => runtime.api.handle(input, init));
  return webRuntime.api.handle(input, init);
}

export async function enterDemo() {
  const runtime = await loadDemo();
  setMode(DEMO);
  return { persistent: runtime.persistent };
}

export async function exitDemo() {
  const { resetDemoRuntime } = await import('./demo/runtime.js');
  await resetDemoRuntime();
  demoPromise = null;
  setMode(REAL);
}

export { subscribeMode, isDemoMode };
