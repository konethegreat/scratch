import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { extractDocxText } from './docx.js';

async function makeDocx(text) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

test('a DOCX is read locally', async () => {
  const text = await extractDocxText(await makeDocx('Thandi Mokoena Senior Engineer'));
  assert.match(text, /Thandi Mokoena Senior Engineer/);
});

test('a corrupt DOCX fails with a clear validation error', async () => {
  const corrupt = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]).buffer;
  await assert.rejects(
    () => extractDocxText(corrupt),
    (error) => error.code === 'VALIDATION' && /could not be read/i.test(error.message)
  );
});
