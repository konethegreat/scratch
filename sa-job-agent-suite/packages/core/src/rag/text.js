const STOP_WORDS = new Set([
  'a', 'am', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'can', 'could',
  'did', 'do', 'does', 'for', 'from', 'had', 'has', 'have', 'he', 'her', 'hers',
  'him', 'his', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'me', 'my',
  'no', 'not', 'of', 'on', 'or', 'our', 'ours', 'she', 'so', 'than', 'that',
  'the', 'their', 'theirs', 'them', 'then', 'there', 'these', 'they', 'this',
  'those', 'to', 'too', 'up', 'was', 'we', 'were', 'what', 'when', 'where',
  'which', 'who', 'whom', 'why', 'will', 'with', 'would', 'you', 'your', 'yours'
]);

export function hashText(value) {
  let hash = 0x811c9dc5;
  const text = String(value ?? '');
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function tokenize(value) {
  const text = String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const words = text.match(/[a-z0-9][a-z0-9+#]*/g) || [];
  return words.filter((word) => word.length > 1 && !STOP_WORDS.has(word));
}
