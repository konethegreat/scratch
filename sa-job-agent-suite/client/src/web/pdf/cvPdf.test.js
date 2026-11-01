import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { createCvPdf, safePdfFileName } from './cvPdf.js';

test('a tailored CV becomes a valid multi-page PDF', async () => {
  const text = ['# Thandi Mokoena', 'Senior Backend Engineer', '', '## Experience', '- Built payment systems', ...Array.from({ length: 80 }, (_, i) => `Line ${i} of a long CV`)].join('\n');
  const bytes = await createCvPdf({ text, title: 'Backend Engineer CV' });
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-');
  const doc = await PDFDocument.load(bytes);
  assert.ok(doc.getPageCount() >= 2);
});

test('accented text and punctuation do not throw', async () => {
  const bytes = await createCvPdf({ text: '# André Mokoena — Engineer’s CV\nThe café cost R 50.', title: 'CV' });
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-');
});

test('empty and oversized text are refused with plain messages', async () => {
  await assert.rejects(() => createCvPdf({ text: '   ' }), /empty/);
  await assert.rejects(() => createCvPdf({ text: 'x'.repeat(120001) }), /too long/);
});

test('file names are safe and end in .pdf', () => {
  assert.equal(safePdfFileName('Backend / Engineer: CV?'), 'Backend-Engineer-CV.pdf');
  assert.equal(safePdfFileName(''), 'tailored-cv.pdf');
});
