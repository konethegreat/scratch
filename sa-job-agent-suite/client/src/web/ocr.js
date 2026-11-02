// On-device OCR for photographed and scanned CVs. Tesseract is lazy-loaded and
// every asset (worker, core, English data) comes from this origin, so the file
// never leaves the browser and no key or network call is involved.
import { AppError, ERROR_CODES } from '@sajas/core/errors';

export const MIN_OCR_CHARS = 40;
export const MAX_OCR_PAGES = 5;
const MAX_SIDE = 2000;

let workerPromise = null;
let activeProgress = null;

function invalid(message) {
  return new AppError(ERROR_CODES.VALIDATION, message);
}

export function cleanOcrText(raw) {
  return String(raw ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function ensureOcrText(raw) {
  const text = cleanOcrText(raw);
  if (text.replace(/\s/g, '').length < MIN_OCR_CHARS) {
    throw invalid('The scan was read, but too little text came out. Try a sharper, straight photo or paste the text.');
  }
  return text;
}

function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker, OEM } = await import('tesseract.js');
      return createWorker('eng', OEM.LSTM_ONLY, {
        workerPath: '/ocr/worker.min.js',
        corePath: '/ocr/tesseract-core-simd-lstm.wasm.js',
        langPath: '/ocr',
        workerBlobURL: false,
        cacheMethod: 'none',
        gzip: true,
        logger: (message) => {
          if (message.status === 'recognizing text' && activeProgress) activeProgress(message.progress);
        }
      });
    })().catch((error) => {
      workerPromise = null;
      throw error;
    });
  }
  return workerPromise;
}

async function recognize(canvas, onProgress) {
  let worker;
  try {
    worker = await getWorker();
  } catch {
    throw invalid('The on-device reader could not start. Check that your browser allows WebAssembly, then try again.');
  }
  activeProgress = typeof onProgress === 'function' ? onProgress : null;
  try {
    const { data } = await worker.recognize(canvas);
    return String(data?.text || '');
  } catch {
    throw invalid('The photo could not be read on this device. Try another photo or paste the text.');
  } finally {
    activeProgress = null;
  }
}

function scaledCanvas(bitmap) {
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export async function ocrImage(source, onProgress) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(source);
  } catch {
    throw invalid('That photo could not be opened. Try a JPG or PNG copy.');
  }
  try {
    return ensureOcrText(await recognize(scaledCanvas(bitmap), onProgress));
  } finally {
    bitmap.close?.();
  }
}

export async function ocrCanvases(canvases, onProgress) {
  if (!Array.isArray(canvases) || canvases.length === 0) {
    throw invalid('That PDF did not render a page to read.');
  }
  const parts = [];
  for (let index = 0; index < canvases.length; index += 1) {
    const page = index + 1;
    const text = await recognize(canvases[index], (progress) => {
      if (typeof onProgress === 'function') onProgress((index + progress) / canvases.length);
    });
    parts.push(text);
  }
  return ensureOcrText(parts.join('\n\n'));
}
