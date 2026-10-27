// Install the web API ahead of every fetch the UI makes. Only API_BASE calls are
// intercepted; everything else (including Anthropic) keeps the native fetch.
// Every API_BASE call, including 404/501 answers, is handled locally, so a web
// build can never fall through to a non-existent localhost server.
function urlOf(input, base) {
  const raw = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.href
      : typeof input?.url === 'string'
        ? input.url
        : null;
  if (typeof raw !== 'string') return null;
  try {
    return new URL(raw, base);
  } catch {
    return null;
  }
}

export function installWebApi({ apiBase, handler, nativeFetch = globalThis.fetch }) {
  const base = new URL(apiBase);
  const basePath = base.pathname.replace(/\/$/, '');
  return (input, init) => {
    const url = urlOf(input, base);
    const isApi = Boolean(url)
      && url.origin === base.origin
      && (url.pathname === basePath || url.pathname.startsWith(`${basePath}/`));
    if (!isApi) return nativeFetch(input, init);
    return handler(input, init);
  };
}
