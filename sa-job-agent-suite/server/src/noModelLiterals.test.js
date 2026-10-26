import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Guard: model IDs are defined once, in packages/core/src/models.js. Server and
// client source reference the registry; they never hard-code an ID.
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PATTERN = /['"`]claude-[a-z0-9.-]+/;
const SKIP_DIRS = new Set(['node_modules', 'dist']);
const SOURCE_EXT = /\.(js|mjs|cjs|jsx|ts|tsx)$/;
const TEST_FILE = /\.test\.(js|mjs|jsx)$/;

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(path.join(dir, entry.name));
    } else if (SOURCE_EXT.test(entry.name) && !TEST_FILE.test(entry.name)) {
      yield path.join(dir, entry.name);
    }
  }
}

test('no model ID string literal in server or client source', () => {
  const offenders = [];
  for (const d of ['server/src', 'client/src']) {
    for (const file of walk(path.join(ROOT, d))) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
        if (PATTERN.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
      });
    }
  }
  assert.deepEqual(offenders, [], `model ID literals found (use the registry):\n${offenders.join('\n')}`);
});
