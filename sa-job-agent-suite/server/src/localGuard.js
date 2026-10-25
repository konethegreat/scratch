// Local API guard. CORS only controls who may READ a response; it does not stop a
// web page open in the user's browser from firing a body-less "simple" POST at
// 127.0.0.1, and it says nothing about DNS rebinding. This guard refuses both:
//   1. Host must be localhost / 127.0.0.1 / [::1] on exactly the configured port
//      (a rebinding hostname such as 127.0.0.1.evil.example is refused).
//   2. Origin, when present, must be a localhost hostname (any port: the Vite dev
//      server runs on another one). No Origin is fine (Electron renderer, curl).
//   3. Anything other than GET/HEAD/OPTIONS must carry `X-SAJAS-Client: 1`, a
//      custom header a cross-site form or simple request cannot add.
// Every in-repo caller that makes a state-changing request must send the header.

export const CLIENT_HEADER = 'x-sajas-client';
export const CLIENT_HEADER_VALUE = '1';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

const refuse = (error) => ({ ok: false, status: 403, error });

function hostAllowed(host, port) {
  if (typeof host !== 'string' || !host) return false;
  const match = /^(localhost|127\.0\.0\.1|\[::1\]):(\d+)$/i.exec(host);
  return Boolean(match) && match[2] === String(port);
}

function originAllowed(origin) {
  try {
    return LOCAL_HOSTNAMES.has(new URL(origin).hostname.toLowerCase());
  } catch {
    return false; // includes the string 'null' sent by opaque origins
  }
}

export function checkLocalRequest({ method, host, origin, clientHeader }, { port }) {
  if (!hostAllowed(host, port)) return refuse('Host not allowed');
  if (origin !== undefined && origin !== '' && !originAllowed(origin)) return refuse('Origin not allowed');
  if (!SAFE_METHODS.has(String(method).toUpperCase()) && clientHeader !== CLIENT_HEADER_VALUE) {
    return refuse('Missing X-SAJAS-Client header');
  }
  return { ok: true };
}

export function localGuard({ port }) {
  return (req, res, next) => {
    const verdict = checkLocalRequest({
      method: req.method,
      host: req.headers.host,
      origin: req.headers.origin,
      clientHeader: req.headers[CLIENT_HEADER]
    }, { port });
    if (!verdict.ok) return res.status(403).json({ error: verdict.error });
    return next();
  };
}
