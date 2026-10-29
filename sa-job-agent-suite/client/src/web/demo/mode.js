// Per-tab demo flag. Pure: no React and no runtime imports, so both the entry
// bundle and the demo bundle can read the same answer.
export const MODE_STORAGE_KEY = 'sajas:mode';
export const REAL = 'real';
export const DEMO = 'demo';

const listeners = new Set();
let fallbackMode = REAL;

function storage() {
  try {
    return globalThis.sessionStorage || null;
  } catch {
    return null;
  }
}

export function storageAvailable() {
  const store = storage();
  if (!store) return false;
  try {
    const probe = `${MODE_STORAGE_KEY}:probe`;
    store.setItem(probe, '1');
    store.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

export function getMode() {
  const store = storage();
  if (!store) return fallbackMode;
  try {
    return store.getItem(MODE_STORAGE_KEY) === DEMO ? DEMO : REAL;
  } catch {
    return fallbackMode;
  }
}

export function isDemoMode() {
  return getMode() === DEMO;
}

export function setMode(mode) {
  const next = mode === DEMO ? DEMO : REAL;
  fallbackMode = next;
  const store = storage();
  if (store) {
    try {
      if (next === DEMO) store.setItem(MODE_STORAGE_KEY, DEMO);
      else store.removeItem(MODE_STORAGE_KEY);
    } catch {
      // The in-memory flag keeps this tab in the chosen mode.
    }
  }
  for (const listener of listeners) listener(next);
  return next;
}

export function subscribeMode(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function enterDemo() {
  return setMode(DEMO);
}

export function exitDemo() {
  return setMode(REAL);
}
