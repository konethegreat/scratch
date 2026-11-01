import test from 'node:test';
import assert from 'node:assert/strict';
import { createExtensionStore, MAX_PACKETS, MAX_RESULTS, PACKET_TTL_MS, PENDING_TTL_MS } from './store.js';
import { isAppMessage, isWorkerMessage, resultFrom } from './protocol.js';

function memoryStorage() {
  const data = new Map([['packets', new Map()], ['results', new Map()], ['pending', new Map()]]);
  return {
    async readAll(name) { return [...data.get(name).values()]; },
    async put(name, record) { data.get(name).set(record.id, record); },
    async remove(name, key) { data.get(name).delete(key); }
  };
}

const packet = (id, site = 'localhost', over = {}) => ({
  version: 2,
  packetId: id,
  createdAt: '2026-11-01T10:00:00.000Z',
  job: { id: `job-${id}`, title: 'Engineer', company: 'Acme', site, applyUrl: `http://${site}/apply` },
  identity: [],
  questions: [],
  fields: [],
  attachments: [],
  checklist: [],
  warnings: [],
  ...over
});

const result = (id, over = {}) => ({
  id,
  packetId: `p-${id}`,
  jobId: 'job-1',
  site: 'localhost',
  submittedAt: '2026-11-01T10:00:00.000Z',
  fields: [{ label: 'Email address', value: 'thandi@example.test' }],
  warnings: [],
  ...over
});

test('a packet is validated, stored and found by site', async () => {
  const store = createExtensionStore(memoryStorage());
  await store.savePacket(packet('p1'));
  assert.equal((await store.getPacket('p1')).packetId, 'p1');
  assert.equal((await store.matchingPackets('localhost'))[0].packetId, 'p1');
  assert.deepEqual(await store.matchingPackets('other.test'), []);
  await assert.rejects(() => store.savePacket({ ...packet('bad'), version: 1 }), /version/);
});

test('every packet for one host is offered, newest first', async () => {
  let at = Date.parse('2026-11-01T10:00:00.000Z');
  const store = createExtensionStore(memoryStorage(), { now: () => at });
  await store.savePacket(packet('first'));
  at += 1000;
  await store.savePacket(packet('second'));
  const matches = await store.matchingPackets('localhost');
  assert.deepEqual(matches.map((entry) => entry.packetId), ['second', 'first']);
});

test('a pending submission is found by tab, expires and clears', async () => {
  let at = Date.parse('2026-11-01T10:00:00.000Z');
  const store = createExtensionStore(memoryStorage(), { now: () => at });
  const submitted = result('r1', { confirmation: null });
  await store.beginSubmit(submitted, { tabId: 7, startedUrl: 'http://localhost/apply' });
  assert.equal((await store.pendingForTab(7)).id, 'r1');
  assert.equal(await store.pendingForTab(8), null);
  await store.clearPending('r1');
  assert.equal(await store.pendingForTab(7), null);
  await store.beginSubmit(submitted, { tabId: 7, startedUrl: 'http://localhost/apply' });
  at += PENDING_TTL_MS + 1;
  assert.equal(await store.pendingForTab(7), null);
});

test('packets expire and the cap evicts the oldest', async () => {
  let at = Date.parse('2026-11-01T10:00:00.000Z');
  const store = createExtensionStore(memoryStorage(), { now: () => at });
  for (let index = 0; index < MAX_PACKETS + 2; index += 1) {
    at += 1000;
    await store.savePacket(packet(`p${index}`));
  }
  const kept = await Promise.all(Array.from({ length: MAX_PACKETS + 2 }, (_, index) => store.getPacket(`p${index}`)));
  assert.equal(kept.filter(Boolean).length, MAX_PACKETS);
  assert.equal(await store.getPacket('p0'), null);
  at += PACKET_TTL_MS + 1;
  assert.equal(await store.getPacket(`p${MAX_PACKETS + 1}`), null);
});

test('a corrupted stored packet is dropped on read', async () => {
  const storage = memoryStorage();
  const store = createExtensionStore(storage);
  await store.savePacket(packet('p1'));
  const stored = (await storage.readAll('packets'))[0];
  await storage.put('packets', { ...stored, packet: { ...stored.packet, version: 1 } });
  assert.equal(await store.getPacket('p1'), null);
});

test('results are cleaned, capped and acknowledged by id', async () => {
  const store = createExtensionStore(memoryStorage());
  for (let index = 0; index < MAX_RESULTS + 5; index += 1) {
    await store.addResult(result(`r${index}`));
  }
  const kept = await store.takeResults();
  assert.equal(kept.length, MAX_RESULTS);
  assert.equal(kept.some((entry) => entry.id === 'r0'), false);
  assert.equal(kept[0].fields[0].value, 'thandi@example.test');
  await store.ackResults(['r4', 'r5']);
  assert.equal((await store.takeResults()).some((entry) => entry.id === 'r4'), false);
});

test('a page confirmation is kept on the queued result', async () => {
  const store = createExtensionStore(memoryStorage());
  await store.addResult(result('r1', {
    confirmation: { confirmedAt: '2026-11-01T10:00:00.000Z', text: 'Thank you for applying.' }
  }));
  const [kept] = await store.takeResults();
  assert.deepEqual(kept.confirmation, {
    confirmedAt: '2026-11-01T10:00:00.000Z',
    text: 'Thank you for applying.'
  });
});

test('a result without a job, site or timestamp is refused', async () => {
  const store = createExtensionStore(memoryStorage());
  await assert.rejects(() => store.addResult(result('r1', { jobId: '' })), /job/);
  await assert.rejects(() => store.addResult(result('r1', { site: '' })), /site/);
  await assert.rejects(() => store.addResult(result('r1', { submittedAt: 'today' })), /time/);
});

test('bridge messages are versioned, sourced and nonce-carrying', () => {
  assert.equal(isAppMessage({ source: 'sajas-app', type: 'sajas:hello', version: 1, nonce: 'n1' }), true);
  assert.equal(isAppMessage({ source: 'sajas-app', type: 'sajas:hello', version: 2, nonce: 'n1' }), false);
  assert.equal(isAppMessage({ source: 'sajas-app', type: 'sajas:hello', version: 1 }), false);
  assert.equal(isAppMessage({ source: 'other', type: 'sajas:hello', version: 1, nonce: 'n1' }), false);
  assert.equal(isAppMessage({ source: 'sajas-app', type: 'sajas:unknown', version: 1, nonce: 'n1' }), false);
  assert.equal(isWorkerMessage({ source: 'sajas-extension', type: 'sajas:results', version: 1, nonce: 'n1', results: [] }), true);
  assert.equal(isWorkerMessage({ source: 'sajas-extension', type: 'sajas:results', version: 1, nonce: 'n1' }), false);
});

test('resultFrom caps fields and refuses a key-shaped value', () => {
  const fakeKey = ['sk', 'ant', 'x'.repeat(24)].join('-');
  const clean = resultFrom(result('r1', { fields: [{ label: 'Email', value: 'a'.repeat(600) }] }));
  assert.equal(clean.fields[0].value.length, 500);
  assert.equal(resultFrom(result('r1', { fields: [{ label: 'Notes', value: fakeKey }] })).fields.length, 0);
});
