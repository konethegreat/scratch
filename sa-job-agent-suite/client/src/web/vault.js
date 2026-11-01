// The browser data port. Pure repository semantics over a storage adapter, so
// every rule (allow-list of stores, export shape, key exclusion) is testable in
// Node and identical in IndexedDB.
import { AppError, ERROR_CODES } from '@sajas/core/errors';
import { sanitiseBackupData } from './backup.js';
import { exportDocumentRecords, sanitiseDocumentRecords } from './documents.js';

export const STORES = Object.freeze({
  profile: 'profile',
  jobs: 'jobs',
  answers: 'answers',
  memory: 'memory',
  usage: 'usage',
  meta: 'meta',
  documents: 'documents',
  keyVault: 'keyVault'
});

export const VAULT_STORES = Object.freeze(Object.values(STORES));
export const KEY_VAULT_STORE = STORES.keyVault;
export const EXPORT_STORES = Object.freeze(['profile', 'jobs', 'answers', 'memory', 'usage', 'meta']);
export const EXPORT_FORMAT = Object.freeze({ app: 'sajas-web', schemaVersion: 2 });

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
      const documents = await adapter.entries(STORES.documents);
      data.documents = exportDocumentRecords(documents.map(([, record]) => record));
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
      if (![1, 2].includes(payload.schemaVersion)) {
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
      // Clean every record before anything is cleared: a hostile link, a
      // key-shaped field or a malformed record must not cost the user the
      // records that are already on this device.
      const data = sanitiseBackupData(payload.data);
      let documents = null;
      if (payload.schemaVersion === 2) {
        if (!isPlainObject(payload.data.documents)) {
          throw new AppError(ERROR_CODES.VALIDATION, 'That backup is missing or has invalid document data.');
        }
        documents = sanitiseDocumentRecords(payload.data.documents);
      }
      for (const store of EXPORT_STORES) {
        await adapter.clear(store);
        // One export format only: each store is a keyed map of key -> value.
        for (const [key, value] of Object.entries(data[store])) {
          await adapter.put(store, key, value);
        }
      }
      if (documents) {
        await adapter.clear(STORES.documents);
        for (const [id, record] of Object.entries(documents)) await adapter.put(STORES.documents, id, record);
      }
    }
  };
}
