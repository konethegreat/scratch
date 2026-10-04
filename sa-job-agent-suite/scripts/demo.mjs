import { startDemoBackend } from './demo-runtime.mjs';
import { startDemoClient } from './demo-client.mjs';

const backend = await startDemoBackend();
let client;
try {
  client = await startDemoClient(backend.origin);
  console.log(`SA-JAS synthetic demo: http://127.0.0.1:4175\nFictional data: ${backend.directory}\nNo AI calls or live job sites. Press Ctrl+C to close browsers and remove demo data.`);
} catch (error) { await client?.close(); await backend.stop(); throw error; }
let closing = false;
async function stop() {
  if (closing) return; closing = true;
  await client.close(); await backend.stop(); process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
