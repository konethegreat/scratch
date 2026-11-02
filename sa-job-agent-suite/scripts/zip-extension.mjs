// Packs the built unpacked extension into a release zip. The manifest sits at
// the archive root because that is the folder layout Chrome's Load unpacked
// expects after the download is unzipped.
import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';

const root = path.resolve(import.meta.dirname, '..');
const defaultDist = path.join(root, 'extension/dist');
const defaultOut = path.join(root, 'extension/sajas-apply-assistant.zip');
// A fixed timestamp keeps repeated builds byte-identical, so a release can be
// rebuilt and compared.
const FIXED_DATE = new Date('2020-01-01T00:00:00Z');

export async function listFiles(dir, base = dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(full, base)));
    else files.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return files;
}

export async function buildExtensionZip({ distDir = defaultDist, outPath = defaultOut } = {}) {
  const manifest = JSON.parse(await fs.readFile(path.join(distDir, 'manifest.json'), 'utf8'));
  if (!manifest.version) throw new Error('extension manifest has no version');

  const files = await listFiles(distDir);
  if (!files.includes('manifest.json')) {
    throw new Error('the manifest must sit at the archive root; rebuild the extension');
  }

  const zip = new JSZip();
  for (const file of files) {
    zip.file(file, await fs.readFile(path.join(distDir, file)), {
      date: FIXED_DATE,
      unixPermissions: 0o644
    });
  }
  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 }
  });
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, buffer);

  return { files, bytes: buffer.length, version: manifest.version, outPath };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const result = await buildExtensionZip();
  console.log(
    `zip-extension: ${path.relative(root, result.outPath)} v${result.version}, ${result.files.length} files, ${Math.round(result.bytes / 1024)} KB`
  );
}
