// Builds the unpacked MV3 extension into extension/dist.
// The service worker is a module worker; every other entry is injected or
// loaded as a classic script, so only the worker keeps ESM output.
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'extension/dist');
const src = path.join(root, 'extension/src');

await fs.rm(out, { recursive: true, force: true });
await fs.mkdir(path.join(out, 'icons'), { recursive: true });
await fs.copyFile(path.join(root, 'extension/manifest.json'), path.join(out, 'manifest.json'));
for (const file of ['popup.html', 'popup.css']) {
  await fs.copyFile(path.join(src, file), path.join(out, file));
}
await fs.copyFile(path.join(root, 'extension/icons/icon-128.png'), path.join(out, 'icons/icon-128.png'));

const shared = { bundle: true, target: 'chrome120', legalComments: 'none', logLevel: 'info', outdir: out };
await build({ ...shared, format: 'esm', entryPoints: { sw: path.join(src, 'sw.js') } });
await build({
  ...shared,
  format: 'iife',
  entryPoints: {
    appBridge: path.join(src, 'appBridge.js'),
    page: path.join(src, 'page.js'),
    popup: path.join(src, 'popup.js')
  }
});
