// IndexedDB lives in the extension's own origin, so packets and results never
// share storage with the app vault.
const DB_NAME = 'sajas-extension';
const DB_VERSION = 2;
const STORES = ['packets', 'results', 'pending'];

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      for (const name of STORES) {
        if (!database.objectStoreNames.contains(name)) database.createObjectStore(name, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function settle(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('The extension database aborted a transaction.'));
  });
}

export function createIdbStorage() {
  let opening = null;
  const database = () => {
    if (!opening) opening = openDatabase();
    return opening;
  };

  return {
    async readAll(name) {
      const db = await database();
      return new Promise((resolve, reject) => {
        const request = db.transaction(name, 'readonly').objectStore(name).getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });
    },
    async put(name, record) {
      const db = await database();
      const transaction = db.transaction(name, 'readwrite');
      transaction.objectStore(name).put(record);
      await settle(transaction);
    },
    async remove(name, key) {
      const db = await database();
      const transaction = db.transaction(name, 'readwrite');
      transaction.objectStore(name).delete(key);
      await settle(transaction);
    }
  };
}
