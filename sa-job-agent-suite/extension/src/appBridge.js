// The only script the extension leaves on the app origin. It relays validated
// window messages to the service worker and nothing else.
import { isAppMessage, EXTENSION_SOURCE, BRIDGE_VERSION } from './protocol.js';

const allowed = (href) => {
  try {
    const { protocol, hostname } = new URL(href);
    return (protocol === 'https:' && hostname === 'sajas.pages.dev')
      || (protocol === 'http:' && ['localhost', '127.0.0.1'].includes(hostname));
  } catch {
    return false;
  }
};

let nonce = '';

function reply(type, extra = {}) {
  if (!allowed(location.href)) return;
  window.postMessage({ source: EXTENSION_SOURCE, type, version: BRIDGE_VERSION, nonce, ...extra }, location.origin);
}

async function ask(type, body = {}) {
  try {
    return await chrome.runtime.sendMessage({ type, ...body });
  } catch {
    return null;
  }
}

window.addEventListener('message', async (event) => {
  if (event.source !== window || event.origin !== location.origin) return;
  if (!isAppMessage(event.data)) return;
  const message = event.data;
  if (message.type === 'sajas:hello') {
    nonce = message.nonce;
    reply('sajas:ready');
    return;
  }
  if (!nonce || message.nonce !== nonce) return;
  if (message.type === 'sajas:packet') {
    const response = await ask('sajas:store-packet', { packet: message.packet });
    if (response?.ok) reply('sajas:ack', { packetId: response.packetId });
    return;
  }
  if (message.type === 'sajas:results-request') {
    const response = await ask('sajas:take-results');
    reply('sajas:results', { results: Array.isArray(response?.results) ? response.results : [] });
    return;
  }
  if (message.type === 'sajas:results-ack') {
    const ids = Array.isArray(message.ids) ? message.ids : [];
    const response = await ask('sajas:ack-results', { ids });
    if (response?.ok) reply('sajas:results-acked', { ids });
  }
});
