// Copies the Tesseract worker, WebAssembly core and English data into the
// public folder so the hosted build serves them from its own origin. The
// directory is generated, never committed, and rebuilt by the npm hooks.
import { createRequire } from 'node:module';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const appRoot = path.resolve(import.meta.dirname, '..');
const require = createRequire(path.join(appRoot, 'client/package.json'));
const out = path.join(appRoot, 'client/public/ocr');

function packageDir(name) {
  return path.dirname(require.resolve(`${name}/package.json`));
}

const assets = [
  [path.join(packageDir('tesseract.js'), 'dist/worker.min.js'), 'worker.min.js'],
  [path.join(packageDir('tesseract.js-core'), 'tesseract-core-simd-lstm.wasm.js'), 'tesseract-core-simd-lstm.wasm.js'],
  [path.join(packageDir('@tesseract.js-data/eng'), '4.0.0_best_int/eng.traineddata.gz'), 'eng.traineddata.gz'],
  [path.join(packageDir('tesseract.js'), 'LICENSE.md'), 'TESSERACT-JS-LICENSE.md'],
  [path.join(packageDir('tesseract.js-core'), 'LICENSE'), 'TESSERACT-CORE-LICENSE.txt']
];

const NOTICE = `On-device OCR assets
====================

Tesseract.js 7.0.0 and tesseract.js-core 7.0.0 are used under the Apache
License 2.0. See TESSERACT-JS-LICENSE.md and TESSERACT-CORE-LICENSE.txt.

eng.traineddata is the best_int English model from the tessdata_best project
(Apache License 2.0), packaged by @tesseract.js-data/eng 1.0.0 (MIT).

These files are served from this site so a CV photo or scan can be read in the
browser without sending the file or a key anywhere.
`;

await mkdir(out, { recursive: true });
for (const [from, name] of assets) await copyFile(from, path.join(out, name));
await writeFile(path.join(out, 'NOTICE.txt'), NOTICE);
console.log(`ocr assets: ${assets.length + 1} files in client/public/ocr`);
