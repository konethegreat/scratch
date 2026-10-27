import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createVault, STORES } from './vault.js';
import { createMemoryAdapter } from './memoryAdapter.js';
import { createKeyStore, KEY_VAULT_KEY, IDLE_OPTIONS } from './keyStore.js';

const API_KEY = ['sk', 'ant', 'api03', 'B'.repeat(24)].join('-');
const ADMIN_KEY = ['sk', 'ant', 'admin01', 'C'.repeat(24)].join('-');
const META_KEY = 'key';
const T0 = 1_000_000;

function make({ saved } = {}) {
  const vault = createVault(createMemoryAdapter(saved));
  let clock = T0;
  const store = createKeyStore({
    vault,
    now: () => clock,
    encrypt: async (secret) => ({ v: 1, ciphertext: `enc:${Buffer.from(secret).toString('base64')}` }),
    decrypt: async (blob) => {
      if (!String(blob.ciphertext).startsWith('enc:')) throw new Error('bad blob');
      return Buffer.from(String(blob.ciphertext).slice(4), 'base64').toString('utf8');
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
  assert.equal((await vault.get(STORES.meta, META_KEY)).remembered, false);
});

test('forget without wiping keeps the blob and records it as remembered', async () => {
  const { store, vault } = make();
  store.setKey(API_KEY);
  await store.remember('a long passphrase');
  await store.forget({ wipeSaved: false });
  assert.equal(store.hasKey(), false);
  assert.equal(await store.hasSavedKey(), true);
  assert.equal((await vault.get(STORES.meta, META_KEY)).remembered, true);
});

test('idle minutes persist across key stores and an invalid choice changes nothing', async () => {
  const { store, vault } = make();
  await store.saveIdleMinutes(15);
  const reopened = createKeyStore({ vault });
  assert.equal(await reopened.loadIdleMinutes(), 15);
  assert.equal(reopened.getIdleMinutes(), 15);
  await assert.rejects(() => reopened.saveIdleMinutes(7), (e) => e.code === 'VALIDATION');
  assert.equal(reopened.getIdleMinutes(), 15);
  assert.equal((await vault.get(STORES.meta, META_KEY)).idleMinutes, 15);
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
