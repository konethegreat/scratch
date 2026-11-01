import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadBytes } from './download.js';

test('a download creates one object URL, clicks one link and revokes it', () => {
  const created = [];
  const clicked = [];
  const revoked = [];
  const documentRef = {
    createElement: () => ({
      set href(value) { created.push(value); },
      set download(value) { this.fileName = value; },
      click() { clicked.push(this.fileName); }
    })
  };
  downloadBytes(new Uint8Array([1, 2, 3]), 'cv.pdf', {
    document: documentRef,
    url: { createObjectURL: () => 'blob:one', revokeObjectURL: (value) => revoked.push(value) },
    Blob,
    setTimeout: (fn) => fn()
  });
  assert.deepEqual(created, ['blob:one']);
  assert.deepEqual(clicked, ['cv.pdf']);
  assert.deepEqual(revoked, ['blob:one']);
});
