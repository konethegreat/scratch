import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkerHandlers, hostOf } from './worker.js';

const PACKET = {
  version: 2,
  packetId: 'p1',
  createdAt: '2026-11-01T10:00:00.000Z',
  job: { id: 'job-1', title: 'Backend Engineer', company: 'Acme', site: 'boards.example.test', applyUrl: 'https://boards.example.test/apply' },
  identity: [{ label: 'Email', value: 'thandi@example.test' }],
  fields: [],
  attachments: [{ key: 'a', label: 'CV', fileName: 'cv.pdf', mime: 'application/pdf', size: 4, dataBase64: 'AAAA' }]
};

const APP = { id: 'extid', url: 'https://sajas.pages.dev/settings' };
const POPUP = { id: 'extid', url: 'chrome-extension://extid/popup.html' };
const JOB_PAGE = { id: 'extid', url: 'https://boards.example.test/apply', tab: { id: 7, url: 'https://boards.example.test/apply' } };

function harness({ tabUrl = 'https://boards.example.test/apply', store = {} } = {}) {
  const calls = { saved: [], acked: [], added: [], injected: [], sent: [], begun: [], cleared: [], pending: new Map() };
  const fakeStore = {
    async savePacket(packet) { calls.saved.push(packet); return { ...packet, packetId: packet.packetId || 'p1' }; },
    async getPacket(id) { return id === 'p1' ? PACKET : null; },
    async matchingPackets(host) { return hostOf(host) === 'boards.example.test' ? [PACKET] : []; },
    async takeResults() { return [{ id: 'r1', jobId: 'job-1', site: 'boards.example.test' }]; },
    async ackResults(ids) { calls.acked.push(...ids); },
    async addResult(result) { calls.added.push(result); },
    async beginSubmit(result, meta) {
      calls.begun.push({ result, meta });
      calls.pending.set(result.id, { id: result.id, tabId: meta.tabId, startedUrl: meta.startedUrl, result });
    },
    async pendingForTab(tabId) {
      return [...calls.pending.values()].find((entry) => Number(entry.tabId) === Number(tabId)) || null;
    },
    async clearPending(id) { calls.cleared.push(id); calls.pending.delete(id); },
    ...store
  };
  const chrome = {
    tabs: {
      async get(id) { return { id, url: tabUrl }; },
      async sendMessage(id, message) { calls.sent.push({ id, message }); }
    },
    scripting: {
      async executeScript(details) { calls.injected.push(details); }
    }
  };
  const handlers = createWorkerHandlers({ store: fakeStore, chrome, now: () => Date.parse('2026-11-01T10:00:00.000Z') });
  return { handlers, calls };
}

test('only the app origin may store a packet', async () => {
  const { handlers, calls } = harness();
  const denied = await handlers.onMessage({ type: 'sajas:store-packet', packet: PACKET }, { id: 'extid', url: 'https://evil.example.test/page' });
  assert.equal(denied.ok, false);
  const allowed = await handlers.onMessage({ type: 'sajas:store-packet', packet: PACKET }, APP);
  assert.equal(allowed.ok, true);
  assert.equal(allowed.packetId, 'p1');
  assert.equal(calls.saved.length, 1);
  const local = await handlers.onMessage({ type: 'sajas:store-packet', packet: PACKET }, { id: 'extid', url: 'http://localhost:5173/' });
  assert.equal(local.ok, true);
});

test('a refused packet reports a plain error and stores nothing', async () => {
  const { handlers, calls } = harness({ store: { async savePacket() { throw new Error('That packet carries a field that looks like a credential.'); } } });
  const response = await handlers.onMessage({ type: 'sajas:store-packet', packet: PACKET }, APP);
  assert.deepEqual(response, { ok: false, error: 'That application packet was refused.' });
  assert.equal(calls.saved.length, 0);
});

test('the popup can look up every match and only summaries come back', async () => {
  const second = { ...PACKET, packetId: 'p2', job: { ...PACKET.job, id: 'job-2', title: 'Data Engineer' } };
  const { handlers } = harness({ store: { async matchingPackets() { return [second, PACKET]; } } });
  const response = await handlers.onMessage({ type: 'sajas:matching-packet', host: 'boards.example.test' }, POPUP);
  assert.equal(response.ok, true);
  assert.deepEqual(response.matches, [
    { packetId: 'p2', title: 'Data Engineer', company: 'Acme', site: 'boards.example.test' },
    { packetId: 'p1', title: 'Backend Engineer', company: 'Acme', site: 'boards.example.test' }
  ]);
  assert.equal(JSON.stringify(response).includes('thandi@example.test'), false);
  assert.equal(JSON.stringify(response).includes('dataBase64'), false);
  const stranger = await handlers.onMessage({ type: 'sajas:matching-packet', host: 'boards.example.test' }, JOB_PAGE);
  assert.equal(stranger.ok, false);
});

test('results are only handed out to the app, and an ack removes them', async () => {
  const { handlers, calls } = harness();
  const taken = await handlers.onMessage({ type: 'sajas:take-results' }, POPUP);
  assert.equal(taken.ok, false);
  const allowed = await handlers.onMessage({ type: 'sajas:take-results' }, APP);
  assert.equal(allowed.results.length, 1);
  const ack = await handlers.onMessage({ type: 'sajas:ack-results', ids: ['r1'] }, APP);
  assert.equal(ack.ok, true);
  assert.deepEqual(calls.acked, ['r1']);
});

const RESULT = { id: 'p1', packetId: 'p1', jobId: 'job-1', site: 'boards.example.test', submittedAt: '2026-11-01T09:59:00.000Z', fields: [] };

test('a result is recorded only for the page host it came from', async () => {
  const { handlers, calls } = harness();
  const mismatch = await handlers.onMessage({ type: 'sajas:record-result', result: RESULT }, { ...JOB_PAGE, tab: { id: 7, url: 'https://other.example.test/apply' } });
  assert.equal(mismatch.ok, false);
  const allowed = await handlers.onMessage({ type: 'sajas:record-result', result: RESULT }, JOB_PAGE);
  assert.equal(allowed.ok, true);
  assert.equal(calls.added.length, 1);
  assert.equal(calls.added[0].recordedAt, '2026-11-01T10:00:00.000Z');
});

test('a submission is tracked before the page navigates, and only from its own page', async () => {
  const { handlers, calls } = harness();
  const mismatch = await handlers.onMessage({ type: 'sajas:begin-submit', result: RESULT }, { ...JOB_PAGE, tab: { id: 7, url: 'https://other.example.test/apply' } });
  assert.equal(mismatch.ok, false);
  assert.equal(calls.begun.length, 0);
  const allowed = await handlers.onMessage({ type: 'sajas:begin-submit', result: RESULT }, JOB_PAGE);
  assert.equal(allowed.ok, true);
  assert.deepEqual(calls.begun[0].meta, { tabId: 7, startedUrl: 'https://boards.example.test/apply' });
});

test('a navigation to a confirmation page finishes a tracked submission', async () => {
  const { handlers, calls } = harness();
  await handlers.onMessage({ type: 'sajas:begin-submit', result: RESULT }, JOB_PAGE);
  assert.equal((await handlers.onTabUpdated(7, {})).finalised, false, 'a change without a URL is ignored');
  assert.equal((await handlers.onTabUpdated(7, { url: 'https://boards.example.test/apply' })).finalised, false, 'the same URL is not a confirmation');
  assert.equal((await handlers.onTabUpdated(7, { url: 'https://boards.example.test/step-two' })).finalised, false, 'an unclear URL is not a confirmation');
  assert.equal(calls.added.length, 0);
  const done = await handlers.onTabUpdated(7, { url: 'https://boards.example.test/thanks' });
  assert.equal(done.finalised, true);
  assert.equal(calls.added.length, 1);
  assert.equal(calls.added[0].submittedAt, '2026-11-01T10:00:00.000Z');
  assert.deepEqual(calls.added[0].confirmation, { confirmedAt: '2026-11-01T10:00:00.000Z', text: 'The page moved to a confirmation page.' });
  assert.deepEqual(calls.cleared, ['p1']);
  assert.equal((await handlers.onTabUpdated(7, { url: 'https://boards.example.test/thanks?again=1' })).finalised, false, 'the pending entry is gone');
});

test('leaving the site drops a tracked submission without recording it', async () => {
  const { handlers, calls } = harness();
  await handlers.onMessage({ type: 'sajas:begin-submit', result: RESULT }, JOB_PAGE);
  await handlers.onTabUpdated(7, { url: 'https://other.example.test/thanks' });
  assert.equal(calls.added.length, 0);
  assert.deepEqual(calls.cleared, ['p1']);
});

test('cancelling clears the tracked submission only for its own page', async () => {
  const { handlers, calls } = harness();
  await handlers.onMessage({ type: 'sajas:begin-submit', result: RESULT }, JOB_PAGE);
  const denied = await handlers.onMessage({ type: 'sajas:cancel-submit', packetId: 'p1', site: 'others.example.test' }, JOB_PAGE);
  assert.equal(denied.ok, false);
  assert.deepEqual(calls.cleared, []);
  const cancel = await handlers.onMessage({ type: 'sajas:cancel-submit', packetId: 'p1', site: 'boards.example.test' }, JOB_PAGE);
  assert.equal(cancel.ok, true);
  assert.deepEqual(calls.cleared, ['p1']);
});

test('recording a result clears a tracked submission', async () => {
  const { handlers, calls } = harness();
  await handlers.onMessage({ type: 'sajas:begin-submit', result: RESULT }, JOB_PAGE);
  await handlers.onMessage({ type: 'sajas:record-result', result: RESULT }, JOB_PAGE);
  assert.deepEqual(calls.cleared, ['p1']);
});

test('injection needs the popup, a waiting packet and the matching tab host', async () => {
  const { handlers, calls } = harness();
  const fromPage = await handlers.onMessage({ type: 'sajas:inject', tabId: 7, packetId: 'p1' }, JOB_PAGE);
  assert.equal(fromPage.ok, false);
  const missing = await handlers.onMessage({ type: 'sajas:inject', tabId: 7, packetId: 'gone' }, POPUP);
  assert.equal(missing.ok, false);
  const wrongTab = await handlers.onMessage({ type: 'sajas:inject', tabId: 7, packetId: 'p1' }, POPUP);
  assert.equal(wrongTab.ok, true, 'the default tab host matches the packet site');
  assert.equal(calls.injected.length, 1);
  assert.deepEqual(calls.sent[0], { id: 7, message: { type: 'sajas:fill', packetId: 'p1' } });

  const offsite = harness({ tabUrl: 'https://elsewhere.example.test/apply' });
  const refused = await offsite.handlers.onMessage({ type: 'sajas:inject', tabId: 7, packetId: 'p1' }, POPUP);
  assert.equal(refused.ok, false);
  assert.equal(offsite.calls.injected.length, 0);
});

test('a page can read only its own waiting packet', async () => {
  const { handlers } = harness();
  const missing = await handlers.onMessage({ type: 'sajas:packet-by-id', packetId: 'gone' }, JOB_PAGE);
  assert.equal(missing.ok, false);
  const fromApp = await handlers.onMessage({ type: 'sajas:packet-by-id', packetId: 'p1' }, APP);
  assert.equal(fromApp.ok, false);
  const offsite = await harness({ tabUrl: 'https://other.example.test/apply' });
  const denied = await offsite.handlers.onMessage({ type: 'sajas:packet-by-id', packetId: 'p1' }, { ...JOB_PAGE, tab: { id: 7, url: 'https://other.example.test/apply' } });
  assert.equal(denied.ok, false);
  const allowed = await handlers.onMessage({ type: 'sajas:packet-by-id', packetId: 'p1' }, JOB_PAGE);
  assert.equal(allowed.ok, true);
  assert.equal(allowed.packet.packetId, 'p1');
});

test('unknown and malformed messages are refused without side effects', async () => {
  const { handlers, calls } = harness();
  assert.equal((await handlers.onMessage({ type: 'sajas:steal' }, APP)).ok, false);
  assert.equal((await handlers.onMessage(null, APP)).ok, false);
  assert.equal(calls.saved.length + calls.acked.length + calls.added.length + calls.injected.length + calls.begun.length + calls.cleared.length, 0);
});
