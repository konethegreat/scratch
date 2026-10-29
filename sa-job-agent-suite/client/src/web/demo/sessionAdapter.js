// sessionStorage-backed vault adapter. Every key carries the demo prefix, so a
// wipe can only ever remove demo data. When storage is refused or full, the
// adapter silently becomes an in-memory store and reports persistent: false.
import { createMemoryAdapter } from '../memoryAdapter.js';

export const DEMO_PREFIX = 'sajas:demo:';

function defaultStorage() {
  try {
    return globalThis.sessionStorage || null;
  } catch {
    return null;
  }
}

function usable(storage, prefix) {
  try {
    const probe = `${prefix}probe`;
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

export function createSessionAdapter({ storage, prefix = DEMO_PREFIX } = {}) {
  const api = storage ?? defaultStorage();
  const persistent = Boolean(api && usable(api, prefix));
  if (!persistent) {
    const memory = createMemoryAdapter();
    return { ...memory, persistent: false, prefix };
  }

  const full = (store, key) => `${prefix}${store}:${key}`;
  function keysOf(store) {
    const head = `${prefix}${store}:`;
    const found = [];
    for (let index = 0; index < api.length; index += 1) {
      const key = api.key(index);
      if (key && key.startsWith(head)) found.push(key.slice(head.length));
    }
    return found;
  }

  return {
    persistent: true,
    prefix,
    async get(store, key) {
      const raw = api.getItem(full(store, key));
      return raw == null ? undefined : JSON.parse(raw);
    },
    async put(store, key, value) {
      api.setItem(full(store, key), JSON.stringify(value));
    },
    async delete(store, key) {
      api.removeItem(full(store, key));
    },
    async getAll(store) {
      return keysOf(store).map((key) => JSON.parse(api.getItem(full(store, key))));
    },
    async entries(store) {
      return keysOf(store).map((key) => [key, JSON.parse(api.getItem(full(store, key)))]);
    },
    async clear(store) {
      for (const key of keysOf(store)) api.removeItem(full(store, key));
    },
    async clearAll() {
      const doomed = [];
      for (let index = 0; index < api.length; index += 1) {
        const key = api.key(index);
        if (key && key.startsWith(prefix)) doomed.push(key);
      }
      for (const key of doomed) api.removeItem(key);
    }
  };
}

export function wipeDemoNamespace(storage = defaultStorage(), prefix = DEMO_PREFIX) {
  if (!storage) return;
  try {
    const doomed = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key && key.startsWith(prefix)) doomed.push(key);
    }
    for (const key of doomed) storage.removeItem(key);
  } catch {
    // Nothing persisted to remove.
  }
}
