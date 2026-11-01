// Tailored CV to PDF, entirely in the browser. pdf-lib is lazy so the main
// bundle stays small; the output is a plain A4 document with no images or links.
export const MAX_PDF_TEXT = 120000;
export const MAX_PDF_PAGES = 12;

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;
const BODY_SIZE = 10.5;
const HEADING_SIZE = 14;
const LINE_HEIGHT = 15;
const MAX_LINE_WIDTH = PAGE_WIDTH - MARGIN * 2;

const REPLACEMENTS = new Map([
  ['\u2018', "'"], ['\u2019', "'"], ['\u201c', '"'], ['\u201d', '"'],
  ['\u2013', '-'], ['\u2014', '-'], ['\u2026', '...'], ['\u00a0', ' '],
  ['\u2022', '-']
]);

function winAnsiSafe(value) {
  let out = '';
  for (const char of String(value)) {
    const mapped = REPLACEMENTS.get(char) ?? char;
    for (const piece of mapped) {
      const code = piece.codePointAt(0);
      if (code === 10 || code === 13 || code === 9 || (code >= 32 && code <= 255)) out += piece;
    }
  }
  return out;
}

function plain(value) {
  return winAnsiSafe(value).replace(/\*\*|__|`/g, '').replace(/^\s*#{1,6}\s*/, '').trimEnd();
}

export function safePdfFileName(title) {
  const base = String(title ?? '')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return `${base || 'tailored-cv'}.pdf`;
}

function wrap(line, font, size, width) {
  const words = line.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width || !current) current = next;
    else { lines.push(current); current = word; }
  }
  lines.push(current);
  return lines;
}

export async function createCvPdf({ text, title = 'Tailored CV' }) {
  const source = String(text ?? '').replace(/\r\n/g, '\n');
  if (!source.trim()) throw new Error('The tailored CV is empty, so there is nothing to make into a PDF.');
  if (source.length > MAX_PDF_TEXT) throw new Error('That CV is too long to make into a PDF. Trim it first.');
  const { PDFDocument, StandardFonts } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  doc.setTitle(plain(title).slice(0, 120) || 'Tailored CV');
  doc.setProducer('SA-JAS');
  doc.setCreator('SA-JAS');
  const body = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const newPage = () => {
    if (doc.getPageCount() >= MAX_PDF_PAGES) {
      throw new Error(`That CV needs more than ${MAX_PDF_PAGES} pages. Trim it first.`);
    }
    page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
  };

  for (const raw of source.split('\n')) {
    const heading = /^\s*#/.test(raw);
    const bullet = /^\s*[-*]\s+/.test(raw);
    const content = plain(raw.replace(/^\s*[-*]\s+/, ''));
    if (!content) { y -= LINE_HEIGHT * 0.6; continue; }
    const font = heading ? bold : body;
    const size = heading ? HEADING_SIZE : BODY_SIZE;
    const width = MAX_LINE_WIDTH - (bullet ? 14 : 0);
    const lines = wrap(content, font, size, width);
    for (const line of lines) {
      if (y < MARGIN + LINE_HEIGHT) newPage();
      page.drawText(bullet ? `- ${line}` : line, { x: MARGIN + (bullet ? 10 : 0), y, size, font });
      y -= LINE_HEIGHT;
    }
    if (heading) y -= 4;
  }
  return doc.save();
}
