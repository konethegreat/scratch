import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_DOCUMENT_BYTES, TEXT_MIME } from './documents.js';
import { readDocumentFile } from './readDocumentFile.js';

test('a text file is read from its bytes even with no declared type', async () => {
  const file = new File(['Thandi Mokoena\nCape Town'], 'cv.txt', { type: '' });
  const result = await readDocumentFile(file);
  assert.equal(result.mime, TEXT_MIME);
  assert.match(result.text, /Thandi/);
  assert.ok(result.data instanceof ArrayBuffer);
});

test('a file over the cap is refused before its bytes are read', async () => {
  let read = false;
  const file = {
    size: MAX_DOCUMENT_BYTES + 1,
    async arrayBuffer() {
      read = true;
      return new ArrayBuffer(0);
    }
  };
  await assert.rejects(() => readDocumentFile(file), /8 MB/);
  assert.equal(read, false);
});

test('binary bytes behind a document file name are refused', async () => {
  const file = new File([new Uint8Array([0, 1, 2, 3])], 'cv.pdf', { type: 'application/pdf' });
  await assert.rejects(() => readDocumentFile(file), /does not look like/);
});

test('a photo is refused unless the caller allows a CV photo', async () => {
  const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3])], 'cv.jpg', { type: 'image/jpeg' });
  await assert.rejects(() => readDocumentFile(file), /CV/);
});
