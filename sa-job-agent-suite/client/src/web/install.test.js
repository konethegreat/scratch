import test from 'node:test';
import assert from 'node:assert/strict';
import { installWebApi } from './install.js';
import { createVault } from './vault.js';
import { createMemoryAdapter } from './memoryAdapter.js';
import { createKeyStore } from './keyStore.js';
import { createActivity } from './activity.js';
import { createWebApi } from './api.js';

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

test('an unknown API path is answered locally and never reaches the network', async () => {
  const vault = createVault(createMemoryAdapter());
  const keyStore = createKeyStore({ vault });
  const activity = createActivity();
  const api = createWebApi({ apiBase: API_BASE, vault, keyStore, activity });
  const nativeCalls = [];
  const fetchImpl = installWebApi({
    apiBase: API_BASE,
    handler: api.handle,
    nativeFetch: async (input) => { nativeCalls.push(input); return new Response('native'); }
  });

  const res = await fetchImpl(`${API_BASE}/nothing-here`);
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.code, 'NOT_FOUND');
  assert.equal(body.error, body.message);
  assert.ok(body.requestId);
  assert.equal(nativeCalls.length, 0);

  const unsupported = await fetchImpl(`${API_BASE}/jobs/hunter`, { method: 'POST' });
  assert.equal(unsupported.status, 501);
  assert.equal((await unsupported.json()).code, 'NOT_SUPPORTED_IN_WEB');
  assert.equal(nativeCalls.length, 0);
});

test('the dispatcher switches handlers without being reinstalled', async () => {
  let mode = 'real';
  const fetchImpl = installWebApi({
    apiBase: API_BASE,
    handler: async () => new Response(JSON.stringify({ mode })),
    nativeFetch: async () => { throw new Error('native fetch must not run'); }
  });
  const first = await (await fetchImpl(`${API_BASE}/profile`)).json();
  assert.equal(first.mode, 'real');
  mode = 'demo';
  const second = await (await fetchImpl(`${API_BASE}/profile`)).json();
  assert.equal(second.mode, 'demo');
});
