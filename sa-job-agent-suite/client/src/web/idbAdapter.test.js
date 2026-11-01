import test from 'node:test';
import assert from 'node:assert/strict';
import { createIdbAdapter, toStorageError } from './idbAdapter.js';

function quotaError() {
  return Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' });
}

test('non-quota failures pass through unchanged', () => {
  const original = new Error('boom');
  assert.equal(toStorageError(original), original);
});

test('a quota failure becomes STORAGE_FULL with web recovery copy', () => {
  const error = toStorageError(quotaError());
  assert.equal(error.code, 'STORAGE_FULL');
  assert.match(error.message, /storage is full/i);
  assert.match(error.hint, /Export a backup/i);
  assert.match(error.hint, /clear site data/i);
});

// Minimal fake IDB: open succeeds, the transaction hands back one request, and
// that request fails the way IndexedDB reports a full disk.
function fakeFactory(put) {
  return {
    open() {
      const request = {};
      queueMicrotask(() => {
        request.result = {
          objectStoreNames: { contains: () => true },
          transaction() {
            return {
              objectStore: () => ({ put }),
              error: null
            };
          }
        };
        request.onsuccess();
      });
      return request;
    }
  };
}

test('an asynchronous quota hit on a write rejects as STORAGE_FULL', async () => {
  const factory = fakeFactory(() => {
    const request = {};
    queueMicrotask(() => {
      request.error = quotaError();
      request.onerror();
    });
    return request;
  });
  const adapter = createIdbAdapter({ factory });
  await assert.rejects(
    () => adapter.put('jobs', 'j1', { title: 'Test' }),
    (error) => error.code === 'STORAGE_FULL' && /clear site data/i.test(error.hint)
  );
});

test('a synchronous quota throw on a write rejects as STORAGE_FULL', async () => {
  const factory = fakeFactory(() => {
    throw quotaError();
  });
  const adapter = createIdbAdapter({ factory });
  await assert.rejects(
    () => adapter.put('jobs', 'j1', { title: 'Test' }),
    (error) => error.code === 'STORAGE_FULL'
  );
});

function replaceFactory({ fail = null, abort = false } = {}) {
  const calls = { transaction: [], cleared: [], puts: [] };
  return {
    calls,
    open() {
      const request = {};
      queueMicrotask(() => {
        request.result = {
          objectStoreNames: { contains: () => true },
          transaction(names, mode) {
            calls.transaction.push({ names, mode });
            const tx = {
              error: null,
              objectStore(storeName) {
                return {
                  clear() {
                    calls.cleared.push(storeName);
                    return {};
                  },
                  put(value, key) {
                    calls.puts.push({ store: storeName, key, value });
                    return {};
                  }
                };
              }
            };
            queueMicrotask(() => {
              if (fail) {
                tx.error = fail;
                if (abort) tx.onabort?.();
                else tx.onerror?.();
              } else {
                tx.oncomplete?.();
              }
            });
            return tx;
          }
        };
        request.onsuccess();
      });
      return request;
    }
  };
}

test('replaceAll clears and fills every store in one readwrite transaction', async () => {
  const factory = replaceFactory();
  const adapter = createIdbAdapter({ factory });
  await adapter.replaceAll({
    jobs: { j1: { title: 'A' } },
    documents: { d1: { label: 'CV' } }
  });
  assert.deepEqual(factory.calls.transaction, [{ names: ['jobs', 'documents'], mode: 'readwrite' }]);
  assert.deepEqual(factory.calls.cleared.sort(), ['documents', 'jobs']);
  assert.deepEqual(factory.calls.puts, [
    { store: 'jobs', key: 'j1', value: { title: 'A' } },
    { store: 'documents', key: 'd1', value: { label: 'CV' } }
  ]);
});

test('replaceAll rejects as STORAGE_FULL when the transaction aborts', async () => {
  const factory = replaceFactory({ fail: quotaError(), abort: true });
  const adapter = createIdbAdapter({ factory });
  await assert.rejects(
    () => adapter.replaceAll({ jobs: { j1: { title: 'A' } } }),
    (error) => error.code === 'STORAGE_FULL'
  );
  assert.equal(factory.calls.puts.length, 1);
});

test('a failed open is retried instead of staying rejected forever', async () => {
  let attempts = 0;
  const factory = {
    open() {
      attempts += 1;
      const request = {};
      queueMicrotask(() => {
        if (attempts === 1) {
          request.error = new Error('blocked');
          request.onerror();
          return;
        }
        request.result = {
          objectStoreNames: { contains: () => true },
          transaction() {
            const tx = { objectStore: () => ({ get: () => ({}) }) };
            queueMicrotask(() => tx.oncomplete?.());
            return tx;
          }
        };
        request.onsuccess();
      });
      return request;
    }
  };
  const adapter = createIdbAdapter({ factory });
  await assert.rejects(() => adapter.get('jobs', 'j1'));
  assert.equal(await adapter.get('jobs', 'j1'), undefined);
  assert.equal(attempts, 2);
});
