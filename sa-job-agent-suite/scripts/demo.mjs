import { createServer } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startDemoBackend } from './demo-runtime.mjs';

const suite = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backend = await startDemoBackend();
let client;
try {
  process.env.VITE_SAJAS_API_BASE = `${backend.origin}/api`;
  process.env.VITE_SAJAS_DEMO = '1';
  client = await createServer({ root: path.join(suite, 'client'),
    server: { host: '127.0.0.1', port: 4175, strictPort: true } });
  await client.listen();
  console.log(`SA-JAS synthetic demo: http://127.0.0.1:4175\nFictional data: ${backend.directory}\nNo AI calls or live job sites. Press Ctrl+C to close browsers and remove demo data.`);
} catch (error) { await client?.close(); await backend.stop(); throw error; }
let closing = false;
async function stop() {
  if (closing) return; closing = true;
  await client.close(); await backend.stop(); process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
