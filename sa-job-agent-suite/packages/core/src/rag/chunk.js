import { hashText } from './text.js';

const HEADING_RE = /^(#{1,3})\s+(.+)$/;
const LIST_RE = /^\s*(?:[-*+]|\d+[.)])\s+\S/;
const TABLE_RE = /^\s*\|/;

function lineType(line) {
  if (HEADING_RE.test(line)) return 'heading';
  if (LIST_RE.test(line)) return 'list';
  if (TABLE_RE.test(line)) return 'table';
  return 'prose';
}

function headingText(line) {
  const match = HEADING_RE.exec(line);
  return match ? match[2].trim() : '';
}

function splitLongBlock(block, maxChars) {
  if (block.type === 'list' || block.type === 'table') {
    const pieces = [];
    let current = [];
    let size = 0;
    for (const line of block.lines) {
      const extra = current.length ? 1 : 0;
      if (current.length && size + extra + line.length > maxChars) {
        pieces.push(current.join('\n'));
        current = [];
        size = 0;
      }
      current.push(line);
      size += (current.length > 1 ? 1 : 0) + line.length;
    }
    if (current.length) pieces.push(current.join('\n'));
    return pieces;
  }
  const text = block.lines.join('\n');
  const sentences = text.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) || [text];
  const pieces = [];
  let current = '';
  for (const sentence of sentences) {
    const clean = sentence.trim();
    if (!clean) continue;
    if (current && current.length + 1 + clean.length > maxChars) {
      pieces.push(current);
      current = clean;
    } else {
      current = current ? `${current} ${clean}` : clean;
    }
  }
  if (current) pieces.push(current);
  return pieces.length ? pieces : [text];
}

function blocksOf(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let current = null;
  let section = 'General';

  const flush = () => {
    if (!current) return;
    blocks.push(current);
    current = null;
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) {
      flush();
      continue;
    }
    const type = lineType(line);
    if (type === 'heading') {
      flush();
      section = headingText(line) || 'General';
      blocks.push({ type: 'heading', lines: [line], section });
      continue;
    }
    if (!current || current.type !== type) {
      flush();
      current = { type, lines: [], section };
    }
    current.lines.push(line);
  }
  flush();
  return blocks;
}

export function chunkDocument(doc, { maxChars = 1200, minChars = 120 } = {}) {
  const source = String(doc?.text ?? '').replace(/\r\n?/g, '\n').trim();
  if (!source) return [];

  const version = hashText(source);
  const base = {
    docId: String(doc?.id ?? ''),
    docKind: String(doc?.kind ?? ''),
    docTitle: String(doc?.title ?? doc?.id ?? 'Document'),
    version
  };
  const chunks = [];

  const push = (text, section) => {
    const clean = text.trim();
    if (!clean) return;
    const index = chunks.length;
    chunks.push({
      ...base,
      id: `${base.docId}::${version}::${index}`,
      section: section || 'General',
      index,
      text: clean,
      tag: `[Doc: ${base.docTitle} | Chunk: ${index}]`
    });
  };

  let buffer = [];
  let bufferLength = 0;
  let bufferSection = 'General';
  let headingOnly = false;

  const flush = () => {
    if (!buffer.length) return;
    push(buffer.join('\n\n'), bufferSection);
    buffer = [];
    bufferLength = 0;
    headingOnly = false;
  };

  for (const block of blocksOf(source)) {
    const text = block.lines.join('\n');
    if (block.type === 'heading') {
      flush();
      buffer = [text];
      bufferLength = text.length;
      bufferSection = block.section;
      headingOnly = true;
      continue;
    }

    const pieces = text.length > maxChars ? splitLongBlock(block, maxChars) : [text];
    for (const piece of pieces) {
      if (buffer.length && !headingOnly && bufferLength + 2 + piece.length > maxChars) flush();
      if (!buffer.length) {
        bufferSection = block.section;
        headingOnly = false;
      }
      const extra = buffer.length ? 2 : 0;
      buffer.push(piece);
      bufferLength += extra + piece.length;
      headingOnly = false;
      if (bufferLength >= maxChars) flush();
    }
  }
  flush();

  if (chunks.length <= 1) return chunks;
  const kept = chunks.filter((chunk) => chunk.text.length >= minChars
    || /^(?:\s*(?:[-*+]|\d+[.)])\s|\s*\|)/m.test(chunk.text));
  return kept.length ? kept : chunks;
}

export function chunkDocuments(docs, opts) {
  return (Array.isArray(docs) ? docs : []).flatMap((doc) => chunkDocument(doc, opts));
}
