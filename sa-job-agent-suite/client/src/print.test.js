import test from 'node:test';
import assert from 'node:assert/strict';
import { printDocument } from './print.js';

function fakeWindow() {
  const nodes = [];
  const win = {
    focused: false,
    printed: false,
    document: {
      title: '',
      createElement(tag) { return { tag, textContent: '', style: {} }; },
      head: { appendChild(node) { nodes.push(node); } },
      body: { append(...items) { nodes.push(...items); } }
    },
    focus() { win.focused = true; },
    print() { win.printed = true; }
  };
  win.nodes = nodes;
  return win;
}

test('writes the document as text and calls print', () => {
  const win = fakeWindow();
  const ok = printDocument({ title: 'Tailored CV', text: '# CV\nBuilt things <b>safely</b>.', open: () => win });
  assert.equal(ok, true);
  assert.equal(win.document.title, 'Tailored CV');
  assert.ok(win.nodes.some((node) => node.tag === 'h1' && node.textContent === 'Tailored CV'));
  assert.ok(win.nodes.some((node) => node.tag === 'pre' && node.textContent.includes('<b>safely</b>')));
  assert.equal(win.focused, true);
  assert.equal(win.printed, true);
});

test('reports a blocked window and refuses empty text', () => {
  assert.equal(printDocument({ title: 'CV', text: 'x', open: () => null }), false);
  assert.equal(printDocument({ title: 'CV', text: '   ', open: () => fakeWindow() }), false);
});
