// Packets and results live in the extension's own storage, never in the app's
// vault. Every read is validated again so a damaged store cannot yield a packet
// outside the Phase 2 contract.
import { sanitisePacketV2 } from '@sajas/core/apply';
import { resultFrom, RESULT_CAP } from './protocol.js';

export const PACKET_TTL_MS = 8 * 60 * 60 * 1000;
export const MAX_PACKETS = 5;
export const MAX_RESULTS = RESULT_CAP;
const PACKETS = 'packets';
const RESULTS = 'results';

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
    async matchingPacket(site) {
      const wanted = host(site);
      if (!wanted) return null;
      const record = (await freshPackets()).find((entry) => host(entry.packet?.job?.site) === wanted);
      return record ? sanitisePacketV2(record.packet) : null;
    },
    async addResult(raw) {
      const result = resultFrom(raw);
      const record = { ...result, order: at() * 1e6 + (sequence++ % 1e6) };
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
