import test from 'node:test';
import assert from 'node:assert/strict';
import { MIN_OCR_CHARS, cleanOcrText, ensureOcrText } from './ocr.js';

test('ocr text keeps its lines and loses stray spacing and control bytes', () => {
  assert.equal(
    cleanOcrText('  Thandi   Mokoena \r\n\r\n\r\n\r\nCape Town\u0000  '),
    'Thandi Mokoena\n\nCape Town'
  );
  assert.equal(cleanOcrText(null), '');
  assert.equal(cleanOcrText('a\t\tb\n\n\n\nc'), 'a b\n\nc');
});

test('a read that produced too little text is refused with advice', () => {
  assert.throws(
    () => ensureOcrText('T M'),
    (error) => error.code === 'VALIDATION' && /sharper|paste/i.test(error.message)
  );
});

test('a readable scan is returned cleaned and complete', () => {
  const text = 'Thandi Mokoena\nSenior Backend Engineer\nCape Town\nthandi@example.test';
  assert.equal(ensureOcrText(`  ${text}  `), text);
  assert.ok(text.replace(/\s/g, '').length >= MIN_OCR_CHARS);
});
