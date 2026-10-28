// Collects the most stable representations of a loaded page: same-origin JSON
// responses, embedded application state and JSON-LD. Best effort only.
export const CAPTURE_LIMITS = Object.freeze({
  maxResponses: 12,
  maxResponseBytes: 512 * 1024,
  maxTotalBytes: 1536 * 1024,
  maxStatePayloads: 5,
  maxStateBytes: 2 * 1024 * 1024
});

const isJsonType = (type) => {
  const base = String(type || '').toLowerCase().split(';')[0].trim();
  return base === 'application/json' || base.endsWith('+json');
};

const originOf = (url) => {
  try { return new URL(url).origin; } catch { return ''; }
};

export function createCollector({ origin, limits } = {}) {
  const lim = { ...CAPTURE_LIMITS, ...(limits || {}) };
  const payloads = [];
  const pending = new Set();
  const state = { malformed: 0, skipped: 0, totalBytes: 0, stopped: false };
  let target = origin ? originOf(origin) : '';
  let tail = Promise.resolve();

  const accept = (response) => {
    try {
      if (state.stopped) return false;
      if (payloads.length >= lim.maxResponses) { state.stopped = true; return false; }
      const url = String(response?.url?.() || '');
      if (!url) return false;
      if (!target) target = originOf(url);
      if (originOf(url) !== target) return false;
      const headers = response?.headers?.() || {};
      return isJsonType(headers['content-type'] || headers['Content-Type']);
    } catch {
      return false;
    }
  };

  // Bodies are read in arrival order so the response cap counts accepted
  // payloads, not just responses that started downloading.
  const ingest = async (response) => {
    if (!accept(response)) return;
    const url = response.url();
    let body;
    try { body = await response.body(); } catch { state.skipped += 1; return; }
    const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body || '');
    if (!buffer.length || buffer.length > lim.maxResponseBytes) { state.skipped += 1; return; }
    if (state.totalBytes + buffer.length > lim.maxTotalBytes) {
      state.stopped = true;
      state.skipped += 1;
      return;
    }
    state.totalBytes += buffer.length;
    let json;
    try { json = JSON.parse(buffer.toString('utf8')); } catch { state.malformed += 1; return; }
    payloads.push({ kind: 'xhr', url, json });
  };

  const collect = (response) => {
    const task = tail.then(() => ingest(response)).catch(() => { state.skipped += 1; });
    tail = task;
    pending.add(task);
    task.finally(() => { pending.delete(task); });
  };

  const settle = async () => {
    while (pending.size) await Promise.allSettled([...pending]);
  };

  return { origin: target, payloads, state, accept, collect, settle };
}

export function installCapture(page, collector) {
  if (!page || typeof page.on !== 'function') return () => {};
  const handler = (response) => collector.collect(response);
  page.on('response', handler);
  return () => {
    try { page.off?.('response', handler); } catch { /* teardown must not throw */ }
  };
}

// Runs inside the page. Self-contained on purpose.
export function readStateInPage({ maxPayloads = 5, maxBytes = 2 * 1024 * 1024 } = {}) {
  const out = [];
  const seen = new Set();
  const push = (kind, raw) => {
    if (out.length >= maxPayloads) return;
    const text = typeof raw === 'string' ? raw : '';
    if (!text || text.length > maxBytes || seen.has(text)) return;
    seen.add(text);
    out.push({ kind, text });
  };
  for (const name of ['__NEXT_DATA__', '__NUXT__', '__INITIAL_STATE__', '__APOLLO_STATE__']) {
    try {
      const value = window[name];
      // A script with this id becomes a DOM element on window. The element is
      // read as text below, not stringified as a node.
      if (value == null || (typeof value === 'object' && typeof value.nodeType === 'number')) continue;
      push(name, JSON.stringify(value));
    } catch { /* a cyclic or hostile global must not break the snapshot */ }
  }
  const nextData = document.getElementById('__NEXT_DATA__');
  if (nextData && nextData.textContent) push('__NEXT_DATA__', nextData.textContent);
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (let i = 0; i < scripts.length && out.length < maxPayloads; i += 1) {
    push('jsonld', scripts[i].textContent || '');
  }
  return out;
}

export function parseStateEntries(entries = []) {
  const payloads = [];
  let malformed = 0;
  for (const entry of Array.isArray(entries) ? entries : []) {
    const text = typeof entry?.text === 'string' ? entry.text.trim() : '';
    if (!text) continue;
    try { payloads.push({ kind: entry.kind || 'state', json: JSON.parse(text) }); } catch { malformed += 1; }
  }
  return { payloads, malformed };
}

export async function collectPageData({ page, collector, origin } = {}) {
  const base = { payloads: [], malformed: 0, skipped: 0, origin: origin || collector?.origin || '' };
  if (!page || !collector) return base;
  await collector.settle();
  let entries = [];
  try {
    entries = await page.evaluate(readStateInPage, {
      maxPayloads: CAPTURE_LIMITS.maxStatePayloads,
      maxBytes: CAPTURE_LIMITS.maxStateBytes
    });
  } catch {
    entries = [];
  }
  const parsed = parseStateEntries(entries);
  return {
    origin: origin || collector.origin || '',
    payloads: [...collector.payloads, ...parsed.payloads],
    malformed: collector.state.malformed + parsed.malformed,
    skipped: collector.state.skipped
  };
}
