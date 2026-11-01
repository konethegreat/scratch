// Shared browser-side file reader for uploads. The size cap is checked before
// the bytes are read, and the type comes from the bytes so a wrong extension
// cannot smuggle a different format past the server check.
import { AppError, ERROR_CODES } from '@sajas/core/errors';
import { DOCX_MIME, MAX_DOCUMENT_BYTES, PDF_MIME, TEXT_MIME, detectMime } from './documents.js';
import { extractPdfText } from './extract/pdf.js';
import { extractDocxText } from './extract/docx.js';

export async function readDocumentFile(file) {
  if (!file) throw new AppError(ERROR_CODES.VALIDATION, 'Choose a file first.');
  if (file.size > MAX_DOCUMENT_BYTES) {
    throw new AppError(ERROR_CODES.VALIDATION, 'Each document must be 8 MB or smaller.');
  }
  const data = await file.arrayBuffer();
  const mime = detectMime(new Uint8Array(data));
  if (mime === PDF_MIME) return { mime, text: await extractPdfText(data), data };
  if (mime === DOCX_MIME) return { mime, text: await extractDocxText(data), data };
  if (mime === TEXT_MIME) return { mime, text: new TextDecoder().decode(data), data };
  throw new AppError(ERROR_CODES.VALIDATION, 'That file does not look like a PDF, DOCX or text file.');
}
