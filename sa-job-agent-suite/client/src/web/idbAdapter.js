// IndexedDB adapter for the hosted app. One database, one object store per data
// area, created on the first open. All failures surface as AppError codes the
// shared mapper understands (QuotaExceededError -> STORAGE_FULL).
import { AppError, ERROR_CODES } from '@sajas/core/errors';
import { VAULT_STORES } from './vault.js';

const DB_NAME = 'sajas-web';
const DB_VERSION = 1;

export function createIdbAdapter({ factory = globalThis.indexedDB, name = DB_NAME, version = DB_VERSION } = {}) {
  let opening = null;

  function open() {
    if (!factory) {
      return Promise.reject(new AppError(ERROR_CODES.STORAGE_UNAVAILABLE, 'This browser does not allow local storage.'));
    }
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      const request = factory.open(name, version);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const store of VAULT_STORES) {
          if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new AppError(ERROR_CODES.STORAGE_UNAVAILABLE, 'Close other SA-JAS tabs, then reload.'));
    });
    return opening;
  }

  function run(store, mode, action) {
    return open().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const request = action(tx.objectStore(store));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }));
  }

  return {
    async get(store, key) {
      return run(store, 'readonly', (s) => s.get(key));
    },
    async put(store, key, value) {
      await run(store, 'readwrite', (s) => s.put(value, key));
    },
    async delete(store, key) {
      await run(store, 'readwrite', (s) => s.delete(key));
    },
    async getAll(store) {
      return run(store, 'readonly', (s) => s.getAll());
    },
    async entries(store) {
      return open().then((db) => new Promise((resolve, reject) => {
        // One readonly transaction: getAllKeys() and getAll() both walk the
        // store by ascending key order, so the two result arrays align.
        const tx = db.transaction(store, 'readonly');
        const objectStore = tx.objectStore(store);
        const keysRequest = objectStore.getAllKeys();
        const valuesRequest = objectStore.getAll();
        tx.oncomplete = () => {
          const keys = keysRequest.result;
          const values = valuesRequest.result;
          resolve(keys.map((key, index) => [key, values[index]]));
        };
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }));
    },
    async clear(store) {
      await run(store, 'readwrite', (s) => s.clear());
    },
    async clearAll() {
      const db = await open();
      await Promise.all(VAULT_STORES.map((store) => run(store, 'readwrite', (s) => s.clear())));
      void db;
    }
  };
}
