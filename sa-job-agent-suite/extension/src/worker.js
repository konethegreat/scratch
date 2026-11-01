// Every privileged request is checked against its sender. The app may queue a
// packet and collect results; the popup may ask for a match and start a fill;
// a job page may only report a result for its own host.
export const APP_HOSTS = Object.freeze(['sajas.pages.dev', 'localhost', '127.0.0.1']);

export function hostOf(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(raw) ? raw : `https://${raw}`);
    return url.hostname.replace(/\.$/, '').replace(/^www\./, '');
  } catch {
    return '';
  }
}

const isAppSender = (sender) => APP_HOSTS.includes(hostOf(sender?.url || sender?.tab?.url));
const isExtensionPage = (sender) => Boolean(sender?.id) && String(sender?.url || '').startsWith(`chrome-extension://${sender.id}/`);
const sameSite = (sender, site) => Boolean(hostOf(sender?.tab?.url)) && hostOf(sender.tab.url) === hostOf(site);
const CONFIRM_URL = /thank|confirm|success|applied|submitted|complete/i;

const matchSummary = (packet) => ({
  packetId: packet.packetId,
  title: packet.job.title,
  company: packet.job.company,
  site: packet.job.site
});

export function createWorkerHandlers({ store, chrome, now = () => Date.now() }) {
  if (!store) throw new TypeError('The worker needs a packet store.');
  const clock = () => Number(now());

  return {
    async onMessage(raw, sender = {}) {
      const message = raw && typeof raw === 'object' ? raw : {};
      switch (message.type) {
        case 'sajas:store-packet': {
          if (!isAppSender(sender)) return { ok: false, error: 'Only the SA-JAS app can send an application.' };
          try {
            const packet = await store.savePacket(message.packet);
            return { ok: true, packetId: packet.packetId };
          } catch {
            return { ok: false, error: 'That application packet was refused.' };
          }
        }
        case 'sajas:matching-packet': {
          if (!isAppSender(sender) && !isExtensionPage(sender)) {
            return { ok: false, error: 'Only the SA-JAS app or its popup can look for an application.' };
          }
          const packets = await store.matchingPackets(message.host);
          return { ok: true, matches: packets.map(matchSummary) };
        }
        case 'sajas:take-results': {
          if (!isAppSender(sender)) return { ok: false, error: 'Only the SA-JAS app can collect results.' };
          return { ok: true, results: await store.takeResults() };
        }
        case 'sajas:ack-results': {
          if (!isAppSender(sender)) return { ok: false, error: 'Only the SA-JAS app can acknowledge results.' };
          await store.ackResults(message.ids);
          return { ok: true };
        }
        case 'sajas:record-result': {
          if (!sameSite(sender, message.result?.site)) {
            return { ok: false, error: 'That result does not match the page it came from.' };
          }
          try {
            await store.addResult({ ...message.result, recordedAt: new Date(clock()).toISOString() });
            await store.clearPending?.(message.result?.id || message.result?.packetId);
            return { ok: true };
          } catch {
            return { ok: false, error: 'That result was refused.' };
          }
        }
        case 'sajas:begin-submit': {
          if (!sameSite(sender, message.result?.site)) {
            return { ok: false, error: 'That submission does not match the page it came from.' };
          }
          try {
            await store.beginSubmit(message.result, { tabId: sender.tab?.id, startedUrl: sender.tab?.url });
            return { ok: true };
          } catch {
            return { ok: false, error: 'That submission could not be tracked.' };
          }
        }
        case 'sajas:cancel-submit': {
          if (!sameSite(sender, message.site)) {
            return { ok: false, error: 'That submission does not match the page it came from.' };
          }
          await store.clearPending(message.packetId);
          return { ok: true };
        }
        case 'sajas:packet-by-id': {
          const packet = await store.getPacket(message.packetId);
          if (!packet) return { ok: false, error: 'That application is no longer waiting.' };
          if (hostOf(sender.tab?.url) !== hostOf(packet.job.site)) {
            return { ok: false, error: 'Open the application link for this job first.' };
          }
          return { ok: true, packet };
        }
        case 'sajas:inject': {
          if (!isExtensionPage(sender)) return { ok: false, error: 'Only the apply assistant popup can start a fill.' };
          const packet = await store.getPacket(message.packetId);
          if (!packet) return { ok: false, error: 'That application is no longer waiting.' };
          const tab = await chrome.tabs.get(message.tabId);
          const url = String(tab?.url || '');
          if (!/^https?:/i.test(url) || hostOf(url) !== hostOf(packet.job.site)) {
            return { ok: false, error: 'Open the application link for this job first.' };
          }
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['page.js'] });
          await chrome.tabs.sendMessage(tab.id, { type: 'sajas:fill', packetId: packet.packetId });
          return { ok: true };
        }
        default:
          return { ok: false, error: 'Unknown message.' };
      }
    },
    // A form that submits by navigation destroys the page script before it can
    // report anything. The tab's own URL change is the confirmation then.
    async onTabUpdated(tabId, changeInfo = {}) {
      const url = String(changeInfo.url || '');
      if (!url) return { finalised: false };
      const pending = await store.pendingForTab(tabId);
      if (!pending) return { finalised: false };
      if (url === pending.startedUrl) return { finalised: false };
      if (hostOf(url) !== hostOf(pending.result?.site)) {
        await store.clearPending(pending.id);
        return { finalised: false };
      }
      if (!CONFIRM_URL.test(url)) return { finalised: false };
      const submittedAt = new Date(clock()).toISOString();
      await store.addResult({
        ...pending.result,
        submittedAt,
        confirmation: { confirmedAt: submittedAt, text: 'The page moved to a confirmation page.' }
      });
      await store.clearPending(pending.id);
      return { finalised: true };
    }
  };
}
