import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DOCX_MIME, MAX_DOCUMENTS, MAX_DOCUMENT_BYTES, MAX_TOTAL_DOCUMENT_BYTES, PDF_MIME, TEXT_MIME,
  base64ToBytes, bytesToBase64, createDocumentRecord, documentMetadata,
  exportDocumentRecords, sanitiseDocumentRecords, sanitiseFileName, sniffDocumentType, textToBytes
} from './documents.js';

const pdfBytes = new TextEncoder().encode('%PDF-1.7\n% test\n');
const docxBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);

function input(overrides = {}) {
  return {
    kind: 'cv',
    label: 'My CV',
    fileName: 'cv.pdf',
    mime: PDF_MIME,
    size: pdfBytes.byteLength,
    dataBase64: bytesToBase64(pdfBytes),
    text: 'Thandi Mokoena',
    ...overrides
  };
}

function validationError(fn, pattern) {
  assert.throws(fn, (error) => error.code === 'VALIDATION' && (!pattern || pattern.test(error.message)));
}

test('type sniffing reads the magic bytes and refuses binary text', () => {
  assert.equal(sniffDocumentType(pdfBytes), 'pdf');
  assert.equal(sniffDocumentType(docxBytes), 'docx');
  assert.equal(sniffDocumentType(textToBytes('hello')), 'text');
  assert.equal(sniffDocumentType(new Uint8Array([0, 1, 2, 3])), '');
});

test('base64 round-trips and rejects malformed input', () => {
  assert.deepEqual([...base64ToBytes(bytesToBase64(pdfBytes))], [...pdfBytes]);
  for (const bad of ['not base64!', 'abc', '====', 'AA=A', 42, null]) {
    validationError(() => base64ToBytes(bad), /base64/i);
  }
});

test('a valid PDF record is rebuilt with its exact byte length', () => {
  const record = createDocumentRecord(input());
  assert.equal(record.kind, 'cv');
  assert.equal(record.label, 'My CV');
  assert.equal(record.fileName, 'cv.pdf');
  assert.equal(record.mime, PDF_MIME);
  assert.equal(record.size, pdfBytes.byteLength);
  assert.equal(record.text, 'Thandi Mokoena');
  assert.ok(record.data instanceof ArrayBuffer);
  assert.equal(record.data.byteLength, pdfBytes.byteLength);
});

test('a declared type that disagrees with the bytes is rejected', () => {
  validationError(() => createDocumentRecord(input({ mime: PDF_MIME, dataBase64: bytesToBase64(docxBytes), fileName: 'cv.pdf' })), /match/);
  validationError(() => createDocumentRecord(input({ mime: DOCX_MIME, dataBase64: bytesToBase64(pdfBytes), fileName: 'cv.docx' })), /match/);
});

test('pasted text becomes a text document whose text is decoded from the bytes', () => {
  const text = 'Thandi Mokoena\nCape Town';
  const bytes = textToBytes(text);
  const record = createDocumentRecord({
    kind: 'cv', label: 'Pasted CV', fileName: 'pasted-cv.txt', mime: TEXT_MIME,
    size: bytes.byteLength, dataBase64: bytesToBase64(bytes), text: ''
  });
  assert.equal(record.text, text);
  assert.equal(record.mime, TEXT_MIME);
});

test('caps are checked before a record is returned', () => {
  const huge = new Uint8Array(MAX_DOCUMENT_BYTES + 1);
  huge.set(pdfBytes);
  validationError(() => createDocumentRecord(input({ size: huge.byteLength, dataBase64: bytesToBase64(huge) })), /8 MB/);

  const ten = Array.from({ length: MAX_DOCUMENTS }, (_, index) => ({ size: 1, id: `d${index}` }));
  validationError(() => createDocumentRecord(input(), ten), /10 documents/);

  validationError(() => createDocumentRecord(input(), [{ size: MAX_TOTAL_DOCUMENT_BYTES }]), /20 MB/);
  validationError(() => createDocumentRecord(input({ text: 'x'.repeat(1_000_001) })), /text/i);
  validationError(() => createDocumentRecord(input({ size: 1 })), /size/i);
});

test('a record with an unknown kind, blank label or unsafe name is rejected or cleaned', () => {
  validationError(() => createDocumentRecord(input({ kind: 'passport' })), /type/i);
  validationError(() => createDocumentRecord(input({ label: '   ' })), /label/i);
  assert.equal(sanitiseFileName('..\\secret/CV\u0000.pdf'), '..-secret-CV.pdf');
  assert.equal(sanitiseFileName('x'.repeat(300)).length, 200);
  validationError(() => createDocumentRecord(input({ fileName: '\u0000' })), /name/i);
  validationError(() => createDocumentRecord(input({ mime: 'image/png' })), /PDF|DOCX|text/i);
});

test('metadata never carries the bytes or the text', () => {
  const record = createDocumentRecord(input());
  const meta = documentMetadata({ id: 'doc-1', ...record, uploadedAt: '2026-11-01T00:00:00.000Z', isDefault: true });
  assert.equal(Object.hasOwn(meta, 'data'), false);
  assert.equal(Object.hasOwn(meta, 'text'), false);
  assert.equal(meta.hasText, true);
});

test('export converts bytes to base64 and refuses a legacy record over the caps', () => {
  const record = { id: 'doc-1', ...createDocumentRecord(input()), uploadedAt: '2026-11-01T00:00:00.000Z', isDefault: true };
  const exported = exportDocumentRecords([record]);
  assert.equal(exported['doc-1'].data, bytesToBase64(pdfBytes));
  assert.equal(exported['doc-1'].text, 'Thandi Mokoena');

  const broken = { ...record, data: new ArrayBuffer(MAX_DOCUMENT_BYTES + 1) };
  validationError(() => exportDocumentRecords([broken]), /export/i);
});

test('import rebuilds each record and rejects hostile shapes', () => {
  const record = { id: 'doc-1', ...createDocumentRecord(input()), uploadedAt: '2026-11-01T00:00:00.000Z', isDefault: true };
  const exported = exportDocumentRecords([record]);
  const restored = sanitiseDocumentRecords(exported);
  assert.equal(restored['doc-1'].id, 'doc-1');
  assert.ok(restored['doc-1'].data instanceof ArrayBuffer);
  assert.equal(restored['doc-1'].text, 'Thandi Mokoena');
  assert.deepEqual(sanitiseDocumentRecords({}), {});

  validationError(() => sanitiseDocumentRecords([]), /document/i);
  validationError(() => sanitiseDocumentRecords({ 'doc-1': { ...exported['doc-1'], id: 'other' } }), /document/i);
  validationError(() => sanitiseDocumentRecords({ 'doc-1': { ...exported['doc-1'], uploadedAt: 'yesterday' } }), /document/i);
  validationError(() => sanitiseDocumentRecords({ 'doc-1': { ...exported['doc-1'], isDefault: 'yes' } }), /document/i);
  validationError(() => sanitiseDocumentRecords({
    a: { ...exported['doc-1'], id: 'a', isDefault: true },
    b: { ...exported['doc-1'], id: 'b', isDefault: true }
  }), /default/i);
});
