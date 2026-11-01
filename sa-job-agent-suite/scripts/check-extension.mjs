// Static gate for the built extension: refuses anything that could reach the
// network, read app secrets or upload data. Run after npm run build:extension.
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'extension/dist');
const failures = [];
const fail = (message) => failures.push(message);

const read = async (file) => fs.readFile(path.join(dist, file), 'utf8');

let manifest;
try {
  manifest = JSON.parse(await read('manifest.json'));
} catch {
  console.error('check-extension: FAIL - extension/dist/manifest.json is missing. Run npm run build:extension first.');
  process.exit(1);
}

if (manifest.manifest_version !== 3) fail('manifest is not v3');
const allowed = ['storage', 'scripting', 'activeTab', 'tabs'];
for (const permission of manifest.permissions || []) {
  if (!allowed.includes(permission)) fail(`unexpected permission: ${permission}`);
}
if (manifest.host_permissions?.some((pattern) => pattern.includes('*://*') || pattern === '<all_urls>')) {
  fail('host permissions are broader than the three allowed origins');
}
if (JSON.stringify(manifest).includes('<all_urls>')) fail('<all_urls> is not allowed');
if (manifest.externally_connectable) fail('externally_connectable is not allowed');

for (const file of ['sw.js', 'appBridge.js', 'page.js', 'popup.js']) {
  const source = await read(file);
  if (!source.trim()) fail(`${file} is empty`);
  if (/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon/.test(source)) fail(`${file} reaches the network`);
  if (/anthropicApiKey|keyVault|sajas-web/.test(source)) fail(`${file} mentions app key or vault state`);
  if (/^\s*import\s/m.test(source)) fail(`${file} kept an import`);
}

const html = await read('popup.html');
if (/<script(?![^>]*\bsrc=)/i.test(html)) fail('popup has an inline script');

if (failures.length) {
  for (const failure of failures) console.error(`check-extension: FAIL - ${failure}`);
  process.exit(1);
}
console.log('check-extension: PASS');
