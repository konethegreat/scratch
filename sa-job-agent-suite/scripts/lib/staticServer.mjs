import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseHeadersFile, headersFor } from './headers.mjs';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

export async function startStaticServer({ root, port = 0 }) {
  const resolved = path.resolve(root);
  const rules = parseHeadersFile(await fs.readFile(path.join(resolved, '_headers'), 'utf8').catch(() => ''));

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      // A malformed percent-escape throws URIError; answer instead of letting
      // the rejection escape the async handler with no response written.
      res.writeHead(400).end('Bad Request');
      return;
    }
    let file = path.resolve(resolved, `.${pathname}`);
    // `startsWith` would admit sibling prefixes such as `dist2/...`; compare
    // relative paths instead so only the served root (and below) is reachable.
    const relative = path.relative(resolved, file);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    let body;
    try {
      body = await fs.readFile(file);
      if (!file.includes('.')) throw new Error('directory');
    } catch {
      file = path.join(resolved, 'index.html');
      body = await fs.readFile(file);
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      ...headersFor(rules, url.pathname)
    });
    res.end(body);
  });

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}
