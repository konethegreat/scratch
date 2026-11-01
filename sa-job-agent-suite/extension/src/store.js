// Packets and results live in the extension's own storage, never in the app's
// vault. Every read is validated again so a damaged store cannot yield a packet
// outside the Phase 2 contract.
import { sanitisePacketV2 } from '@sajas/core/apply';
import { resultFrom, RESULT_CAP } from './protocol.js';

export const PACKET_TTL_MS = 8 * 60 * 60 * 1000;
export const PENDING_TTL_MS = 60 * 1000;
export const MAX_PACKETS = 5;
export const MAX_RESULTS = RESULT_CAP;
export const MAX_PENDING = 5;
const PACKETS = 'packets';
const RESULTS = 'results';
const PENDING = 'pending';

const host = (value) => String(value || '').toLowerCase().replace(/\.$/, '').replace(/^www\./, '');

export function createExtensionStore(storage, { now = () => Date.now() } = {}) {
  if (!storage) throw new TypeError('The extension store needs a storage adapter.');
  const at = () => Number(now());
  let sequence = 0;
  const orderOf = (record) => Number(record.order || 0);
  const newestFirst = (left, right) => Date.parse(right.submittedAt) - Date.parse(left.submittedAt)
    || orderOf(right) - orderOf(left);
  const expired = (record) => !record || at() - Number(record.storedAt || 0) > PACKET_TTL_MS;

  async function freshPackets() {
    const records = await storage.readAll(PACKETS);
    const fresh = [];
    for (const record of records) {
      if (expired(record)) await storage.remove(PACKETS, record.id);
      else fresh.push(record);
    }
    return fresh.sort((left, right) => right.storedAt - left.storedAt);
  }

  return {
    async savePacket(raw) {
      const packet = sanitisePacketV2(raw);
      const fresh = await freshPackets();
      while (fresh.length >= MAX_PACKETS) await storage.remove(PACKETS, fresh.pop().id);
      const record = { id: packet.packetId, storedAt: at(), packet };
      await storage.put(PACKETS, record);
      return packet;
    },
    async getPacket(id) {
      const record = (await freshPackets()).find((entry) => entry.id === id);
      if (!record) return null;
      try {
        return sanitisePacketV2(record.packet);
      } catch {
        await storage.remove(PACKETS, id);
        return null;
      }
    },
    async matchingPackets(site) {
      const wanted = host(site);
      if (!wanted) return [];
      const matches = [];
      for (const record of await freshPackets()) {
        if (host(record.packet?.job?.site) !== wanted) continue;
        try {
          matches.push(sanitisePacketV2(record.packet));
        } catch {
          await storage.remove(PACKETS, record.id);
        }
      }
      return matches;
    },
    // A form that navigates takes the page script with it, so the worker holds
    // the submission open here until the tab's next URL confirms or the entry
    // expires.
    async beginSubmit(raw, { tabId, startedUrl } = {}) {
      const result = resultFrom(raw);
      const entries = await storage.readAll(PENDING);
      const live = entries
        .filter((entry) => at() - Number(entry.startedAt || 0) <= PENDING_TTL_MS)
        .sort((left, right) => left.startedAt - right.startedAt);
      for (const entry of entries) {
        if (!live.includes(entry)) await storage.remove(PENDING, entry.id);
      }
      while (live.length >= MAX_PENDING) await storage.remove(PENDING, live.shift().id);
      const record = { id: result.id, tabId: Number(tabId) || 0, startedUrl: String(startedUrl || ''), startedAt: at(), result };
      await storage.put(PENDING, record);
      return record;
    },
    async pendingForTab(tabId) {
      const entries = await storage.readAll(PENDING);
      const live = [];
      for (const entry of entries) {
        if (at() - Number(entry.startedAt || 0) > PENDING_TTL_MS) await storage.remove(PENDING, entry.id);
        else live.push(entry);
      }
      return live.find((entry) => Number(entry.tabId) === Number(tabId)) || null;
    },
    async clearPending(id) {
      const key = String(id || '').trim().slice(0, 80);
      if (key) await storage.remove(PENDING, key);
    },
    async addResult(raw) {
      const result = resultFrom(raw);
      // Milliseconds times 1000 keeps the sum inside the safe integer range and
      // still orders results that share a timestamp.
      const record = { ...result, order: at() * 1000 + (sequence++ % 1000) };
      const existing = (await storage.readAll(RESULTS)).filter((entry) => entry.id !== result.id);
      existing.push(record);
      existing.sort(newestFirst);
      while (existing.length > MAX_RESULTS) await storage.remove(RESULTS, existing.pop().id);
      await storage.put(RESULTS, record);
      return result;
    },
    async takeResults() {
      const records = await storage.readAll(RESULTS);
      return records.sort(newestFirst).map(({ order, ...result }) => result);
    },
    async ackResults(ids) {
      for (const id of Array.isArray(ids) ? ids : []) {
        const key = String(id || '').trim().slice(0, 80);
        if (key) await storage.remove(RESULTS, key);
      }
    }
  };
}
