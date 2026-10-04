import { createServer } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const suite = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function startDemoClient(apiOrigin, { port = 4175 } = {}) {
  process.env.VITE_SAJAS_API_BASE = `${apiOrigin}/api`;
  process.env.VITE_SAJAS_DEMO = '1';
  const client = await createServer({ root: path.join(suite, 'client'),
    server: { host: '127.0.0.1', port, strictPort: true },
    plugins: [{ name: 'sajas-local-demo-fonts', transformIndexHtml(html) {
      // Use the existing system-font fallbacks; don't fetch web fonts in the demo.
      return html.replace(/<link\b[^>]*https:\/\/fonts\.(?:googleapis|gstatic)\.com[^>]*>/g, '');
    } }] });
  try { await client.listen(); return client; }
  catch (error) { await client.close(); throw error; }
}
