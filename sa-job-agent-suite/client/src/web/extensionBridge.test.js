import test from 'node:test';
import assert from 'node:assert/strict';
import { createExtensionBridge } from './extensionBridge.js';

function fakeWindow() {
  const listeners = new Set();
  const sent = [];
  return {
    location: { origin: 'https://sajas.pages.dev' },
    sent,
    addEventListener(type, fn) { if (type === 'message') listeners.add(fn); },
    removeEventListener(type, fn) { if (type === 'message') listeners.delete(fn); },
    postMessage(data, origin) { sent.push({ data, origin }); },
    receive(data, { origin = 'https://sajas.pages.dev', source = this } = {}) {
      for (const fn of listeners) fn({ data, origin, source });
    }
  };
}

const packet = {
  version: 2, packetId: 'p1', createdAt: '2026-11-01T10:00:00.000Z',
  job: { id: 'j1', title: 'T', company: 'C', applyUrl: 'https://acme.example.test/1', site: 'acme.example.test' },
  identity: [{ key: 'fullName', label: 'Full name', value: 'Thandi' }],
  questions: [], fields: [], attachments: [], checklist: [], warnings: []
};

test('probe resolves true only for a ready message with the same nonce', async () => {
  const win = fakeWindow();
  const bridge = createExtensionBridge({ window: win, nonce: 'n1', timeoutMs: 30 });
  const ready = bridge.probe();
  win.receive({ source: 'sajas-extension', type: 'sajas:ready', version: 1, nonce: 'wrong' });
  win.receive({ source: 'sajas-extension', type: 'sajas:ready', version: 1, nonce: 'n1' });
  assert.equal(await ready, true);
  assert.deepEqual(win.sent[0], {
    data: { source: 'sajas-app', type: 'sajas:hello', version: 1, nonce: 'n1' },
    origin: 'https://sajas.pages.dev'
  });
  bridge.dispose();
});

test('probe resolves false when no extension answers', async () => {
  const win = fakeWindow();
  const bridge = createExtensionBridge({ window: win, nonce: 'n1', timeoutMs: 10 });
  assert.equal(await bridge.probe(), false);
  bridge.dispose();
});

test('send posts a validated packet once and waits for a matching ack', async () => {
  const win = fakeWindow();
  const bridge = createExtensionBridge({ window: win, nonce: 'n1', ackTimeoutMs: 50 });
  const result = bridge.send(packet);
  const posted = win.sent.find((entry) => entry.data.type === 'sajas:packet');
  assert.equal(posted.data.packet.packetId, 'p1');
  win.receive({ source: 'sajas-extension', type: 'sajas:ack', version: 1, nonce: 'n1', packetId: 'p1' });
  assert.deepEqual(await result, { ok: true });
  bridge.dispose();
});

test('an invalid packet is refused before anything is posted', async () => {
  const win = fakeWindow();
  const bridge = createExtensionBridge({ window: win, nonce: 'n1', ackTimeoutMs: 10 });
  const result = await bridge.send({ ...packet, version: 1 });
  assert.equal(result.ok, false);
  assert.equal(win.sent.filter((entry) => entry.data.type === 'sajas:packet').length, 0);
  bridge.dispose();
});

test('an ack from a foreign origin is ignored', async () => {
  const win = fakeWindow();
  const bridge = createExtensionBridge({ window: win, nonce: 'n1', ackTimeoutMs: 10 });
  const pending = bridge.send(packet);
  win.receive({ source: 'sajas-extension', type: 'sajas:ack', version: 1, nonce: 'n1', packetId: 'p1' }, { origin: 'https://evil.example' });
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'timeout');
  bridge.dispose();
});

test('an ack from a window other than this one is ignored', async () => {
  const win = fakeWindow();
  const bridge = createExtensionBridge({ window: win, nonce: 'n1', ackTimeoutMs: 10 });
  const pending = bridge.send(packet);
  win.receive({ source: 'sajas-extension', type: 'sajas:ack', version: 1, nonce: 'n1', packetId: 'p1' }, { source: {} });
  assert.equal((await pending).ok, false);
  bridge.dispose();
});

test('an ack with a different nonce is ignored', async () => {
  const win = fakeWindow();
  const bridge = createExtensionBridge({ window: win, nonce: 'n1', ackTimeoutMs: 10 });
  const pending = bridge.send(packet);
  win.receive({ source: 'sajas-extension', type: 'sajas:ack', version: 1, nonce: 'n2', packetId: 'p1' });
  assert.equal((await pending).ok, false);
  bridge.dispose();
});

test('probe ignores a ready message with a different nonce', async () => {
  const win = fakeWindow();
  const bridge = createExtensionBridge({ window: win, nonce: 'n1', timeoutMs: 10 });
  const ready = bridge.probe();
  win.receive({ source: 'sajas-extension', type: 'sajas:ready', version: 1, nonce: 'n2' });
  assert.equal(await ready, false);
  bridge.dispose();
});

test('pullResults asks with this nonce and returns the queued results', async () => {
  const win = fakeWindow();
  const bridge = createExtensionBridge({ window: win, nonce: 'n1', resultsTimeoutMs: 50 });
  const pending = bridge.pullResults();
  assert.deepEqual(win.sent.at(-1), {
    data: { source: 'sajas-app', type: 'sajas:results-request', version: 1, nonce: 'n1' },
    origin: 'https://sajas.pages.dev'
  });
  win.receive({ source: 'sajas-extension', type: 'sajas:results', version: 1, nonce: 'n1', results: [{ id: 'r1' }] });
  assert.deepEqual(await pending, [{ id: 'r1' }]);
  bridge.dispose();
});

test('ackResults posts the ids and waits for the extension confirmation', async () => {
  const win = fakeWindow();
  const bridge = createExtensionBridge({ window: win, nonce: 'n1', resultsTimeoutMs: 50 });
  const pending = bridge.ackResults(['r1', 'r2']);
  assert.equal(win.sent.at(-1).data.type, 'sajas:results-ack');
  assert.deepEqual(win.sent.at(-1).data.ids, ['r1', 'r2']);
  win.receive({ source: 'sajas-extension', type: 'sajas:results-acked', version: 1, nonce: 'n1', ids: ['r1', 'r2'] });
  assert.equal(await pending, true);
  bridge.dispose();
});

test('pullResults gives up quietly when no extension answers', async () => {
  const win = fakeWindow();
  const bridge = createExtensionBridge({ window: win, nonce: 'n1', resultsTimeoutMs: 10 });
  assert.deepEqual(await bridge.pullResults(), []);
  bridge.dispose();
});

test('results and acks from a foreign origin or another nonce are ignored', async () => {
  const win = fakeWindow();
  const bridge = createExtensionBridge({ window: win, nonce: 'n1', resultsTimeoutMs: 10 });
  const results = bridge.pullResults();
  win.receive({ source: 'sajas-extension', type: 'sajas:results', version: 1, nonce: 'n1', results: [{ id: 'r1' }] }, { origin: 'https://evil.example' });
  win.receive({ source: 'sajas-extension', type: 'sajas:results', version: 1, nonce: 'n2', results: [{ id: 'r1' }] });
  assert.deepEqual(await results, []);
  const ack = bridge.ackResults(['r1']);
  win.receive({ source: 'sajas-extension', type: 'sajas:results-acked', version: 1, nonce: 'n2', ids: ['r1'] });
  assert.equal(await ack, false);
  assert.equal(await bridge.ackResults([]), false);
  bridge.dispose();
});
