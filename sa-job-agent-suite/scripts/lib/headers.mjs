// Minimal parser for Cloudflare Pages `_headers` files: a path rule line, then
// indented `Name: value` lines. Good enough for the static tests and the local
// test server; Cloudflare's own parser is the production authority.
export function parseHeadersFile(text) {
  const rules = [];
  let current = null;
  for (const raw of String(text).split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    if (!/^\s/.test(raw)) {
      current = { pattern: raw.trim(), headers: {} };
      rules.push(current);
      continue;
    }
    if (!current) throw new Error(`Header before any path rule: ${raw}`);
    const line = raw.trim();
    const idx = line.indexOf(':');
    if (idx < 1) throw new Error(`Malformed header line: ${line}`);
    current.headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
  }
  return rules;
}

export function headersFor(rules, pathname) {
  const exact = rules.find((rule) => rule.pattern === pathname);
  const wildcard = rules.find((rule) => rule.pattern === '/*');
  return { ...(wildcard?.headers || {}), ...(exact?.headers || {}) };
}
