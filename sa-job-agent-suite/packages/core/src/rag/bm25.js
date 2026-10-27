import { tokenize } from './text.js';

const K1 = 1.5;
const B = 0.75;

export function createSearchIndex(chunks = []) {
  const items = (Array.isArray(chunks) ? chunks : []).map((chunk) => {
    const tokens = tokenize(chunk.text || '');
    const frequencies = new Map();
    for (const token of tokens) frequencies.set(token, (frequencies.get(token) || 0) + 1);
    return { chunk, length: tokens.length, frequencies };
  });

  const documentFrequency = new Map();
  for (const item of items) {
    for (const token of item.frequencies.keys()) {
      documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1);
    }
  }

  const total = items.length;
  const averageLength = total ? items.reduce((sum, item) => sum + item.length, 0) / total : 0;
  const idf = new Map();
  for (const [token, frequency] of documentFrequency) {
    idf.set(token, Math.log(1 + (total - frequency + 0.5) / (frequency + 0.5)));
  }

  function search(query, { topK = 8, maxChars = 8000, minScore = 0.01 } = {}) {
    const terms = [...new Set(tokenize(query))];
    if (!terms.length || !items.length) return [];

    const scored = [];
    for (const item of items) {
      let score = 0;
      for (const term of terms) {
        const frequency = item.frequencies.get(term) || 0;
        if (!frequency) continue;
        const normalization = K1 * (1 - B + B * (item.length / (averageLength || 1)));
        score += (idf.get(term) || 0) * ((frequency * (K1 + 1)) / (frequency + normalization));
      }
      if (score > 0 && score >= minScore) scored.push({ chunk: item.chunk, score });
    }

    scored.sort((left, right) => (right.score - left.score)
      || (left.chunk.id < right.chunk.id ? -1 : left.chunk.id > right.chunk.id ? 1 : 0));

    const picked = [];
    let used = 0;
    for (const entry of scored) {
      if (picked.length >= topK) break;
      const length = String(entry.chunk.text || '').length;
      if (picked.length && used + length > maxChars) continue;
      picked.push({ ...entry.chunk, score: entry.score });
      used += length;
    }
    return picked;
  }

  return { search, size: items.length };
}
