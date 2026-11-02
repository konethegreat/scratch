// Local PDF text extraction. The file never leaves the browser and nothing here
// makes a network request: pdf.js is lazy-loaded only when a CV is read.
import { AppError, ERROR_CODES } from '@sajas/core/errors';

const MIN_TEXT = 40;
let loading = null;

// pdf.js may transfer the buffer it is given to its worker, so each read gets
// its own copy and the caller keeps the original bytes for storage.
function sourceBytes(data) {
  return new Uint8Array(data instanceof ArrayBuffer ? data.slice(0) : data);
}

function unreadable() {
  return new AppError(ERROR_CODES.VALIDATION, 'That file could not be read as a PDF. Try another copy or paste the text.');
}

async function loadPdfjs() {
  if (!loading) {
    loading = (async () => {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      if (typeof window !== 'undefined') {
        const worker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      }
      return pdfjs;
    })();
  }
  return loading;
}

export async function extractPdfText(data, { minText = MIN_TEXT } = {}) {
  const pdfjs = await loadPdfjs();
  let loadingTask = null;
  try {
    loadingTask = pdfjs.getDocument({
      data: sourceBytes(data),
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: true
    });
    const pdf = await loadingTask.promise;
    const pages = [];
    for (let index = 1; index <= pdf.numPages; index += 1) {
      const page = await pdf.getPage(index);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => (typeof item.str === 'string' ? item.str : '')).join(' '));
    }
    const text = pages.join('\n\n').trim();
    if (minText > 0 && text.replace(/\s/g, '').length < minText) {
      throw new AppError(
        ERROR_CODES.VALIDATION,
        'This PDF has no selectable text, so it looks like a scan. Paste the text instead.'
      );
    }
    return text;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw unreadable();
  } finally {
    if (loadingTask) await loadingTask.destroy().catch(() => {});
  }
}

// Renders the first pages of a PDF to canvases so a scanned file can be read
// by the on-device OCR worker. Only called when no selectable text was found.
export async function renderPdfPages(data, { maxPages = 5, scale = 2 } = {}) {
  const pdfjs = await loadPdfjs();
  let loadingTask = null;
  try {
    loadingTask = pdfjs.getDocument({
      data: sourceBytes(data),
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: true
    });
    const pdf = await loadingTask.promise;
    const count = Math.max(1, Math.min(pdf.numPages, maxPages));
    const canvases = [];
    for (let index = 1; index <= count; index += 1) {
      const page = await pdf.getPage(index);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise;
      canvases.push(canvas);
    }
    return canvases;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw unreadable();
  } finally {
    if (loadingTask) await loadingTask.destroy().catch(() => {});
  }
}
