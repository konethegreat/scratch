import { scrubSecrets } from '@sajas/core/secrets';

export function createActivity({ limit = 200, now = () => new Date().toISOString() } = {}) {
  let entries = [];
  return {
    add(message, type = 'info') {
      entries = [...entries, { timestamp: now(), message: scrubSecrets(String(message)), type }].slice(-limit);
    },
    list() {
      return entries.slice();
    },
    clear() {
      entries = [];
    }
  };
}
