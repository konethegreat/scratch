import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionAdapter, wipeDemoNamespace, DEMO_PREFIX } from './sessionAdapter.js';

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

function keys(store) {
  const found = [];
  for (let index = 0; index < store.length; index += 1) found.push(store.key(index));
  return found;
}

test.beforeEach(() => { globalThis.sessionStorage = fakeSession(); });
test.afterEach(() => { delete globalThis.sessionStorage; });

test('the adapter round-trips under the demo prefix only', async () => {
  globalThis.sessionStorage.setItem('sajas:real:profile:current', '{"fullName":"Real"}');
  const adapter = createSessionAdapter();
  await adapter.put('profile', 'current', { fullName: 'Alex Example' });
  assert.deepEqual(await adapter.get('profile', 'current'), { fullName: 'Alex Example' });
  assert.equal(adapter.persistent, true);
  assert.match(globalThis.sessionStorage.getItem(`${DEMO_PREFIX}profile:current`), /Alex Example/);
  await adapter.clearAll();
  assert.equal(globalThis.sessionStorage.getItem('sajas:real:profile:current'), '{"fullName":"Real"}');
  assert.deepEqual(keys(globalThis.sessionStorage), ['sajas:real:profile:current']);
});

test('getAll and entries stay inside one store', async () => {
  const adapter = createSessionAdapter();
  await adapter.put('jobs', 'a', { id: 'a' });
  await adapter.put('jobs', 'b', { id: 'b' });
  await adapter.put('answers', 'c', { id: 'c' });
  assert.deepEqual((await adapter.getAll('jobs')).map((job) => job.id).sort(), ['a', 'b']);
  assert.deepEqual((await adapter.entries('jobs')).map(([key]) => key).sort(), ['a', 'b']);
});

test('clear(store) leaves other stores and other prefixes alone', async () => {
  globalThis.sessionStorage.setItem('sajas:real:x', 'keep');
  const adapter = createSessionAdapter();
  await adapter.put('jobs', 'a', { id: 'a' });
  await adapter.put('answers', 'c', { id: 'c' });
  await adapter.clear('jobs');
  assert.equal(await adapter.get('jobs', 'a'), undefined);
  assert.deepEqual(await adapter.get('answers', 'c'), { id: 'c' });
  assert.equal(globalThis.sessionStorage.getItem('sajas:real:x'), 'keep');
});

test('a denied sessionStorage yields a working memory adapter', async () => {
  const denied = {
    length: 0,
    key() { return null; },
    getItem() { return null; },
    setItem() { throw new Error('denied'); },
    removeItem() {}
  };
  const adapter = createSessionAdapter({ storage: denied });
  assert.equal(adapter.persistent, false);
  await adapter.put('jobs', 'j1', { id: 'j1' });
  assert.deepEqual(await adapter.get('jobs', 'j1'), { id: 'j1' });
});

test('wipeDemoNamespace removes demo keys and nothing else', () => {
  globalThis.sessionStorage.setItem(`${DEMO_PREFIX}jobs:a`, '{}');
  globalThis.sessionStorage.setItem(`${DEMO_PREFIX}progress`, '{}');
  globalThis.sessionStorage.setItem('sajas:mode', 'demo');
  globalThis.sessionStorage.setItem('sajas:real:key', 'keep');
  wipeDemoNamespace();
  assert.deepEqual(keys(globalThis.sessionStorage).sort(), ['sajas:mode', 'sajas:real:key']);
});
