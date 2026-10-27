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
