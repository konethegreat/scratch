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

test('foreign origins, wrong sources, wrong nonces and invalid packets are refused', async () => {
  const win = fakeWindow();
  const bridge = createExtensionBridge({ window: win, nonce: 'n1', ackTimeoutMs: 10 });
  const rejected = bridge.send({ ...packet, version: 1 });
  assert.equal(win.sent.filter((entry) => entry.data.type === 'sajas:packet').length, 0);
  assert.equal((await rejected).ok, false);

  const pending = bridge.send(packet);
  win.receive({ source: 'sajas-extension', type: 'sajas:ack', version: 1, nonce: 'n1', packetId: 'p1' }, { origin: 'https://evil.example' });
  win.receive({ source: {}, type: 'sajas:ack', version: 1, nonce: 'n1', packetId: 'p1' });
  win.receive({ source: 'sajas-extension', type: 'sajas:ack', version: 1, nonce: 'n1', packetId: 'p1' });
  assert.deepEqual(await pending, { ok: true });
  bridge.dispose();
  assert.equal(win.sent.filter((entry) => entry.data.type === 'sajas:packet').length, 1);
});
