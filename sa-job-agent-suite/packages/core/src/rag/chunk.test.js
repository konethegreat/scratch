import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkDocument, chunkDocuments } from './chunk.js';
import { hashText } from './text.js';

const DOC = {
  id: 'base-cv',
  kind: 'base-cv',
  title: 'Base CV',
  text: [
    '# Experience',
    '',
    '- Built web systems with React and Node for ten years.',
    '- Led a small team of four engineers.',
    '- Shipped a payments dashboard used by three banks.',
    '',
    '## Skills',
    '',
    '| Skill | Level |',
    '|---|---|',
    '| React | Strong |',
    '| Node | Strong |'
  ].join('\n')
};

test('chunks track headings, keep list and table rows, and number deterministically', () => {
  const chunks = chunkDocument(DOC);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].section, 'Experience');
  assert.equal(chunks[0].index, 0);
  assert.match(chunks[0].text, /^- Built web systems/m);
  assert.match(chunks[0].text, /^- Shipped a payments dashboard/m);
  assert.equal(chunks[1].section, 'Skills');
  assert.match(chunks[1].text, /^\| React \| Strong \|$/m);
  assert.equal(chunks[0].tag, '[Doc: Base CV | Chunk: 0]');
  assert.equal(chunks[1].tag, '[Doc: Base CV | Chunk: 1]');
});

test('chunk ids carry the document version and change when text changes', () => {
  const chunks = chunkDocument(DOC);
  const version = hashText(DOC.text);
  assert.equal(chunks[0].version, version);
  assert.equal(chunks[0].id, `base-cv::${version}::0`);
  const changed = chunkDocument({ ...DOC, text: `${DOC.text}\n\nNew line about payments.` });
  assert.notEqual(changed[0].id, chunks[0].id);
});

test('long prose is split on sentences without cutting a sentence', () => {
  const sentence = 'A long sentence about building reliable payment systems in South Africa. ';
  const text = `# Summary\n\n${sentence.repeat(12).trim()}`;
  const chunks = chunkDocument({ id: 'long', kind: 'base-cv', title: 'Long', text }, { maxChars: 300, minChars: 20 });
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.ok(chunk.text.length <= 300 + 80, `chunk too long: ${chunk.text.length}`);
    assert.equal(chunk.text.startsWith('A long sentence') || chunk.text.startsWith('# Summary'), true);
  }
});

test('a short document still yields one chunk, and empty documents yield none', () => {
  assert.equal(chunkDocument({ id: 's', kind: 'answer', title: 'S', text: 'Too short to split.' }).length, 1);
  assert.deepEqual(chunkDocument({ id: 'e', kind: 'answer', title: 'E', text: '   ' }), []);
  assert.deepEqual(chunkDocuments([]), []);
});
