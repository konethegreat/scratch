import { IS_WEB } from './env.js';
import { createIdbAdapter } from './idbAdapter.js';
import { createVault } from './vault.js';
import { createKeyStore } from './keyStore.js';
import { createActivity } from './activity.js';
import { createWebApi } from './api.js';

export const WEB_API_BASE = import.meta.env.VITE_SAJAS_API_BASE || 'http://localhost:5000/api';

function build() {
  const vault = createVault(createIdbAdapter());
  const keyStore = createKeyStore({ vault });
  const activity = createActivity();
  const api = createWebApi({ apiBase: WEB_API_BASE, vault, keyStore, activity });
  return { vault, keyStore, activity, api };
}

export const webRuntime = IS_WEB ? build() : null;
