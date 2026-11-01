// Local PDF text extraction. The file never leaves the browser and nothing here
// makes a network request: pdf.js is lazy-loaded only when a CV is read.
import { AppError, ERROR_CODES } from '@sajas/core/errors';

const MIN_TEXT = 40;
let loading = null;

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

export async function extractPdfText(data) {
  const pdfjs = await loadPdfjs();
  let loadingTask = null;
  try {
    loadingTask = pdfjs.getDocument({
      data: new Uint8Array(data),
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: true
    });
    const document = await loadingTask.promise;
    const pages = [];
    for (let index = 1; index <= document.numPages; index += 1) {
      const page = await document.getPage(index);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => (typeof item.str === 'string' ? item.str : '')).join(' '));
    }
    const text = pages.join('\n\n').trim();
    if (text.replace(/\s/g, '').length < MIN_TEXT) {
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
