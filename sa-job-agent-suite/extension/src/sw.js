import { createIdbStorage } from './idb.js';
import { createExtensionStore } from './store.js';
import { createWorkerHandlers } from './worker.js';

const store = createExtensionStore(createIdbStorage());
const handlers = createWorkerHandlers({ store, chrome });

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handlers.onMessage(message, sender).then(sendResponse, (error) => {
    sendResponse({ ok: false, error: String(error?.message || 'The apply assistant failed.') });
  });
  return true;
});
