// In-memory adapter with IndexedDB-like value isolation, used by unit tests and
// as the fallback when a browser refuses IndexedDB.
export function createMemoryAdapter(seed = {}) {
  const data = new Map();
  for (const [store, entries] of Object.entries(seed)) {
    data.set(store, new Map(Object.entries(entries)));
  }
  const store = (name) => {
    if (!data.has(name)) data.set(name, new Map());
    return data.get(name);
  };
  return {
    async get(name, key) {
      const value = store(name).get(key);
      return value === undefined ? undefined : structuredClone(value);
    },
    async put(name, key, value) {
      store(name).set(key, structuredClone(value));
    },
    async delete(name, key) {
      store(name).delete(key);
    },
    async getAll(name) {
      return [...store(name).values()].map((value) => structuredClone(value));
    },
    async clear(name) {
      store(name).clear();
    },
    async clearAll() {
      for (const entries of data.values()) entries.clear();
    }
  };
}
