// Document rules for the hosted app. Every value is rebuilt here before it can
// reach IndexedDB, and the same rules guard export and import so a file that is
// accepted once is always accepted again.
import { AppError, ERROR_CODES } from '@sajas/core/errors';

export const DOCUMENT_KINDS = Object.freeze(['cv', 'cover-letter', 'certified-id', 'qualification', 'other']);
export const PDF_MIME = 'application/pdf';
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const TEXT_MIME = 'text/plain';
const KNOWN_MIME = Object.freeze([PDF_MIME, DOCX_MIME, TEXT_MIME]);

export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
export const MAX_DOCUMENTS = 10;
export const MAX_TOTAL_DOCUMENT_BYTES = 20 * 1024 * 1024;
export const MAX_DOCUMENT_TEXT = 1_000_000;
export const MAX_LABEL = 120;
export const MAX_FILE_NAME = 200;

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

function invalid(message) {
  return new AppError(ERROR_CODES.VALIDATION, message);
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export function sanitiseFileName(raw) {
  return String(raw ?? '')
    .replace(/[\\/]/g, '-')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_FILE_NAME);
}

export function normaliseDocumentLabel(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL);
}

export function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(value) {
  if (typeof value !== 'string' || value.length % 4 !== 0 || !BASE64.test(value)) {
    throw invalid('That document data is not valid base64.');
  }
  let binary;
  try {
    binary = atob(value);
  } catch {
    throw invalid('That document data is not valid base64.');
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function textToBytes(text) {
  return new TextEncoder().encode(String(text ?? ''));
}

export function sniffDocumentType(bytes) {
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) {
    return 'pdf';
  }
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    return 'docx';
  }
  if (bytes.subarray(0, 4096).includes(0)) return '';
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return 'text';
  } catch {
    return '';
  }
}

function expectedType(mime) {
  if (mime === PDF_MIME) return 'pdf';
  if (mime === DOCX_MIME) return 'docx';
  return 'text';
}

export function createDocumentRecord(input, existing = []) {
  const kind = String(input?.kind || '');
  if (!DOCUMENT_KINDS.includes(kind)) throw invalid('Choose a document type.');
  const label = normaliseDocumentLabel(input?.label);
  if (!label) throw invalid('Give this document a label.');
  const fileName = sanitiseFileName(input?.fileName);
  if (!fileName) throw invalid('That file needs a name.');
  const mime = String(input?.mime || '');
  if (!KNOWN_MIME.includes(mime)) throw invalid('Only PDF, DOCX and text files can be added.');

  const bytes = base64ToBytes(input?.dataBase64);
  if (bytes.byteLength === 0) throw invalid('That file is empty.');
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) throw invalid('Each document must be 8 MB or smaller.');
  if (input?.size !== undefined && Number(input.size) !== bytes.byteLength) {
    throw invalid('The file size did not match the file itself, so nothing was saved.');
  }
  const total = existing.reduce((sum, document) => sum + (Number(document.size) || 0), 0);
  if (existing.length >= MAX_DOCUMENTS) throw invalid(`You can keep up to ${MAX_DOCUMENTS} documents in this browser.`);
  if (total + bytes.byteLength > MAX_TOTAL_DOCUMENT_BYTES) throw invalid('Your documents would exceed the 20 MB total. Delete one first.');

  const sniffed = sniffDocumentType(bytes);
  if (!sniffed) throw invalid('That file does not look like a PDF, DOCX or text file.');
  if (sniffed !== expectedType(mime)) throw invalid('The file contents do not match its declared type.');

  let text = String(input?.text ?? '');
  if (mime === TEXT_MIME && text === '') text = new TextDecoder().decode(bytes);
  if (text.length > MAX_DOCUMENT_TEXT) throw invalid('That document has too much text to keep in this browser.');

  return { kind, label, fileName, mime, size: bytes.byteLength, text, data: bytes.buffer };
}

export function documentMetadata(record) {
  const { data: _data, text, ...meta } = record;
  return { ...meta, hasText: typeof text === 'string' && text.length > 0 };
}

export function exportDocumentRecords(records) {
  if (!Array.isArray(records)) throw invalid('The documents could not be exported.');
  if (records.length > MAX_DOCUMENTS) throw invalid('Export refused: this browser holds more documents than the format allows.');
  const out = {};
  let total = 0;
  for (const record of records) {
    if (!record || typeof record.id !== 'string') throw invalid('Export refused: a stored document is malformed.');
    if (!(record.data instanceof ArrayBuffer)) throw invalid('Export refused: a stored document is missing its file.');
    total += record.data.byteLength;
    if (
      record.data.byteLength > MAX_DOCUMENT_BYTES
      || total > MAX_TOTAL_DOCUMENT_BYTES
      || String(record.text || '').length > MAX_DOCUMENT_TEXT
    ) {
      throw invalid('Export refused: a stored document breaks the size limits.');
    }
    out[record.id] = { ...record, data: bytesToBase64(new Uint8Array(record.data)) };
  }
  return out;
}

export function sanitiseDocumentRecords(map) {
  if (!isObject(map)) throw invalid('That backup has no valid document data.');
  const out = {};
  const records = [];
  for (const [key, record] of Object.entries(map)) {
    if (!isObject(record) || record.id !== key) throw invalid('That backup has an invalid document record.');
    const created = createDocumentRecord({
      kind: record.kind,
      label: record.label,
      fileName: record.fileName,
      mime: record.mime,
      size: record.size,
      dataBase64: record.data,
      text: record.text
    }, records);
    if (typeof record.uploadedAt !== 'string' || Number.isNaN(Date.parse(record.uploadedAt))) {
      throw invalid('That backup has an invalid document record.');
    }
    if (record.isDefault !== undefined && typeof record.isDefault !== 'boolean') {
      throw invalid('That backup has an invalid document record.');
    }
    const rebuilt = { id: key, ...created, uploadedAt: record.uploadedAt, isDefault: record.isDefault === true };
    out[key] = rebuilt;
    records.push(rebuilt);
  }
  if (records.filter((record) => record.isDefault).length > 1) {
    throw invalid('That backup marks more than one document as the default.');
  }
  return out;
}
