import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import JSZip from 'jszip';
import { buildExtensionZip } from './zip-extension.mjs';

const root = path.resolve(import.meta.dirname, '..');

test('the release zip carries the unpacked extension at its root', async () => {
  execFileSync(process.execPath, [path.join(root, 'scripts/build-extension.mjs')], {
    cwd: root,
    stdio: 'pipe'
  });
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sajas-extension-zip-'));
  try {
    const outPath = path.join(outDir, 'sajas-apply-assistant.zip');
    const result = await buildExtensionZip({ outPath });
    const manifest = JSON.parse(await fs.readFile(path.join(root, 'extension/manifest.json'), 'utf8'));
    const zip = await JSZip.loadAsync(await fs.readFile(outPath));
    const names = Object.keys(zip.files);

    for (const required of [
      'manifest.json',
      'sw.js',
      'page.js',
      'appBridge.js',
      'popup.html',
      'popup.css',
      'icons/icon-128.png'
    ]) {
      assert.ok(names.includes(required), `the zip is missing ${required}`);
    }
    assert.ok(
      names.every((name) => !name.startsWith('dist/') && !name.startsWith('src/')),
      'the zip nested the build under its source folder'
    );
    assert.equal(
      JSON.parse(await zip.file('manifest.json').async('string')).version,
      manifest.version,
      'the zipped manifest is not the source manifest'
    );
    assert.equal(result.version, manifest.version);

    const secondPath = path.join(outDir, 'second.zip');
    await buildExtensionZip({ outPath: secondPath });
    assert.deepEqual(
      await fs.readFile(secondPath),
      await fs.readFile(outPath),
      'two builds of the same dist produced different bytes'
    );
  } finally {
    await fs.rm(outDir, { recursive: true, force: true });
  }
});
