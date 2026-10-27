// Print a generated document through the browser's print dialog. The text is
// inserted with textContent, never HTML, so a generated document cannot inject
// markup into the print window.
const PRINT_STYLE = 'body{font-family:Georgia,serif;max-width:46rem;margin:2rem auto;line-height:1.5;color:#111}pre{white-space:pre-wrap;font-family:inherit;font-size:12pt}h1{font-size:14pt;margin-bottom:1.5rem}';

export function printDocument({ title, text, open = globalThis.open }) {
  if (!String(text || '').trim()) return false;
  const win = open('', '_blank');
  if (!win) return false;

  const doc = win.document;
  doc.title = title;
  const style = doc.createElement('style');
  style.textContent = PRINT_STYLE;
  const heading = doc.createElement('h1');
  heading.textContent = title;
  const body = doc.createElement('pre');
  body.textContent = text;
  doc.head.appendChild(style);
  doc.body.append(heading, body);
  win.focus();
  win.print();
  return true;
}
