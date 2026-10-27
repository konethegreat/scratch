// Bound any untrusted string before it is stored or echoed back.
export function limit(value, max = 2000) {
  return String(value == null ? '' : value).slice(0, max);
}
