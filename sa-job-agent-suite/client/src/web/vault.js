// The browser data port. Pure repository semantics over a storage adapter, so
// every rule (allow-list of stores, export shape, key exclusion) is testable in
// Node and identical in IndexedDB.
import { AppError, ERROR_CODES } from '@sajas/core/errors';

export const STORES = Object.freeze({
  profile: 'profile',
  jobs: 'jobs',
  answers: 'answers',
  memory: 'memory',
  usage: 'usage',
  meta: 'meta',
  keyVault: 'keyVault'
});

export const VAULT_STORES = Object.freeze(Object.values(STORES));
export const KEY_VAULT_STORE = STORES.keyVault;
export const EXPORT_STORES = Object.freeze(['profile', 'jobs', 'answers', 'memory', 'usage', 'meta']);
export const EXPORT_FORMAT = Object.freeze({ app: 'sajas-web', schemaVersion: 1 });

function checkStore(store) {
  if (!VAULT_STORES.includes(store)) {
    throw new AppError(ERROR_CODES.VALIDATION, `Unknown storage area: ${store}`);
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function createVault(adapter) {
  if (!adapter) throw new AppError(ERROR_CODES.STORAGE_UNAVAILABLE, 'Local storage is unavailable.');

  return {
    async get(store, key, fallback) {
      checkStore(store);
      const value = await adapter.get(store, key);
      return value === undefined ? fallback : value;
    },
    async put(store, key, value) {
      checkStore(store);
      await adapter.put(store, key, value);
    },
    async delete(store, key) {
      checkStore(store);
      await adapter.delete(store, key);
    },
    async getAll(store) {
      checkStore(store);
      return adapter.getAll(store);
    },
    async clear(store) {
      checkStore(store);
      await adapter.clear(store);
    },
    async wipe() {
      await adapter.clearAll();
    },
    async exportAll() {
      const data = {};
      for (const store of EXPORT_STORES) {
        // Keyed maps keep record identity (profile/current, meta/app) intact
        // across export -> wipe -> import; a value array would lose the keys.
        data[store] = Object.fromEntries(await adapter.entries(store));
      }
      return {
        app: EXPORT_FORMAT.app,
        schemaVersion: EXPORT_FORMAT.schemaVersion,
        exportedAt: new Date().toISOString(),
        data
      };
    },
    async importAll(payload) {
      if (!payload || typeof payload !== 'object' || payload.app !== EXPORT_FORMAT.app) {
        throw new AppError(ERROR_CODES.VALIDATION, 'That file is not a SA-JAS web backup.');
      }
      if (payload.schemaVersion !== EXPORT_FORMAT.schemaVersion) {
        throw new AppError(ERROR_CODES.VALIDATION, 'That backup comes from a different version of the app.');
      }
      if (!isPlainObject(payload.data)) {
        throw new AppError(ERROR_CODES.VALIDATION, 'That backup has no data.');
      }
      // Validate every store before clearing anything: one bad store must not
      // cost the user the records that are already on this device.
      for (const store of EXPORT_STORES) {
        if (!isPlainObject(payload.data[store])) {
          throw new AppError(ERROR_CODES.VALIDATION, `That backup is missing or has invalid ${store} data.`);
        }
      }
      for (const store of EXPORT_STORES) {
        await adapter.clear(store);
        // One export format only: each store is a keyed map of key -> value.
        for (const [key, value] of Object.entries(payload.data[store])) {
          await adapter.put(store, key, value);
        }
      }
    }
  };
}
