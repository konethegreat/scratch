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
