import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';
import { IS_WEB } from './web/env.js';
import { webRuntime, WEB_API_BASE } from './web/runtime.js';
import { installWebApi } from './web/install.js';
import './index.css';

const API_BASE = import.meta.env.VITE_SAJAS_API_BASE || 'http://localhost:5000/api';

if (IS_WEB) {
  // Every API_BASE call is answered in-process by the vault-backed API port,
  // including its 404/501 error contracts, so nothing reaches the network.
  window.fetch = installWebApi({
    apiBase: WEB_API_BASE,
    handler: webRuntime.api.handle,
    nativeFetch: window.fetch.bind(window)
  });
} else {
  // The local API refuses state-changing requests that lack this header (see
  // server/src/localGuard.js). Web mode has no server, so this patch is desktop-only.
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
    if (typeof url !== 'string' || !url.startsWith(API_BASE)) return nativeFetch(input, init);
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    headers.set('X-SAJAS-Client', '1');
    return nativeFetch(input, { ...init, headers });
  };
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
