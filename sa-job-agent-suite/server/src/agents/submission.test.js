import test from 'node:test';
import assert from 'node:assert/strict';
import { captureFieldSnapshot, attachedFileNames, documentsFromFiles, confirmationExcerpt } from './submission.js';

function fakePage({ fields = [], files = [], text = '' } = {}) {
  return {
    evaluate: async (fn) => {
      const source = String(fn);
      if (source.includes('querySelectorAll(\'input[type=file]\')')) return files;
      if (source.includes('document.body')) return text;
      return fields;
    }
  };
}

test('field snapshots are capped and blank values dropped before they reach the page', () => {
  const page = fakePage({
    fields: [
      { label: 'Full name', value: 'Thandi Mokoena' },
      { label: '', value: 'orphan' },
      { label: 'Notice', value: 'V'.repeat(900) }
    ]
  });
  return captureFieldSnapshot(page).then((snapshot) => {
    assert.deepEqual(snapshot.map((field) => field.label), ['Full name', 'Notice']);
    assert.equal(snapshot[1].value.length, 500);
  });
});

test('file inputs become named documents', () => {
  assert.deepEqual(documentsFromFiles(['cv.pdf', 'id.pdf']), [
    { key: 'attachment-1', label: 'Attached document', fileName: 'cv.pdf' },
    { key: 'attachment-2', label: 'Attached document', fileName: 'id.pdf' }
  ]);
  assert.deepEqual(documentsFromFiles([]), []);
});

test('the confirmation excerpt is trimmed to a readable line', async () => {
  const page = fakePage({ text: `  Application received.${'x'.repeat(900)}` });
  const text = await confirmationExcerpt(page);
  assert.equal(text.startsWith('Application received.'), true);
  assert.equal(text.length, 500);
});
