// Local DOCX text extraction with mammoth. The browser build keeps the file on
// the device and strips formatting, which is all the intake needs.
import { AppError, ERROR_CODES } from '@sajas/core/errors';

let loading = null;

function loadMammoth() {
  if (!loading) loading = import('mammoth');
  return loading;
}

export async function extractDocxText(data) {
  const mammoth = await loadMammoth();
  try {
    // The browser build reads `arrayBuffer`; the Node build reads `buffer`.
    // Passing both keeps one code path working under test and in the app.
    const input = { arrayBuffer: data };
    if (typeof Buffer !== 'undefined') input.buffer = Buffer.from(data);
    const result = await mammoth.extractRawText(input);
    const text = String(result.value || '').trim();
    if (!text) {
      throw new AppError(ERROR_CODES.VALIDATION, 'That DOCX has no text in it. Try another copy or paste the text.');
    }
    return text;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(ERROR_CODES.VALIDATION, 'That file could not be read as a DOCX. Try another copy or paste the text.');
  }
}
