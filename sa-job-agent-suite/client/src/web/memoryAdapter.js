// In-memory adapter with IndexedDB-like value isolation, used by unit tests and
// as the fallback when a browser refuses IndexedDB.
export function createMemoryAdapter(seed = {}) {
  // Seed values are plain JSON; clone them so the adapter never shares object
  // references with the caller that built the seed.
  const cloneSeed =
    typeof structuredClone === 'function'
      ? structuredClone
      : (value) => JSON.parse(JSON.stringify(value));
  const data = new Map();
  for (const [store, entries] of Object.entries(seed)) {
    data.set(store, new Map(Object.entries(entries).map(([key, value]) => [key, cloneSeed(value)])));
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
    async entries(name) {
      return [...store(name).entries()].map(([key, value]) => [key, structuredClone(value)]);
    },
    async clear(name) {
      store(name).clear();
    },
    async clearAll() {
      for (const entries of data.values()) entries.clear();
    }
  };
}
