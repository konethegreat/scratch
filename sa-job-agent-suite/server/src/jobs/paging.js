// Pure parsing helpers for the cursor-paged GET /api/jobs.

export function clampJobLimit(value) {
  const parsed = parseInt(String(value), 10);
  if (Number.isNaN(parsed)) return 50;
  return Math.min(200, Math.max(1, parsed));
}

// A paging cursor is the base64 of a zero-based offset. Anything that does not
// decode to a non-negative safe integer falls back to the first page.
export function decodeJobCursor(value) {
  if (typeof value !== 'string' || !value) return 0;
  const text = Buffer.from(value, 'base64').toString('utf8').trim();
  if (!/^\d+$/.test(text)) return 0;
  const offset = Number(text);
  return Number.isSafeInteger(offset) ? offset : 0;
}
