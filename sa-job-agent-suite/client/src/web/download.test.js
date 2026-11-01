import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadBytes } from './download.js';

function fakeDocument() {
  const created = [];
  const clicked = [];
  const documentRef = {
    createElement: () => ({
      set href(value) { created.push(value); },
      set download(value) { this.fileName = value; },
      click() { clicked.push(this.fileName); }
    })
  };
  return { documentRef, created, clicked };
}

test('a download creates one object URL, clicks one link and revokes it', () => {
  const revoked = [];
  const { documentRef, created, clicked } = fakeDocument();
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

test('the blob type follows the file being downloaded', () => {
  const blobs = [];
  const { documentRef } = fakeDocument();
  downloadBytes(new Uint8Array([65]), 'base-cv.txt', {
    document: documentRef,
    url: { createObjectURL: (blob) => { blobs.push(blob); return 'blob:two'; }, revokeObjectURL: () => {} },
    Blob,
    setTimeout: (fn) => fn(),
    type: 'text/plain'
  });
  assert.equal(blobs[0].type, 'text/plain');
});
