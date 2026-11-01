import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname);

async function demoFiles() {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/\.(js|jsx)$/.test(entry.name)) continue;
    if (entry.name.endsWith('.test.js') || entry.name.endsWith('.test.jsx')) continue;
    files.push(path.join(root, entry.name));
  }
  return files;
}

const FORBIDDEN = /from\s+['"](?:[^'"]*keyStore|[^'"]*keyCrypto|[^'"]*validateKey|@sajas\/core\/ai|[^'"]*idbAdapter)['"]/;
const INTERCEPTED_HOSTS = new Set(['localhost', '127.0.0.1']);

test('the demo tree never imports a key, crypto, AI or IndexedDB adapter module', async () => {
  for (const file of await demoFiles()) {
    const text = await fs.readFile(file, 'utf8');
    assert.equal(FORBIDDEN.test(text), false, `${path.basename(file)} imports a forbidden module`);
    assert.equal(text.includes('api.anthropic.com'), false, `${path.basename(file)} names the provider origin`);
    assert.equal(/indexedDB/i.test(text), false, `${path.basename(file)} names IndexedDB`);
    assert.equal(text.includes('sajas-web'), false, `${path.basename(file)} names the real vault database`);
  }
});

test('only UI files may fetch, and only the intercepted API base', async () => {
  const ui = new Set(['SimulatedHunter.jsx', 'SimulatedCopilot.jsx']);
  for (const file of await demoFiles()) {
    const name = path.basename(file);
    if (ui.has(name)) continue;
    const text = await fs.readFile(file, 'utf8');
    assert.equal(text.includes('fetch('), false, `${name} performs a fetch outside the API seam`);
  }
  for (const name of ui) {
    const text = await fs.readFile(path.join(root, name), 'utf8');
    for (const match of text.matchAll(/fetch\(([^)]*)\)/g)) {
      assert.match(match[1], /API_BASE|\$\{API_BASE\}/, `${name} fetches outside the API base`);
    }
  }
});

test('the demo tree contains only reserved .test hosts and emails', async () => {
  for (const file of await demoFiles()) {
    const text = await fs.readFile(file, 'utf8');
    const urls = [...text.matchAll(/https?:\/\/[^'"`\s)]+/g)]
      .map((match) => match[0])
      .filter((url) => !url.includes('${'));
    for (const url of urls) {
      const { hostname } = new URL(url);
      if (INTERCEPTED_HOSTS.has(hostname)) continue;
      assert.match(hostname, /\.test$/, `${path.basename(file)}: ${url}`);
    }
    for (const email of [...text.matchAll(/[\w.+-]+@([\w.-]+)/g)].map((match) => match[1])) {
      assert.match(email, /\.test$/, `${path.basename(file)}: ${email}`);
    }
  }
});

test('no placeholder employer survives in the demo tree', async () => {
  for (const file of await demoFiles()) {
    const text = await fs.readFile(file, 'utf8');
    for (const placeholder of [
      'Alex Example', 'Example Studio', 'Fable Fintech', 'Placeholder Health',
      'Imaginary Retail', 'Sample Logistics'
    ]) {
      assert.equal(text.includes(placeholder), false, `${path.basename(file)} still uses ${placeholder}`);
    }
  }
});
