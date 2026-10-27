import test from 'node:test';
import assert from 'node:assert/strict';
import { createVault, STORES } from './vault.js';
import { createMemoryAdapter } from './memoryAdapter.js';
import { createKeyStore } from './keyStore.js';
import { createActivity } from './activity.js';
import { createWebApi } from './api.js';

const API_BASE = 'http://localhost:5000/api';
const API_KEY = ['sk', 'ant', 'api03', 'G'.repeat(24)].join('-');
const ADMIN_KEY = ['sk', 'ant', 'admin01', 'H'.repeat(24)].join('-');

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
  assert.equal(JSON.stringify(await vault.exportAll()).includes(API_KEY), false);
});

test('an admin or malformed key is rejected and not stored', async () => {
  const { call, keyStore } = harness();
  for (const [value, code] of [[ADMIN_KEY, 'KEY_ADMIN'], ['sk-nope', 'KEY_INVALID']]) {
    const res = await call('/profile', { method: 'POST', body: { anthropicApiKey: value } });
    assert.equal(res.status, 400);
    const body = await json(res);
    assert.equal(body.code, code);
    assert.equal(body.error, body.message);
    assert.equal(JSON.stringify(body).includes(value), false);
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
    const body = await json(res);
    assert.equal(body.code, 'NOT_SUPPORTED_IN_WEB');
    assert.ok(body.hint);
    assert.equal(body.retryable, false);
    assert.ok(body.requestId);
  }
});

test('an unknown endpoint is a NOT_FOUND contract', async () => {
  const { call } = harness();
  const res = await call('/nothing-here');
  assert.equal(res.status, 404);
  const body = await json(res);
  assert.equal(body.code, 'NOT_FOUND');
  assert.equal(body.error, body.message);
  assert.ok(body.hint);
  assert.equal(body.retryable, false);
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
