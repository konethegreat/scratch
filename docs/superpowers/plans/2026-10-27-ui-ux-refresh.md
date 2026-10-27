# UI/UX refresh implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dark-only aurora interface with a light-first, token-driven design system, a persisted three-state theme, plain copy, and a portfolio-led home page that presents six approved projects.

**Architecture:** A synchronous same-origin boot script sets the theme before first paint, and a small React store keeps it in sync with the OS, other tabs and the toggle. A single stylesheet owns two token sets and every surface, with no blur, gradient or emoji. A Node design gate enforces tokens, contrast, copy and script placement, and a Playwright script proves theme, landing, dialog, toast and responsive behaviour in a real browser.

**Tech Stack:** React 18, Vite 7, plain CSS with custom properties, Lucide icons, `node:test`, Playwright Chromium, Cloudflare Pages.

**Spec:** [`docs/superpowers/specs/2026-10-27-ui-ux-refresh-design.md`](../specs/2026-10-27-ui-ux-refresh-design.md)

## Global Constraints

- Work from `sa-job-agent-suite/` unless a step says otherwise.
- Never set `ANTHROPIC_API_KEY`. Never run `npm run smoke:live`, `evals/run.mjs --live`, or anything that calls Anthropic. Every test in this plan is offline.
- No U+2014 em dash in code, CSS, docs, commit messages, PR text or chat. Use a period, comma or colon.
- No emoji in client source. Use Lucide icons.
- No `gradient-text`, `aurora`, `backdrop-filter`, `glass-panel`, Google Fonts, or hard-coded colours in JSX.
- Preserve every existing web test contract: one button matching `/Enter the Suite/i`, headings `Dashboard` and `Profile & Settings`, the five sidebar names, absent `Apply Copilot` and `Activity Logs` in web mode, test ids `onboarding`, `key-skip`, `key-status`, `export-backup`, `feed-source-*`, `add-job-*`, `job-status`, `job-notes`, `save-notes`, the tracker selector `table.data-table tbody`, and the toast selector `.toast.toast-error .toast-msg`.
- Do not change the key lifecycle, crypto, backup format, CSP, `_headers`, or the IndexedDB schema.
- Use `X-SAJAS-Client: 1` on non-GET requests in desktop code. This plan does not add any desktop request.
- Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Never bypass the pre-commit hook. If it fails, fix the cause.

## File structure

| File | Responsibility |
|---|---|
| `client/public/theme-boot.js` | Synchronous pre-paint theme resolution. No imports, under 1 KB. |
| `client/src/theme.js` | Choice rules, storage, OS sync, storage-event sync, React store. |
| `client/src/theme.test.js` | Unit proof for choice rules and side effects. |
| `client/src/ThemeToggle.jsx` | Three-button theme control. |
| `client/public/favicon.svg` | Static brand mark. No emoji. |
| `client/index.html` | Metadata, boot script before the module entry. |
| `client/src/index.css` | Light and dark tokens, base elements, components, landing. |
| `client/src/Dialog.jsx` | Shared dialog semantics, focus trap, Escape, restoration. |
| `client/src/Landing.jsx` | Portfolio landing page. |
| `client/src/App.jsx` | Shell skip link, navigation semantics, token sweep, dialogs, toasts, toggle. |
| `client/src/web/WebStartup.jsx` | Onboarding panel on tokens, theme dock. |
| `client/src/ApplicationAnswers.jsx` | Token sweep. |
| `client/src/CandidateMemory.jsx` | Token sweep. |
| `client/src/Routines.jsx` | Token sweep. |
| `client/src/SourceHealth.jsx` | Token sweep. |
| `client/src/JobFeeds.jsx` | Panel class rename. |
| `client/src/main.jsx` | Remove the desktop Google Fonts injection. |
| `scripts/check-ui.mjs` | Offline design gate: tokens, contrast, patterns, copy, script order. |
| `scripts/web-ui.mjs` | Offline browser proof: boot, theme, landing, dialogs, toasts, responsive, motion. |
| `package.json` | Add the gate and browser proof to `test:web`. |
| `docs/superpowers/specs/2026-10-27-ui-ux-refresh-design.md` | Mark implemented when shipped. |
| `docs/superpowers/specs/2026-10-27-post-m3a3-pipeline.md` | Mark Arc 3 shipped with evidence. |

---

### Task 1: Theme core, boot script and metadata

**Files:**
- Create: `client/src/theme.js`
- Create: `client/src/theme.test.js`
- Create: `client/src/ThemeToggle.jsx`
- Create: `client/public/theme-boot.js`
- Create: `client/public/favicon.svg`
- Modify: `client/index.html`
- Modify: `client/src/main.jsx:33-44`

**Interfaces:**
- Consumes: nothing.
- Produces: `THEME_KEY`, `THEME_CHOICES`, `THEME_COLORS`, `normalizeChoice(value)`, `resolveTheme(choice, prefersDark)`, `getChoice()`, `applyChoice(choice)`, `setChoice(choice)`, `subscribe(listener)`, `useThemeChoice()`. `ThemeToggle` is a default export with no required props.

- [ ] **Step 1: Write the failing theme tests**

Create `client/src/theme.test.js`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

let version = 0;

function installEnv({ saved = null, prefersDark = false, storageThrows = false } = {}) {
  const store = new Map();
  if (saved !== null) store.set('sajas-theme', saved);
  const media = {
    matches: prefersDark,
    listeners: [],
    addEventListener(type, listener) {
      if (type === 'change') this.listeners.push(listener);
    }
  };
  const windowListeners = new Map();
  const meta = {
    content: '',
    setAttribute(name, value) {
      if (name === 'content') this.content = value;
    }
  };
  const documentElement = { dataset: {}, style: {} };
  const localStorage = {
    getItem(key) {
      if (storageThrows) throw new Error('storage blocked');
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      if (storageThrows) throw new Error('storage blocked');
      store.set(key, value);
    }
  };
  globalThis.window = {
    localStorage,
    matchMedia: () => media,
    addEventListener(type, listener) {
      windowListeners.set(type, listener);
    }
  };
  globalThis.document = {
    documentElement,
    querySelector(selector) {
      return selector === 'meta[name="theme-color"]' ? meta : null;
    }
  };
  return {
    store,
    meta,
    documentElement,
    storage: localStorage,
    dispose() {
      delete globalThis.window;
      delete globalThis.document;
    },
    changeMedia(matches) {
      media.matches = matches;
      for (const listener of media.listeners) listener({ matches });
    },
    emitStorage(key, value) {
      if (key === null) store.clear();
      else store.set(key, value);
      const listener = windowListeners.get('storage');
      if (listener) listener({ key, newValue: value });
    }
  };
}

async function loadTheme(env) {
  version += 1;
  return import(`./theme.js?test=${version}`);
}

test('normalizeChoice accepts only the three choices', async () => {
  const env = installEnv();
  const theme = await loadTheme(env);
  try {
    assert.equal(theme.normalizeChoice('light'), 'light');
    assert.equal(theme.normalizeChoice('dark'), 'dark');
    assert.equal(theme.normalizeChoice('system'), 'system');
    for (const value of ['', 'blue', null, undefined, 3, {}]) {
      assert.equal(theme.normalizeChoice(value), 'system');
    }
  } finally {
    env.dispose();
  }
});

test('resolveTheme maps explicit and system choices', async () => {
  const env = installEnv();
  const theme = await loadTheme(env);
  try {
    assert.equal(theme.resolveTheme('light', true), 'light');
    assert.equal(theme.resolveTheme('dark', false), 'dark');
    assert.equal(theme.resolveTheme('system', true), 'dark');
    assert.equal(theme.resolveTheme('system', false), 'light');
  } finally {
    env.dispose();
  }
});

test('setChoice stores the choice and applies every surface', async () => {
  const env = installEnv();
  const theme = await loadTheme(env);
  try {
    assert.equal(theme.getChoice(), 'system');
    theme.setChoice('dark');
    assert.equal(env.store.get('sajas-theme'), 'dark');
    assert.equal(env.documentElement.dataset.theme, 'dark');
    assert.equal(env.documentElement.dataset.themeChoice, 'dark');
    assert.equal(env.documentElement.style.colorScheme, 'dark');
    assert.equal(env.meta.content, '#0b0d12');
    theme.setChoice('light');
    assert.equal(env.store.get('sajas-theme'), 'light');
    assert.equal(env.documentElement.dataset.theme, 'light');
    assert.equal(env.documentElement.dataset.themeChoice, 'light');
    assert.equal(env.documentElement.style.colorScheme, 'light');
    assert.equal(env.meta.content, '#f6f6f3');
  } finally {
    env.dispose();
  }
});

test('a blocked localStorage keeps the choice for the session', async () => {
  const env = installEnv({ storageThrows: true });
  const theme = await loadTheme(env);
  try {
    assert.doesNotThrow(() => theme.setChoice('dark'));
    assert.equal(theme.getChoice(), 'dark');
    assert.equal(env.documentElement.dataset.theme, 'dark');
  } finally {
    env.dispose();
  }
});

test('an OS change applies while the choice is system only', async () => {
  const env = installEnv({ prefersDark: false });
  const theme = await loadTheme(env);
  try {
    assert.equal(env.documentElement.dataset.theme, 'light');
    env.changeMedia(true);
    assert.equal(env.documentElement.dataset.theme, 'dark');
    theme.setChoice('light');
    env.changeMedia(false);
    env.changeMedia(true);
    assert.equal(env.documentElement.dataset.theme, 'light');
  } finally {
    env.dispose();
  }
});

test('a storage event applies a change from another tab', async () => {
  const env = installEnv({ saved: 'light' });
  const theme = await loadTheme(env);
  try {
    assert.equal(env.documentElement.dataset.theme, 'light');
    env.emitStorage('sajas-theme', 'dark');
    assert.equal(theme.getChoice(), 'dark');
    assert.equal(env.documentElement.dataset.theme, 'dark');
    env.emitStorage(null, null);
    assert.equal(theme.getChoice(), 'system');
  } finally {
    env.dispose();
  }
});

test('an unknown stored value falls back to system', async () => {
  const env = installEnv({ saved: 'blue', prefersDark: true });
  const theme = await loadTheme(env);
  try {
    assert.equal(theme.getChoice(), 'system');
    assert.equal(env.documentElement.dataset.theme, 'dark');
  } finally {
    env.dispose();
  }
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test client/src/theme.test.js`

Expected: FAIL because `client/src/theme.js` does not exist.

- [ ] **Step 3: Implement the theme module**

Create `client/src/theme.js`:

```js
import { useSyncExternalStore } from 'react';

export const THEME_KEY = 'sajas-theme';
export const THEME_CHOICES = ['system', 'light', 'dark'];
export const THEME_COLORS = { light: '#f6f6f3', dark: '#0b0d12' };

const MEDIA_QUERY = '(prefers-color-scheme: dark)';
const listeners = new Set();
let memoryChoice = 'system';
let started = false;

export function normalizeChoice(value) {
  return THEME_CHOICES.includes(value) ? value : 'system';
}

export function resolveTheme(choice, prefersDark) {
  if (choice === 'light' || choice === 'dark') return choice;
  return prefersDark ? 'dark' : 'light';
}

function osPrefersDark() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(MEDIA_QUERY).matches;
}

export function getChoice() {
  try {
    const saved = window.localStorage.getItem(THEME_KEY);
    return saved === null ? 'system' : normalizeChoice(saved);
  } catch {
    return memoryChoice;
  }
}

export function applyChoice(choice) {
  const normalized = normalizeChoice(choice);
  const theme = resolveTheme(normalized, osPrefersDark());
  if (typeof document === 'undefined') return theme;
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.themeChoice = normalized;
  root.style.colorScheme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLORS[theme]);
  return theme;
}

function emit() {
  for (const listener of listeners) listener();
}

export function setChoice(choice) {
  const normalized = normalizeChoice(choice);
  memoryChoice = normalized;
  try {
    window.localStorage.setItem(THEME_KEY, normalized);
  } catch {
    // The choice still applies for this session.
  }
  applyChoice(normalized);
  emit();
  return normalized;
}

function start() {
  if (started || typeof window === 'undefined') return;
  started = true;
  const media = window.matchMedia?.(MEDIA_QUERY);
  media?.addEventListener?.('change', () => {
    if (getChoice() === 'system') {
      applyChoice('system');
      emit();
    }
  });
  window.addEventListener('storage', (event) => {
    if (event.key !== THEME_KEY && event.key !== null) return;
    applyChoice(getChoice());
    emit();
  });
}

export function subscribe(listener) {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useThemeChoice() {
  return useSyncExternalStore(subscribe, getChoice, () => 'system');
}

if (typeof document !== 'undefined') applyChoice(getChoice());
start();
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test client/src/theme.test.js`

Expected: 7 tests pass.

- [ ] **Step 5: Add the boot script**

Create `client/public/theme-boot.js`:

```js
(function () {
  var KEY = 'sajas-theme';
  var root = document.documentElement;
  var choice = 'system';
  try {
    var saved = window.localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark' || saved === 'system') choice = saved;
  } catch (error) {
    choice = 'system';
  }
  var dark = choice === 'dark' || (choice === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  root.dataset.theme = dark ? 'dark' : 'light';
  root.dataset.themeChoice = choice;
  root.style.colorScheme = dark ? 'dark' : 'light';
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#0b0d12' : '#f6f6f3');
})();
```

- [ ] **Step 6: Add the toggle**

Create `client/src/ThemeToggle.jsx`:

```jsx
import { Monitor, Sun, Moon } from 'lucide-react';
import { THEME_CHOICES, setChoice, useThemeChoice } from './theme.js';

const ICONS = { system: Monitor, light: Sun, dark: Moon };
const LABELS = { system: 'System theme', light: 'Light theme', dark: 'Dark theme' };
const VISIBLE = { system: 'System', light: 'Light', dark: 'Dark' };

export default function ThemeToggle({ className = '' }) {
  const choice = useThemeChoice();
  return (
    <div className={`theme-toggle ${className}`.trim()} role="group" aria-label="Theme" data-testid="theme-toggle">
      {THEME_CHOICES.map((value) => {
        const Icon = ICONS[value];
        const pressed = choice === value;
        return (
          <button
            key={value}
            type="button"
            className={`theme-option${pressed ? ' is-active' : ''}`}
            aria-pressed={pressed}
            aria-label={LABELS[value]}
            title={LABELS[value]}
            data-testid={`theme-${value}`}
            onClick={() => setChoice(value)}
          >
            <Icon size={15} aria-hidden="true" />
            <span className="theme-option-label">{VISIBLE[value]}</span>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 7: Add the favicon and metadata**

Create `client/public/favicon.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#16181d"/>
  <rect x="14" y="30" width="8" height="20" rx="2" fill="#a5b4fc"/>
  <rect x="28" y="20" width="8" height="30" rx="2" fill="#f3f4f6"/>
  <rect x="42" y="10" width="8" height="40" rx="2" fill="#4f46e5"/>
</svg>
```

Replace `client/index.html` with:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="./favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="SA-JAS finds South African jobs, tailors your CV and cover letter, and guides each application. Your key and data stay in your browser." />
    <meta name="theme-color" content="#f6f6f3" />
    <meta name="color-scheme" content="light dark" />
    <title>SA-JAS | South African Job Agent Suite</title>
    <script src="./theme-boot.js"></script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

- [ ] **Step 8: Remove the desktop Google Fonts injection**

In `client/src/main.jsx`, delete the whole `for (const [href, rel] of [...])` block and its comment, lines 33 to 44. The `else` branch must keep only the `X-SAJAS-Client` fetch patch.

- [ ] **Step 9: Run the client tests and a web build**

Run: `npm test --workspace=client`

Expected: PASS.

Run: `npm run build:web`

Expected: build succeeds and `client/dist/theme-boot.js` exists. Confirm with:

```bash
test -f client/dist/theme-boot.js && echo boot-present
grep -o '<script[^>]*>' client/dist/index.html
```

Expected: `boot-present`, two script tags, the boot script first.

- [ ] **Step 10: Commit**

```bash
git add client/src/theme.js client/src/theme.test.js client/src/ThemeToggle.jsx client/public/theme-boot.js client/public/favicon.svg client/index.html client/src/main.jsx
git commit -m "$(cat <<'EOF'
feat(ui): add the three-state theme core and pre-paint boot

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Design gate and the light-first token stylesheet

**Files:**
- Create: `scripts/check-ui.mjs`
- Modify: `client/src/index.css` (full replacement)
- Modify: `client/src/App.jsx` (class rename only)
- Modify: `client/src/CandidateMemory.jsx`, `client/src/JobFeeds.jsx`, `client/src/Routines.jsx`, `client/src/web/WebStartup.jsx`, `client/src/Landing.jsx` (class rename only)

**Interfaces:**
- Consumes: `client/public/theme-boot.js` and `client/src/theme.js` from Task 1.
- Produces: `npm` script path `scripts/check-ui.mjs`; CSS tokens `--bg-*`, `--color-*`, `--text-*`, `--border*`, `--overlay`, `--shadow-*`, `--radius-*`, `--font-*`, `--focus-ring`; classes `.panel`, `.panel-interactive`, `.theme-toggle`, `.theme-option`, `.skip-link`, `.status-dot`, `.modal-card-wide`, `.inline-meta`.

- [ ] **Step 1: Write the failing design gate**

Create `scripts/check-ui.mjs`:

```js
// Offline design gate. It fails on a missing token, a contrast pair below AA,
// a forbidden visual pattern, a stale boot script, or a wrong script order in
// the built entry document. No network and no browser.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const client = path.join(root, 'client');

const TOKENS = {
  '--bg-app': ['#f6f6f3', '#0b0d12'],
  '--bg-app-2': ['#ffffff', '#11141b'],
  '--bg-surface': ['#ffffff', '#141821'],
  '--bg-surface-2': ['#f0f0ec', '#1a1f2a'],
  '--bg-input': ['#ffffff', '#10131a'],
  '--bg-sidebar': ['#ffffff', '#0e1117'],
  '--bg-topbar': ['#ffffff', '#0e1117'],
  '--bg-code': ['#f0f0ec', '#0f131b'],
  '--color-accent': ['#4f46e5', '#a5b4fc'],
  '--color-accent-hover': ['#4338ca', '#c7d2fe'],
  '--color-accent-soft': ['#eef0ff', '#1d2340'],
  '--color-on-accent': ['#ffffff', '#0b0d12'],
  '--color-success': ['#047857', '#34d399'],
  '--color-info': ['#0369a1', '#38bdf8'],
  '--color-warning': ['#b45309', '#fbbf24'],
  '--color-error': ['#b91c1c', '#fb7185'],
  '--text-primary': ['#16181d', '#f3f4f6'],
  '--text-secondary': ['#3f4552', '#c3c8d2'],
  '--text-muted': ['#5f6673', '#929aab'],
  '--border': ['#e4e4de', '#232936'],
  '--border-strong': ['#c9c9c2', '#333b4c'],
  '--overlay': ['rgba(16, 18, 24, 0.35)', 'rgba(0, 0, 0, 0.60)']
};

const PAIRS = [
  ['light', '--text-primary', '--bg-app'],
  ['light', '--text-secondary', '--bg-app'],
  ['light', '--text-muted', '--bg-app'],
  ['light', '--color-accent', '--bg-surface'],
  ['light', '--color-success', '--bg-surface'],
  ['light', '--color-info', '--bg-surface'],
  ['light', '--color-warning', '--bg-surface'],
  ['light', '--color-error', '--bg-surface'],
  ['dark', '--text-primary', '--bg-app'],
  ['dark', '--text-secondary', '--bg-app'],
  ['dark', '--text-muted', '--bg-app'],
  ['dark', '--color-accent', '--bg-surface'],
  ['dark', '--color-on-accent', '--color-accent'],
  ['dark', '--color-success', '--bg-surface'],
  ['dark', '--color-info', '--bg-surface'],
  ['dark', '--color-warning', '--bg-surface'],
  ['dark', '--color-error', '--bg-surface']
];

function readBlock(css, selector) {
  const index = css.indexOf(selector);
  assert.notEqual(index, -1, `styles are missing the ${selector} block`);
  const start = css.indexOf('{', index);
  const end = css.indexOf('}', start);
  assert.ok(start !== -1 && end !== -1, `styles have a malformed ${selector} block`);
  return css.slice(start + 1, end);
}

function declarations(text) {
  const map = new Map();
  for (const match of text.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    map.set(match[1].trim(), match[2].trim());
  }
  return map;
}

function rgb(hex) {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  return [0, 2, 4].map((index) => parseInt(full.slice(index, index + 2), 16) / 255);
}

function channel(value) {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const [r, g, b] = rgb(hex).map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

async function walk(dir, files = []) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, files);
    else if (entry.name.endsWith('.css')) files.push(full);
  }
  return files;
}

async function main() {
  const cssPath = path.join(client, 'src/index.css');
  const css = await fs.readFile(cssPath, 'utf8');
  const light = declarations(readBlock(css, ':root'));
  const dark = declarations(readBlock(css, "[data-theme='dark']"));

  for (const [name, values] of Object.entries(TOKENS)) {
    assert.equal(light.get(name), values[0], `${name} is missing or wrong in the light theme`);
    assert.equal(dark.get(name), values[1], `${name} is missing or wrong in the dark theme`);
  }

  const themes = { light, dark };
  for (const [theme, foreground, background] of PAIRS) {
    const values = themes[theme];
    const ratio = contrast(values.get(foreground), values.get(background));
    assert.ok(
      ratio >= 4.5,
      `${theme} ${foreground} on ${background} is ${ratio.toFixed(2)}:1, below 4.5:1`
    );
  }

  for (const file of await walk(path.join(client, 'src'))) {
    const text = await fs.readFile(file, 'utf8');
    assert.equal(
      /gradient-text|aurora|backdrop-filter|glass-panel|fonts\.googleapis\.com|fonts\.gstatic\.com/.test(text),
      false,
      `${path.relative(root, file)} still contains a forbidden visual pattern`
    );
  }

  const html = await fs.readFile(path.join(client, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script\b([^>]*)>/gi)].map((match) => match[1]);
  assert.equal(scripts.length, 2, `index.html must load exactly two scripts, found ${scripts.length}`);
  assert.equal(scripts.some((attrs) => !/\bsrc=/.test(attrs)), false, 'index.html contains an inline script');
  const sources = scripts.map((attrs) => /\bsrc="([^"]+)"/.exec(attrs)?.[1] || '');
  assert.equal(sources[0], './theme-boot.js', 'the theme boot script must load first');
  assert.equal(sources[1], '/src/main.jsx', 'the module entry must load second');
  for (const source of sources) {
    assert.equal(/^(?:https?:)?\/\//.test(source), false, `index.html loads a third-party script: ${source}`);
  }

  const boot = await fs.readFile(path.join(client, 'public/theme-boot.js'), 'utf8');
  const theme = await fs.readFile(path.join(client, 'src/theme.js'), 'utf8');
  assert.ok(boot.length < 1024, 'theme-boot.js must stay under 1 KB');
  assert.match(boot, /sajas-theme/, 'theme-boot.js does not use the shared storage key');
  assert.match(theme, /THEME_KEY = 'sajas-theme'/, 'theme.js does not use the shared storage key');
  for (const choice of ['system', 'light', 'dark']) {
    assert.ok(boot.includes(`'${choice}'`), `theme-boot.js does not handle ${choice}`);
    assert.ok(theme.includes(`'${choice}'`), `theme.js does not handle ${choice}`);
  }
  for (const colour of ['#f6f6f3', '#0b0d12']) {
    assert.ok(boot.includes(colour), `theme-boot.js is missing ${colour}`);
    assert.ok(theme.includes(colour), `theme.js is missing ${colour}`);
  }

  console.log('check-ui: PASS');
}

main().catch((error) => {
  console.error(`check-ui: FAIL - ${error.message}`);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Run the gate and confirm it fails**

Run: `node scripts/check-ui.mjs`

Expected: FAIL with a missing token or a forbidden visual pattern. The current stylesheet has no light token set and still contains the old visual language.

- [ ] **Step 3: Replace the stylesheet**

Replace `client/src/index.css` with:

```css
/* Tokens */
:root {
  color-scheme: light;
  --bg-app: #f6f6f3;
  --bg-app-2: #ffffff;
  --bg-surface: #ffffff;
  --bg-surface-2: #f0f0ec;
  --bg-input: #ffffff;
  --bg-sidebar: #ffffff;
  --bg-topbar: #ffffff;
  --bg-code: #f0f0ec;
  --color-accent: #4f46e5;
  --color-accent-hover: #4338ca;
  --color-accent-soft: #eef0ff;
  --color-on-accent: #ffffff;
  --color-success: #047857;
  --color-info: #0369a1;
  --color-warning: #b45309;
  --color-error: #b91c1c;
  --text-primary: #16181d;
  --text-secondary: #3f4552;
  --text-muted: #5f6673;
  --border: #e4e4de;
  --border-strong: #c9c9c2;
  --overlay: rgba(16, 18, 24, 0.35);
  --shadow-sm: 0 1px 2px rgba(22, 24, 29, 0.06);
  --shadow-card: 0 1px 2px rgba(22, 24, 29, 0.05), 0 8px 24px rgba(22, 24, 29, 0.06);
  --shadow-lg: 0 16px 40px rgba(22, 24, 29, 0.12);
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --focus-ring: 0 0 0 3px rgba(79, 70, 229, 0.30);
}

[data-theme='dark'] {
  color-scheme: dark;
  --bg-app: #0b0d12;
  --bg-app-2: #11141b;
  --bg-surface: #141821;
  --bg-surface-2: #1a1f2a;
  --bg-input: #10131a;
  --bg-sidebar: #0e1117;
  --bg-topbar: #0e1117;
  --bg-code: #0f131b;
  --color-accent: #a5b4fc;
  --color-accent-hover: #c7d2fe;
  --color-accent-soft: #1d2340;
  --color-on-accent: #0b0d12;
  --color-success: #34d399;
  --color-info: #38bdf8;
  --color-warning: #fbbf24;
  --color-error: #fb7185;
  --text-primary: #f3f4f6;
  --text-secondary: #c3c8d2;
  --text-muted: #929aab;
  --border: #232936;
  --border-strong: #333b4c;
  --overlay: rgba(0, 0, 0, 0.60);
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.50);
  --shadow-card: 0 1px 2px rgba(0, 0, 0, 0.40), 0 8px 24px rgba(0, 0, 0, 0.35);
  --shadow-lg: 0 16px 40px rgba(0, 0, 0, 0.55);
  --focus-ring: 0 0 0 3px rgba(165, 180, 252, 0.35);
}

* { box-sizing: border-box; margin: 0; padding: 0; }

html, body, #root { height: 100%; }

body {
  background: var(--bg-app);
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-size: 15px;
  line-height: 1.6;
  min-height: 100vh;
  -webkit-font-smoothing: antialiased;
}

h1, h2, h3, h4, h5, h6 {
  font-family: var(--font-sans);
  font-weight: 650;
  letter-spacing: -0.02em;
  color: var(--text-primary);
}

a { color: var(--color-accent); }
a:hover { color: var(--color-accent-hover); }
button { font-family: inherit; }

:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

.app-bg { background: var(--bg-app); }

.skip-link {
  position: fixed;
  top: 8px;
  left: 8px;
  z-index: 10001;
  padding: 8px 12px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  color: var(--text-primary);
  font-weight: 600;
  text-decoration: none;
  transform: translateY(-180%);
  transition: transform 150ms ease;
}
.skip-link:focus { transform: translateY(0); }

::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }

/* Surfaces */
.panel {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
  min-width: 0;
}

.panel-interactive {
  cursor: pointer;
  transition: border-color 150ms ease, box-shadow 150ms ease, transform 150ms ease;
}
.panel-interactive:hover {
  transform: translateY(-2px);
  border-color: var(--border-strong);
  box-shadow: var(--shadow-lg);
}

/* Inputs */
input, select, textarea {
  background: var(--bg-input);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-family: inherit;
  font-size: 14px;
  padding: 10px 14px;
  width: 100%;
  transition: border-color 150ms ease, box-shadow 150ms ease;
}

input[type='checkbox'], input[type='radio'] {
  width: auto;
  padding: 0;
  accent-color: var(--color-accent);
}

input:focus, select:focus, textarea:focus {
  border-color: var(--color-accent);
  box-shadow: var(--focus-ring);
  outline: none;
}

input::placeholder, textarea::placeholder { color: var(--text-muted); }
select option { background: var(--bg-surface); color: var(--text-primary); }

label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 6px;
}

/* Buttons */
.btn-primary, .btn-secondary, .btn-danger, .btn-ghost {
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-weight: 600;
  font-size: 14px;
  padding: 10px 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px solid transparent;
  transition: background-color 150ms ease, border-color 150ms ease, color 150ms ease, box-shadow 150ms ease;
  white-space: nowrap;
  font-family: inherit;
  text-decoration: none;
}

.btn-primary {
  background: var(--color-accent);
  color: var(--color-on-accent);
}
.btn-primary:hover:not(:disabled) { background: var(--color-accent-hover); }

.btn-secondary {
  background: var(--bg-surface);
  color: var(--text-primary);
  border-color: var(--border-strong);
}
.btn-secondary:hover:not(:disabled) {
  background: var(--bg-surface-2);
  border-color: var(--text-muted);
}

.btn-danger {
  background: transparent;
  color: var(--color-error);
  border-color: var(--color-error);
}
.btn-danger:hover:not(:disabled) {
  background: var(--color-error);
  color: var(--bg-app);
}

.btn-ghost {
  background: transparent;
  color: var(--text-secondary);
}
.btn-ghost:hover:not(:disabled) {
  background: var(--bg-surface-2);
  color: var(--text-primary);
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-sm { padding: 6px 12px; font-size: 12px; }
.btn-xs { padding: 4px 8px; font-size: 11px; }
.btn-lg { padding: 14px 26px; font-size: 15px; border-radius: var(--radius-md); }

/* Sidebar */
.sidebar-link {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 14px;
  border-radius: var(--radius-sm);
  background: transparent;
  border: 1px solid transparent;
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 500;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color 150ms ease, color 150ms ease, border-color 150ms ease;
}

.sidebar-link:hover {
  background: var(--bg-surface-2);
  color: var(--text-primary);
}

.sidebar-link.active {
  background: var(--color-accent-soft);
  border-color: var(--color-accent);
  color: var(--text-primary);
  box-shadow: inset 3px 0 0 0 var(--color-accent);
}

/* Badges */
.badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 999px;
  text-transform: capitalize;
  background: var(--bg-surface-2);
  color: var(--text-secondary);
  border: 1px solid var(--border);
  white-space: nowrap;
}

.badge-success { color: var(--color-success); border-color: var(--color-success); background: transparent; }
.badge-info    { color: var(--color-info);    border-color: var(--color-info);    background: transparent; }
.badge-accent  { color: var(--color-accent);  border-color: var(--color-accent);  background: transparent; }
.badge-warning { color: var(--color-warning); border-color: var(--color-warning); background: transparent; }
.badge-error   { color: var(--color-error);   border-color: var(--color-error);   background: transparent; }

/* Terminal */
.terminal-console {
  background: var(--bg-code);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font-family: var(--font-mono);
  font-size: 12.5px;
  padding: 16px;
  overflow-y: auto;
}

.terminal-line {
  margin-bottom: 4px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.terminal-system  { color: var(--text-muted); }
.terminal-info    { color: var(--text-secondary); }
.terminal-agent1  { color: var(--color-info); }
.terminal-agent2  { color: var(--color-warning); }
.terminal-agent3  { color: var(--color-success); }
.terminal-success { color: var(--color-success); }
.terminal-warning { color: var(--color-warning); }
.terminal-error   { color: var(--color-error); font-weight: 700; }

/* Motion */
@keyframes pulse {
  0%, 100% { transform: scale(1); opacity: 0.7; }
  50%      { transform: scale(1.1); opacity: 1; }
}

.pulse-indicator {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: var(--color-accent);
  animation: pulse 1.6s infinite ease-in-out;
}

@keyframes spin { to { transform: rotate(360deg); } }
.spin { animation: spin 1s linear infinite; }

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
.fade-in { animation: fadeIn 150ms ease-out; }

@keyframes fadeUp {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
.reveal { opacity: 0; animation: fadeUp 400ms cubic-bezier(0.2, 0.7, 0.2, 1) forwards; }
.reveal.d1 { animation-delay: 60ms; }
.reveal.d2 { animation-delay: 120ms; }
.reveal.d3 { animation-delay: 180ms; }
.reveal.d4 { animation-delay: 240ms; }
.reveal.d5 { animation-delay: 300ms; }
.reveal.d6 { animation-delay: 360ms; }

@keyframes slideInRight {
  from { opacity: 0; transform: translateX(16px); }
  to   { opacity: 1; transform: translateX(0); }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
  .reveal { opacity: 1; transform: none; }
}

/* Toasts */
.toast-stack {
  position: fixed;
  top: 20px;
  right: 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  z-index: 10000;
  max-width: min(360px, calc(100vw - 40px));
  pointer-events: none;
}

.toast {
  pointer-events: auto;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-lg);
  color: var(--text-primary);
  font-size: 13px;
  animation: slideInRight 150ms ease-out;
}

.toast-success { border-left: 3px solid var(--color-success); }
.toast-error   { border-left: 3px solid var(--color-error); }
.toast-info    { border-left: 3px solid var(--color-info); }

.toast .toast-icon  { flex-shrink: 0; margin-top: 1px; }
.toast .toast-body  { flex: 1; }
.toast .toast-title { font-weight: 700; margin-bottom: 2px; color: var(--text-primary); font-size: 13px; }
.toast .toast-msg   { color: var(--text-secondary); font-size: 12px; }
.toast button.toast-close {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 0;
  margin-left: 4px;
  line-height: 1;
}

/* Dialogs */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay);
  z-index: 9000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  animation: fadeIn 150ms ease;
}

.modal-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  padding: 24px;
  max-width: 480px;
  width: 100%;
  max-height: calc(100vh - 40px);
  overflow-y: auto;
  box-shadow: var(--shadow-lg);
}

.modal-card-wide { max-width: 540px; }

/* Layout helpers */
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
.grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
.flex-between { display: flex; justify-content: space-between; align-items: center; }
.flex-gap { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.muted { color: var(--text-secondary); }
.tiny  { font-size: 11px; color: var(--text-muted); }
.hint  { font-size: 11px; color: var(--text-muted); margin-top: 4px; display: block; }
.divider { height: 1px; background: var(--border); margin: 16px 0; }

/* Tables */
.data-table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
  font-size: 13px;
}

.data-table thead tr {
  border-bottom: 2px solid var(--border);
  color: var(--text-muted);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.data-table th, .data-table td { padding: 12px 10px; vertical-align: middle; }

.data-table tbody tr {
  border-bottom: 1px solid var(--border);
  transition: background-color 150ms ease;
}
.data-table tbody tr:hover { background: var(--bg-surface-2); }

/* Top bar */
.app-topbar {
  position: sticky;
  top: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  padding: 12px 18px;
  margin-bottom: 24px;
  border-radius: var(--radius-md);
  background: var(--bg-topbar);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-sm);
}

.brand-chip {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  border: none;
  background: transparent;
  padding: 0;
  font-family: inherit;
  text-align: left;
}
.brand-chip:hover .brand-name { color: var(--color-accent); }

.brand-name {
  font-weight: 800;
  font-size: 17px;
  letter-spacing: 0.04em;
  color: var(--text-primary);
}

/* Social links */
.social-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.social-pill {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 7px 13px;
  border-radius: 999px;
  font-size: 12.5px;
  font-weight: 600;
  text-decoration: none;
  color: var(--text-secondary);
  background: var(--bg-surface-2);
  border: 1px solid var(--border);
  transition: color 150ms ease, border-color 150ms ease, background-color 150ms ease;
}
.social-pill:hover {
  color: var(--text-primary);
  border-color: var(--color-accent);
  background: var(--color-accent-soft);
}
.social-pill.lg { padding: 11px 18px; font-size: 14px; }

/* Footer */
.app-footer {
  margin-top: 36px;
  padding: 22px 24px;
  border-top: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.app-footer .foot-credit { font-size: 13px; color: var(--text-secondary); }
.app-footer .foot-credit b { color: var(--text-primary); font-weight: 700; }

/* Theme control */
.theme-toggle {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-surface-2);
}
.theme-option {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  color: var(--text-muted);
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 150ms ease, color 150ms ease, border-color 150ms ease;
}
.theme-option:hover { color: var(--text-primary); }
.theme-option.is-active {
  background: var(--bg-surface);
  border-color: var(--border-strong);
  color: var(--text-primary);
}

.theme-dock {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 100;
}

.status-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-muted);
  margin-right: 6px;
  vertical-align: 1px;
}
.status-dot.active { background: var(--color-success); }

.inline-meta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-muted);
  font-size: 13px;
}

/* Error surface */
.error-card {
  border: 1px solid var(--color-error);
  background: var(--bg-surface);
  border-radius: var(--radius-md);
  padding: 16px;
  margin-bottom: 20px;
}
.error-card-head { display: flex; gap: 10px; align-items: flex-start; }
.error-card-title { font-weight: 700; font-size: 14px; }
.error-card-code {
  font-size: 11px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  margin-top: 2px;
}
.error-card-message { font-size: 13px; margin: 10px 0; line-height: 1.55; }
.error-card-details summary {
  cursor: pointer;
  font-size: 11px;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  gap: 4px;
}
.error-card-details pre {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 11px;
  background: var(--bg-surface-2);
  padding: 10px;
  border-radius: var(--radius-sm);
  margin-top: 8px;
  max-height: 220px;
  overflow: auto;
}
.error-card-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.error-row {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px 12px;
  background: var(--bg-surface-2);
}

input[type=number]::-webkit-outer-spin-button,
input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
input[type=number] { -moz-appearance: textfield; }

/* Responsive */
@media (max-width: 960px) {
  .grid-2, .grid-3 { grid-template-columns: 1fr; }
  .dashboard-row, .tailor-grid { grid-template-columns: 1fr !important; }
}

@media (max-width: 768px) {
  aside.app-sidebar {
    width: 100% !important;
    position: relative !important;
    border-radius: 0 !important;
    height: auto !important;
  }
  .app-shell { flex-direction: column !important; }
  .app-main { padding: 20px !important; max-height: none !important; }
}

@media (max-width: 560px) {
  .theme-option { padding: 7px; }
  .theme-option-label { display: none; }
}
```

- [ ] **Step 4: Rename the panel classes across the client**

For each file below, replace every `glass-panel` with `panel` and every `glass-card-interactive` with `panel-interactive`.

Files: `client/src/App.jsx`, `client/src/CandidateMemory.jsx`, `client/src/JobFeeds.jsx`, `client/src/Routines.jsx`, `client/src/web/WebStartup.jsx`, `client/src/Landing.jsx`.

Verify:

```bash
grep -rn "glass-panel\|glass-card-interactive" client/src --include=*.jsx
```

Expected: no output.

- [ ] **Step 5: Run the gate and confirm it passes**

Run: `node scripts/check-ui.mjs`

Expected: `check-ui: PASS`.

- [ ] **Step 6: Build and smoke the stylesheet**

Run: `npm run build:client`

Expected: PASS.

Run: `npm run build:web`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/check-ui.mjs client/src/index.css client/src/App.jsx client/src/CandidateMemory.jsx client/src/JobFeeds.jsx client/src/Routines.jsx client/src/web/WebStartup.jsx client/src/Landing.jsx
git commit -m "$(cat <<'EOF'
feat(ui): replace the visual system with light-first design tokens

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Shell semantics, token sweep and the theme control

**Files:**
- Modify: `client/src/App.jsx` (imports, shell, sidebar, topbar, KPI, presets, usage)
- Modify: `client/src/ApplicationAnswers.jsx`
- Modify: `client/src/CandidateMemory.jsx`
- Modify: `client/src/Routines.jsx`
- Modify: `client/src/SourceHealth.jsx`
- Modify: `client/src/web/WebStartup.jsx`
- Modify: `client/src/Landing.jsx` (gradient classes only)
- Modify: `scripts/check-ui.mjs`

**Interfaces:**
- Consumes: `ThemeToggle` from Task 1, tokens and classes from Task 2.
- Produces: skip link `#main-content`, `nav aria-label="Primary"`, `aria-current="page"`, the theme dock on onboarding, and a JSX colour gate.

- [ ] **Step 1: Extend the gate with JSX checks**

In `scripts/check-ui.mjs`, after the CSS pattern loop and before the `index.html` block, add:

```js
  const jsxFiles = [];
  for (const entry of await fs.readdir(path.join(client, 'src'), { recursive: true, withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.jsx')) {
      jsxFiles.push(path.join(entry.parentPath, entry.name));
    }
  }
  for (const file of jsxFiles) {
    const relative = path.relative(root, file);
    const text = await fs.readFile(file, 'utf8');
    assert.equal(
      /gradient-text|glass-panel|glass-card-interactive|aurora|backdrop-filter/.test(text),
      false,
      `${relative} still contains a forbidden class or style`
    );
    if (!relative.endsWith('SocialLinks.jsx')) {
      assert.equal(
        /#[0-9a-f]{3,8}\b/i.test(text),
        false,
        `${relative} still contains a hard-coded colour`
      );
    }
  }
```

- [ ] **Step 2: Run the gate and confirm it fails**

Run: `node scripts/check-ui.mjs`

Expected: FAIL naming `App.jsx` or `Landing.jsx` for a gradient class or a hex colour.

- [ ] **Step 3: Wire the toggle and shell semantics in `App.jsx`**

Add the import next to the other component imports:

```jsx
import ThemeToggle from './ThemeToggle.jsx';
```

Replace `SidebarLink` with:

```jsx
function SidebarLink({ active, onClick, icon, children }) {
  return (
    <button
      type="button"
      className={`sidebar-link ${active ? 'active' : ''}`}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
    >
      {icon} <span>{children}</span>
    </button>
  );
}
```

Inside the returned app shell, the first children must be:

```jsx
      <a className="skip-link" href="#main-content">Skip to main content</a>
```

Change the main element to:

```jsx
      <main id="main-content" tabIndex={-1} className="app-main" style={{ flex: 1, padding: 40, overflowY: 'auto', maxHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
```

Change the sidebar nav to:

```jsx
        <nav aria-label="Primary" style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
```

In the topbar, replace `<SocialLinks size="sm" />` with:

```jsx
          <div className="flex-gap">
            <ThemeToggle />
            <SocialLinks size="sm" />
          </div>
```

Replace the sidebar brand heading class:

```jsx
            <h2 className="brand-name" style={{ fontSize: 18, fontWeight: 800, letterSpacing: '0.05em' }}>SA-JAS</h2>
```

Replace the topbar brand class:

```jsx
            <span className="brand-name">SA-JAS</span>
```

Replace the hunter status block:

```jsx
          <div className="tiny" style={{ marginTop: 12, textAlign: 'center' }}>
            <span className={`status-dot${hunterRunning ? ' active' : ''}`} aria-hidden="true" />
            <span style={{ color: hunterRunning ? 'var(--color-success)' : 'var(--text-muted)' }}>
              {hunterRunning ? 'Hunter active' : 'Hunter idle'}
            </span>
          </div>
```

- [ ] **Step 4: Replace the sidebar colours**

In the sidebar `aside` style object, replace:

```jsx
          background: '#0F172A', border: 'none', borderRadius: 0,
        boxShadow: '1px 0 0 0 #1E293B', position: 'sticky', top: 0, alignSelf: 'flex-start',
```

with:

```jsx
          background: 'var(--bg-sidebar)', border: 'none', borderRadius: 0,
        boxShadow: '1px 0 0 0 var(--border)', position: 'sticky', top: 0, alignSelf: 'flex-start',
```

In the sidebar footer divider, replace `'1px solid rgba(255,255,255,0.06)'` with `'1px solid var(--border)'`.

- [ ] **Step 5: Replace the remaining hard-coded colours**

Apply these exact substitutions in `client/src/App.jsx`:

| Old | New |
|---|---|
| `borderColor: '#22d3ee'` | `borderColor: 'var(--color-info)'` |
| `background: selectedJob?.id === job.id ? '#FFFBEB' : 'transparent'` | `background: selectedJob?.id === job.id ? 'var(--color-accent-soft)' : 'transparent'` |
| `color: ok ? '#4ade80' : 'var(--color-muted)'` | `color: ok ? 'var(--color-success)' : 'var(--text-muted)'` |
| `<CheckCircle2 size={12} color="#4ade80" />` | `<CheckCircle2 size={12} color="var(--color-success)" />` |
| `borderLeft: '3px solid #DC2626'` | `borderLeft: '3px solid var(--color-error)'` |
| `color: '#DC2626'` (danger heading) | `color: 'var(--color-error)'` |
| `const tone = !complete ? 'var(--color-accent)' : '#B45309';` | `const tone = !complete ? 'var(--color-accent)' : 'var(--color-warning)';` |
| `color="#B45309"` | `color="var(--color-warning)"` |
| `color="#DC2626"` | `color="var(--color-error)"` |
| `const tone = zero ? '#B45309' : 'var(--color-success)';` | `const tone = zero ? 'var(--color-warning)' : 'var(--color-success)';` |
| `color: exceeded ? '#DC2626' : 'var(--text-primary)'` | `color: exceeded ? 'var(--color-error)' : 'var(--text-primary)'` |
| `background: pct >= 100 ? '#DC2626' : pct >= 75 ? '#B45309' : 'var(--color-success)'` | `background: pct >= 100 ? 'var(--color-error)' : pct >= 75 ? 'var(--color-warning)' : 'var(--color-success)'` |
| `background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.35)'` | `background: 'var(--bg-surface-2)', border: '1px solid var(--color-error)'` |
| `background: 'rgba(255,255,255,0.08)'` in the budget bar | `background: 'var(--bg-surface-2)'` |
| `background: isActive ? 'rgba(245,158,11,0.07)' : 'var(--bg-surface-2)'` | `background: isActive ? 'var(--color-accent-soft)' : 'var(--bg-surface-2)'` |

- [ ] **Step 6: Replace the KPI palette and emoji icons**

Replace `KpiCard` with:

```jsx
function KpiCard({ color, icon, value, label }) {
  const foreground = {
    info: 'var(--color-info)',
    accent: 'var(--color-accent)',
    success: 'var(--color-success)'
  }[color];
  return (
    <div className="panel" style={{ padding: 22, display: 'flex', alignItems: 'center', gap: 16 }}>
      <div style={{ background: 'var(--bg-surface-2)', color: foreground, padding: 12, borderRadius: 12 }}>{icon}</div>
      <div>
        <h3 style={{ fontSize: 24, fontWeight: 700 }}>{value}</h3>
        <p className="tiny" style={{ marginTop: 2 }}>{label}</p>
      </div>
    </div>
  );
}
```

Add `Coins`, `Scale` and `Rocket` to the Lucide import.

Replace the preset card data with:

```jsx
  const cards = [
    {
      id: 'saver', title: 'Token Saver', Icon: Coins, note: 'Cheapest',
      points: ['AI search on Haiku, light depth', 'Optional AI features all off', 'Caching on, tailor one at a time']
    },
    {
      id: 'balanced', title: 'Balanced', Icon: Scale, note: 'Recommended',
      points: ['Standard search depth', 'Planner, memory and dreaming on', 'Vision, computer-use and research off']
    },
    {
      id: 'max', title: 'Maximum', Icon: Rocket, note: 'Most capable',
      points: ['Deep two-round search on Sonnet', 'Link repair and company research on', 'Vision and computer-use finisher on']
    }
  ];
```

Replace the card title line with:

```jsx
                <span style={{ fontSize: 15, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <c.Icon size={16} aria-hidden="true" /> {c.title}
                </span>
```

Replace the warning badge in the dashboard status row with:

```jsx
              {aiSearchOn && !profile.hasAnthropicKey && (
                <span className="badge badge-error" title="AI search needs an Anthropic key">
                  <AlertTriangle size={11} aria-hidden="true" /> No Anthropic key
                </span>
              )}
```

Replace the repaired-link glyph with:

```jsx
          {ls.repaired > 0 && <span className="badge badge-accent" title="Missing links found via AI grounded search"><RotateCw size={10} aria-hidden="true" /> {ls.repaired} repaired</span>}
```

Add `RotateCw` to the Lucide import.

Replace the docs link arrow:

```jsx
        {docsUrl && <a href={docsUrl} target="_blank" rel="noopener noreferrer" className="tiny" style={{ color: 'var(--color-info)' }}>{docsLabel} <ExternalLink size={11} aria-hidden="true" /></a>}
```

- [ ] **Step 7: Sweep the component files**

Apply these substitutions:

`client/src/ApplicationAnswers.jsx`:
- `background: 'rgba(255,255,255,0.03)'` becomes `background: 'var(--bg-surface-2)'`.
- `var(--color-accent, #fbbf24)` becomes `var(--color-accent)`.
- `borderColor: 'rgba(251,191,36,0.4)', background: 'rgba(251,191,36,0.06)'` becomes `borderColor: 'var(--color-warning)', background: 'var(--bg-surface-2)'`.
- `var(--color-text, #e2e8f0)` becomes `var(--text-primary)`.

`client/src/CandidateMemory.jsx`:
- `preference: '#60a5fa', strength: '#34d399', achievement: '#fbbf24', style: '#c084fc', constraint: '#f87171', other: '#94a3b8'` becomes `preference: 'var(--color-info)', strength: 'var(--color-success)', achievement: 'var(--color-warning)', style: 'var(--color-accent)', constraint: 'var(--color-error)', other: 'var(--text-muted)'`.
- `background: 'rgba(255,255,255,0.03)'` becomes `background: 'var(--bg-surface-2)'`.
- `var(--color-accent, #fbbf24)` becomes `var(--color-accent)`.
- `var(--color-text, #e2e8f0)` becomes `var(--text-primary)`.

`client/src/Routines.jsx`:
- `{ ok: '#34d399', running: '#fbbf24', error: '#f87171', skipped: '#94a3b8', idle: '#94a3b8' }` becomes `{ ok: 'var(--color-success)', running: 'var(--color-warning)', error: 'var(--color-error)', skipped: 'var(--text-muted)', idle: 'var(--text-muted)' }`.
- `var(--color-success, #34d399)` becomes `var(--color-success)`.
- `var(--color-accent, #818cf8)` becomes `var(--color-accent)`.
- `STATUS_COLOR[r.lastStatus] || '#94a3b8'` becomes `STATUS_COLOR[r.lastStatus] || 'var(--text-muted)'` in both places.
- `r.enabled ? 'var(--color-success, #34d399)' : '#94a3b8'` becomes `r.enabled ? 'var(--color-success)' : 'var(--text-muted)'`.

`client/src/SourceHealth.jsx`:
- `background: 'rgba(251,113,133,0.10)', border: '1px solid rgba(251,113,133,0.32)'` becomes `background: 'var(--bg-surface-2)', border: '1px solid var(--color-error)'`.
- `color: '#fda4af'` becomes `color: 'var(--color-error)'`.

`client/src/Landing.jsx` (temporary, replaced in Task 4): remove every `<span className="gradient-text">` wrapper and keep its text. The brand span becomes `className="brand-name"`.

- [ ] **Step 8: Add the theme dock to onboarding**

In `client/src/web/WebStartup.jsx`, import the toggle:

```jsx
import ThemeToggle from '../ThemeToggle.jsx';
```

Inside the outer `div.app-bg`, render the dock before the panel:

```jsx
      <div className="theme-dock">
        <ThemeToggle />
      </div>
```

Also change the heading from `h2` to `h1` so the gate screen has one page heading:

```jsx
          <h1 style={{ fontSize: 20 }}>SA-JAS for the web</h1>
```

- [ ] **Step 9: Run the gate and tests**

Run: `node scripts/check-ui.mjs`

Expected: `check-ui: PASS`.

Run: `npm test --workspace=client`

Expected: PASS.

Run: `npm run build:web`

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add client/src/App.jsx client/src/ApplicationAnswers.jsx client/src/CandidateMemory.jsx client/src/Routines.jsx client/src/SourceHealth.jsx client/src/web/WebStartup.jsx client/src/Landing.jsx scripts/check-ui.mjs
git commit -m "$(cat <<'EOF'
feat(ui): apply tokens to the shell and add theme, skip link and navigation semantics

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Portfolio landing page and browser theme proof

**Files:**
- Replace: `client/src/Landing.jsx`
- Modify: `client/src/index.css` (landing section)
- Create: `scripts/web-ui.mjs`

**Interfaces:**
- Consumes: `ThemeToggle`, `.panel`, `.skip-link`, `.reveal`, tokens.
- Produces: `scripts/web-ui.mjs` with the boot, first visit, toggle, system follow, keyboard, landing, skip link and responsive phases.

- [ ] **Step 1: Replace the landing page**

Replace `client/src/Landing.jsx` with:

```jsx
import { useEffect, useRef } from 'react';
import { ArrowRight, ArrowUpRight, MapPin } from 'lucide-react';
import SocialLinks, { SAFlag } from './SocialLinks.jsx';
import ThemeToggle from './ThemeToggle.jsx';

const WORK = [
  {
    name: 'SA-JAS',
    kicker: 'South African job agent suite',
    status: 'You are here',
    period: 'May to Jun 2026',
    summary: 'Three AI agents find South African vacancies, tailor an ATS-ready CV and cover letter, and walk a visible browser copilot through each application. The final Submit always stays with you.',
    stack: 'Electron, React, Express, Playwright, Claude',
    links: [{ label: 'Source', href: 'https://github.com/konethegreat/scratch' }],
    app: true
  },
  {
    name: 'ClearCut',
    kicker: 'Agent-native invoicing',
    status: 'Alpha, Apache-2.0',
    period: 'Oct 2026',
    summary: 'An agent-native invoicing core for South Africa, exposed as a REST API, an MCP server and a Claude plugin. Policy and people approve the work while the VAT rules stay tested code.',
    stack: 'Rust, PostgreSQL, MCP, TypeScript',
    links: [{ label: 'Source', href: 'https://github.com/konethegreat/clearcut' }]
  },
  {
    name: 'Vigil',
    kicker: 'Sovereign operational intelligence',
    status: 'In development',
    period: 'Sep 2026',
    summary: 'A sovereign operational-intelligence platform that models evidence, investigations and missions as a governed ontology. It is designed so no prompt leaves South Africa.',
    stack: 'Java, Python, Next.js, PostgreSQL, Ollama',
    links: [{ label: 'Source', href: 'https://github.com/konethegreat/Vigil' }]
  },
  {
    name: 'TimeLex',
    kicker: 'Autonomous practice management',
    status: 'Pre-alpha, Apache-2.0',
    period: 'Oct 2026',
    summary: 'An open, API-first practice management system that captures work signals and attributes them to the right matter with cited evidence. Small services sit behind REST, MCP and a Claude plugin.',
    stack: 'Rust, Python, TypeScript, PostgreSQL, MCP',
    links: [{ label: 'Source', href: 'https://github.com/konethegreat/timelex' }]
  },
  {
    name: 'Diary',
    kicker: 'Private AI life log',
    status: 'Public source, noncommercial',
    period: 'Jun 2026',
    summary: 'A private PWA that turns daily entries into an AI-coached life log. Ask it questions over local embeddings, with a runtime toggle between the Claude API and Ollama.',
    stack: 'Python, FastAPI, SQLite, Ollama',
    links: [{ label: 'Source', href: 'https://github.com/konethegreat/Diary' }]
  },
  {
    name: 'MuniSolve ZA',
    kicker: 'Municipal fault reporting',
    status: 'Live',
    period: 'Feb to Jun 2026',
    summary: 'Citizens report municipal faults and administrators triage them on a live heat map. A Claude-powered assistant answers citizen questions within a rate limit.',
    stack: 'React, Node.js, PostgreSQL, Prisma',
    links: [
      { label: 'Live', href: 'https://munisolve-za.vercel.app' },
      { label: 'Source', href: 'https://github.com/konethegreat/munisolve-za' }
    ]
  }
];

const PRINCIPLES = [
  {
    title: 'Evidence before confidence',
    body: 'Every agent claim should point at the source behind it. If the system cannot show its work, it says so.'
  },
  {
    title: 'Local first where it matters',
    body: 'Your key, your data and your machine are the boundary. Nothing leaves them without a reason you can see.'
  },
  {
    title: 'People make the final call',
    body: 'Agents can search, draft, check and prepare. A person decides what is sent and what is submitted.'
  }
];

export default function Landing({ onEnter }) {
  const railRef = useRef(null);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return undefined;
    const update = () => {
      const doc = document.documentElement;
      const max = doc.scrollHeight - doc.clientHeight;
      rail.style.transform = `scaleX(${max > 0 ? Math.min(1, doc.scrollTop / max) : 0})`;
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);

  return (
    <div className="landing">
      <div className="scroll-rail" aria-hidden="true"><span ref={railRef} /></div>
      <a className="skip-link" href="#main-content">Skip to main content</a>

      <header className="landing-header">
        <button type="button" className="brand-chip" onClick={() => window.scrollTo(0, 0)} title="Back to top">
          <SAFlag size={26} />
          <span className="brand-name">SA-JAS</span>
        </button>
        <nav className="landing-nav" aria-label="Sections">
          <a href="#work">Work</a>
          <a href="#approach">Approach</a>
          <a href="https://konethegreat.github.io" target="_blank" rel="noopener noreferrer">Portfolio</a>
        </nav>
        <div className="landing-actions">
          <ThemeToggle />
          <button type="button" className="btn-secondary" onClick={onEnter}>Open the app</button>
        </div>
      </header>

      <main id="main-content" tabIndex={-1} className="landing-main">
        <section className="landing-hero reveal" aria-labelledby="hero-title">
          <span className="eyebrow">AI systems engineer, Johannesburg</span>
          <h1 id="hero-title">Kone Tshivhinda</h1>
          <p className="hero-lede">
            I build AI systems that do real work: job agents, invoicing cores, legal practice tools and civic platforms.
            Most of it is shaped by South African constraints, with evidence checks and human approval built in.
          </p>
          <p className="hero-lede">
            I work solo across the stack, from Rust and Python services to React interfaces, and I publish the source
            and the tradeoffs.
          </p>
          <div className="hero-actions">
            <button type="button" className="btn-primary btn-lg" onClick={onEnter}>
              Enter the Suite <ArrowRight size={16} aria-hidden="true" />
            </button>
            <a className="btn-secondary btn-lg" href="#work">See selected work</a>
          </div>
          <div className="hero-meta">
            <span className="inline-meta"><MapPin size={14} aria-hidden="true" /> Johannesburg, South Africa</span>
            <SocialLinks size="sm" />
          </div>
        </section>

        <section className="landing-section reveal" id="work" aria-labelledby="work-title">
          <div className="landing-section-head">
            <h2 id="work-title">Selected work</h2>
            <p className="landing-section-sub">Six projects, public where possible.</p>
          </div>
          <div className="work-grid">
            {WORK.map((project) => (
              <article key={project.name} className="panel work-card">
                <div className="work-card-top">
                  <span className="work-meta">{project.period}</span>
                  <span className="badge badge-accent">{project.status}</span>
                </div>
                <div>
                  <h3>{project.name}</h3>
                  <p className="work-kicker">{project.kicker}</p>
                </div>
                <p>{project.summary}</p>
                <p className="work-stack">{project.stack}</p>
                <div className="work-links">
                  {project.app && (
                    <button type="button" className="work-link" onClick={onEnter}>
                      Open the app <ArrowRight size={12} aria-hidden="true" />
                    </button>
                  )}
                  {project.links.map((link) => (
                    <a key={link.href} className="work-link" href={link.href} target="_blank" rel="noopener noreferrer">
                      {link.label} <ArrowUpRight size={12} aria-hidden="true" />
                    </a>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-section reveal" id="approach" aria-labelledby="approach-title">
          <div className="landing-section-head">
            <h2 id="approach-title">Approach</h2>
            <p className="landing-section-sub">How I build.</p>
          </div>
          <div className="principles">
            {PRINCIPLES.map((principle) => (
              <div key={principle.title} className="panel principle">
                <h3>{principle.title}</h3>
                <p>{principle.body}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <span>Designed and built by Kone Tshivhinda. Johannesburg, South Africa. © {new Date().getFullYear()}.</span>
        <SocialLinks size="sm" />
      </footer>
    </div>
  );
}
```

- [ ] **Step 2: Add the landing styles**

Append to `client/src/index.css`:

```css
/* Landing */
.landing { min-height: 100vh; background: var(--bg-app); }

.scroll-rail {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  z-index: 100;
  background: transparent;
}
.scroll-rail span {
  display: block;
  height: 100%;
  background: var(--color-accent);
  transform: scaleX(0);
  transform-origin: 0 50%;
}

.landing-header {
  position: sticky;
  top: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px clamp(20px, 5vw, 64px);
  background: var(--bg-app);
  border-bottom: 1px solid var(--border);
}

.landing-nav { display: flex; align-items: center; gap: 18px; }
.landing-nav a {
  color: var(--text-secondary);
  text-decoration: none;
  font-size: 13px;
  font-weight: 600;
}
.landing-nav a:hover { color: var(--text-primary); }

.landing-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

.landing-main { padding: 0 clamp(20px, 5vw, 64px); }

.landing-hero {
  max-width: 980px;
  padding: clamp(56px, 10vh, 120px) 0 clamp(48px, 8vh, 96px);
}

.eyebrow {
  display: block;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 18px;
}

.landing-hero h1 {
  font-size: clamp(40px, 6vw, 72px);
  line-height: 1.02;
  letter-spacing: -0.035em;
  font-weight: 700;
  max-width: 12ch;
  margin-bottom: 24px;
}

.hero-lede {
  font-size: clamp(16px, 2vw, 19px);
  color: var(--text-secondary);
  max-width: 62ch;
  margin-bottom: 14px;
}
.hero-lede + .hero-lede { margin-bottom: 28px; }

.hero-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 24px; }
.hero-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; }

.landing-section {
  padding: clamp(40px, 7vh, 80px) 0;
  border-top: 1px solid var(--border);
}

.landing-section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 28px;
}

.landing-section h2 { font-size: clamp(24px, 3vw, 34px); }
.landing-section-sub { color: var(--text-muted); font-size: 13px; }

.work-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 18px;
}

.work-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 22px;
}

.work-card-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.work-meta {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.work-card h3 { font-size: 18px; }
.work-kicker { font-size: 12px; color: var(--text-muted); }
.work-card p { font-size: 13px; color: var(--text-secondary); }
.work-stack { font-size: 11.5px; color: var(--text-muted); }
.work-links { display: flex; flex-wrap: wrap; gap: 8px; margin-top: auto; padding-top: 6px; }

.work-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 11px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-secondary);
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
  transition: color 150ms ease, border-color 150ms ease;
}
.work-link:hover { color: var(--text-primary); border-color: var(--color-accent); }

.principles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
.principle { padding: 22px; }
.principle h3 { font-size: 16px; margin-bottom: 6px; }
.principle p { font-size: 13px; color: var(--text-secondary); }

.landing-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  padding: 28px clamp(20px, 5vw, 64px);
  border-top: 1px solid var(--border);
  color: var(--text-muted);
  font-size: 12.5px;
}

@media (max-width: 800px) {
  .landing-nav { display: none; }
  .principles { grid-template-columns: 1fr; }
}

@media (max-width: 560px) {
  .landing-header { flex-wrap: wrap; }
  .landing-actions { width: 100%; justify-content: space-between; }
}
```

- [ ] **Step 3: Write the browser proof**

Create `scripts/web-ui.mjs`:

```js
// Offline browser proof for the theme, the portfolio landing page, keyboard
// access, responsive layout and console cleanliness. All requests stay on the
// local static server.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { startStaticServer } from './lib/staticServer.mjs';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'client/dist');

const PROJECTS = ['SA-JAS', 'ClearCut', 'Vigil', 'TimeLex', 'Diary', 'MuniSolve ZA'];
const TOP_LINKS = [
  'https://konethegreat.github.io',
  'https://k-one-it-solutions-website.erictshivhinda.workers.dev',
  'https://github.com/konethegreat'
];

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function assertBuiltDist() {
  try {
    await fs.access(path.join(dist, 'index.html'));
  } catch {
    throw new Error('client/dist/index.html is missing. Run npm run build:web first.');
  }
}

async function themeOf(page) {
  return page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    choice: document.documentElement.dataset.themeChoice,
    colourScheme: document.documentElement.style.colorScheme,
    stored: localStorage.getItem('sajas-theme')
  }));
}

async function enterLanding(page) {
  await page.getByTestId('onboarding').waitFor({ timeout: 20_000 });
  await page.getByTestId('key-skip').click();
  await page.getByRole('button', { name: /Enter the Suite/i }).waitFor({ timeout: 15_000 });
}

async function main() {
  await assertBuiltDist();
  const server = await startStaticServer({ root: dist });
  const origin = new URL(server.url).origin;
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });

  try {
    // 1. Boot: with the React bundle blocked, the head script alone must set dark.
    {
      const context = await browser.newContext();
      await context.addInitScript(() => {
        try { localStorage.setItem('sajas-theme', 'dark'); } catch { /* first document */ }
      });
      const page = await context.newPage();
      await page.route('**/*', (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) return route.abort();
        if (url.pathname.endsWith('.js') && !url.pathname.endsWith('theme-boot.js')) return route.abort();
        return route.continue();
      });
      await page.goto(server.url, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark', null, { timeout: 10_000 });
      assert.equal(await page.evaluate(() => document.documentElement.dataset.themeChoice), 'dark');
      assert.equal(
        await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
        'rgb(11, 13, 18)',
        'the boot script did not paint the dark app surface before React loaded'
      );
      await context.close();
    }

    const context = await browser.newContext({ colorScheme: 'dark', viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    const requests = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('request', (request) => requests.push(request.url()));

    await page.goto(server.url, { waitUntil: 'networkidle' });

    // 2. First visit follows the OS.
    await page.getByTestId('onboarding').waitFor({ timeout: 20_000 });
    await page.getByTestId('theme-toggle').waitFor();
    assert.equal((await themeOf(page)).theme, 'dark');

    await enterLanding(page);

    // 3. Landing content.
    const heading = await page.locator('h1').count();
    assert.equal(heading, 1, 'the landing page must have exactly one h1');
    for (const name of PROJECTS) {
      assert.equal(
        await page.getByRole('heading', { name, exact: true }).count(),
        1,
        `the ${name} card heading is missing or duplicated`
      );
    }
    assert.equal(await page.getByText('Server Health Monitor', { exact: false }).count(), 0, 'excluded project on the landing page');
    assert.equal(await page.getByText('Mostoeneng', { exact: false }).count(), 0, 'excluded client work on the landing page');
    for (const href of TOP_LINKS) {
      assert.ok(await page.locator(`a[href="${href}"]`).count() > 0, `missing link ${href}`);
    }

    const order = await page.evaluate(() =>
      Array.from(document.querySelectorAll('h1,h2,h3')).map((element) => element.tagName)
    );
    let sawSection = false;
    for (const tag of order) {
      if (tag === 'H2') sawSection = true;
      if (tag === 'H3') assert.ok(sawSection, 'a card heading appears before a section heading');
    }

    // 4. Skip link.
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.className), 'skip-link');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.activeElement?.id === 'main-content');

    // 5. Toggle, persistence and system follow.
    await page.getByTestId('theme-light').click();
    let state = await themeOf(page);
    assert.equal(state.theme, 'light');
    assert.equal(state.choice, 'light');
    assert.equal(state.colourScheme, 'light');
    assert.equal(state.stored, 'light');

    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /Enter the Suite/i }).waitFor({ timeout: 15_000 });
    assert.equal((await themeOf(page)).theme, 'light', 'a stored light choice did not survive a dark OS reload');

    await page.getByTestId('theme-system').click();
    assert.equal((await themeOf(page)).theme, 'dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');

    // 6. Keyboard operation and a visible focus ring.
    for (let index = 0; index < 40; index += 1) {
      const active = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
      if (active === 'theme-dark') break;
      await page.keyboard.press('Tab');
    }
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-testid')), 'theme-dark');
    const ring = await page.evaluate(() => {
      const style = getComputedStyle(document.activeElement);
      return { width: style.outlineWidth, style: style.outlineStyle };
    });
    assert.notEqual(ring.style, 'none', 'the theme control has no visible focus ring');
    assert.notEqual(ring.width, '0px');
    await page.keyboard.press('Enter');
    assert.equal((await themeOf(page)).theme, 'dark');

    // 7. Enter the shell.
    await page.getByRole('button', { name: /Enter the Suite/i }).click();
    await page.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor({ timeout: 15_000 });
    assert.equal(await page.evaluate(() => document.body.style.overflowX), '', 'the shell sets a horizontal overflow hack');
    assert.equal(
      await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
      'rgb(11, 13, 18)'
    );

    // 8. Responsive layout on the dashboard and the landing page.
    for (const width of [360, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await delay(150);
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      assert.ok(overflow <= 1, `the dashboard overflows horizontally at ${width}px by ${overflow}px`);
    }
    await page.getByRole('button', { name: 'Home / About' }).click();
    await page.getByRole('button', { name: /Enter the Suite/i }).waitFor();
    for (const width of [360, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await delay(150);
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      assert.ok(overflow <= 1, `the landing page overflows horizontally at ${width}px by ${overflow}px`);
    }

    // 9. Reduced motion.
    {
      const reduced = await browser.newContext({ colorScheme: 'light', reducedMotion: 'reduce' });
      const reducedPage = await reduced.newPage();
      await reducedPage.goto(server.url, { waitUntil: 'networkidle' });
      await enterLanding(reducedPage);
      const reveal = await reducedPage.evaluate(() => {
        const element = document.querySelector('.reveal');
        if (!element) return null;
        const style = getComputedStyle(element);
        return { opacity: Number(style.opacity), duration: parseFloat(style.animationDuration) };
      });
      assert.ok(reveal, 'the landing page has no reveal element');
      assert.ok(reveal.opacity > 0.99, 'a reduced-motion reveal element stays hidden');
      assert.ok(reveal.duration < 0.02, `reduced motion still animates for ${reveal.duration}s`);
      await reduced.close();
    }

    // 10. No off-origin request and no console error.
    assert.deepEqual(
      requests.filter((url) => new URL(url).origin !== origin),
      [],
      'the landing and dashboard reached an origin outside the local bundle'
    );
    assert.deepEqual(errors, [], `console errors: ${errors.join(' | ')}`);

    await context.close();
    console.log(`web ui: PASS (${requests.length} requests checked)`);
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((error) => {
  console.error(`web ui: FAIL - ${error.message}`);
  process.exitCode = 1;
});
```

- [ ] **Step 4: Run the browser proof**

Run: `npm run build:web`

Run: `node scripts/web-ui.mjs`

Expected: `web ui: PASS`. If the skip link is not first, reorder the DOM so the anchor precedes the header. If a project heading count differs, correct the duplicate or missing card.

- [ ] **Step 5: Run the existing web suite**

Run: `npm run test:web`

Expected: PASS. The canary, feeds and isolation scripts must not need selector changes.

- [ ] **Step 6: Commit**

```bash
git add client/src/Landing.jsx client/src/index.css scripts/web-ui.mjs
git commit -m "$(cat <<'EOF'
feat(ui): rebuild the home page as a portfolio and prove the theme in a browser

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Dialog and toast accessibility

**Files:**
- Create: `client/src/Dialog.jsx`
- Modify: `client/src/App.jsx` (`ConfirmModal`, `AddJobModal`, `ToastStack`)
- Modify: `scripts/web-ui.mjs` (dialog and toast phases)

**Interfaces:**
- Consumes: `.modal-overlay`, `.modal-card`, `.modal-card-wide` from Task 2, `.toast` roles.
- Produces: `Dialog` default export with props `open`, `labelledBy`, `onClose`, `initialFocus`, `className`, `children`.

- [ ] **Step 1: Add the failing browser phases**

In `scripts/web-ui.mjs`, after the dashboard responsive block and before the reduced motion block, insert:

```js
    // 8b. Dialog semantics, focus restoration and a named close action.
    const addTrigger = page.getByRole('button', { name: 'Add manually' });
    await addTrigger.click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor({ timeout: 10_000 });
    assert.equal(await dialog.getAttribute('aria-modal'), 'true');
    const labelledBy = await dialog.getAttribute('aria-labelledby');
    assert.ok(labelledBy, 'the dialog has no aria-labelledby');
    assert.ok((await page.locator(`#${labelledBy}`).innerText()).length > 0, 'the dialog label is empty');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'add-job-title-input');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    assert.equal(
      await page.evaluate(() => document.activeElement?.textContent?.includes('Add manually')),
      true,
      'focus did not return to the trigger'
    );

    // 8c. Toast live role and a named dismiss button.
    await addTrigger.click();
    await page.locator('#add-job-title-input').fill('Backend engineer');
    await page.locator('#add-job-company-input').fill('Example Studio');
    await page.getByRole('button', { name: 'Add job', exact: true }).click();
    const toast = page.locator('.toast.toast-success').last();
    await toast.waitFor({ timeout: 10_000 });
    assert.equal(await toast.getAttribute('role'), 'status');
    assert.equal(await toast.getAttribute('aria-atomic'), 'true');
    assert.equal(await toast.getByRole('button', { name: 'Dismiss notification' }).count(), 1);
```

If adding a job shows a different toast type, use the actual success toast and keep the `role="status"` assertion.

- [ ] **Step 2: Run the browser proof and confirm it fails**

Run: `node scripts/web-ui.mjs`

Expected: FAIL because the dialog has no `role`, no labelled title, and the close button has no name.

- [ ] **Step 3: Implement the dialog wrapper**

Create `client/src/Dialog.jsx`:

```jsx
import { useEffect, useRef } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

export default function Dialog({ open, labelledBy, onClose, initialFocus, className = '', children }) {
  const cardRef = useRef(null);
  const restoreRef = useRef(null);
  const closeRef = useRef(onClose);
  const initialRef = useRef(initialFocus);
  closeRef.current = onClose;
  initialRef.current = initialFocus;

  useEffect(() => {
    if (!open) return undefined;
    restoreRef.current = document.activeElement;
    const card = cardRef.current;
    const target = initialRef.current?.current || card?.querySelector(FOCUSABLE) || card;
    target?.focus();
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab' || !card) return;
      const items = Array.from(card.querySelectorAll(FOCUSABLE)).filter((element) => element.offsetParent !== null);
      if (items.length === 0) {
        event.preventDefault();
        card.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const previous = restoreRef.current;
      if (previous && typeof previous.focus === 'function') previous.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeRef.current();
      }}
    >
      <div
        className={`modal-card fade-in ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        ref={cardRef}
      >
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Use the wrapper in both dialogs**

Replace `ConfirmModal` with:

```jsx
function ConfirmModal({ open, title, message, confirmLabel = 'Confirm', danger = false, onConfirm, onCancel }) {
  return (
    <Dialog open={open} labelledBy="confirm-title" onClose={onCancel}>
      <h3 id="confirm-title" style={{ fontSize: '18px', marginBottom: '8px' }}>{title}</h3>
      <p className="muted" style={{ fontSize: '13px', marginBottom: '20px' }}>{message}</p>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
        <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
        <button type="button" className={danger ? 'btn-danger' : 'btn-primary'} onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </Dialog>
  );
}
```

Replace `AddJobModal` with:

```jsx
function AddJobModal({ open, onClose, onSubmit }) {
  const [form, setForm] = useState({ title: '', company: '', location: '', applyUrl: '', description: '' });
  const titleRef = useRef(null);
  const submit = (event) => {
    event.preventDefault();
    if (!form.title || !form.company) return;
    onSubmit(form);
    setForm({ title: '', company: '', location: '', applyUrl: '', description: '' });
  };
  return (
    <Dialog open={open} labelledBy="add-job-title" onClose={onClose} initialFocus={titleRef} className="modal-card-wide">
      <div className="flex-between" style={{ marginBottom: 16 }}>
        <h3 id="add-job-title" style={{ fontSize: '18px' }}>Add a job manually</h3>
        <button type="button" className="btn-ghost btn-xs" onClick={onClose} aria-label="Close dialog">
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label htmlFor="add-job-title-input">Job title *</label>
          <input id="add-job-title-input" ref={titleRef} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required />
        </div>
        <div className="grid-2">
          <div>
            <label htmlFor="add-job-company-input">Company *</label>
            <input id="add-job-company-input" value={form.company} onChange={(event) => setForm({ ...form, company: event.target.value })} required />
          </div>
          <div>
            <label htmlFor="add-job-location-input">Location</label>
            <input id="add-job-location-input" value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder="e.g. Cape Town" />
          </div>
        </div>
        <div>
          <label htmlFor="add-job-url-input">Apply URL</label>
          <input id="add-job-url-input" value={form.applyUrl} onChange={(event) => setForm({ ...form, applyUrl: event.target.value })} placeholder="https://..." />
        </div>
        <div>
          <label htmlFor="add-job-description-input">Description and requirements</label>
          <textarea
            id="add-job-description-input"
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
            style={{ minHeight: 140, fontSize: 12 }}
            placeholder="Paste the job description so the tailor agent has context to work with."
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary"><Plus size={14} aria-hidden="true" /> Add job</button>
        </div>
      </form>
    </Dialog>
  );
}
```

Add the import near the other component imports:

```jsx
import Dialog from './Dialog.jsx';
```

- [ ] **Step 5: Give toasts live roles and a named close button**

Replace `ToastStack` with:

```jsx
function ToastStack({ toasts, onClose }) {
  return (
    <div className="toast-stack">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast toast-${toast.type}`}
          role={toast.type === 'error' ? 'alert' : 'status'}
          aria-atomic="true"
        >
          <span className="toast-icon" aria-hidden="true">
            {toast.type === 'success' && <CheckCircle2 size={16} color="var(--color-success)" />}
            {toast.type === 'error'   && <AlertTriangle size={16} color="var(--color-error)" />}
            {toast.type === 'info'    && <Info size={16} color="var(--color-info)" />}
          </span>
          <div className="toast-body">
            <div className="toast-title">{toast.title}</div>
            <div className="toast-msg">{toast.msg}</div>
          </div>
          <button type="button" className="toast-close" onClick={() => onClose(toast.id)} aria-label="Dismiss notification">
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Run the browser proof**

Run: `npm run build:web`

Run: `node scripts/web-ui.mjs`

Expected: `web ui: PASS`.

- [ ] **Step 7: Commit**

```bash
git add client/src/Dialog.jsx client/src/App.jsx scripts/web-ui.mjs
git commit -m "$(cat <<'EOF'
feat(ui): add dialog focus handling and live toast roles

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Copy sweep and full design gate

**Files:**
- Modify: `client/src/App.jsx`
- Modify: `client/src/ApplicationAnswers.jsx`
- Modify: `client/src/CandidateMemory.jsx`
- Modify: `client/src/Routines.jsx`
- Modify: `client/src/SocialLinks.jsx`
- Modify: `client/src/SourceHealth.jsx`
- Modify: `client/src/main.jsx`
- Modify: `client/src/web/install.js`
- Modify: `client/src/web/keyCrypto.js`
- Modify: `scripts/check-ui.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: every prior task.
- Produces: zero em dashes and zero emoji in client source, `check-ui` in `npm run test:web`, and `web-ui` in `npm run test:web`.

- [ ] **Step 1: Extend the gate with copy checks**

In `scripts/check-ui.mjs`, after the JSX loop and before the `index.html` block, add:

```js
  const copyFiles = [...jsxFiles, path.join(client, 'src/index.css'), path.join(client, 'public/theme-boot.js')];
  for (const file of copyFiles) {
    const relative = path.relative(root, file);
    const text = await fs.readFile(file, 'utf8');
    assert.equal(text.includes('\u2014'), false, `${relative} contains an em dash`);
    assert.equal(
      /[\u{1F000}-\u{1FAFF}\u{25A0}-\u{27BF}]/u.test(text),
      false,
      `${relative} contains an emoji`
    );
  }
  {
    const html = await fs.readFile(path.join(client, 'index.html'), 'utf8');
    assert.equal(html.includes('\u2014'), false, 'client/index.html contains an em dash');
    assert.equal(/[\u{1F000}-\u{1FAFF}\u{25A0}-\u{27BF}]/u.test(html), false, 'client/index.html contains an emoji');
  }
```

Add `client/src/main.jsx`, `client/src/web/install.js` and `client/src/web/keyCrypto.js` to the scan by including `.js` files under `src`:

```js
  const sourceFiles = [];
  for (const entry of await fs.readdir(path.join(client, 'src'), { recursive: true, withFileTypes: true })) {
    if (entry.isFile() && /\.(js|jsx|css)$/.test(entry.name)) {
      sourceFiles.push(path.join(entry.parentPath, entry.name));
    }
  }
  for (const file of sourceFiles) {
    const relative = path.relative(root, file);
    const text = await fs.readFile(file, 'utf8');
    assert.equal(text.includes('\u2014'), false, `${relative} contains an em dash`);
    assert.equal(
      /[\u{1F000}-\u{1FAFF}\u{25A0}-\u{27BF}]/u.test(text),
      false,
      `${relative} contains an emoji`
    );
  }
```

Place this block after the JSX loop. It supersedes the copy block above, so keep only one implementation.

- [ ] **Step 2: Run the gate and confirm it fails**

Run: `node scripts/check-ui.mjs`

Expected: FAIL naming the first file with an em dash.

- [ ] **Step 3: Remove every em dash**

Run this to list the remaining sites:

```bash
grep -rn $'\u2014' client/src client/index.html client/public/theme-boot.js
```

Apply this decision rule to every match:

1. If the dash separates two complete sentences, replace it with a period and a space.
2. If the second half explains or expands the first, replace it with a colon and a space.
3. If the second half is a parenthetical, replace it with a comma and a space.
4. Code comments take rule 2. Null placeholders become `Not set` or `Select an option`.
5. Never leave a double space or a space before punctuation.

The user-facing strings must read exactly as follows:

`client/src/App.jsx`:

| New copy |
|---|
| `Couldn't confirm this link (site blocked the check or timed out). Open with care.` |
| `A re-check found this posting is gone (expired or removed). Kept so you can decide, but the link likely won't work.` |
| `Browser opened with LinkedIn and Indeed sign-in pages. Log in, then close the window. Your sessions will be saved for all future scraping runs.` |
| `${labels[mode] || mode} mode applied. Every cost toggle updated.` |
| `Claude web search first, then 12 South African job boards, with link checks.` |
| `After you apply, reach a real engineer at the company. Finds a senior contact and drafts a peer-to-peer message for you to review and send.` |
| `Schedule unattended hunts that find jobs, and optionally tailor them, while you sleep. They never apply for you.` |
| `Learned insights, employer notes and what wins. Read by all three agents.` |
| `Re-check saved job links. Flags ones that have since expired, never deletes.` |
| `Search thoroughness. Change it in Settings, then Job Search.` |
| `to open a human conversation. <strong>Nothing is sent automatically</strong>. You review, edit, and reach out.` |
| `Browser steps, AI calls and database changes, all streamed live.` |
| `Estimated spend across every AI feature. Your Anthropic invoice is the source of truth. Set a daily cap to hard-stop AI calls when it is reached; it resets at midnight.` |
| `How much AI the copilot uses while walking application forms. Each step up is smarter and costs more.` |
| `Apply Copilot: smart page understanding (planner)` |
| `AI vision fallback (experimental, uses more credit)` |
| `Computer-use form filler (advanced, highest cost)` |
| `It <strong>never clicks Submit</strong>, which is hard-blocked in code, and stops on any CAPTCHA.` |
| `Before tailoring, a sub-agent uses <strong>live web search</strong> to research each employer and role (sector, recent news, salary context) so the cover letter is specific to the company, not generic. <strong>Anthropic key required</strong>; web search is billed (~$10/1,000) and it is the most token-hungry tailoring add-on, so it is off by default. Briefs are gathered in parallel across a batch.` |
| `Structured outputs for reliable form-filling and planning` |
| `Forces the AI to return guaranteed-valid JSON when mapping forms and planning pages, removing a whole class of parsing errors. No extra cost. Recommended on. Switch off only if you hit a schema error.` |
| `Prompt caching for cheaper repeat tailoring` |
| `Candidate memory that learns from each application` |
| `After each confirmed application, the AI distils a few durable insights about you (strengths, preferences, what you said) into your <strong>Candidate Memory</strong> dossier, which all three agents then read. Uses your Anthropic key; costs one small call per application. Turn off to keep memory manual-only. The dossier still records your application history either way.` |
| `Dreaming: let memory learn what wins` |
| `A periodic reflective pass that reviews your application <strong>outcomes</strong> (interview or offer versus rejected) and curates the dossier: strengthening the insights and phrasings that keep winning, dropping noise. Run it on a schedule via a <strong>Reflect and learn</strong> routine, or on demand with <strong>Reflect now</strong> in the Candidate Memory tab. Uses your Anthropic key; one small call per pass. Your manually-added insights are never removed.` |
| `AI job search (Claude live web search), primary engine` |
| `Uses your <strong>Anthropic API key</strong> to search the live web for real SA vacancies (grounded, with source links, not invented). This is the most reliable source; the site scrapers run as a fallback. Web search is billed by Anthropic (~$10/1,000 searches) and must be enabled in your Anthropic Console.` |
| `Light: cheapest (2 web searches per keyword, ~10 results)` |
| `Standard: recommended (5 searches per keyword, ~20 results)` |
| `Deep: most thorough (8 searches + a second pass per keyword)` |
| `Deep runs a second, differently-targeted search round per keyword (PNet, CareerJunction, employer ATS pages) so far fewer roles slip through, at roughly double the search cost.` |
| `Before a job is saved, its link is shape-checked and opened (browser-grade) to confirm the advert is live, so <strong>only confirmed-dead links are dropped</strong>. Links on junk repost-aggregators (Jooble, Jobrapido, WhatJobs and similar) are stripped so the copilot never lands on them. Anything we cannot confirm is kept and flagged <em>Unverified</em>. Adds a few seconds per run.` |
| `When a found job has no usable apply link, ask Claude (grounded web search) to find the real posting URL, then re-verify it before saving. <strong>Billed per search and capped per run</strong>, so it is off by default. Turn it on if you want fewer linkless leads.` |
| `Sign in to all 6 SA job sites at once. Sessions are saved to your persistent browser profile and reused by every future scraping run, with no need to sign in again.` |
| `Browser open. Sign in, then close the window.` |
| `Opens Chrome with login tabs for LinkedIn, Indeed SA, PNet, CareerJunction &amp; Gumtree SA. Do this once. Sessions are saved permanently to your browser profile.` |
| `Upload your ID, matric certificate, qualification and academic record once. <strong>PDF only, max 15 MB</strong>.` |
| `Hunter is running. Results will appear here when it finishes.` |
| `AI Search is on but no Anthropic key is set, so it was skipped, and the scrapers returned nothing. Add an Anthropic key to enable AI search.` |
| `Couldn't confirm (bot-blocked or timeout). Kept anyway` |
| `Kept as leads, with no direct apply link` |
| `${m.label}: $${fmtPrice(m.inputPerMTok)} / $${fmtPrice(m.outputPerMTok)} per MTok${m.optIn ? ' (opt-in)' : ''}` |
| `Current mode: <strong>Custom</strong>. Your settings do not exactly match a preset. Click a card to snap every cost toggle to that bundle.` |
| `No AI calls recorded today yet. Run the hunter or tailor a job and the breakdown appears here.` |
| `0 = no cap. When today's estimated spend reaches the cap, <strong>every AI call refuses</strong> (hunter AI search, tailoring, smart-fill, research, dreaming) until midnight. Costs are estimates from public pricing. Check the Anthropic Console for exact billing. Click <strong>Save configuration</strong> to apply a new cap.` |
| `Outreach channel ready. Search link and draft message.` |
| `Skip the ATS and reach a human` |
| `Draft a message you can send for a referral. Drafts only, nothing is sent automatically.` |

`client/src/ApplicationAnswers.jsx`:

| New copy |
|---|
| `Saved to your answer bank. It will auto-fill next time.` |
| `Set them yourself. Demographics and salary are never guessed. Everything is optional and stored locally only. Your ID or passport number is intentionally not saved here. Paste it per application.` |
| `Select an option` (the select placeholder) |

`client/src/CandidateMemory.jsx`:

| New copy |
|---|
| `Outcome updated. The suite learns from this.` |
| `` `Reflection done. Reinforced ${r.reinforced || 0}, pruned ${r.pruned || 0}, added ${r.added || 0}.` `` |
| `Last reflected {new Date(mem.lastDream.at).toLocaleString()}. Reinforced {mem.lastDream.reinforced || 0}, pruned {mem.lastDream.pruned || 0}, added {mem.lastDream.added || 0}.` |

`client/src/Routines.jsx`:

| New copy |
|---|
| `Routines find and prepare. They never apply for you.` |
| `It will <strong>never open the Apply Copilot or submit an application</strong>.` |
| `No hunting. Reviews your past application outcomes and curates your Candidate Memory: strengthens what wins interviews, drops noise. One small AI call. Best run nightly.` |

`client/src/SocialLinks.jsx`:

| New copy |
|---|
| `Inline South African flag. Windows cannot render the flag emoji, so it shows as text, which made the logo read incorrectly.` |
| `Kone's public profiles, reused in the app header, footer and landing page.` |

`client/src/SourceHealth.jsx`:

| New copy |
|---|
| `What each registry source returned last run, and what needs attention.` |
| `Not set` (the null last-run placeholder) |
| `All sources are unknown. Run the crawler to collect health data.` |
| `All sources are unknown. Launch the crawler or test sources to collect health data.` |

`client/src/web/keyCrypto.js`:

| New copy |
|---|
| `Try again. The saved key cannot be recovered without its passphrase.` |

Code comments in `App.jsx`, `main.jsx`, `web/install.js`, `ApplicationAnswers.jsx`, `CandidateMemory.jsx` and `Routines.jsx` take rule 2. Example: `// API-key reveal state: when toggled, the user is "replacing" the saved key`.

- [ ] **Step 4: Confirm the sweep**

Run: `grep -rn $'\u2014' client/src client/index.html client/public/theme-boot.js`

Expected: no output.

Run: `node scripts/check-ui.mjs`

Expected: `check-ui: PASS`.

- [ ] **Step 5: Wire the gate and browser proof into `test:web`**

In `package.json`, replace the `test:web` line with:

```json
    "test:web": "node scripts/check-ui.mjs && node scripts/web-canary.mjs && node scripts/web-feeds.mjs && node scripts/web-isolation.mjs && node scripts/web-ui.mjs",
```

- [ ] **Step 6: Run the whole web suite**

Run: `npm run build:web`

Run: `npm run test:web`

Expected: `check-ui: PASS`, `web canary: PASS`, feeds PASS, isolation PASS, `web ui: PASS`.

- [ ] **Step 7: Commit**

```bash
git add client/src/App.jsx client/src/ApplicationAnswers.jsx client/src/CandidateMemory.jsx client/src/Routines.jsx client/src/SocialLinks.jsx client/src/SourceHealth.jsx client/src/main.jsx client/src/web/install.js client/src/web/keyCrypto.js scripts/check-ui.mjs package.json
git commit -m "$(cat <<'EOF'
chore(ui): remove em dashes and wire the design gate into the web suite

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Docs, full gates, PR, merge and deploy

**Files:**
- Modify: `docs/superpowers/specs/2026-10-27-ui-ux-refresh-design.md`
- Modify: `docs/superpowers/specs/2026-10-27-post-m3a3-pipeline.md`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: a green PR, a deployed bundle, and a live smoke record.

- [ ] **Step 1: Mark the design spec implemented**

In `docs/superpowers/specs/2026-10-27-ui-ux-refresh-design.md`, change:

```markdown
**Status:** proposed for review
```

to:

```markdown
**Status:** implemented 2026-10-27
```

- [ ] **Step 2: Mark Arc 3 shipped in the pipeline**

In `docs/superpowers/specs/2026-10-27-post-m3a3-pipeline.md`, change the Arc 3 row to:

```markdown
| 3 | UI/UX refresh | Shipped 2026-10-27 (PR #<number from gh pr create>) | Light mode, copy sweep and the new home page pass the acceptance list below |
```

Below the Arc 3 acceptance criteria, add:

```markdown
**Shipped 2026-10-27 in PR #<number>.** Evidence: `npm run test:web` runs `scripts/check-ui.mjs` (tokens, AA contrast, zero em dashes, zero emoji, script order) and `scripts/web-ui.mjs` (pre-paint boot, first visit, toggle, system follow, keyboard, landing content, skip link, dialog, toast, 360/768/1280, reduced motion, console and network surface).
```

Replace `<number from gh pr create>` and `<number>` with the real PR number in Step 6.

- [ ] **Step 3: Run every gate**

From `sa-job-agent-suite/`:

```bash
npm test
npm run test:demo
npm run build:client
npm run build:web
npm run test:web
node tools/check-secrets.mjs --all
```

Expected: every command exits 0. If `test:demo` needs Chromium and it is missing, run `npx playwright install chromium` and retry. Do not set an API key.

- [ ] **Step 4: Check the diff for copy and secrets**

Run:

```bash
git diff --stat 8b1a76b..HEAD
git diff 8b1a76b..HEAD | grep -n $'\u2014'
```

Expected: the stat lists only Arc 3 files and the em dash search returns nothing.

- [ ] **Step 5: Commit the docs**

```bash
git add ../docs/superpowers/specs/2026-10-27-ui-ux-refresh-design.md ../docs/superpowers/specs/2026-10-27-post-m3a3-pipeline.md
git commit -m "$(cat <<'EOF'
docs: record the UI refresh as shipped

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Open the PR**

Push the branch and open the PR:

```bash
git push -u origin feat/ui-ux-refresh
gh pr create --title "feat(ui): light-first design system, theme and portfolio home" --body "$(cat <<'EOF'
## Summary
- Adds a light-first token system with a dark theme, a persisted three-state choice and a pre-paint boot script.
- Replaces the aurora, blur, gradient and emoji visual language with restrained surfaces, one accent and Lucide icons.
- Rebuilds the home page as a portfolio for SA-JAS, ClearCut, Vigil, TimeLex, Diary and MuniSolve ZA.
- Adds skip links, navigation semantics, dialog focus handling, live toast roles and AA contrast in both themes.
- Adds `scripts/check-ui.mjs` and `scripts/web-ui.mjs` to `npm run test:web`.

## Test plan
- [ ] `npm test`
- [ ] `npm run test:demo`
- [ ] `npm run build:client`
- [ ] `npm run build:web`
- [ ] `npm run test:web`
- [ ] `node tools/check-secrets.mjs --all`
- [ ] Open the deployed URL and check the theme toggle, the six project cards and the skip link

No em dashes. No API key. No change to the key lifecycle, storage, backup, CSP or headers.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 7: Put the PR number in the docs**

Take the number printed by `gh pr create`, replace both placeholders in the pipeline document, and amend the docs commit only if the branch has not been reviewed yet. Otherwise add a new commit:

```bash
git add ../docs/superpowers/specs/2026-10-27-post-m3a3-pipeline.md
git commit -m "$(cat <<'EOF'
docs: link the UI refresh to its PR

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
git push
```

- [ ] **Step 8: Merge when green**

```bash
gh pr checks --watch
gh pr merge --squash --delete-branch
```

Expected: all checks green, then the squash merge succeeds. If a check fails, fix the cause on the branch and push again. Never use `--no-verify`.

- [ ] **Step 9: Deploy and verify live**

```bash
git checkout main
git pull
npm run build:web
npx wrangler pages deploy client/dist --project-name sajas --branch main
```

Open `https://sajas.pages.dev` in a fresh Playwright context with no key and verify:

1. Onboarding shows the theme dock and follows the OS theme.
2. Skipping the key lands on the portfolio page with six cards and no excluded project.
3. Light, Dark and System all apply and persist after a reload.
4. The landing page names only the approved projects and links the portfolio, studio site and GitHub.
5. The response headers still include `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `Cross-Origin-Resource-Policy: same-origin`.
6. No request leaves the page origin before the key is used.

Record the result in the PR description as a short comment. If any item fails, fix it in a follow-up commit and redeploy.

---

## Self-review

- **Spec coverage:** theme states and persistence (Task 1), no flash (Tasks 1 and 4), light and dark tokens (Task 2), typography and surfaces (Task 2), motion and reduced motion (Tasks 2 and 4), screens and copy (Tasks 3, 4 and 6), accessibility (Tasks 3, 4 and 5), testing (Tasks 4, 5, 6 and 7), deployment (Task 7).
- **Placeholders:** the only placeholders are the PR number in Task 7, filled from the command output in the same task.
- **Type consistency:** `THEME_KEY`, `THEME_CHOICES`, `normalizeChoice`, `resolveTheme`, `getChoice`, `applyChoice`, `setChoice`, `subscribe` and `useThemeChoice` are defined once in Task 1 and consumed with the same names in Tasks 3, 4 and 5. `Dialog` props are defined once and used once.
