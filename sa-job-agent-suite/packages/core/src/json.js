// JSON helpers for model output: tolerant extraction and truncation salvage.

/**
 * Pull the first JSON value out of model text: handles ```json fences and
 * prose before/after. Returns null when nothing parseable is found.
 */
export function extractJson(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.search(/[\[{]/);
  if (start === -1) return null;
  const lastObj = candidate.lastIndexOf('}');
  const lastArr = candidate.lastIndexOf(']');
  const end = Math.max(lastObj, lastArr);
  if (end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

function findArrayStart(text, key) {
  if (key) {
    const needle = JSON.stringify(String(key));
    let from = 0;
    for (;;) {
      const at = text.indexOf(needle, from);
      if (at === -1) return -1;
      const m = /^\s*:\s*\[/.exec(text.slice(at + needle.length));
      if (m) return at + needle.length + m[0].length;
      from = at + needle.length;
    }
  }
  const i = text.indexOf('[');
  return i === -1 ? -1 : i + 1;
}

/**
 * Recover the fully closed elements of a (possibly truncated) JSON array.
 * String- and escape-aware; stops at the cut-off. Returns [] if no array.
 * `opts.key` reads the array held under that property of an object.
 */
export function salvageJsonArray(text, opts = {}) {
  if (!text || typeof text !== 'string') return [];
  let i = findArrayStart(text, opts.key);
  if (i === -1) return [];

  const out = [];
  let elStart = -1;
  let depth = 0;
  let inStr = false;
  let esc = false;

  const push = (end) => {
    try {
      out.push(JSON.parse(text.slice(elStart, end)));
    } catch { /* malformed element: skip it */ }
    elStart = -1;
  };

  for (; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') {
        inStr = false;
        if (depth === 0) push(i + 1); // top-level string element closed
      }
      continue;
    }
    if (elStart === -1) {
      if (ch === ']') break; // end of the array
      if (/[\s,]/.test(ch)) continue;
      elStart = i;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      if (depth === 0) { // closes the array after a scalar element
        if (elStart !== i) push(i);
        break;
      }
      depth--;
      if (depth === 0) push(i + 1);
    } else if (ch === ',' && depth === 0 && elStart !== -1) {
      push(i); // scalar element terminated by a comma
    }
  }
  return out;
}
