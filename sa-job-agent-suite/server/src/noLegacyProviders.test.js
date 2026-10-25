import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Guard: the product is Anthropic-only. No source file may name another
// provider. Legacy field names live ONLY in db/migrations.js, which owns the
// upgrade path; everything else references the constants it exports.
// Test files are skipped on purpose: migration and route tests must name the
// legacy fields in order to assert that they are gone.
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PATTERN = /gemini|openrouter|openai/i;
const ALLOW = new Set([
  'server/src/db/migrations.js',
  'server/src/noLegacyProviders.test.js',
  'server/src/noModelLiterals.test.js',
]);
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git']);
const SOURCE_EXT = /\.(js|mjs|cjs|jsx|ts|tsx|json|html|css)$/;
const TEST_FILE = /\.test\.(js|mjs|jsx)$/;

function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(path.join(dir, entry.name));
    } else if (SOURCE_EXT.test(entry.name) && !TEST_FILE.test(entry.name)) {
      yield path.join(dir, entry.name);
    }
  }
}

test('no source file names a provider other than Anthropic', () => {
  const files = [
    ...['server/src', 'client/src', 'electron', 'scripts'].flatMap((d) => [...walk(path.join(ROOT, d))]),
    path.join(ROOT, 'package.json'),
    path.join(ROOT, 'server/package.json'),
  ];
  const offenders = [];
  for (const file of files) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    if (ALLOW.has(rel)) continue;
    fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
      if (PATTERN.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
  assert.deepEqual(offenders, [], `legacy provider names found:\n${offenders.join('\n')}`);
});
