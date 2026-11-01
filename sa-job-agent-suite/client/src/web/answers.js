// Answer-bank v2 defaults are applied on read, so existing records are never
// rewritten in bulk and packet v1 keeps working.
export const ANSWER_DEFAULTS = Object.freeze({
  category: 'other',
  source: 'manual',
  timesUsed: 0,
  lastUsed: null,
  createdAt: ''
});

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export function withAnswerDefaults(record) {
  if (!isObject(record)) return { ...ANSWER_DEFAULTS };
  return { ...ANSWER_DEFAULTS, ...record };
}
