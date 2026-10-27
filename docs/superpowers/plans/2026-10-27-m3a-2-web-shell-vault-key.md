# M3a-2 — Web Shell, Vault and Key Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the hosted web shell: a `VITE`-gated web build backed by an IndexedDB vault, a zero-knowledge key lifecycle (memory by default, optional passphrase-encrypted blob), typed errors for every path, and Cloudflare Pages headers/config — with a canary-key test proving the key leaves the tab only in the `x-api-key` header to `api.anthropic.com`.

**Architecture:** The existing React client stays. A build-time `__SAJAS_WEB__` flag routes `API_BASE` fetches to an in-process web API implemented over an IndexedDB vault; no server is involved. The key lives in a closure (memory) and optionally as an AES-GCM/PBKDF2 blob in the vault. Server-only tabs and settings sub-tabs are hidden in web mode; unsupported endpoints answer `NOT_SUPPORTED_IN_WEB`.

**Tech Stack:** Node 22.12+, ESM, React 18, Vite 7, `node:test`, Playwright (already a dependency), IndexedDB + WebCrypto in the browser, Cloudflare Pages.

**Spec:** `docs/superpowers/specs/2026-10-27-m3-hosted-web-alpha-design.md` (§4.1–§4.3, §4.6–§4.8, §5 M3a-2, §6).

## Global Constraints

- Run every command from `sa-job-agent-suite/` unless the step says otherwise.
- Base: `origin/main` at `1510f7b` (M3a-1 merged). Worktree branch `feat/m3a2-web-shell`.
- **No new npm dependencies.** No new dev dependencies. Playwright is already installed.
- **No live network in tests.** Never set or use `ANTHROPIC_API_KEY`; never run `npm run smoke:live` or `node evals/run.mjs --live`.
- Key-shaped test strings must be assembled at runtime (`['sk','ant','api','03','-', 'A'.repeat(24)].join('')`), never written literally.
- No model-ID literals outside `packages/core/src/models.js` and `*.test.js`.
- Do not import `@sajas/core` (root) from client code; import subpaths (`@sajas/core/errors`, `@sajas/core/secrets`, `@sajas/core/models`) so the Anthropic SDK never enters the M3a-2 web bundle.
- Web mode must never call `http://localhost:5000`; the local server and `X-SAJAS-Client` header do not exist on Pages.
- The key must never be written to `localStorage`, `sessionStorage`, cookies, URLs, logs, analytics, or the DOM.
- Desktop behaviour must not change: `npm test`, `npm run test:demo`, `npm run build:client`, `npm run test:desktop` stay green.
- Commit trailer on every commit:
  `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`
- Never bypass the pre-commit hook (`--no-verify` is forbidden). If it flags something, fix the cause.
- Do not touch `docs/superpowers/HANDOFF-2026-10-26.md` or other `.superpowers/` paths except the SDD ledger for this increment.

---

### Task 1: Web build mode and shell gating

**Files:**
- Modify: `sa-job-agent-suite/client/vite.config.js`
- Modify: `sa-job-agent-suite/client/package.json`
- Modify: `sa-job-agent-suite/package.json`
- Create: `sa-job-agent-suite/client/src/web/env.js`
- Create: `sa-job-agent-suite/client/src/web/mode.js`
- Create: `sa-job-agent-suite/client/src/web/mode.test.js`
- Modify: `sa-job-agent-suite/client/src/main.jsx`
- Modify: `sa-job-agent-suite/client/index.html`
- Modify: `sa-job-agent-suite/client/src/App.jsx`
- Modify: `sa-job-agent-suite/client/src/index.css` (font fallbacks only)

**Interfaces:**
- Consumes: nothing.
- Produces: `IS_WEB: boolean` (`web/env.js`); `SERVER_ONLY_TABS`, `SERVER_ONLY_SETTINGS`, `isTabVisible(tab, isWeb)`, `filterSettingsTabs(tabs, isWeb)` (`web/mode.js`); npm script `build:web` at root and in `client`; `--mode web` sets `__SAJAS_WEB__ === true`.

- [ ] **Step 1: Write the failing tab-visibility test**

Create `client/src/web/mode.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SERVER_ONLY_TABS,
  SERVER_ONLY_SETTINGS,
  isTabVisible,
  filterSettingsTabs
} from './mode.js';

test('server-only tabs are visible on desktop', () => {
  for (const tab of SERVER_ONLY_TABS) assert.equal(isTabVisible(tab, false), true);
});

test('server-only tabs are hidden in web mode', () => {
  for (const tab of SERVER_ONLY_TABS) assert.equal(isTabVisible(tab, true), false);
});

test('core tabs stay visible in web mode', () => {
  for (const tab of ['landing', 'dashboard', 'hunter', 'tailor', 'memory', 'profile']) {
    assert.equal(isTabVisible(tab, true), true, tab);
  }
});

test('web settings hide answers and data, desktop keeps them', () => {
  const tabs = ['ai', 'profile', 'search', 'answers', 'data'].map((id) => ({ id }));
  assert.deepEqual(filterSettingsTabs(tabs, true).map((t) => t.id), ['ai', 'profile', 'search']);
  assert.deepEqual(filterSettingsTabs(tabs, false).map((t) => t.id), ['ai', 'profile', 'search', 'answers', 'data']);
});

test('server-only settings are a known subset', () => {
  for (const id of SERVER_ONLY_SETTINGS) {
    assert.ok(['answers', 'data'].includes(id), id);
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace=client -- --test-name-pattern="server-only"`
Expected: FAIL — `./mode.js` does not exist.

- [ ] **Step 3: Add the web flag and mode helpers**

`client/vite.config.js` — change the export to a function and add `define`:

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  // Relative base so built assets (images, CSS, JS) resolve under Electron's
  // file:// protocol in the packaged app, not just http:// in dev.
  base: './',
  define: {
    // Compile-time switch. `vite build --mode web` is the only way to set it;
    // the Electron/desktop build leaves it false.
    __SAJAS_WEB__: JSON.stringify(mode === 'web')
  },
  plugins: [react()],
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
  },
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: 4173,
    strictPort: false
  }
}));
```

Create `client/src/web/env.js`:

```js
// True only in the hosted web build (`vite build --mode web`). Vite replaces the
// identifier at build time; Node (unit tests) sees it as undefined.
export const IS_WEB = typeof __SAJAS_WEB__ !== 'undefined' ? __SAJAS_WEB__ : false;
```

Create `client/src/web/mode.js`:

```js
// Which parts of the desktop UI are meaningful in the hosted, server-less app.
export const SERVER_ONLY_TABS = Object.freeze(['copilot', 'referrals', 'routines', 'logs']);
export const SERVER_ONLY_SETTINGS = Object.freeze(['answers', 'data']);

export function isTabVisible(tab, isWeb) {
  return !isWeb || !SERVER_ONLY_TABS.includes(tab);
}

export function filterSettingsTabs(tabs, isWeb) {
  if (!isWeb) return tabs;
  return tabs.filter((tab) => !SERVER_ONLY_SETTINGS.includes(tab.id));
}
```

Add scripts:

```json
// client/package.json — scripts
"build:web": "vite build --mode web"
```

```json
// package.json (root) — scripts
"build:web": "npm run build:web --workspace=client"
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test --workspace=client -- --test-name-pattern="server-only|web settings|core tabs"`
Expected: PASS (5 tests).

- [ ] **Step 5: Gate the desktop-only fetch header and fonts**

`client/src/main.jsx` — replace the file with:

```jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';
import { IS_WEB } from './web/env.js';
import './index.css';

const API_BASE = import.meta.env.VITE_SAJAS_API_BASE || 'http://localhost:5000/api';

if (!IS_WEB) {
  // The local API refuses state-changing requests that lack this header (see
  // server/src/localGuard.js). Web mode has no server, so this patch is desktop-only.
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
    if (typeof url !== 'string' || !url.startsWith(API_BASE)) return nativeFetch(input, init);
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    headers.set('X-SAJAS-Client', '1');
    return nativeFetch(input, { ...init, headers });
  };

  // The desktop CSP allows these; the hosted CSP deliberately does not.
  for (const [href, rel] of [
    ['https://fonts.googleapis.com', 'preconnect'],
    ['https://fonts.gstatic.com', 'preconnect'],
    ['https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Outfit:wght@400;500;600;700;850&display=swap', 'stylesheet']
  ]) {
    const link = document.createElement('link');
    link.rel = rel;
    link.href = href;
    if (rel === 'preconnect' && href.includes('gstatic')) link.crossOrigin = 'anonymous';
    document.head.append(link);
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
```

`client/index.html` — delete the three Google-Fonts tags (`preconnect` ×2 and the `stylesheets` link). Leave the favicon, viewport, title and root element.

`client/src/index.css` — make the existing font stacks degrade cleanly (keep desktop fonts first):

```css
font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
```

Apply the same fallback addition to the three `'Outfit', sans-serif` declarations and the `'JetBrains Mono', 'Courier New', Courier, monospace` declaration. Do not change sizes or weights.

- [ ] **Step 6: Hide server-only surfaces in the web UI**

In `client/src/App.jsx`:

1. Add imports near the existing local imports:

```js
import { IS_WEB } from './web/env.js';
import { isTabVisible, filterSettingsTabs } from './web/mode.js';
```

2. Wrap each server-only sidebar link (Apply Copilot, Direct Outreach, Routines, Activity Logs):

```jsx
{isTabVisible('copilot', IS_WEB) && (
  <SidebarLink active={activeTab === 'copilot'} onClick={() => setActiveTab('copilot')} icon={<Send size={16} />}>Apply Copilot</SidebarLink>
)}
```

Repeat for `referrals`, `routines`, `logs` with their existing labels/icons.

3. Hide the Dashboard "Open full" logs link:

```jsx
{!IS_WEB && (
  <button type="button" className="btn-ghost btn-xs" onClick={() => setActiveTab('logs')}>Open full <ChevronRight size={12} /></button>
)}
```

4. Change the Settings sub-tab list to:

```jsx
tabs={filterSettingsTabs([
  { id: 'ai',      label: 'AI & Cost',           icon: <Sparkles size={13} /> },
  { id: 'profile', label: 'Profile & CV',        icon: <FileText size={13} /> },
  { id: 'search',  label: 'Job Search',          icon: <Search size={13} /> },
  { id: 'answers', label: 'Application Answers', icon: <Database size={13} /> },
  { id: 'data',    label: 'Documents & Data',    icon: <ShieldCheck size={13} /> }
], IS_WEB)}
```

5. Guard each server-only render block so a stale `activeTab` cannot mount it: change `{activeTab === 'copilot' && (` to `{!IS_WEB && activeTab === 'copilot' && (` and do the same for `referrals`, `routines`, `logs`.

6. Add a safety effect next to the tab state:

```js
useEffect(() => {
  if (!isTabVisible(activeTab, IS_WEB) && activeTab !== 'landing') setActiveTab('dashboard');
  if (IS_WEB && SERVER_ONLY_SETTINGS.includes(settingsTab)) setSettingsTab('ai');
}, [activeTab, settingsTab]);
```

Import `SERVER_ONLY_SETTINGS` alongside the other mode helpers.

- [ ] **Step 7: Verify the build and tests**

Run:

```bash
npm test --workspace=client
npm run build:client
npm run build:web
```

Expected: all pass; `client/dist/index.html` contains no `fonts.googleapis.com`; both builds exit 0.

- [ ] **Step 8: Commit**

```bash
git add client/vite.config.js client/package.json package.json client/src/web/env.js client/src/web/mode.js client/src/web/mode.test.js client/src/main.jsx client/index.html client/src/App.jsx client/src/index.css
git commit -m "feat(web): add web build mode and hide server-only surfaces" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Vault repository and adapters

**Files:**
- Create: `sa-job-agent-suite/client/src/web/vault.js`
- Create: `sa-job-agent-suite/client/src/web/memoryAdapter.js`
- Create: `sa-job-agent-suite/client/src/web/idbAdapter.js`
- Create: `sa-job-agent-suite/client/src/web/vault.test.js`

**Interfaces:**
- Consumes: `AppError`, `ERROR_CODES` from `@sajas/core/errors`.
- Produces:
  - `STORES = { profile, jobs, answers, memory, usage, meta, keyVault }`, `VAULT_STORES`, `EXPORT_STORES`, `KEY_VAULT_STORE`.
  - `createVault(adapter)` → `{ get(store, key, fallback?), put(store, key, value), delete(store, key), getAll(store), clear(store), wipe(), exportAll(), importAll(payload) }`, all async.
  - Adapter shape: `{ get(store,key), put(store,key,value), delete(store,key), getAll(store), clear(store), clearAll() }`.
  - `createMemoryAdapter(seed?)` for tests; `createIdbAdapter({ factory?, name?, version? })` for the browser.
  - Export format: `{ app: 'sajas-web', schemaVersion: 1, exportedAt, data: { profile, jobs, answers, memory, usage, meta } }` — never includes `keyVault`.

- [ ] **Step 1: Write the failing vault tests**

Create `client/src/web/vault.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createVault, STORES, EXPORT_STORES } from './vault.js';
import { createMemoryAdapter } from './memoryAdapter.js';

function make(seed) {
  const adapter = createMemoryAdapter(seed);
  return { vault: createVault(adapter), adapter };
}

test('put/get/list/delete round-trips values', async () => {
  const { vault } = make();
  await vault.put(STORES.profile, 'current', { fullName: 'Thandi' });
  assert.deepEqual(await vault.get(STORES.profile, 'current'), { fullName: 'Thandi' });
  assert.deepEqual(await vault.getAll(STORES.profile), [{ fullName: 'Thandi' }]);
  await vault.delete(STORES.profile, 'current');
  assert.equal(await vault.get(STORES.profile, 'current'), undefined);
  assert.deepEqual(await vault.getAll(STORES.profile), []);
});

test('get returns the fallback when absent', async () => {
  const { vault } = make();
  assert.deepEqual(await vault.get(STORES.meta, 'app', { onboarded: false }), { onboarded: false });
});

test('an unknown store is a VALIDATION error', async () => {
  const { vault } = make();
  await assert.rejects(() => vault.put('nope', 'k', 1), (err) => err.code === 'VALIDATION');
  await assert.rejects(() => vault.get('nope', 'k'), (err) => err.code === 'VALIDATION');
});

test('export excludes key material', async () => {
  const { vault } = make();
  await vault.put(STORES.profile, 'current', { fullName: 'Thandi' });
  await vault.put(STORES.keyVault, 'anthropic', { v: 1, ciphertext: 'abc' });
  const dump = await vault.exportAll();
  assert.equal(dump.app, 'sajas-web');
  assert.equal(dump.schemaVersion, 1);
  assert.match(dump.exportedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(Object.keys(dump.data).sort(), [...EXPORT_STORES].sort());
  assert.equal(Object.hasOwn(dump.data, 'keyVault'), false);
});

test('import replaces exported stores but never touches keyVault', async () => {
  const { vault } = make();
  await vault.put(STORES.keyVault, 'anthropic', { v: 1, ciphertext: 'keep-me' });
  await vault.put(STORES.jobs, 'old', { title: 'Old' });
  await vault.importAll({
    app: 'sajas-web',
    schemaVersion: 1,
    exportedAt: '2026-10-27T00:00:00.000Z',
    data: {
      profile: { current: { fullName: 'Thandi' } },
      jobs: {},
      answers: {},
      memory: {},
      usage: {},
      meta: { app: { onboarded: true } }
    }
  });
  assert.deepEqual(await vault.get(STORES.profile, 'current'), { fullName: 'Thandi' });
  assert.deepEqual(await vault.getAll(STORES.jobs), []);
  assert.deepEqual(await vault.get(STORES.keyVault, 'anthropic'), { v: 1, ciphertext: 'keep-me' });
});

test('import rejects foreign or newer payloads', async () => {
  const { vault } = make();
  await assert.rejects(() => vault.importAll({ app: 'other', schemaVersion: 1, data: {} }), (e) => e.code === 'VALIDATION');
  await assert.rejects(() => vault.importAll({ app: 'sajas-web', schemaVersion: 2, data: {} }), (e) => e.code === 'VALIDATION');
  await assert.rejects(() => vault.importAll(null), (e) => e.code === 'VALIDATION');
});

test('wipe clears every store including keyVault', async () => {
  const { vault } = make();
  await vault.put(STORES.profile, 'current', { fullName: 'Thandi' });
  await vault.put(STORES.keyVault, 'anthropic', { v: 1, ciphertext: 'abc' });
  await vault.wipe();
  for (const store of Object.values(STORES)) {
    assert.deepEqual(await vault.getAll(store), [], store);
  }
});

test('the memory adapter isolates stored objects from later mutation', async () => {
  const { vault } = make();
  const value = { nested: { n: 1 } };
  await vault.put(STORES.meta, 'app', value);
  value.nested.n = 2;
  assert.deepEqual(await vault.get(STORES.meta, 'app'), { nested: { n: 1 } });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace=client -- --test-name-pattern="vault|store|import|wipe"`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement the adapters and repository**

Create `client/src/web/memoryAdapter.js`:

```js
// In-memory adapter with IndexedDB-like value isolation, used by unit tests and
// as the fallback when a browser refuses IndexedDB.
export function createMemoryAdapter(seed = {}) {
  const data = new Map();
  for (const [store, entries] of Object.entries(seed)) {
    data.set(store, new Map(Object.entries(entries)));
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
    async clear(name) {
      store(name).clear();
    },
    async clearAll() {
      for (const entries of data.values()) entries.clear();
    }
  };
}
```

Create `client/src/web/vault.js`:

```js
// The browser data port. Pure repository semantics over a storage adapter, so
// every rule (allow-list of stores, export shape, key exclusion) is testable in
// Node and identical in IndexedDB.
import { AppError, ERROR_CODES } from '@sajas/core/errors';

export const STORES = Object.freeze({
  profile: 'profile',
  jobs: 'jobs',
  answers: 'answers',
  memory: 'memory',
  usage: 'usage',
  meta: 'meta',
  keyVault: 'keyVault'
});

export const VAULT_STORES = Object.freeze(Object.values(STORES));
export const KEY_VAULT_STORE = STORES.keyVault;
export const EXPORT_STORES = Object.freeze(['profile', 'jobs', 'answers', 'memory', 'usage', 'meta']);
export const EXPORT_FORMAT = Object.freeze({ app: 'sajas-web', schemaVersion: 1 });

function checkStore(store) {
  if (!VAULT_STORES.includes(store)) {
    throw new AppError(ERROR_CODES.VALIDATION, `Unknown storage area: ${store}`);
  }
}

export function createVault(adapter) {
  if (!adapter) throw new AppError(ERROR_CODES.STORAGE_UNAVAILABLE, 'Local storage is unavailable.');

  return {
    async get(store, key, fallback) {
      checkStore(store);
      const value = await adapter.get(store, key);
      return value === undefined ? fallback : value;
    },
    async put(store, key, value) {
      checkStore(store);
      await adapter.put(store, key, value);
    },
    async delete(store, key) {
      checkStore(store);
      await adapter.delete(store, key);
    },
    async getAll(store) {
      checkStore(store);
      return adapter.getAll(store);
    },
    async clear(store) {
      checkStore(store);
      await adapter.clear(store);
    },
    async wipe() {
      await adapter.clearAll();
    },
    async exportAll() {
      const data = {};
      for (const store of EXPORT_STORES) {
        const entries = await adapter.getAll(store);
        // Keys are not exposed by the adapter API; exports are value arrays.
        data[store] = entries;
      }
      return {
        app: EXPORT_FORMAT.app,
        schemaVersion: EXPORT_FORMAT.schemaVersion,
        exportedAt: new Date().toISOString(),
        data
      };
    },
    async importAll(payload) {
      if (!payload || typeof payload !== 'object' || payload.app !== EXPORT_FORMAT.app) {
        throw new AppError(ERROR_CODES.VALIDATION, 'That file is not a SA-JAS web backup.');
      }
      if (payload.schemaVersion !== EXPORT_FORMAT.schemaVersion) {
        throw new AppError(ERROR_CODES.VALIDATION, 'That backup comes from a different version of the app.');
      }
      if (!payload.data || typeof payload.data !== 'object') {
        throw new AppError(ERROR_CODES.VALIDATION, 'That backup has no data.');
      }
      for (const store of EXPORT_STORES) {
        await adapter.clear(store);
        const entries = payload.data[store];
        if (Array.isArray(entries)) {
          for (const value of entries) {
            const key = value && typeof value === 'object' && typeof value.id === 'string' ? value.id : crypto.randomUUID();
            await adapter.put(store, key, value);
          }
        }
      }
    }
  };
}
```

> Review note for the implementer: the import path above only handles array exports (the shape `exportAll` produces). Do not invent a second format.

Create `client/src/web/idbAdapter.js`:

```js
// IndexedDB adapter for the hosted app. One database, one object store per data
// area, created on the first open. All failures surface as AppError codes the
// shared mapper understands (QuotaExceededError -> STORAGE_FULL).
import { AppError, ERROR_CODES } from '@sajas/core/errors';
import { VAULT_STORES } from './vault.js';

const DB_NAME = 'sajas-web';
const DB_VERSION = 1;

export function createIdbAdapter({ factory = globalThis.indexedDB, name = DB_NAME, version = DB_VERSION } = {}) {
  let opening = null;

  function open() {
    if (!factory) {
      return Promise.reject(new AppError(ERROR_CODES.STORAGE_UNAVAILABLE, 'This browser does not allow local storage.'));
    }
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      const request = factory.open(name, version);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const store of VAULT_STORES) {
          if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new AppError(ERROR_CODES.STORAGE_UNAVAILABLE, 'Close other SA-JAS tabs, then reload.'));
    });
    return opening;
  }

  function run(store, mode, action) {
    return open().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const request = action(tx.objectStore(store));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }));
  }

  return {
    async get(store, key) {
      return run(store, 'readonly', (s) => s.get(key));
    },
    async put(store, key, value) {
      await run(store, 'readwrite', (s) => s.put(value, key));
    },
    async delete(store, key) {
      await run(store, 'readwrite', (s) => s.delete(key));
    },
    async getAll(store) {
      return run(store, 'readonly', (s) => s.getAll());
    },
    async clear(store) {
      await run(store, 'readwrite', (s) => s.clear());
    },
    async clearAll() {
      const db = await open();
      await Promise.all(VAULT_STORES.map((store) => run(store, 'readwrite', (s) => s.clear())));
      void db;
    }
  };
}
```

- [ ] **Step 4: Run the vault tests**

Run: `npm test --workspace=client -- --test-name-pattern="vault|store|import|wipe|fallback|isolate"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/web/vault.js client/src/web/memoryAdapter.js client/src/web/idbAdapter.js client/src/web/vault.test.js
git commit -m "feat(web): add IndexedDB vault with pure repository and test adapter" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Key crypto, memory store, and lifecycle

**Files:**
- Modify: `sa-job-agent-suite/packages/core/package.json`
- Modify: `sa-job-agent-suite/client/package.json`
- Create: `sa-job-agent-suite/client/src/web/keyCrypto.js`
- Create: `sa-job-agent-suite/client/src/web/keyCrypto.test.js`
- Create: `sa-job-agent-suite/client/src/web/keyStore.js`
- Create: `sa-job-agent-suite/client/src/web/keyStore.test.js`

**Interfaces:**
- Consumes: `vault.get/put/delete/wipe`, `AppError`, `ERROR_CODES`, `normalizeKeyInput`, `isAnthropicKeyShape`, `isAdminKeyShape`.
- Produces:
  - `deriveKey(passphrase, salt, iterations?)`, `encryptSecret(secret, passphrase, { iterations? })` → `{ v:1, alg:'AES-GCM', kdf:'PBKDF2-SHA-256', iterations, salt, iv, ciphertext }` (base64 fields), `decryptSecret(blob, passphrase)`.
  - `createKeyStore({ vault, now?, encrypt?, decrypt? })` → `{ hasKey(), getKey(), setKey(raw), clearMemory(), touch(), isIdleExpired(at?), maybeForgetIdle(at?), setIdleMinutes(n), getIdleMinutes(), saveIdleMinutes(n), hasSavedKey(), remember(passphrase), unlock(passphrase), forget({wipeSaved?}), panicWipe() }`.
  - `KEY_VAULT_KEY = 'anthropic'`, `IDLE_OPTIONS = [15, 30, 60]`, `MIN_PASSPHRASE = 10`.

- [ ] **Step 1: Add the core subpath exports and the client test glob**

`packages/core/package.json` — add to `exports`:

```json
"./secrets": "./src/secrets.js",
"./models": "./src/models.js"
```

`client/package.json` — change `"test"` to:

```json
"test": "node --test \"src/**/*.test.js\""
```

- [ ] **Step 2: Write the failing crypto and key-store tests**

Create `client/src/web/keyCrypto.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptSecret, decryptSecret } from './keyCrypto.js';

const API_KEY = ['sk', 'ant', 'api', '03', '-', 'A'.repeat(24)].join('');
const FAST = { iterations: 1000 };

test('encrypt/decrypt round-trips and stores no plaintext', async () => {
  const blob = await encryptSecret(API_KEY, 'correct horse battery', FAST);
  assert.equal(blob.v, 1);
  assert.equal(blob.alg, 'AES-GCM');
  assert.equal(blob.kdf, 'PBKDF2-SHA-256');
  assert.equal(blob.iterations, 1000);
  for (const field of ['salt', 'iv', 'ciphertext']) {
    assert.equal(typeof blob[field], 'string');
    assert.ok(blob[field].length > 8);
  }
  assert.equal(JSON.stringify(blob).includes(API_KEY), false);
  assert.equal(await decryptSecret(blob, 'correct horse battery'), API_KEY);
});

test('a wrong passphrase is a VALIDATION error, not a crash', async () => {
  const blob = await encryptSecret(API_KEY, 'correct horse battery', FAST);
  await assert.rejects(() => decryptSecret(blob, 'wrong passphrase'), (err) => err.code === 'VALIDATION');
});

test('a tampered ciphertext is rejected', async () => {
  const blob = await encryptSecret(API_KEY, 'correct horse battery', FAST);
  const raw = Buffer.from(blob.ciphertext, 'base64');
  raw[0] ^= 0xff;
  await assert.rejects(
    () => decryptSecret({ ...blob, ciphertext: raw.toString('base64') }, 'correct horse battery'),
    (err) => err.code === 'VALIDATION'
  );
});

test('a malformed blob is rejected before deriving', async () => {
  await assert.rejects(() => decryptSecret({ v: 2 }, 'x'), (err) => err.code === 'VALIDATION');
  await assert.rejects(() => decryptSecret(null, 'x'), (err) => err.code === 'VALIDATION');
});
```

Create `client/src/web/keyStore.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createVault, STORES } from './vault.js';
import { createMemoryAdapter } from './memoryAdapter.js';
import { createKeyStore, KEY_VAULT_KEY, IDLE_OPTIONS } from './keyStore.js';

const API_KEY = ['sk', 'ant', 'api', '03', '-', 'B'.repeat(24)].join('');
const ADMIN_KEY = ['sk', 'ant', 'admin', '01', '-', 'C'.repeat(24)].join('');
const T0 = 1_000_000;

function make({ saved } = {}) {
  const vault = createVault(createMemoryAdapter(saved));
  let clock = T0;
  const store = createKeyStore({
    vault,
    now: () => clock,
    encrypt: async (secret) => ({ v: 1, ciphertext: `enc:${secret}` }),
    decrypt: async (blob) => {
      if (!String(blob.ciphertext).startsWith('enc:')) throw new Error('bad blob');
      return blob.ciphertext.slice(4);
    }
  });
  return { vault, store, advance: (ms) => { clock += ms; } };
}

test('setKey accepts a shaped key and rejects the rest', () => {
  const { store } = make();
  assert.equal(store.setKey(`  ${API_KEY}  `), API_KEY);
  for (const [value, code] of [['', 'KEY_INVALID'], [ADMIN_KEY, 'KEY_ADMIN'], ['sk-nope', 'KEY_INVALID']]) {
    assert.throws(() => store.setKey(value), (err) => err.code === code);
  }
  assert.equal(store.hasKey(), true);
});

test('remember stores only an encrypted blob and unlock restores memory', async () => {
  const { store, vault } = make();
  store.setKey(API_KEY);
  const blob = await store.remember('a long passphrase');
  assert.equal(JSON.stringify(blob).includes(API_KEY), false);
  assert.deepEqual(await vault.get(STORES.keyVault, KEY_VAULT_KEY), blob);
  assert.equal(await store.hasSavedKey(), true);
  store.clearMemory();
  assert.equal(store.hasKey(), false);
  assert.equal(await store.unlock('a long passphrase'), API_KEY);
  assert.equal(store.getKey(), API_KEY);
});

test('remember requires a loaded key and a long passphrase', async () => {
  const { store } = make();
  await assert.rejects(() => store.remember('a long passphrase'), (e) => e.code === 'KEY_INVALID');
  store.setKey(API_KEY);
  await assert.rejects(() => store.remember('short'), (e) => e.code === 'VALIDATION');
});

test('unlock with no saved blob is NOT_FOUND', async () => {
  const { store } = make();
  await assert.rejects(() => store.unlock('a long passphrase'), (e) => e.code === 'NOT_FOUND');
});

test('forget drops memory and the saved blob', async () => {
  const { store, vault } = make();
  store.setKey(API_KEY);
  await store.remember('a long passphrase');
  await store.forget();
  assert.equal(store.hasKey(), false);
  assert.equal(await store.hasSavedKey(), false);
  assert.equal(await vault.get(STORES.keyVault, KEY_VAULT_KEY), undefined);
});

test('idle forget runs at the configured minute and touch resets it', async () => {
  const { store, advance } = make();
  store.setKey(API_KEY);
  store.setIdleMinutes(15);
  advance(14 * 60_000);
  assert.equal(store.maybeForgetIdle(), false);
  assert.equal(store.hasKey(), true);
  store.touch();
  advance(14 * 60_000);
  assert.equal(store.maybeForgetIdle(), false);
  advance(60_000);
  assert.equal(store.maybeForgetIdle(), true);
  assert.equal(store.hasKey(), false);
});

test('idle minutes are limited to the documented choices', () => {
  const { store } = make();
  assert.deepEqual([...IDLE_OPTIONS], [15, 30, 60]);
  assert.throws(() => store.setIdleMinutes(5), (e) => e.code === 'VALIDATION');
});

test('panicWipe clears memory and every store', async () => {
  const { store, vault } = make();
  store.setKey(API_KEY);
  await store.remember('a long passphrase');
  await vault.put(STORES.jobs, 'j1', { title: 'Job' });
  await store.panicWipe();
  assert.equal(store.hasKey(), false);
  for (const area of Object.values(STORES)) {
    assert.deepEqual(await vault.getAll(area), [], area);
  }
});

test('key modules never touch web-storage shortcuts that outlive the tab', async () => {
  for (const file of ['keyStore.js', 'keyCrypto.js']) {
    const source = await readFile(new URL(`./${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /localStorage|sessionStorage|document\.cookie/, file);
  }
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test --workspace=client -- --test-name-pattern="encrypt|passphrase|key|idle|panic"`
Expected: FAIL — `keyCrypto.js` / `keyStore.js` missing.

- [ ] **Step 4: Implement crypto and the key store**

Create `client/src/web/keyCrypto.js`:

```js
// Passphrase-protected key storage. AES-GCM with a key derived by PBKDF2-SHA-256
// (600k iterations by default, random 16-byte salt, random 12-byte IV). The
// plaintext key never leaves memory.
import { AppError, ERROR_CODES } from '@sajas/core/errors';

export const KEY_ITERATIONS = 600000;

function subtle() {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new AppError(ERROR_CODES.STORAGE_UNAVAILABLE, 'This browser cannot encrypt the saved key.');
  return s;
}

function toBase64(bytes) {
  let binary = '';
  const view = new Uint8Array(bytes);
  for (let i = 0; i < view.length; i += 1) binary += String.fromCharCode(view[i]);
  return btoa(binary);
}

function fromBase64(value) {
  const binary = atob(String(value));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export async function deriveKey(passphrase, salt, iterations = KEY_ITERATIONS) {
  const material = await subtle().importKey('raw', new TextEncoder().encode(String(passphrase)), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptSecret(secret, passphrase, { iterations = KEY_ITERATIONS } = {}) {
  if (!String(passphrase || '')) throw new AppError(ERROR_CODES.VALIDATION, 'Enter a passphrase to save the key.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, iterations);
  const ciphertext = await subtle().encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(String(secret)));
  return {
    v: 1,
    alg: 'AES-GCM',
    kdf: 'PBKDF2-SHA-256',
    iterations,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertext)
  };
}

export async function decryptSecret(blob, passphrase) {
  if (!blob || typeof blob !== 'object' || blob.v !== 1 || !blob.salt || !blob.iv || !blob.ciphertext) {
    throw new AppError(ERROR_CODES.VALIDATION, 'The saved key is not readable.');
  }
  try {
    const key = await deriveKey(passphrase, fromBase64(blob.salt), blob.iterations || KEY_ITERATIONS);
    const plain = await subtle().decrypt({ name: 'AES-GCM', iv: fromBase64(blob.iv) }, key, fromBase64(blob.ciphertext));
    return new TextDecoder().decode(plain);
  } catch {
    throw new AppError(ERROR_CODES.VALIDATION, 'That passphrase did not unlock the saved key.', {
      hint: 'Try again — the saved key cannot be recovered without its passphrase.'
    });
  }
}
```

Create `client/src/web/keyStore.js`:

```js
// The only place a plaintext API key lives in the web app: a closure variable.
// Optional persistence is an encrypted blob in the vault; idle forget drops both
// the memory reference and, only when asked, the blob.
import { AppError, ERROR_CODES } from '@sajas/core/errors';
import { limit } from './limits.js';
import {
  normalizeKeyInput,
  isAnthropicKeyShape,
  isAdminKeyShape
} from '@sajas/core/secrets';
import { STORES } from './vault.js';
import { encryptSecret, decryptSecret } from './keyCrypto.js';

export const KEY_VAULT_KEY = 'anthropic';
export const MIN_PASSPHRASE = 10;
export const IDLE_OPTIONS = Object.freeze([15, 30, 60]);
export const DEFAULT_IDLE_MINUTES = 30;
const META_KEY = 'key';

export function createKeyStore({ vault, now = () => Date.now(), encrypt = encryptSecret, decrypt = decryptSecret } = {}) {
  let key = null;
  let lastActivity = 0;
  let idleMinutes = DEFAULT_IDLE_MINUTES;

  async function readMeta() {
    return vault.get(STORES.meta, META_KEY, {});
  }

  async function writeMeta(patch) {
    const current = await readMeta();
    await vault.put(STORES.meta, META_KEY, { ...current, ...patch });
  }

  const store = {
    hasKey: () => Boolean(key),
    getKey: () => key,

    setKey(raw) {
      const value = limit(normalizeKeyInput(raw), 512);
      if (!value) throw new AppError(ERROR_CODES.KEY_INVALID, 'Paste an Anthropic API key first.');
      if (isAdminKeyShape(value)) {
        throw new AppError(ERROR_CODES.KEY_ADMIN, 'That is an Anthropic Admin key. Create a standard API key in the Console and use that instead.');
      }
      if (!isAnthropicKeyShape(value)) {
        throw new AppError(ERROR_CODES.KEY_INVALID, 'That does not look like an Anthropic API key. It should start with sk-ant-api.');
      }
      key = value;
      store.touch();
      return key;
    },

    clearMemory() {
      key = null;
      lastActivity = 0;
    },

    touch() {
      lastActivity = now();
    },

    setIdleMinutes(minutes) {
      const value = Number(minutes);
      if (!IDLE_OPTIONS.includes(value)) {
        throw new AppError(ERROR_CODES.VALIDATION, 'Choose 15, 30 or 60 minutes.');
      }
      idleMinutes = value;
    },

    getIdleMinutes: () => idleMinutes,

    async saveIdleMinutes(minutes) {
      store.setIdleMinutes(minutes);
      await writeMeta({ idleMinutes });
    },

    async loadIdleMinutes() {
      const meta = await readMeta();
      if (IDLE_OPTIONS.includes(Number(meta.idleMinutes))) idleMinutes = Number(meta.idleMinutes);
      return idleMinutes;
    },

    isIdleExpired(at = now()) {
      return Boolean(key) && lastActivity > 0 && at - lastActivity >= idleMinutes * 60_000;
    },

    maybeForgetIdle(at = now()) {
      if (!store.isIdleExpired(at)) return false;
      store.clearMemory();
      return true;
    },

    async hasSavedKey() {
      return Boolean(await vault.get(STORES.keyVault, KEY_VAULT_KEY));
    },

    async remember(passphrase) {
      if (!key) throw new AppError(ERROR_CODES.KEY_INVALID, 'Add the key before saving it.');
      if (String(passphrase || '').length < MIN_PASSPHRASE) {
        throw new AppError(ERROR_CODES.VALIDATION, `Use a passphrase of at least ${MIN_PASSPHRASE} characters.`);
      }
      const blob = await encrypt(key, passphrase);
      await vault.put(STORES.keyVault, KEY_VAULT_KEY, blob);
      await writeMeta({ idleMinutes, remembered: true });
      return blob;
    },

    async unlock(passphrase) {
      const blob = await vault.get(STORES.keyVault, KEY_VAULT_KEY);
      if (!blob) throw new AppError(ERROR_CODES.NOT_FOUND, 'No saved key was found on this device.');
      const plain = await decrypt(blob, passphrase);
      return store.setKey(plain);
    },

    async forget({ wipeSaved = true } = {}) {
      store.clearMemory();
      if (wipeSaved) await vault.delete(STORES.keyVault, KEY_VAULT_KEY);
      const meta = await readMeta();
      await vault.put(STORES.meta, META_KEY, { ...meta, idleMinutes, remembered: false });
    },

    async panicWipe() {
      store.clearMemory();
      await vault.wipe();
    }
  };

  return store;
}
```

Create `client/src/web/limits.js` (shared with the API layer):

```js
// Bound any untrusted string before it is stored or echoed back.
export function limit(value, max = 2000) {
  return String(value == null ? '' : value).slice(0, max);
}
```

- [ ] **Step 5: Run the key tests**

Run: `npm test --workspace=client -- --test-name-pattern="encrypt|passphrase|key|idle|panic|web-storage"`
Expected: PASS.

- [ ] **Step 6: Verify the desktop suites still pass**

Run: `npm test --workspace=@sajas/core`
Expected: PASS (package exports unchanged in behaviour).

- [ ] **Step 7: Commit**

```bash
git add packages/core/package.json client/package.json client/src/web/keyCrypto.js client/src/web/keyCrypto.test.js client/src/web/keyStore.js client/src/web/keyStore.test.js client/src/web/limits.js
git commit -m "feat(web): add zero-knowledge key store with optional encrypted blob" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Web API router, fetch installation, and key validation

**Files:**
- Create: `sa-job-agent-suite/client/src/web/activity.js`
- Create: `sa-job-agent-suite/client/src/web/activity.test.js`
- Create: `sa-job-agent-suite/client/src/web/validateKey.js`
- Create: `sa-job-agent-suite/client/src/web/validateKey.test.js`
- Create: `sa-job-agent-suite/client/src/web/api.js`
- Create: `sa-job-agent-suite/client/src/web/api.test.js`
- Create: `sa-job-agent-suite/client/src/web/install.js`
- Create: `sa-job-agent-suite/client/src/web/install.test.js`
- Create: `sa-job-agent-suite/client/src/web/runtime.js`
- Modify: `sa-job-agent-suite/client/src/main.jsx`

**Interfaces:**
- Consumes: `createVault`, `createKeyStore`, `AppError`, `ERROR_CODES`, `statusForCode`, `toUserError`, `MODELS`, `scrubSecrets`.
- Produces:
  - `createActivity({ limit?, now? })` → `{ add(message, type?), list(), clear() }` (200 entries, scrubbed).
  - `validateAnthropicKey(raw, { fetchImpl?, online? })` → resolves `true`, throws `AppError`.
  - `createWebApi({ apiBase, vault, keyStore, activity })` → `{ handle(input, init) }` returning `Promise<Response>`.
  - `installWebApi({ apiBase, handler, nativeFetch? })` → replacement `fetch(input, init)`.
  - `webRuntime = IS_WEB ? { vault, keyStore, activity, api } : null` (`web/runtime.js`).
- Supported endpoints: `GET/POST /profile`, `DELETE /profile/key/:provider`, `GET /models`, `GET /status`, `GET/POST /logs`, `POST /logs/clear`, `GET/DELETE /usage`, `GET /documents` (always `[]`), `GET/POST /jobs`, `PATCH/DELETE /jobs/:id`, `DELETE /jobs`, `GET/POST/DELETE /memory`, `POST /memory/insight`, `DELETE /memory/insight/:id`, `POST /memory/employer`, `PATCH /memory/application/:jobId`.
- Every other `/api/*` path answers 501 `NOT_SUPPORTED_IN_WEB`; a truly unknown path answers 404 `NOT_FOUND`.

- [ ] **Step 1: Write the failing activity and validation tests**

Create `client/src/web/activity.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createActivity } from './activity.js';

const API_KEY = ['sk', 'ant', 'api', '03', '-', 'D'.repeat(24)].join('');

test('logs are appended with a timestamp and scrubbed', () => {
  const activity = createActivity({ now: () => '2026-10-27T00:00:00.000Z' });
  activity.add('Profile saved.', 'system');
  activity.add(`Oops ${API_KEY}`, 'error');
  const entries = activity.list();
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], { timestamp: '2026-10-27T00:00:00.000Z', message: 'Profile saved.', type: 'system' });
  assert.equal(entries[1].message.includes(API_KEY), false);
  assert.equal(entries[1].type, 'error');
});

test('the ring keeps only the newest 200 entries', () => {
  const activity = createActivity({ limit: 3 });
  for (let i = 0; i < 5; i += 1) activity.add(`line ${i}`);
  assert.deepEqual(activity.list().map((e) => e.message), ['line 2', 'line 3', 'line 4']);
});

test('clear empties the log and list is a copy', () => {
  const activity = createActivity();
  activity.add('one');
  const snapshot = activity.list();
  snapshot.push({ message: 'injected' });
  assert.equal(activity.list().length, 1);
  activity.clear();
  assert.deepEqual(activity.list(), []);
});
```

Create `client/src/web/validateKey.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAnthropicKey } from './validateKey.js';

const API_KEY = ['sk', 'ant', 'api', '03', '-', 'E'.repeat(24)].join('');
const ADMIN_KEY = ['sk', 'ant', 'admin', '01', '-', 'F'.repeat(24)].join('');

function fakeFetch(status, body = '{}') {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return new Response(body, { status, headers: { 'content-type': 'application/json' } });
  };
  impl.calls = calls;
  return impl;
}

test('a working key validates with the browser-access header', async () => {
  const fetchImpl = fakeFetch(200, '{"data":[]}');
  assert.equal(await validateAnthropicKey(API_KEY, { fetchImpl }), true);
  const [call] = fetchImpl.calls;
  assert.equal(call.url, 'https://api.anthropic.com/v1/models?limit=1');
  assert.equal(call.init.headers['x-api-key'], API_KEY);
  assert.equal(call.init.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(call.init.headers['anthropic-version'], '2023-06-01');
});

test('admin and malformed keys are refused without a request', async () => {
  const fetchImpl = fakeFetch(200);
  await assert.rejects(() => validateAnthropicKey(ADMIN_KEY, { fetchImpl }), (e) => e.code === 'KEY_ADMIN');
  await assert.rejects(() => validateAnthropicKey('not-a-key', { fetchImpl }), (e) => e.code === 'KEY_INVALID');
  assert.equal(fetchImpl.calls.length, 0);
});

test('SDK-style statuses map to typed errors', async () => {
  for (const [status, code] of [[401, 'AUTH_REJECTED'], [403, 'AUTH_REJECTED'], [429, 'RATE_LIMITED'], [529, 'OVERLOADED'], [500, 'OVERLOADED']]) {
    await assert.rejects(() => validateAnthropicKey(API_KEY, { fetchImpl: fakeFetch(status) }), (e) => e.code === code, String(status));
  }
});

test('a blocked fetch maps to offline or CORS using the online hint', async () => {
  const failing = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(() => validateAnthropicKey(API_KEY, { fetchImpl: failing, online: false }), (e) => e.code === 'NETWORK_OFFLINE');
  await assert.rejects(() => validateAnthropicKey(API_KEY, { fetchImpl: failing, online: true }), (e) => e.code === 'CORS_BLOCKED');
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test --workspace=client -- --test-name-pattern="logs are|ring keeps|working key|admin and malformed"`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement activity and key validation**

Create `client/src/web/activity.js`:

```js
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
```

Create `client/src/web/validateKey.js`:

```js
// Zero-knowledge key check: one GET from the browser to Anthropic's own API.
// The key appears only in the x-api-key header; nothing is sent to our origin.
import { AppError, ERROR_CODES, toUserError } from '@sajas/core/errors';
import { normalizeKeyInput, isAnthropicKeyShape, isAdminKeyShape } from '@sajas/core/secrets';

export const MODELS_PROBE_URL = 'https://api.anthropic.com/v1/models?limit=1';

export async function validateAnthropicKey(raw, { fetchImpl = globalThis.fetch, online } = {}) {
  const key = normalizeKeyInput(raw);
  if (isAdminKeyShape(key)) {
    throw new AppError(ERROR_CODES.KEY_ADMIN, 'That is an Anthropic Admin key. Create a standard API key in the Console and use that instead.');
  }
  if (!isAnthropicKeyShape(key)) {
    throw new AppError(ERROR_CODES.KEY_INVALID, 'That does not look like an Anthropic API key. It should start with sk-ant-api.');
  }

  let res;
  try {
    res = await fetchImpl(MODELS_PROBE_URL, {
      method: 'GET',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      }
    });
  } catch (err) {
    const payload = toUserError(err, { crossOrigin: true, online });
    throw new AppError(payload.code, payload.message, {
      hint: payload.hint,
      retryable: payload.retryable,
      details: payload.details
    });
  }

  if (res.ok) return true;
  if (res.status === 429) {
    throw new AppError(ERROR_CODES.RATE_LIMITED, 'Anthropic is rate-limiting this key right now.');
  }
  if (res.status >= 500) {
    throw new AppError(ERROR_CODES.OVERLOADED, 'Anthropic is temporarily unavailable. Try again in a moment.');
  }
  throw new AppError(ERROR_CODES.AUTH_REJECTED, 'Anthropic rejected this key. Check that it is a standard API key, not an admin key.');
}
```

- [ ] **Step 4: Write the failing API and install tests**

Create `client/src/web/api.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createVault, STORES } from './vault.js';
import { createMemoryAdapter } from './memoryAdapter.js';
import { createKeyStore } from './keyStore.js';
import { createActivity } from './activity.js';
import { createWebApi } from './api.js';

const API_BASE = 'http://localhost:5000/api';
const API_KEY = ['sk', 'ant', 'api', '03', '-', 'G'.repeat(24)].join('');
const ADMIN_KEY = ['sk', 'ant', 'admin', '01', '-', 'H'.repeat(24)].join('');

function harness(seed) {
  const vault = createVault(createMemoryAdapter(seed));
  const keyStore = createKeyStore({ vault });
  const activity = createActivity();
  const api = createWebApi({ apiBase: API_BASE, vault, keyStore, activity });
  const call = (path, init = {}) => {
    const body = init.body === undefined ? undefined : JSON.stringify(init.body);
    return api.handle(`${API_BASE}${path}`, { ...init, body });
  };
  return { vault, keyStore, activity, call };
}

async function json(res) {
  return res.json();
}

test('models are the public registry, without key material', async () => {
  const { call } = harness();
  const res = await call('/models');
  assert.equal(res.status, 200);
  const list = await json(res);
  assert.ok(list.length >= 4);
  for (const model of list) {
    assert.deepEqual(Object.keys(model).sort(), ['id', 'inputPerMTok', 'label', 'optIn', 'outputPerMTok', 'tier'].sort());
  }
});

test('profile starts empty, stores only non-secret fields, and reports hasAnthropicKey', async () => {
  const { call, keyStore, vault } = harness();
  let profile = await json(await call('/profile'));
  assert.equal(profile.hasAnthropicKey, false);
  assert.equal(Object.hasOwn(profile, 'anthropicApiKey'), false);

  const saved = await call('/profile', {
    method: 'POST',
    body: { fullName: 'Thandi Mokoena', anthropicApiKey: API_KEY, keywords: 'developer' }
  });
  assert.equal(saved.status, 200);
  assert.equal((await json(saved)).success, true);
  assert.equal(keyStore.getKey(), API_KEY);

  profile = await json(await call('/profile'));
  assert.equal(profile.fullName, 'Thandi Mokoena');
  assert.equal(profile.hasAnthropicKey, true);
  assert.equal(Object.hasOwn(profile, 'anthropicApiKey'), false);
  assert.equal(JSON.stringify(await vault.get(STORES.profile, 'current')).includes(API_KEY), false);
});

test('an admin or malformed key is rejected and not stored', async () => {
  const { call, keyStore } = harness();
  for (const [value, code] of [[ADMIN_KEY, 'KEY_ADMIN'], ['sk-nope', 'KEY_INVALID']]) {
    const res = await call('/profile', { method: 'POST', body: { anthropicApiKey: value } });
    assert.equal(res.status, 400);
    const body = await json(res);
    assert.equal(body.code, code);
    assert.equal(body.error, body.message);
  }
  assert.equal(keyStore.hasKey(), false);
});

test('DELETE /profile/key/anthropic forgets the key and any saved blob', async () => {
  const { call, keyStore } = harness();
  await call('/profile', { method: 'POST', body: { anthropicApiKey: API_KEY } });
  await keyStore.remember('a long passphrase');
  const res = await call('/profile/key/anthropic', { method: 'DELETE' });
  assert.equal(res.status, 200);
  assert.equal(keyStore.hasKey(), false);
  assert.equal(await keyStore.hasSavedKey(), false);
  assert.equal((await json(await call('/profile'))).hasAnthropicKey, false);
});

test('usage has the server shape, a live budget cap, and can be cleared', async () => {
  const { call } = harness({ profile: { current: { dailyBudgetUSD: 5 } } });
  const usage = await json(await call('/usage'));
  assert.equal(usage.today.calls, 0);
  assert.equal(usage.today.estCostUSD, 0);
  assert.deepEqual(usage.history, []);
  assert.equal(usage.budget.capUSD, 5);
  assert.equal(usage.budget.exceeded, false);
  assert.equal((await call('/usage', { method: 'DELETE' })).status, 200);
});

test('logs read and clear the in-memory activity ring', async () => {
  const { call, activity } = harness();
  activity.add('Profile settings saved.', 'system');
  assert.equal((await json(await call('/logs'))).length, 1);
  assert.equal((await call('/logs/clear', { method: 'POST' })).status, 200);
  assert.deepEqual(await json(await call('/logs')), []);
});

test('documents is empty and server-only endpoints answer NOT_SUPPORTED_IN_WEB', async () => {
  const { call } = harness();
  assert.deepEqual(await json(await call('/documents')), []);
  for (const [path, method] of [
    ['/jobs/hunter', 'POST'],
    ['/jobs/revalidate', 'POST'],
    ['/jobs/tailor-batch', 'POST'],
    ['/application/bank', 'GET'],
    ['/backup', 'GET'],
    ['/routines', 'GET'],
    ['/hunter/sources', 'GET'],
    ['/browser/setup', 'POST'],
    ['/memory/dream', 'POST']
  ]) {
    const res = await call(path, { method });
    assert.equal(res.status, 501, `${method} ${path}`);
    assert.equal((await json(res)).code, 'NOT_SUPPORTED_IN_WEB');
  }
});

test('an unknown endpoint is a NOT_FOUND contract', async () => {
  const { call } = harness();
  const res = await call('/nothing-here');
  assert.equal(res.status, 404);
  const body = await json(res);
  assert.equal(body.code, 'NOT_FOUND');
  assert.equal(body.error, body.message);
  assert.ok(body.requestId);
});

test('jobs can be added, updated, listed and deleted locally', async () => {
  const { call } = harness();
  let res = await call('/jobs', { method: 'POST', body: { title: '' } });
  assert.equal(res.status, 400);
  assert.equal((await json(res)).code, 'VALIDATION');

  res = await call('/jobs', { method: 'POST', body: { title: 'Junior Developer', company: 'Example Studio', applyUrl: 'https://example.com/jobs/1' } });
  assert.equal(res.status, 200);
  const added = (await json(res)).job;
  assert.equal(added.status, 'found');
  assert.equal(added.matchScore, 75);

  res = await call('/jobs', { method: 'POST', body: { title: 'junior developer', company: 'example studio' } });
  assert.equal(res.status, 409);
  assert.equal((await json(res)).code, 'CONFLICT');

  res = await call(`/jobs/${added.id}`, { method: 'PATCH', body: { status: 'applied' } });
  assert.equal((await json(res)).job.status, 'applied');

  assert.equal((await json(await call('/jobs'))).length, 1);
  await call(`/jobs/${added.id}`, { method: 'DELETE' });
  assert.deepEqual(await json(await call('/jobs')), []);
});

test('candidate memory CRUD is local and typed', async () => {
  const { call } = harness();
  let res = await call('/memory/insight', { method: 'POST', body: { text: '' } });
  assert.equal(res.status, 400);
  res = await call('/memory/insight', { method: 'POST', body: { text: 'Prefers remote roles', category: 'preference' } });
  assert.equal(res.status, 200);
  const entry = (await json(res)).entry;
  res = await call('/memory/insight', { method: 'POST', body: { text: 'Prefers remote roles' } });
  assert.equal(res.status, 409);

  res = await call('/memory/employer', { method: 'POST', body: { company: 'Example Studio', note: 'Uses a take-home' } });
  assert.equal(res.status, 200);

  const job = await json(await call('/jobs', { method: 'POST', body: { title: 'Developer', company: 'Example Studio' } }));
  res = await call(`/memory/application/${job.job.id}`, { method: 'PATCH', body: { outcome: 'interview' } });
  assert.equal(res.status, 200);

  const memory = await json(await call('/memory'));
  assert.equal(memory.insights.length, 1);
  assert.equal(memory.employers.length, 1);
  assert.equal(memory.applications[0].outcome, 'interview');

  await call(`/memory/insight/${entry.id}`, { method: 'DELETE' });
  assert.equal((await json(await call('/memory'))).insights.length, 0);
  await call('/memory', { method: 'DELETE' });
  assert.equal((await json(await call('/memory'))).insights.length, 0);
  assert.equal((await json(await call('/memory'))).employers.length, 0);
});

test('a storage quota failure becomes STORAGE_FULL, not UNKNOWN', async () => {
  const vault = { get: async () => undefined, put: async () => { throw new DOMException('full', 'QuotaExceededError'); }, delete: async () => {}, getAll: async () => [], clear: async () => {}, wipe: async () => {} };
  const keyStore = createKeyStore({ vault });
  const api = createWebApi({ apiBase: API_BASE, vault, keyStore, activity: createActivity() });
  const res = await api.handle(`${API_BASE}/profile`, { method: 'POST', body: JSON.stringify({ fullName: 'Thandi' }) });
  assert.equal(res.status, 507);
  const body = await res.json();
  assert.equal(body.code, 'STORAGE_FULL');
  assert.ok(body.hint);
});
```

Create `client/src/web/install.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { installWebApi } from './install.js';

const API_BASE = 'http://localhost:5000/api';

test('API calls go to the web handler', async () => {
  const calls = [];
  const fetchImpl = installWebApi({
    apiBase: API_BASE,
    handler: async (input, init) => { calls.push({ input, init }); return new Response('{}'); },
    nativeFetch: async () => { throw new Error('native fetch must not run'); }
  });
  const res = await fetchImpl(`${API_BASE}/profile`, { method: 'GET' });
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
});

test('non-API calls pass through to the native fetch', async () => {
  const seen = [];
  const fetchImpl = installWebApi({
    apiBase: API_BASE,
    handler: async () => { throw new Error('handler must not run'); },
    nativeFetch: async (input, init) => { seen.push({ input, init }); return new Response('ok'); }
  });
  await fetchImpl('https://api.anthropic.com/v1/models', { method: 'GET' });
  assert.equal(seen.length, 1);
});

test('Request and URL inputs resolve their URLs', async () => {
  const seen = [];
  const fetchImpl = installWebApi({
    apiBase: API_BASE,
    handler: async () => new Response('{}'),
    nativeFetch: async (input) => { seen.push(input); return new Response('ok'); }
  });
  await fetchImpl(new Request(`${API_BASE}/jobs`));
  await fetchImpl(new URL('https://example.com/feed'));
  assert.equal(seen.length, 1);
  assert.ok(String(seen[0]).includes('example.com'));
});
```

- [ ] **Step 5: Run them to verify they fail**

Run: `npm test --workspace=client -- --test-name-pattern="models are|profile starts|NOT_SUPPORTED|storage quota|API calls go|non-API"`
Expected: FAIL — `api.js` / `install.js` missing.

- [ ] **Step 6: Implement the web API**

Create `client/src/web/api.js` (complete file):

```js
// The server-less `/api/*` port. It answers the subset the desktop UI uses,
// backed by the vault, and returns the same error contract as the Express
// server so the client needs no second error path.
import { AppError, ERROR_CODES, statusForCode, toUserError } from '@sajas/core/errors';
import { MODELS } from '@sajas/core/models';
import { STORES } from './vault.js';
import { limit } from './limits.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const MAX_TEXT = 20000;

function ok(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function fail(res, err) {
  const payload = toUserError(err);
  const body = { error: payload.message, ...payload };
  return new Response(JSON.stringify(body), { status: statusForCode(payload.code), headers: JSON_HEADERS });
}

function notSupported() {
  return fail(null, new AppError(ERROR_CODES.NOT_SUPPORTED_IN_WEB, undefined));
}

function notFound(message = 'No such endpoint.') {
  return fail(null, new AppError(ERROR_CODES.NOT_FOUND, message));
}

function publicModels() {
  return Object.values(MODELS).map(({ id, label, tier, inputPerMTok, outputPerMTok, optIn }) => ({
    id, label, tier, inputPerMTok, outputPerMTok, optIn: Boolean(optIn)
  }));
}

function emptyMemory() {
  return { version: 1, updatedAt: new Date().toISOString(), insights: [], employers: [], applications: [], lastDream: null };
}

function emptyUsage(profile = {}) {
  const cap = Number(profile.dailyBudgetUSD) || 0;
  return {
    today: {
      date: new Date().toISOString().slice(0, 10),
      calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
      webSearches: 0, estCostUSD: 0, byBucket: {}, byTask: {}
    },
    history: [],
    last7CostUSD: 0,
    budget: { capUSD: cap, spentUSD: 0, exceeded: false }
  };
}

export function createWebApi({ apiBase, vault, keyStore, activity, now = () => new Date() }) {
  const basePath = new URL(apiBase).pathname.replace(/\/$/, '');

  function pathOf(input) {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
    const url = new URL(raw);
    const path = url.pathname.startsWith(basePath) ? url.pathname.slice(basePath.length) : url.pathname;
    return path || '/';
  }

  async function bodyOf(input, init) {
    const raw = init?.body ?? (typeof input === 'object' && input?.clone ? await input.clone().text() : undefined);
    if (raw == null || raw === '') return {};
    if (typeof raw !== 'string') return raw;
    try { return JSON.parse(raw); } catch { throw new AppError(ERROR_CODES.VALIDATION, 'That request was not valid JSON.'); }
  }

  async function getProfile() {
    const stored = await vault.get(STORES.profile, 'current', {});
    const { anthropicApiKey, hasAnthropicKey, ...rest } = stored;
    return { ...rest, hasAnthropicKey: keyStore.hasKey() };
  }

  async function saveProfile(input, init) {
    const incoming = await bodyOf(input, init);
    if (incoming.anthropicApiKey && String(incoming.anthropicApiKey).trim()) {
      keyStore.setKey(incoming.anthropicApiKey);
    }
    const current = await vault.get(STORES.profile, 'current', {});
    const { anthropicApiKey, hasAnthropicKey, ...rest } = incoming;
    const next = { ...current, ...rest };
    delete next.anthropicApiKey;
    delete next.hasAnthropicKey;
    await vault.put(STORES.profile, 'current', next);
    activity.add('Profile settings saved.', 'system');
    return ok({ success: true, profile: { ...next, hasAnthropicKey: keyStore.hasKey() } });
  }

  async function clearKey(_input, _init, provider) {
    if (provider !== 'anthropic') return notFound('Unknown provider');
    await keyStore.forget();
    activity.add('Anthropic API key cleared.', 'system');
    return ok({ success: true });
  }

  async function addJob(input, init) {
    const { title, company, location, description, applyUrl, source } = await bodyOf(input, init);
    if (!String(title || '').trim() || !String(company || '').trim()) {
      throw new AppError(ERROR_CODES.VALIDATION, 'Title and company are required.');
    }
    const jobs = await vault.getAll(STORES.jobs);
    const same = jobs.find((job) => String(job.title).trim().toLowerCase() === String(title).trim().toLowerCase()
      && String(job.company).trim().toLowerCase() === String(company).trim().toLowerCase());
    if (same) {
      throw new AppError(ERROR_CODES.CONFLICT, 'A similar job already exists.', {
        retryable: false,
        hint: 'Find the existing job in your tracker instead of adding it again.'
      });
    }
    const job = {
      id: crypto.randomUUID(),
      title: limit(title, 300),
      company: limit(company, 200),
      location: limit(location || 'South Africa', 200),
      description: limit(description, MAX_TEXT),
      applyUrl: limit(applyUrl, 2000),
      datePosted: now().toISOString().slice(0, 10),
      matchScore: 75,
      status: 'found',
      source: limit(source || 'Manual', 80),
      tailoredCvText: '',
      tailoredCoverLetterText: '',
      dateAdded: now().toISOString().slice(0, 10)
    };
    await vault.put(STORES.jobs, job.id, job);
    activity.add(`Manual job added: ${job.title} at ${job.company}`, 'system');
    return ok({ success: true, job });
  }

  async function updateJob(input, init, id) {
    const current = await vault.get(STORES.jobs, id);
    if (!current) throw new AppError(ERROR_CODES.NOT_FOUND, 'Job not found.');
    const patch = await bodyOf(input, init);
    const next = { ...current, ...patch, id: current.id };
    await vault.put(STORES.jobs, id, next);
    return ok({ success: true, job: next });
  }

  async function getMemory() {
    return (await vault.get(STORES.memory, 'dossier')) || emptyMemory();
  }

  async function addInsight(input, init) {
    const { text, category } = await bodyOf(input, init);
    const clean = limit(String(text || '').trim(), 1000);
    if (!clean) throw new AppError(ERROR_CODES.VALIDATION, 'Insight text is required.');
    const memory = await getMemory();
    if (memory.insights.some((entry) => entry.text.toLowerCase() === clean.toLowerCase())) {
      throw new AppError(ERROR_CODES.CONFLICT, 'That insight already exists.', {
        retryable: false,
        hint: 'Open the existing insight instead of adding it again.'
      });
    }
    const entry = {
      id: crypto.randomUUID(),
      text: clean,
      category: limit(category || 'other', 40),
      source: 'manual',
      createdAt: now().toISOString()
    };
    memory.insights.push(entry);
    memory.updatedAt = now().toISOString();
    await vault.put(STORES.memory, 'dossier', memory);
    return ok({ success: true, entry });
  }

  async function deleteInsight(_input, _init, id) {
    const memory = await getMemory();
    memory.insights = memory.insights.filter((entry) => entry.id !== id);
    memory.updatedAt = now().toISOString();
    await vault.put(STORES.memory, 'dossier', memory);
    return ok({ success: true });
  }

  async function upsertEmployer(input, init) {
    const { company, note } = await bodyOf(input, init);
    const clean = limit(String(company || '').trim(), 200);
    if (!clean) throw new AppError(ERROR_CODES.VALIDATION, 'Company is required.');
    const memory = await getMemory();
    const existing = memory.employers.find((entry) => entry.company.toLowerCase() === clean.toLowerCase());
    const record = existing || { company: clean, createdAt: now().toISOString() };
    record.note = limit(note, 5000);
    record.updatedAt = now().toISOString();
    if (!existing) memory.employers.push(record);
    memory.updatedAt = now().toISOString();
    await vault.put(STORES.memory, 'dossier', memory);
    return ok({ success: true, entry: record });
  }

  async function updateOutcome(input, init, jobId) {
    const { outcome } = await bodyOf(input, init);
    if (!String(outcome || '').trim()) throw new AppError(ERROR_CODES.VALIDATION, 'An outcome is required.');
    const job = await vault.get(STORES.jobs, jobId);
    if (!job) throw new AppError(ERROR_CODES.NOT_FOUND, 'Job not found.');
    const memory = await getMemory();
    const existing = memory.applications.find((entry) => entry.jobId === jobId);
    const record = existing || { jobId, title: job.title, company: job.company, createdAt: now().toISOString() };
    record.outcome = limit(outcome, 60);
    record.updatedAt = now().toISOString();
    if (!existing) memory.applications.push(record);
    memory.updatedAt = now().toISOString();
    await vault.put(STORES.memory, 'dossier', memory);
    return ok({ success: true, entry: record });
  }

  async function clearMemory() {
    const memory = emptyMemory();
    await vault.put(STORES.memory, 'dossier', memory);
    return ok({ success: true, memory });
  }

  async function getJobs() {
    const jobs = await vault.getAll(STORES.jobs);
    jobs.sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0));
    return ok(jobs);
  }

  async function handle(input, init = {}) {
    const path = pathOf(input);
    const method = String(init.method || (typeof input === 'object' && input?.method) || 'GET').toUpperCase();
    try {
      let match;
      if ((match = path.match(/^\/profile\/key\/([^/]+)$/)) && method === 'DELETE') return await clearKey(input, init, match[1]);
      if (path === '/profile' && method === 'GET') return ok(await getProfile());
      if (path === '/profile' && method === 'POST') return await saveProfile(input, init);
      if (path === '/models' && method === 'GET') return ok(publicModels());
      if (path === '/status' && method === 'GET') {
        return ok({ hunter: { isRunning: false, lastResult: null }, apply: {}, routines: [], uptime: 0 });
      }
      if (path === '/logs' && method === 'GET') return ok(activity.list());
      if (path === '/logs/clear' && method === 'POST') { activity.clear(); return ok({ success: true }); }
      if (path === '/usage' && method === 'GET') {
        return ok(emptyUsage(await vault.get(STORES.profile, 'current', {})));
      }
      if (path === '/usage' && method === 'DELETE') return ok({ success: true });
      if (path === '/documents' && method === 'GET') return ok([]);
      if (path === '/jobs' && method === 'GET') return await getJobs();
      if (path === '/jobs' && method === 'POST') return await addJob(input, init);
      if (path === '/jobs' && method === 'DELETE') {
        await vault.clear(STORES.jobs);
        activity.add('All jobs cleared by user.', 'system');
        return ok({ success: true });
      }
      if ((match = path.match(/^\/jobs\/([^/]+)$/))) {
        if (method === 'PATCH') return await updateJob(input, init, match[1]);
        if (method === 'DELETE') { await vault.delete(STORES.jobs, match[1]); return ok({ success: true }); }
      }
      if (path === '/memory' && method === 'GET') return ok(await getMemory());
      if (path === '/memory' && method === 'DELETE') return await clearMemory();
      if (path === '/memory/insight' && method === 'POST') return await addInsight(input, init);
      if ((match = path.match(/^\/memory\/insight\/([^/]+)$/)) && method === 'DELETE') return await deleteInsight(input, init, match[1]);
      if (path === '/memory/employer' && method === 'POST') return await upsertEmployer(input, init);
      if ((match = path.match(/^\/memory\/application\/([^/]+)$/)) && method === 'PATCH') return await updateOutcome(input, init, match[1]);

      const knownServer = [
        '/jobs/hunter', '/jobs/hunter/stop', '/jobs/revalidate', '/jobs/tailor-batch',
        '/application/bank', '/application/pending', '/backup', '/backup/restore',
        '/routines', '/hunter/sources', '/hunter/sources/test',
        '/browser/setup', '/browser/login-status', '/memory/dream', '/profile/preset'
      ];
      if (knownServer.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) return notSupported();
      return notFound();
    } catch (err) {
      return fail(null, err);
    }
  }

  return { handle };
}
```

> The `fail(null, err)` signature is intentional: `toUserError(null)` has nothing to map, so always pass the actual error. If a future helper omits it, the contract falls back to UNKNOWN rather than throwing.

Create `client/src/web/install.js`:

```js
// Install the web API ahead of every fetch the UI makes. Only API_BASE calls are
// intercepted; everything else (including Anthropic) keeps the native fetch.
export function installWebApi({ apiBase, handler, nativeFetch = globalThis.fetch }) {
  return (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
    if (typeof url !== 'string' || !url.startsWith(apiBase)) return nativeFetch(input, init);
    return handler(input, init);
  };
}
```

Create `client/src/web/runtime.js`:

```js
import { IS_WEB } from './env.js';
import { createIdbAdapter } from './idbAdapter.js';
import { createVault } from './vault.js';
import { createKeyStore } from './keyStore.js';
import { createActivity } from './activity.js';
import { createWebApi } from './api.js';

export const WEB_API_BASE = import.meta.env.VITE_SAJAS_API_BASE || 'http://localhost:5000/api';

function build() {
  const vault = createVault(createIdbAdapter());
  const keyStore = createKeyStore({ vault });
  const activity = createActivity();
  const api = createWebApi({ apiBase: WEB_API_BASE, vault, keyStore, activity });
  return { vault, keyStore, activity, api };
}

export const webRuntime = IS_WEB ? build() : null;
```

- [ ] **Step 7: Run the API tests**

Run: `npm test --workspace=client -- --test-name-pattern="models|profile|NOT_SUPPORTED|storage quota|API calls|non-API|jobs|candidate memory|unknown endpoint|usage|logs|documents"`
Expected: PASS.

- [ ] **Step 8: Wire the runtime into the browser entry point**

In `client/src/main.jsx`, replace the fetch block with:

```jsx
import { IS_WEB } from './web/env.js';
import { webRuntime, WEB_API_BASE } from './web/runtime.js';
import { installWebApi } from './web/install.js';

const API_BASE = import.meta.env.VITE_SAJAS_API_BASE || 'http://localhost:5000/api';

if (IS_WEB) {
  window.fetch = installWebApi({
    apiBase: API_BASE,
    handler: webRuntime.api.handle,
    nativeFetch: window.fetch.bind(window)
  });
} else {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
    if (typeof url !== 'string' || !url.startsWith(API_BASE)) return nativeFetch(input, init);
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    headers.set('X-SAJAS-Client', '1');
    return nativeFetch(input, { ...init, headers });
  };
}
```

`WEB_API_BASE` must equal `API_BASE`; both read `VITE_SAJAS_API_BASE`. Do not remove the import.

- [ ] **Step 9: Build and run all client tests**

Run:

```bash
npm test --workspace=client
npm run build:web
npm run build:client
```

Expected: all pass; both builds exit 0.

- [ ] **Step 10: Commit**

```bash
git add client/src/web/activity.js client/src/web/activity.test.js client/src/web/validateKey.js client/src/web/validateKey.test.js client/src/web/api.js client/src/web/api.test.js client/src/web/install.js client/src/web/install.test.js client/src/web/runtime.js client/src/main.jsx
git commit -m "feat(web): serve the UI from an IndexedDB-backed API port" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Onboarding, unlock, and web key settings

**Files:**
- Create: `sa-job-agent-suite/client/src/web/WebStartup.jsx`
- Create: `sa-job-agent-suite/client/src/web/WebKeyPanel.jsx`
- Modify: `sa-job-agent-suite/client/src/App.jsx`
- Modify: `sa-job-agent-suite/client/src/index.css` (only if a class is missing; reuse existing classes)

**Interfaces:**
- Consumes: `webRuntime`, `IS_WEB`, `validateAnthropicKey`, `recordError`, `ErrorCard`, `copyToClipboard` is not needed here.
- Produces: first-run onboarding (`data-testid="onboarding"`), unlock screen, skip path; `WebKeyPanel` with remember/forget/panic-wipe/idle controls. Adds `data-testid` hooks used by Task 6: `key-input`, `key-submit`, `key-skip`, `unlock-input`, `unlock-submit`, `passphrase-input`, `passphrase-confirm`, `remember-submit`, `forget-key`, `forget-confirm`, `panic-wipe`, `panic-confirm`.

- [ ] **Step 1: Implement the startup gate**

Create `client/src/web/WebStartup.jsx`:

```jsx
import React, { useEffect, useState } from 'react';
import { KeyRound, Loader2, ShieldCheck, ExternalLink } from 'lucide-react';
import ErrorCard from '../ErrorCard.jsx';
import { recordError } from '../errors.js';
import { validateAnthropicKey } from './validateKey.js';
import { MIN_PASSPHRASE } from './keyStore.js';

const CONSOLE_URL = 'https://console.anthropic.com/settings/keys';

export default function WebStartup({ runtime, onReady }) {
  const [phase, setPhase] = useState('checking'); // checking | enter | unlock | blocked
  const [blockError, setBlockError] = useState(null);
  const [key, setKey] = useState('');
  const [remember, setRemember] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [unlockPass, setUnlockPass] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (await runtime.keyStore.hasSavedKey()) {
          if (alive) setPhase('unlock');
          return;
        }
        const meta = await runtime.vault.get('meta', 'app', {});
        if (alive) setPhase(meta.onboarded ? 'ready' : 'enter');
      } catch (err) {
        if (!alive) return;
        setBlockError(recordError(err, { where: 'open the local vault' }));
        setPhase('blocked');
      }
    })();
    return () => { alive = false; };
  }, [runtime]);

  useEffect(() => {
    if (phase === 'ready') onReady();
  }, [phase, onReady]);

  const finish = async () => {
    const meta = await runtime.vault.get('meta', 'app', {});
    await runtime.vault.put('meta', 'app', { ...meta, onboarded: true });
    onReady();
  };

  const useKey = async (event) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await validateAnthropicKey(key);
      runtime.keyStore.setKey(key);
      if (remember) {
        if (passphrase.length < MIN_PASSPHRASE) {
          throw new Error(`Use a passphrase of at least ${MIN_PASSPHRASE} characters.`);
        }
        if (passphrase !== confirm) throw new Error('The passphrases do not match.');
        await runtime.keyStore.remember(passphrase);
      }
      await finish();
    } catch (err) {
      runtime.keyStore.clearMemory();
      setError(recordError(err, { where: 'add your key' }));
    } finally {
      setBusy(false);
    }
  };

  const unlock = async (event) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await runtime.keyStore.unlock(unlockPass);
      await finish();
    } catch (err) {
      setError(recordError(err, { where: 'unlock your key' }));
    } finally {
      setBusy(false);
    }
  };

  const resetSaved = async () => {
    await runtime.keyStore.forget();
    setPhase('enter');
  };

  return (
    <div className="app-bg" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div className="glass-panel fade-in" style={{ width: '100%', maxWidth: 560, padding: 28 }} data-testid="onboarding">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <ShieldCheck size={22} color="var(--color-info)" />
          <h2 style={{ fontSize: 20 }}>SA-JAS for the web</h2>
        </div>
        <p className="muted" style={{ fontSize: 13, marginBottom: 18 }}>
          Your profile, jobs and documents stay in this browser. Your key is sent only to Anthropic.
          There are no accounts and no server-side copy.
        </p>

        {phase === 'checking' && (
          <p className="hint" data-testid="startup-checking"><Loader2 size={14} className="spin" /> Opening your local vault…</p>
        )}

        {phase === 'blocked' && (
          <>
            <ErrorCard title="This browser blocked local storage" error={blockError} />
            <button type="button" className="btn-ghost btn-sm" onClick={onReady}>Continue without saving</button>
          </>
        )}

        {phase === 'enter' && (
          <form onSubmit={useKey} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label htmlFor="web-key">Anthropic API key</label>
            <input
              id="web-key"
              data-testid="key-input"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="sk-ant-api…"
            />
            <span className="hint">
              Create a key in a Workspace with a spend limit. Admin keys are refused.{" "}
              <a href={CONSOLE_URL} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-info)' }}>
                Open the Console <ExternalLink size={11} />
              </a>
            </span>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} data-testid="remember-toggle" />
              <span>Remember this key on this device (encrypted)</span>
            </label>

            {remember && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input
                  type="password"
                  data-testid="passphrase-input"
                  placeholder="Passphrase (at least 10 characters)"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  autoComplete="new-password"
                />
                <input
                  type="password"
                  data-testid="passphrase-confirm"
                  placeholder="Confirm passphrase"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                />
                <span className="hint">If you lose this passphrase, the saved key cannot be recovered.</span>
              </div>
            )}

            {error && <ErrorCard title="Could not use that key" error={error} />}

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button type="submit" className="btn-primary" data-testid="key-submit" disabled={busy || !key.trim()}>
                {busy ? <Loader2 size={14} className="spin" /> : <KeyRound size={14} />} Check and continue
              </button>
              <button type="button" className="btn-ghost" onClick={finish} data-testid="key-skip" disabled={busy}>
                Explore without a key
              </button>
            </div>
          </form>
        )}

        {phase === 'unlock' && (
          <form onSubmit={unlock} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p className="hint">A saved key was found on this device. Enter its passphrase to unlock it.</p>
            <input
              type="password"
              data-testid="unlock-input"
              placeholder="Passphrase"
              value={unlockPass}
              onChange={(e) => setUnlockPass(e.target.value)}
              autoComplete="current-password"
            />
            {error && <ErrorCard title="Could not unlock the saved key" error={error} />}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button type="submit" className="btn-primary" data-testid="unlock-submit" disabled={busy || !unlockPass}>
                {busy ? <Loader2 size={14} className="spin" /> : <KeyRound size={14} />} Unlock
              </button>
              <button type="button" className="btn-ghost" onClick={resetSaved} data-testid="forget-saved">
                Use a different key
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Implement the settings key panel**

Create `client/src/web/WebKeyPanel.jsx`:

```jsx
import React, { useCallback, useEffect, useState } from 'react';
import { KeyRound, Loader2, ShieldOff, ShieldCheck, ExternalLink } from 'lucide-react';
import ErrorCard from '../ErrorCard.jsx';
import { recordError } from '../errors.js';
import { IDLE_OPTIONS, MIN_PASSPHRASE } from './keyStore.js';

const CONSOLE_URL = 'https://console.anthropic.com/settings/keys';

export default function WebKeyPanel({ runtime, refreshSignal = 0, onChanged }) {
  const [status, setStatus] = useState({ loaded: false, saved: false });
  const [idle, setIdle] = useState(30);
  const [rememberOpen, setRememberOpen] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [step, setStep] = useState(null); // null | 'forget' | 'wipe'
  const [wipeText, setWipeText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setStatus({ loaded: runtime.keyStore.hasKey(), saved: await runtime.keyStore.hasSavedKey() });
    setIdle(runtime.keyStore.getIdleMinutes());
  }, [runtime]);

  useEffect(() => {
    refresh().catch((err) => setError(recordError(err, { where: 'load key status' })));
  }, [refresh, refreshSignal]);

  const changeIdle = async (value) => {
    try {
      await runtime.keyStore.saveIdleMinutes(Number(value));
      setIdle(Number(value));
      onChanged?.();
    } catch (err) {
      setError(recordError(err, { where: 'change idle timeout' }));
    }
  };

  const remember = async (event) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (passphrase.length < MIN_PASSPHRASE) throw new Error(`Use a passphrase of at least ${MIN_PASSPHRASE} characters.`);
      if (passphrase !== confirm) throw new Error('The passphrases do not match.');
      await runtime.keyStore.remember(passphrase);
      setPassphrase('');
      setConfirm('');
      setRememberOpen(false);
      await refresh();
      onChanged?.();
    } catch (err) {
      setError(recordError(err, { where: 'remember the key' }));
    } finally {
      setBusy(false);
    }
  };

  const forget = async () => {
    setBusy(true);
    try {
      await runtime.keyStore.forget();
      setStep(null);
      await refresh();
      onChanged?.();
    } catch (err) {
      setError(recordError(err, { where: 'forget the key' }));
    } finally {
      setBusy(false);
    }
  };

  const wipe = async () => {
    setBusy(true);
    try {
      await runtime.keyStore.panicWipe();
      window.location.reload();
    } catch (err) {
      setError(recordError(err, { where: 'panic wipe' }));
      setBusy(false);
    }
  };

  const description = status.loaded
    ? status.saved
      ? 'Loaded in this tab and saved encrypted on this device.'
      : 'Loaded in this tab only. Forget it when you are done.'
    : 'No key loaded. AI features stay off until you add one.';

  return (
    <div style={{ marginTop: 18, padding: 14, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-surface-2)' }} data-testid="key-panel">
      <div className="flex-between" style={{ gap: 10, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
          <ShieldCheck size={15} /> Key security
        </span>
        <span className={`badge ${status.loaded ? 'badge-success' : 'badge-error'}`} data-testid="key-status">
          {status.loaded ? (status.saved ? 'Saved encrypted' : 'In this tab') : 'Not loaded'}
        </span>
      </div>
      <p className="hint" style={{ marginTop: 6 }}>{description}</p>

      <div className="grid-2" style={{ marginTop: 10 }}>
        <div>
          <label>Forget the key after</label>
          <select value={idle} onChange={(e) => changeIdle(e.target.value)} data-testid="idle-select">
            {IDLE_OPTIONS.map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes idle</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
          {status.loaded && !status.saved && (
            <button type="button" className="btn-secondary btn-sm" onClick={() => setRememberOpen((v) => !v)} data-testid="remember-open">
              <KeyRound size={12} /> Remember encrypted
            </button>
          )}
          <button type="button" className="btn-danger btn-sm" onClick={() => setStep('forget')} disabled={!status.loaded && !status.saved} data-testid="forget-key">
            <ShieldOff size={12} /> Forget key
          </button>
        </div>
      </div>

      {rememberOpen && (
        <form onSubmit={remember} style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
          <input type="password" placeholder="Passphrase" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} data-testid="remember-passphrase" autoComplete="new-password" />
          <input type="password" placeholder="Confirm passphrase" value={confirm} onChange={(e) => setConfirm(e.target.value)} data-testid="remember-confirm" autoComplete="new-password" />
          <span className="hint">Losing the passphrase makes the saved key unrecoverable. The key is still in this tab until you forget it.</span>
          <button type="submit" className="btn-primary btn-sm" disabled={busy} data-testid="remember-submit">
            {busy ? <Loader2 size={12} className="spin" /> : null} Save encrypted
          </button>
        </form>
      )}

      {step === 'forget' && (
        <div style={{ marginTop: 12, padding: 12, border: '1px solid var(--border)', borderRadius: 8 }}>
          <p style={{ fontSize: 12.5 }}>Forget the key now? Saved data stays unless you panic-wipe.</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn-danger btn-sm" onClick={forget} disabled={busy} data-testid="forget-confirm">Forget key</button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setStep(null)}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
        <p className="hint" style={{ marginBottom: 8 }}>
          Panic wipe deletes the key, every saved job, your profile and the dossier from this browser. It cannot be undone.
        </p>
        {step === 'wipe' ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input value={wipeText} onChange={(e) => setWipeText(e.target.value)} placeholder='Type "wipe" to confirm' data-testid="wipe-confirm-text" />
            <button type="button" className="btn-danger btn-sm" disabled={busy || wipeText.trim().toLowerCase() !== 'wipe'} onClick={wipe} data-testid="panic-confirm">
              Wipe everything
            </button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => { setStep(null); setWipeText(''); }}>Cancel</button>
          </div>
        ) : (
          <button type="button" className="btn-danger btn-sm" onClick={() => setStep('wipe')} data-testid="panic-wipe">Panic wipe…</button>
        )}
      </div>

      <p className="hint" style={{ marginTop: 12 }}>
        <a href={CONSOLE_URL} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-info)' }}>
          Revoke this key in the Anthropic Console <ExternalLink size={11} />
        </a>
      </p>

      {error && <ErrorCard title="Key settings failed" error={error} onDismiss={() => setError(null)} />}
    </div>
  );
}
```

- [ ] **Step 3: Integrate into App**

In `client/src/App.jsx`:

1. Add imports:

```js
import WebStartup from './web/WebStartup.jsx';
import WebKeyPanel from './web/WebKeyPanel.jsx';
import { webRuntime } from './web/runtime.js';
```

2. Add state next to the other UI state:

```js
const [webReady, setWebReady] = useState(!IS_WEB);
const [webKeyTick, setWebKeyTick] = useState(0);
```

3. Add the idle watcher after the existing polling effects:

```js
useEffect(() => {
  if (!IS_WEB) return undefined;
  const timer = setInterval(() => {
    if (webRuntime.keyStore.maybeForgetIdle()) {
      setWebKeyTick((t) => t + 1);
      setProfile((p) => ({ ...p, hasAnthropicKey: false, anthropicApiKey: '' }));
      toasts.info('The API key was forgotten after inactivity. Add it again when you need AI features.', 'Key forgotten');
    }
  }, 15_000);
  return () => clearInterval(timer);
}, []); // eslint-disable-line react-hooks/exhaustive-deps
```

4. Immediately before `if (activeTab === 'landing') {`, add:

```jsx
if (IS_WEB && !webReady) {
  return (
    <WebStartup
      runtime={webRuntime}
      onReady={() => {
        setWebReady(true);
        setWebKeyTick((t) => t + 1);
        fetchProfile();
      }}
    />
  );
}
```

5. In `clearApiKey`, after `setProfile(...)`, add:

```js
if (IS_WEB) setWebKeyTick((t) => t + 1);
```

6. In `handleSaveProfile`, after `await fetchProfile()` in the success branch, add:

```js
if (IS_WEB) setWebKeyTick((t) => t + 1);
```

7. In the Anthropic key section, change the subtitle:

```jsx
<SectionHeader
  title="Anthropic API key"
  subtitle={IS_WEB
    ? 'Your key stays in this browser and is sent only to Anthropic. It never touches our server.'
    : 'SA-JAS runs on Claude. Your key stays on this computer.'}
/>
```

8. Directly after the `<ApiKeyField … />` wrapper `<div style={{ marginTop: 16 }}>…</div>`, add:

```jsx
{IS_WEB && (
  <WebKeyPanel
    runtime={webRuntime}
    refreshSignal={webKeyTick}
    onChanged={() => {
      setWebKeyTick((t) => t + 1);
      fetchProfile();
    }}
  />
)}
```

9. Hide the Performance mode section in web mode (the preset API is server-authoritative):

```jsx
{!IS_WEB && (
  <section>
    <SectionHeader title="Performance mode" … />
    <PresetCards … />
  </section>
)}
```

10. Hide the Apply Copilot intelligence section in web mode: wrap that whole `<section>` in `{!IS_WEB && ( … )}`.

11. Hide the Run Hunter button on the web until the browser hunt lands:

```js
const showRunHunterButton = !SYNTHETIC_DEMO && !IS_WEB && ['dashboard', 'hunter'].includes(activeTab);
```

12. Hide the Source Health board in the Job Hunter tab in web mode: wrap `<SourceHealth … />` in `{!IS_WEB && ( … )}`.

- [ ] **Step 4: Build and run the client tests**

Run:

```bash
npm test --workspace=client
npm run build:web
npm run build:client
```

Expected: all pass. The web build must not contain `fonts.googleapis.com`:

```bash
grep -R "fonts.googleapis.com" client/dist || echo "no third-party fonts"
```

- [ ] **Step 5: Commit**

```bash
git add client/src/web/WebStartup.jsx client/src/web/WebKeyPanel.jsx client/src/App.jsx
git commit -m "feat(web): add onboarding, key unlock and key security settings" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Cloudflare config, header checks, and the canary E2E

**Files:**
- Create: `sa-job-agent-suite/client/public/_headers`
- Create: `sa-job-agent-suite/client/public/_redirects`
- Create: `sa-job-agent-suite/scripts/lib/headers.mjs`
- Create: `sa-job-agent-suite/scripts/lib/headers.test.mjs`
- Create: `sa-job-agent-suite/scripts/lib/staticServer.mjs`
- Create: `sa-job-agent-suite/scripts/web-canary.mjs`
- Modify: `sa-job-agent-suite/package.json`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: the built `client/dist` from Task 5.
- Produces: `parseHeadersFile(text)` → `[{ pattern, headers }]`, `headersFor(rules, pathname)`; `startStaticServer({ root, port? })` → `{ url, close }`; `npm run test:web`; CI job `web` (build + canary).

- [ ] **Step 1: Write the failing header tests**

Create `scripts/lib/headers.mjs` (implementation first, because the test imports it):

```js
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
```

Create `scripts/lib/headers.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseHeadersFile, headersFor } from './headers.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const headersText = await readFile(path.join(root, 'client/public/_headers'), 'utf8');
const redirectsText = await readFile(path.join(root, 'client/public/_redirects'), 'utf8');

test('the CSP allows only self scripts and the four API origins', () => {
  const rules = parseHeadersFile(headersText);
  const headers = headersFor(rules, '/');
  const csp = headers['content-security-policy'];
  assert.ok(csp, 'CSP header missing');
  for (const directive of [
    "default-src 'self'",
    "script-src 'self'",
    "connect-src 'self' https://api.anthropic.com https://remotive.com https://www.arbeitnow.com https://jobicy.com",
    "img-src 'self' data: blob:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
    'upgrade-insecure-requests'
  ]) {
    assert.ok(csp.includes(directive), `missing ${directive}`);
  }
  assert.equal(csp.includes('unsafe-eval'), false);
  const connect = csp.split(';').map((s) => s.trim()).find((s) => s.startsWith('connect-src'));
  assert.equal(connect.includes('*'), false);
});

test('the security headers are present', () => {
  const headers = headersFor(parseHeadersFile(headersText), '/');
  assert.equal(headers['x-content-type-options'], 'nosniff');
  assert.equal(headers['referrer-policy'], 'no-referrer');
  assert.equal(headers['cross-origin-opener-policy'], 'same-origin');
  assert.match(headers['strict-transport-security'], /max-age=\d+/);
  assert.match(headers['permissions-policy'], /camera=\(\)/);
});

test('the SPA fallback is configured', () => {
  assert.match(redirectsText, /^\/\*\s+\/index\.html\s+200$/m);
});

test('the parser merges wildcard and exact rules', () => {
  const rules = parseHeadersFile('/*\n  A: one\n/x\n  B: two\n');
  assert.deepEqual(headersFor(rules, '/x'), { a: 'one', b: 'two' });
  assert.deepEqual(headersFor(rules, '/y'), { a: 'one' });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "scripts/lib/*.test.mjs"`
Expected: FAIL — `client/public/_headers` missing.

- [ ] **Step 3: Add the Cloudflare files**

Create `client/public/_headers` (exact content, two-space indents):

```
/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; connect-src 'self' https://api.anthropic.com https://remotive.com https://www.arbeitnow.com https://jobicy.com; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'; upgrade-insecure-requests
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Permissions-Policy: accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()
  Cross-Origin-Opener-Policy: same-origin
```

Create `client/public/_redirects`:

```
/*  /index.html  200
```

Add the root test script step and `test:web`:

```json
"test": "npm test --workspaces --if-present && node --test \"evals/*.test.js\" && node --test scripts/hunter-record.test.mjs && node --test \"scripts/lib/*.test.mjs\"",
"test:web": "node scripts/web-canary.mjs"
```

- [ ] **Step 4: Run the header tests**

Run: `node --test "scripts/lib/*.test.mjs"`
Expected: PASS.

- [ ] **Step 5: Implement the static server and canary**

Create `scripts/lib/staticServer.mjs`:

```js
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseHeadersFile, headersFor } from './headers.mjs';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

export async function startStaticServer({ root, port = 0 }) {
  const resolved = path.resolve(root);
  const rules = parseHeadersFile(await fs.readFile(path.join(resolved, '_headers'), 'utf8').catch(() => ''));

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let file = path.resolve(resolved, `.${decodeURIComponent(url.pathname)}`);
    if (!file.startsWith(resolved)) { res.writeHead(403).end('Forbidden'); return; }
    let body;
    try {
      body = await fs.readFile(file);
      if (!file.includes('.')) throw new Error('directory');
    } catch {
      file = path.join(resolved, 'index.html');
      body = await fs.readFile(file);
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      ...headersFor(rules, url.pathname)
    });
    res.end(body);
  });

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}
```

Create `scripts/web-canary.mjs`:

```js
// Merge-blocking zero-knowledge check. Builds on the real web bundle, serves it
// with the production headers, and asserts the canary key appears ONLY in the
// x-api-key header of a request to api.anthropic.com.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { startStaticServer } from './lib/staticServer.mjs';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'client/dist');
const canary = ['sk', 'ant', 'api', '03', '-', randomBytes(24).toString('base64url')].join('');

async function main() {
  for (const file of ['index.html', '_headers', '_redirects']) {
    await fs.access(path.join(dist, file)).catch(() => {
      throw new Error(`client/dist/${file} is missing — run npm run build:web first.`);
    });
  }
  const html = await fs.readFile(path.join(dist, 'index.html'), 'utf8');
  assert.equal(/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), false, 'index.html has an inline script the CSP would block');
  assert.equal(html.includes('fonts.googleapis.com'), false, 'the web build still references Google Fonts');

  const server = await startStaticServer({ root: dist });
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const requests = [];
  const consoleLines = [];
  page.on('request', (req) => requests.push({
    url: req.url(),
    method: req.method(),
    headers: req.headers(),
    postData: req.postData() || ''
  }));
  page.on('console', (msg) => consoleLines.push(msg.text()));
  page.on('pageerror', (err) => consoleLines.push(String(err)));

  await page.route('https://api.anthropic.com/**', async (route) => {
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'x-api-key,anthropic-version,anthropic-dangerous-direct-browser-access,content-type',
      'access-control-allow-methods': 'GET,POST,OPTIONS'
    };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: cors,
      body: JSON.stringify({ data: [], has_more: false })
    });
  });

  try {
    await page.goto(server.url, { waitUntil: 'networkidle' });
    await page.getByTestId('key-input').waitFor({ timeout: 15_000 });
    await page.getByTestId('key-input').fill(canary);
    const probe = page.waitForRequest((req) => req.url().startsWith('https://api.anthropic.com/v1/models'), { timeout: 15_000 });
    await page.getByTestId('key-submit').click();
    await probe;
    await page.getByText('Dashboard', { exact: true }).waitFor({ timeout: 15_000 });

    // Server-only surfaces must be gone.
    assert.equal(await page.getByText('Apply Copilot', { exact: true }).count(), 0, 'Apply Copilot tab leaked into web mode');
    assert.equal(await page.getByText('Activity Logs', { exact: true }).count(), 0, 'Activity Logs tab leaked into web mode');

    const scan = await page.evaluate(async () => {
      const dump = {
        dom: document.documentElement.outerHTML,
        url: location.href,
        localStorage: JSON.stringify(localStorage),
        sessionStorage: JSON.stringify(sessionStorage),
        cookie: document.cookie,
        idb: []
      };
      for (const info of await indexedDB.databases()) {
        const db = await new Promise((resolve, reject) => {
          const req = indexedDB.open(info.name);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        for (const store of Array.from(db.objectStoreNames)) {
          const rows = await new Promise((resolve, reject) => {
            const tx = db.transaction(store, 'readonly');
            const req = tx.objectStore(store).getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          });
          dump.idb.push({ db: info.name, store, json: JSON.stringify(rows) });
        }
        db.close();
      }
      return dump;
    });

    const leaks = [];
    if (scan.dom.includes(canary)) leaks.push('DOM');
    if (scan.url.includes(canary)) leaks.push('URL');
    if (scan.localStorage.includes(canary)) leaks.push('localStorage');
    if (scan.sessionStorage.includes(canary)) leaks.push('sessionStorage');
    if (scan.cookie.includes(canary)) leaks.push('cookie');
    for (const row of scan.idb) if (row.json.includes(canary)) leaks.push(`IndexedDB ${row.db}/${row.store}`);
    for (const line of consoleLines) if (line.includes(canary)) leaks.push('console');
    for (const req of requests) {
      if (req.url.includes(canary) || req.postData.includes(canary)) leaks.push(`request ${req.method} ${req.url}`);
      for (const [name, value] of Object.entries(req.headers)) {
        if (!String(value).includes(canary)) continue;
        const allowed = name.toLowerCase() === 'x-api-key'
          && new URL(req.url).hostname === 'api.anthropic.com';
        if (!allowed) leaks.push(`header ${name} on ${req.url}`);
      }
    }
    assert.deepEqual(leaks, [], `canary leaked: ${leaks.join(', ')}`);

    // Remember -> Forget must remove the encrypted blob from IndexedDB.
    await page.getByRole('button', { name: /Profile & Settings/i }).click();
    await page.getByTestId('remember-open').click();
    await page.getByTestId('remember-passphrase').fill('correct horse battery');
    await page.getByTestId('remember-confirm').fill('correct horse battery');
    await page.getByTestId('remember-submit').click();
    await page.getByTestId('key-status').filter({ hasText: 'Saved encrypted' }).waitFor({ timeout: 20_000 });
    await page.getByTestId('forget-key').click();
    await page.getByTestId('forget-confirm').click();
    await page.getByTestId('key-status').filter({ hasText: 'Not loaded' }).waitFor({ timeout: 15_000 });
    const afterForget = await page.evaluate(async () => {
      const info = (await indexedDB.databases()).find((d) => d.name === 'sajas-web');
      if (!info) return [];
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open(info.name);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const rows = await new Promise((resolve, reject) => {
        const tx = db.transaction('keyVault', 'readonly');
        const req = tx.objectStore('keyVault').getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      db.close();
      return rows;
    });
    assert.deepEqual(afterForget, [], 'the saved key blob survived Forget');

    // Panic wipe must clear every store and return to onboarding.
    await page.getByTestId('panic-wipe').click();
    await page.getByTestId('wipe-confirm-text').fill('wipe');
    await page.getByTestId('panic-confirm').click();
    await page.getByTestId('key-input').waitFor({ timeout: 20_000 });
    const afterWipe = await page.evaluate(async () => {
      const dbs = await indexedDB.databases();
      const out = [];
      for (const info of dbs) {
        const db = await new Promise((resolve, reject) => {
          const req = indexedDB.open(info.name);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        for (const store of Array.from(db.objectStoreNames)) {
          const rows = await new Promise((resolve, reject) => {
            const tx = db.transaction(store, 'readonly');
            const req = tx.objectStore(store).getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          });
          if (rows.length) out.push(`${info.name}/${store}`);
        }
        db.close();
      }
      return out;
    });
    assert.deepEqual(afterWipe, [], 'panic wipe left data behind');

    console.log(`web canary: PASS (${requests.length} requests checked)`);
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((err) => {
  console.error(`web canary: FAIL — ${err.message}`);
  process.exitCode = 1;
});
```

- [ ] **Step 6: Build the web app and run the canary locally**

Run:

```bash
npm run build:web
npm run test:web
```

Expected: `web canary: PASS`. If Playwright's Chromium is missing locally: `npx playwright install chromium` (CI installs it).

- [ ] **Step 7: Add the CI job**

Append to `.github/workflows/ci.yml`:

```yaml
  web:
    name: Web build and canary-key check
    runs-on: ubuntu-latest
    timeout-minutes: 15
    defaults:
      run:
        working-directory: sa-job-agent-suite
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: npm
          cache-dependency-path: sa-job-agent-suite/package-lock.json
      - run: npm ci --ignore-scripts
      - name: Install test browser
        run: npx playwright install --with-deps chromium
      - name: Build the hosted bundle
        run: npm run build:web
      - name: Zero-knowledge canary
        run: npm run test:web
```

- [ ] **Step 8: Run the root suites**

Run:

```bash
npm test
npm run test:demo
npm run build:client
node tools/check-secrets.mjs --all
```

Expected: all pass. The canary is additionally run in CI.

- [ ] **Step 9: Commit**

```bash
git add client/public/_headers client/public/_redirects scripts/lib/headers.mjs scripts/lib/headers.test.mjs scripts/lib/staticServer.mjs scripts/web-canary.mjs package.json .github/workflows/ci.yml
git commit -m "feat(web): add Cloudflare headers and a canary-key E2E gate" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Docs, deployment, and the increment PR

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-10-27-m3-hosted-web-alpha-design.md` (status line only, if needed)
- Create: SDD ledger under `.superpowers/sdd/2026-10-27-m3a-2-web-shell/`

**Interfaces:**
- Consumes: everything above.
- Produces: documented build/deploy/self-host path, a live Pages URL (or an explicit credential blocker), a green PR.

- [ ] **Step 1: Document the web build and privacy model**

Add to `README.md` under a new `## Hosted web app (alpha)` section:

- Build: `npm run build:web`; output `client/dist`; local check `npm run build:web && npm run test:web`.
- Self-host: `npx serve client/dist` does **not** apply `_headers`; use any static host that serves `_headers` (Cloudflare Pages) or copy the headers from `client/public/_headers`.
- Data: IndexedDB only; export/import comes later; no accounts.
- Key: memory by default; optional encrypted blob (PBKDF2-SHA-256, 600k, AES-GCM); never sent to our origin; only `api.anthropic.com` sees it; Revoke link.
- Panic wipe clears everything.
- Deployment: Cloudflare Pages project `sajas`, build command `npm run build:web`, output `client/dist`.
- Browser support: Chromium/Firefox/Safari with WebCrypto and IndexedDB; private windows may block storage.

Add a short `## Web mode` section to `CLAUDE.md`:

- `__SAJAS_WEB__` is compile-time; web mode has no Express server.
- `client/src/web/api.js` is the only `/api/*` implementation in web mode; unsupported paths must stay typed (`NOT_SUPPORTED_IN_WEB`).
- Key rules: memory closure only; encrypted blob optional; never localStorage/sessionStorage/cookies/URLs/logs.
- Client imports core subpaths only, so the SDK stays out until M3a-4.
- `npm run test:web` is merge-blocking (canary).
- Web-only CSP forbids third-party scripts/fonts; do not add analytics or remote fonts.

- [ ] **Step 2: Final local gates**

Run from `sa-job-agent-suite/`:

```bash
npm test
npm run test:demo
npm run build:client
npm run build:web
npm run test:web
node tools/check-secrets.mjs --all
```

Expected: all exit 0; canary PASS; no key-shaped strings in tracked files.

- [ ] **Step 3: Deploy to Cloudflare Pages (credential checkpoint)**

First try the Wrangler OAuth device flow (no token is created or stored by us):

```bash
npx --yes wrangler@latest login
```

- If it prints a URL, give it to the user and wait for them to approve, then run:
  `npx --yes wrangler@latest pages deploy client/dist --project-name sajas --branch main`
- If interactive login is unavailable, **ask the user** (AskUserQuestion) whether to:
  1. supply a Pages-scoped `CLOUDFLARE_API_TOKEN` in the environment for one command,
  2. add `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` as GitHub secrets for a deploy workflow, or
  3. defer the live deploy.
  Do not mint API tokens, and never write a token to a file or commit it.

Verify after deploy:

```bash
curl -sI https://sajas.pages.dev | grep -Ei "HTTP/|content-security-policy|strict-transport-security|x-content-type-options|referrer-policy"
```

Expected: `200`, CSP present with `script-src 'self'`, no `unsafe-eval`, HSTS present. Open the URL, enter a key (or skip), confirm the server-only tabs are absent, and confirm the canary flow once more against the live URL if a key is available. Record the URL in the PR body, not in the repo.

- [ ] **Step 4: Open the PR and merge when green**

```bash
git push -u origin feat/m3a2-web-shell
gh pr create --title "feat(web): hosted shell with vault and zero-knowledge key lifecycle" --body "<summary + test plan + Pages URL if deployed>"
gh pr checks --watch
```

Merge only after every check is green (including the new `web` job):

```bash
gh pr merge --squash
```

- [ ] **Step 5: Write the SDD ledger and close the increment**

Create `.superpowers/sdd/2026-10-27-m3a-2-web-shell/progress.md` with: base SHA, per-task brief/review SHAs, every review finding and its disposition, final gate output, PR number, merge SHA, Pages URL and deployment result, and the deferred list. Task 7 is not done until the ledger records the merge.

- [ ] **Step 6: Commit the ledger (SDD artifacts only)**

```bash
git add .superpowers/sdd/2026-10-27-m3a-2-web-shell/progress.md
git commit -m "docs(sdd): record M3a-2 build, review and deployment" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage**

| Spec requirement | Task |
|---|---|
| Web build, `VITE_SAJAS_WEB=1`, `build:web`, `client/dist` | 1 |
| Hide Apply Copilot / Direct Outreach / Routines / Activity Logs | 1 |
| Unsupported endpoints typed `NOT_SUPPORTED_IN_WEB` | 4 |
| IndexedDB `sajas-web` with all seven stores | 2 |
| Pure repository + in-memory test adapter | 2 |
| Export/import JSON without key material; panic wipe | 2, 3, 5 |
| Key entry, shape/admin refusal, remote validation | 3, 4, 5 |
| Memory-only default; optional AES-GCM/PBKDF2 600k blob | 3 |
| Idle forget 15/30/60 (default 30) | 3, 5 |
| Forget key vs panic wipe vs revoke link | 5 |
| Web API contract with requestId/retryable/hint | 4 |
| QuotaExceededError → STORAGE_FULL | 4 (core mapper + test) |
| Strict CSP and security headers in `_headers` | 6 |
| No third-party fonts/scripts | 1, 6 (E2E asserts) |
| Canary-key test and key-removal test | 6 |
| Cloudflare Pages config and deploy | 6, 7 |
| README/self-host/privacy docs | 7 |
| Desktop suites unchanged | 1, 3, 6, 7 gates |

**Placeholder scan:** no TBD/TODO/"similar to Task N" — every code step is literal.

**Type consistency:** `vault.get/put/delete/getAll/clear/wipe/exportAll/importAll` are used with the same signatures in Tasks 2–5. `createKeyStore` returns the names used by `api.js`, `WebStartup.jsx` and `WebKeyPanel.jsx`. `FAIL` in `api.js` always receives the thrown error, never `null`.

**Known limits, deliberately deferred to M3a-3…M3a-6:** feeds and dedupe, tailor/kit and usage writes, hunt, XSS suite beyond the canary, bundle hash publishing, export/import UI, Runner beta.
