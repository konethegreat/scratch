import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Guards the installer configuration that cannot be exercised without building
// an installer: what electron-builder is told to pack.
const readJson = (rel) => JSON.parse(fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'));
const appPkg = readJson('../../package.json');
const serverPkg = readJson('../package.json');

test('every server runtime dependency is also declared at the app root, because electron-builder only packs the root dependencies', () => {
  for (const [name, range] of Object.entries(serverPkg.dependencies || {})) {
    assert.equal(
      appPkg.dependencies?.[name], range,
      `${name}@${range} is a server dependency: declare it in the root package.json "dependencies" too, or the installer ships without it`
    );
  }
});

test('the installer config ships no local data and no test files', () => {
  const build = appPkg.build;
  assert.equal(build.extraResources, undefined, 'extraResources copied a developer db.json (profile, CV text, jobs) into the installer');
  const files = build.files || [];
  assert.ok(files.includes('!**/*.test.js'), 'test files should be excluded from the asar');
  const risky = files.filter((f) => /db\.json|keys\.json|\.env|browser-profile|generated-docs|supporting-docs/.test(f));
  assert.deepEqual(risky, [], 'build.files must not name local data or credentials');
});

test('the entry points the installer relies on exist', () => {
  assert.equal(appPkg.main, 'electron/main.js');
  for (const rel of ['../../electron/main.js', '../../electron/preload.js', './index.js']) {
    assert.ok(fs.existsSync(fileURLToPath(new URL(rel, import.meta.url))), `${rel} is missing`);
  }
});

const corePkg = readJson('../../packages/core/package.json');

test('core is a workspace package that root and server both depend on', () => {
  assert.ok(appPkg.workspaces.includes('packages/*'), 'root workspaces must include packages/*');
  assert.equal(appPkg.dependencies['@sajas/core'], '*');
  assert.equal(serverPkg.dependencies['@sajas/core'], '*');
});

test('every core runtime dependency is also declared at the app root with the same range', () => {
  for (const [name, range] of Object.entries(corePkg.dependencies || {})) {
    assert.equal(
      appPkg.dependencies?.[name], range,
      `${name}@${range} is a core dependency: declare it in the root package.json "dependencies" too`
    );
  }
});

test('the installer ships core source', () => {
  const build = appPkg.build;
  assert.ok(build.files.includes('packages/core/src/**/*'), 'build.files must include packages/core/src/**/*');
  assert.ok(build.files.includes('packages/core/package.json'), 'build.files must include packages/core/package.json');
  assert.ok(build.asarUnpack.includes('packages/**/*'), 'build.asarUnpack must include packages/**/*');
});
