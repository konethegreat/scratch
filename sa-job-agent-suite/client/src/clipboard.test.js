import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyToClipboard } from './clipboard.js';

// These run in plain Node: `navigator` and `document` are stubbed per test and
// the originals restored afterwards, so no DOM or jsdom is needed.

const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const hadDocument = Object.hasOwn(globalThis, 'document');
const originalDocument = globalThis.document;

function stubNavigator(clipboard) {
  Object.defineProperty(globalThis, 'navigator', {
    value: { clipboard },
    configurable: true,
    writable: true
  });
}

function restoreNavigator() {
  if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
  else delete globalThis.navigator;
}

function stubDocument(execResult) {
  const area = {
    value: '',
    style: {},
    attributes: {},
    selected: false,
    removed: false,
    setAttribute(name, value) { this.attributes[name] = value; },
    select() { this.selected = true; },
    remove() { this.removed = true; }
  };
  const documentStub = {
    body: { appended: [], appendChild(node) { this.appended.push(node); } },
    created: [],
    execCommandCalls: [],
    createElement(tag) {
      area.tag = tag;
      this.created.push(tag);
      return area;
    },
    execCommand(command) {
      this.execCommandCalls.push(command);
      return execResult;
    }
  };
  globalThis.document = documentStub;
  return { area, documentStub };
}

function restoreDocument() {
  if (hadDocument) globalThis.document = originalDocument;
  else delete globalThis.document;
}

test('uses navigator.clipboard.writeText when it is available', async () => {
  const written = [];
  stubNavigator({ writeText: async (text) => { written.push(text); } });
  const { documentStub } = stubDocument(true);
  try {
    const ok = await copyToClipboard('hello');
    assert.equal(ok, true);
    assert.deepEqual(written, ['hello']);
    assert.deepEqual(documentStub.execCommandCalls, []);
  } finally {
    restoreNavigator();
    restoreDocument();
  }
});

test('falls back to document.execCommand when writeText rejects', async () => {
  stubNavigator({ writeText: async () => { throw new Error('denied'); } });
  const { area, documentStub } = stubDocument(true);
  try {
    const ok = await copyToClipboard('fallback text');
    assert.equal(ok, true);
    assert.deepEqual(documentStub.execCommandCalls, ['copy']);
    assert.equal(area.value, 'fallback text');
    assert.equal(area.selected, true);
    assert.equal(area.removed, true);
  } finally {
    restoreNavigator();
    restoreDocument();
  }
});
