import test from 'node:test';
import assert from 'node:assert/strict';
import { getDemoRuntime, resetDemoRuntime } from './runtime.js';
import { DEMO_PREFIX } from './sessionAdapter.js';

const API_BASE = 'http://localhost:5000/api';

function fakeSession() {
  const map = new Map();
  return {
    get length() { return map.size; },
    key(index) { return [...map.keys()][index] ?? null; },
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(String(key), String(value)); },
    removeItem(key) { map.delete(key); },
    clear() { map.clear(); }
  };
}

test.beforeEach(() => { globalThis.sessionStorage = fakeSession(); });
test.afterEach(async () => { await resetDemoRuntime(); delete globalThis.sessionStorage; });

test('the demo runtime seeds once, reports a key and answers profile', async () => {
  const runtime = await getDemoRuntime({ apiBase: API_BASE, now: () => new Date('2026-10-28T10:00:00Z') });
  assert.equal(runtime.persistent, true);
  assert.equal(runtime.keyStore.hasKey(), true);
  assert.equal(runtime.keyStore.getKey(), null);
  const response = await runtime.api.handle(`${API_BASE}/profile`, { method: 'GET' });
  const body = await response.json();
  assert.equal(body.fullName, 'Alex Example');
  assert.equal(body.hasAnthropicKey, true);
});

test('a second call returns the same runtime', async () => {
  const first = await getDemoRuntime({ apiBase: API_BASE });
  const second = await getDemoRuntime({ apiBase: API_BASE });
  assert.equal(first, second);
});

test('reset wipes every demo key and nothing else', async () => {
  globalThis.sessionStorage.setItem('sajas:real:keep', '1');
  await getDemoRuntime({ apiBase: API_BASE });
  await resetDemoRuntime();
  const keys = [];
  for (let index = 0; index < globalThis.sessionStorage.length; index += 1) {
    keys.push(globalThis.sessionStorage.key(index));
  }
  assert.deepEqual(keys.filter((key) => key.startsWith(DEMO_PREFIX)), []);
  assert.deepEqual(keys, ['sajas:real:keep']);
});
