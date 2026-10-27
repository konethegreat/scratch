import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';
import { IS_WEB } from './web/env.js';
import './index.css';

const API_BASE = import.meta.env.VITE_SAJAS_API_BASE || 'http://localhost:5000/api';

if (!IS_WEB) {
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

  // The desktop CSP allows these; the hosted CSP deliberately does not.
  for (const [href, rel] of [
    ['https://fonts.googleapis.com', 'preconnect'],
    ['https://fonts.gstatic.com', 'preconnect'],
    ['https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Outfit:wght@400;500;600;700;850&display=swap', 'stylesheet']
  ]) {
    const link = document.createElement('link');
    link.rel = rel;
    link.href = href;
    if (rel === 'preconnect' && href.includes('gstatic')) link.crossOrigin = 'anonymous';
    document.head.append(link);
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
