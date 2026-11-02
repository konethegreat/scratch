// Shared browser-side file reader for uploads. The size cap is checked before
// the bytes are read, and the type comes from the bytes so a wrong extension
// cannot smuggle a different format past the server check.
import { AppError, ERROR_CODES } from '@sajas/core/errors';
import { DOCX_MIME, IMAGE_MIMES, MAX_DOCUMENT_BYTES, PDF_MIME, TEXT_MIME, detectMime } from './documents.js';
import { MAX_OCR_PAGES, MIN_OCR_CHARS, ocrCanvases, ocrImage } from './ocr.js';
import { extractPdfText, renderPdfPages } from './extract/pdf.js';
import { extractDocxText } from './extract/docx.js';

function invalid(message) {
  return new AppError(ERROR_CODES.VALIDATION, message);
}

export async function readDocumentFile(file, { allowImages = false, onProgress } = {}) {
  if (!file) throw invalid('Choose a file first.');
  if (file.size > MAX_DOCUMENT_BYTES) {
    throw invalid('Each document must be 8 MB or smaller.');
  }
  const data = await file.arrayBuffer();
  const bytes = new Uint8Array(data);
  const mime = detectMime(bytes);

  if (mime === PDF_MIME) {
    if (!allowImages) return { mime, text: await extractPdfText(data), data };
    const text = await extractPdfText(data, { minText: 0 });
    if (text.replace(/\s/g, '').length >= MIN_OCR_CHARS) return { mime, text, data };
    const canvases = await renderPdfPages(data, { maxPages: MAX_OCR_PAGES, scale: 2 });
    return { mime, text: await ocrCanvases(canvases, onProgress), data, scanned: true };
  }
  if (mime === DOCX_MIME) return { mime, text: await extractDocxText(data), data };
  if (mime === TEXT_MIME) return { mime, text: new TextDecoder().decode(data), data };
  if (IMAGE_MIMES.includes(mime)) {
    if (!allowImages) throw invalid('Photos can only be added as a CV.');
    const text = await ocrImage(new Blob([bytes], { type: mime }), onProgress);
    return { mime, text, data, scanned: true };
  }
  throw invalid('That file does not look like a supported document.');
}
