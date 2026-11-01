// The app half of the extension hand-off. One window, one origin, one nonce per
// page load; a message that fails any of those checks is ignored.
import { sanitisePacketV2 } from '@sajas/core/apply';

export const BRIDGE_VERSION = 1;
const APP = 'sajas-app';
const EXTENSION = 'sajas-extension';

export function createExtensionBridge({
  window: win = globalThis.window,
  origin = win?.location?.origin || '',
  nonce = globalThis.crypto?.randomUUID?.() || String(Date.now()),
  timeoutMs = 1200,
  ackTimeoutMs = 3000
} = {}) {
  const listeners = new Set();
  let disposed = false;

  function accepts(event) {
    return !disposed
      && event?.source === win
      && event?.origin === origin
      && event?.data?.source === EXTENSION
      && event?.data?.version === BRIDGE_VERSION
      && event?.data?.nonce === nonce;
  }

  function onMessage(event) {
    if (!accepts(event)) return;
    for (const listener of [...listeners]) listener(event.data);
  }

  win?.addEventListener?.('message', onMessage);

  function post(data) {
    win?.postMessage?.(data, origin);
  }

  function waitFor(type, match, timeout) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { listeners.delete(listener); resolve(null); }, timeout);
      const listener = (data) => {
        if (data.type !== type || !match(data)) return;
        clearTimeout(timer);
        listeners.delete(listener);
        resolve(data);
      };
      listeners.add(listener);
    });
  }

  return {
    async probe() {
      const ready = waitFor('sajas:ready', () => true, timeoutMs);
      post({ source: APP, type: 'sajas:hello', version: BRIDGE_VERSION, nonce });
      return Boolean(await ready);
    },
    async send(rawPacket) {
      let packet;
      try {
        packet = sanitisePacketV2(rawPacket);
      } catch (error) {
        return { ok: false, reason: 'invalid', message: error.message };
      }
      const ack = waitFor('sajas:ack', (data) => data.packetId === packet.packetId, ackTimeoutMs);
      post({ source: APP, type: 'sajas:packet', version: BRIDGE_VERSION, nonce, packet });
      const received = await ack;
      if (received) return { ok: true };
      return { ok: false, reason: 'timeout', message: 'The extension did not confirm the packet. Check that it is installed and enabled, then try again.' };
    },
    dispose() {
      disposed = true;
      listeners.clear();
      win?.removeEventListener?.('message', onMessage);
    }
  };
}
