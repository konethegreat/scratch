import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { extractPdfText } from './pdf.js';

async function makePdf(text) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  if (text) {
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    page.drawText(text, { x: 50, y: 760, size: 14, font });
  }
  const bytes = await pdf.save();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

test('a text PDF is read locally', async () => {
  const text = await extractPdfText(await makePdf('Thandi Mokoena Senior Backend Engineer Cape Town'));
  assert.match(text, /Thandi Mokoena Senior Backend Engineer Cape Town/);
});

test('a scanned-style PDF asks for pasted text', async () => {
  const blank = await makePdf('');
  await assert.rejects(
    () => extractPdfText(blank),
    (error) => error.code === 'VALIDATION' && /scan/i.test(error.message)
  );
});

test('a corrupt PDF fails with a clear validation error', async () => {
  const corrupt = new TextEncoder().encode('%PDF-1.4\nthis is not a pdf');
  await assert.rejects(
    () => extractPdfText(corrupt.buffer),
    (error) => error.code === 'VALIDATION' && /could not be read/i.test(error.message)
  );
});
