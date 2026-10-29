// Fails when demo fixtures or the demo storage namespace leak into the entry
// chunk, and fails when the demo chunk is missing entirely.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'client/dist');
const MARKERS = ['Alex Example', 'Example Studio', 'Fable Fintech', 'sajas:demo:'];

async function main() {
  const html = await fs.readFile(path.join(dist, 'index.html'), 'utf8').catch(() => {
    throw new Error('client/dist/index.html is missing. Run npm run build:web first.');
  });
  // Match the module entry, not the small theme-boot script that ships before it.
  const source = /<script[^>]+type="module"[^>]*src="([^"]+)"/.exec(html)?.[1];
  assert.ok(source, 'index.html has no module script');
  const entry = path.resolve(dist, source.replace(/^\.?\//, ''));
  const entryText = await fs.readFile(entry, 'utf8');
  for (const marker of MARKERS) {
    assert.equal(entryText.includes(marker), false, `the entry chunk contains the demo marker ${marker}`);
  }

  const assets = await fs.readdir(path.join(dist, 'assets'));
  const chunks = [];
  for (const name of assets.filter((file) => file.endsWith('.js'))) {
    chunks.push({ name, text: await fs.readFile(path.join(dist, 'assets', name), 'utf8') });
  }
  assert.ok(chunks.some((chunk) => chunk.name !== path.basename(entry) && chunk.text.includes('Alex Example')), 'no demo fixtures chunk was emitted');
  assert.ok(chunks.some((chunk) => chunk.text.includes('sajas:demo:')), 'no demo storage namespace chunk was emitted');
  console.log(`check-demo-bundle: PASS (${chunks.length} chunks)`);
}

main().catch((error) => {
  console.error(`check-demo-bundle: FAIL - ${error.message}`);
  process.exitCode = 1;
});
