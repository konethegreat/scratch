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

test('export -> wipe -> import keeps record keys and values', async () => {
  const { vault } = make();
  const profile = { fullName: 'Thandi', email: 'thandi@example.com' };
  const job = { title: 'Backend Engineer', company: 'Acme' };
  const meta = { onboarded: true, theme: 'dark' };
  await vault.put(STORES.profile, 'current', profile);
  await vault.put(STORES.jobs, 'job-42', job);
  await vault.put(STORES.meta, 'app', meta);

  const dump = await vault.exportAll();
  assert.deepEqual(dump.data.profile, { current: profile });
  assert.deepEqual(dump.data.jobs, { 'job-42': job });
  assert.deepEqual(dump.data.meta, { app: meta });
  assert.equal(Object.hasOwn(dump.data, 'keyVault'), false);

  await vault.wipe();
  assert.equal(await vault.get(STORES.profile, 'current'), undefined);
  assert.equal(await vault.get(STORES.meta, 'app'), undefined);
  assert.equal(await vault.get(STORES.jobs, 'job-42'), undefined);

  await vault.importAll(dump);
  assert.deepEqual(await vault.get(STORES.profile, 'current'), profile);
  assert.deepEqual(await vault.get(STORES.meta, 'app'), meta);
  assert.deepEqual(await vault.get(STORES.jobs, 'job-42'), job);
  assert.equal(Object.hasOwn(dump.data, 'keyVault'), false);
});

function backup(data) {
  return { app: 'sajas-web', schemaVersion: 1, exportedAt: '2026-10-27T00:00:00.000Z', data };
}

async function seedExisting(vault) {
  await vault.put(STORES.profile, 'current', { fullName: 'Keep Me' });
  await vault.put(STORES.jobs, 'job-1', { title: 'Keep Me' });
}

function assertExisting(vault) {
  return Promise.all([
    (async () => assert.deepEqual(await vault.get(STORES.profile, 'current'), { fullName: 'Keep Me' }))(),
    (async () => assert.deepEqual(await vault.get(STORES.jobs, 'job-1'), { title: 'Keep Me' }))()
  ]);
}

test('import rejects an empty data object and leaves existing records intact', async () => {
  const { vault } = make();
  await seedExisting(vault);
  await assert.rejects(() => vault.importAll(backup({})), (e) => e.code === 'VALIDATION');
  await assertExisting(vault);
});

test('import rejects array data and leaves existing records intact', async () => {
  const { vault } = make();
  await seedExisting(vault);
  await assert.rejects(() => vault.importAll(backup([])), (e) => e.code === 'VALIDATION');
  await assertExisting(vault);
});

test('import rejects an array store value and leaves existing records intact', async () => {
  const { vault } = make();
  await seedExisting(vault);
  await assert.rejects(
    () => vault.importAll(backup({ profile: {}, jobs: [], answers: {}, memory: {}, usage: {}, meta: {} })),
    (e) => e.code === 'VALIDATION'
  );
  await assertExisting(vault);
});
