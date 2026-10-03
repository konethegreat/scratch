import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALLOW_MARKER, pathFindings, scanLine, scanText } from './check-secrets.mjs';

const SCRIPT = fileURLToPath(new URL('./check-secrets.mjs', import.meta.url));
const HOOK = fileURLToPath(new URL('../.githooks/pre-commit', import.meta.url));

// Key-shaped fixtures are assembled at runtime, so the repository itself never
// contains a literal that this guard (or GitHub push protection) would flag.
const FAKE = {
  'anthropic-key': () => ['sk', 'ant', 'api03', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4'].join('-'), // gitleaks:allow - synthetic scanner fixture
  'openrouter-key': () => ['sk', 'or', 'v1', '0123456789abcdef0123456789abcdef'].join('-'), // gitleaks:allow - synthetic scanner fixture
  'openai-key': () => 'sk-' + 'proj-' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8',
  'google-api-key': () => 'AIza' + 'SyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6',
  'github-token': () => 'gh' + 'p_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8',
  'aws-access-key': () => 'AK' + 'IA' + '0123456789ABCDEF',
  'slack-token': () => 'xo' + 'xb-' + '0123456789-abcdefghij',
  'stripe-live-key': () => 'sk_' + 'live_' + 'A1b2C3d4E5f6G7h8I9j0',
  jwt: () => ['eyJ' + 'hbGciOiJIUzI1NiJ9', 'eyJ' + 'zdWIiOiIxMjM0NTY3ODkwIn0', 'abcdefghij1234567890'].join('.'),
  'private-key': () => '-----BEGIN ' + 'RSA PRIVATE KEY-----'
};

test('detects each key family exactly once and never echoes the secret', () => {
  for (const [rule, make] of Object.entries(FAKE)) {
    const secret = make();
    const hits = scanLine(`token = "${secret}" // note`);
    assert.deepEqual(hits.map((h) => h.rule), [rule], `${rule}: expected exactly one hit`);
    assert.ok(!hits[0].preview.includes(secret), `${rule}: the preview must be masked`);
    assert.ok(hits[0].preview.endsWith(`(${secret.length} chars)`), `${rule}: the preview reports the length`);
  }
});

test('flags a populated key-store field but not blanks or placeholders', () => {
  // Built at runtime like the other fixtures: a populated key-store line is
  // exactly what the guard refuses to see in a tracked file.
  const field = (name, value) => `  "${name}": "${value}",`;
  assert.deepEqual(scanLine(field('geminiApiKey', 'abcd1234efgh5678')).map((h) => h.rule), ['key-store-field']); // gitleaks:allow - synthetic scanner fixture
  assert.deepEqual(scanLine(field('geminiApiKey', '')), []);
  assert.deepEqual(scanLine(field('anthropicApiKey', 'your_anthropic_api_key_here')), []);
});

test('ordinary text and short look-alikes pass', () => {
  assert.deepEqual(scanLine('The task-runner lists risk-management items; see sk-ant-... in the docs.'), []);
  assert.deepEqual(scanLine('const key = process.env.ANTHROPIC_API_KEY;'), []);
});

test('the allow marker suppresses a deliberate match on that line only', () => {
  const secret = FAKE['github-token']();
  assert.deepEqual(scanLine(`${secret} ${ALLOW_MARKER}`), []);
  assert.equal(scanText(`${secret}\n${secret} ${ALLOW_MARKER}`, 'x.txt').length, 1);
});

test('scanText reports 1-based line numbers for LF and CRLF text', () => {
  const secret = FAKE['github-token']();
  for (const nl of ['\n', '\r\n']) {
    const hits = scanText(`first${nl}second ${secret}${nl}third`, 'notes.txt');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].line, 2);
    assert.equal(hits[0].path, 'notes.txt');
  }
});

test('flags key-store, env, key-material and local-data files by name', () => {
  const flagged = [
    'keys.json', 'sa-job-agent-suite/keys.json', 'server/keys.backup.json', 'a/prod.keys.json', 'keys.json.bak',
    '.env', 'sa-job-agent-suite/.env.local', '.env.production',
    'certs/server.pem', 'id.key', 'cert.p12', 'bundle.pfx',
    'db.json', 'sa-job-agent-suite\\db.backup.json',
    'app/browser-profile/Default/Cookies', 'generated-docs/cv.pdf', 'supporting-docs/id.pdf'
  ];
  for (const p of flagged) assert.ok(pathFindings(p).length > 0, `${p} should be flagged`);
  const fine = [
    '.env.example', 'sa-job-agent-suite/.env.example', '.env.sample', 'README.md', 'server/src/db/helper.js',
    'keyboard.js', 'client/src/keys.jsx', 'docs/monkey.json', 'demo/profile.json'
  ];
  for (const p of fine) assert.deepEqual(pathFindings(p), [], `${p} should pass`);
});

// ---- end to end against throwaway git repositories -------------------------

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

function scratchRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'check-secrets-'));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'config', 'core.autocrlf', 'false');
  return dir;
}

const cleanup = (dir) => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
const guard = (cwd, ...args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });
const output = (r) => `${r.stdout}${r.stderr}`;

function write(dir, rel, text) {
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  writeFileSync(path.join(dir, rel), text);
}

test('--staged blocks a staged key store and key, and reads the index, not the working tree', () => {
  const dir = scratchRepo();
  try {
    const secret = FAKE['anthropic-key']();
    write(dir, 'README.md', 'hello\n');
    git(dir, 'add', 'README.md');
    assert.equal(guard(dir, '--staged').status, 0, 'a clean change passes');

    write(dir, 'app/keys.json', JSON.stringify({ anthropicApiKey: secret }, null, 2) + '\n');
    git(dir, 'add', 'app/keys.json');
    const bad = guard(dir, '--staged');
    assert.equal(bad.status, 1);
    assert.match(output(bad), /key-store-file/);
    assert.match(output(bad), /anthropic-key/);
    assert.match(output(bad), /app\/keys\.json:2/);
    assert.ok(!output(bad).includes(secret.slice(7)), 'the secret must never be printed');

    // A key that is only in the working tree is not part of the commit.
    git(dir, 'reset', '-q', 'app/keys.json');
    write(dir, 'notes.txt', 'clean\n');
    git(dir, 'add', 'notes.txt');
    write(dir, 'notes.txt', `oops ${secret}\n`);
    assert.equal(guard(dir, '--staged').status, 0, 'unstaged edits are not scanned');
  } finally {
    cleanup(dir);
  }
});

test('--range catches a key that a later commit removed again; --all and --files agree', () => {
  const dir = scratchRepo();
  try {
    const secret = FAKE['google-api-key']();
    write(dir, 'a.txt', 'one\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'one');
    const first = git(dir, 'rev-parse', 'HEAD');

    write(dir, 'notes.txt', `token ${secret}\n`);
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'leak');
    const leak = git(dir, 'rev-parse', 'HEAD').slice(0, 10);

    write(dir, 'notes.txt', 'clean\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'remove');

    const r = guard(dir, '--range', `${first}..HEAD`);
    assert.equal(r.status, 1, 'history still holds the key');
    assert.match(output(r), /notes\.txt:1/);
    assert.ok(output(r).includes(`[commit ${leak}]`));
    assert.ok(!output(r).includes(secret.slice(7)), 'the secret must never be printed');

    assert.equal(guard(dir, '--all').status, 0, 'the tip itself is clean');
    assert.equal(guard(dir, '--files', 'notes.txt', 'a.txt').status, 0);
    write(dir, 'notes.txt', `again ${secret}\n`);
    assert.equal(guard(dir, '--files', 'notes.txt').status, 1);
  } finally {
    cleanup(dir);
  }
});

test('bad usage exits 2, a clean range exits 0', () => {
  const dir = scratchRepo();
  try {
    write(dir, 'a.txt', 'one\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'one');
    assert.equal(guard(dir, '--range').status, 2);
    assert.equal(guard(dir, '--bogus').status, 2);
    assert.equal(guard(dir, '--range', 'does-not-exist..HEAD').status, 2);
    assert.equal(guard(dir, '--range', 'HEAD..HEAD').status, 0);
  } finally {
    cleanup(dir);
  }
});

test('the pre-commit hook refuses a commit that stages a key store', () => {
  const dir = scratchRepo();
  try {
    mkdirSync(path.join(dir, 'tools'));
    mkdirSync(path.join(dir, '.githooks'));
    copyFileSync(SCRIPT, path.join(dir, 'tools', 'check-secrets.mjs'));
    copyFileSync(HOOK, path.join(dir, '.githooks', 'pre-commit'));
    chmodSync(path.join(dir, '.githooks', 'pre-commit'), 0o755);
    git(dir, 'config', 'core.hooksPath', '.githooks');

    write(dir, 'README.md', 'hello\n');
    git(dir, 'add', 'README.md');
    git(dir, 'commit', '-q', '-m', 'clean commit is allowed');

    write(dir, 'keys.json', '{ "anthropicApiKey": "' + FAKE['anthropic-key']() + '" }\n');
    git(dir, 'add', 'keys.json');
    const r = spawnSync('git', ['commit', '-q', '-m', 'must be refused'], { cwd: dir, encoding: 'utf8' });
    assert.notEqual(r.status, 0, 'the hook must block the commit');
    assert.match(output(r), /check-secrets/);
    assert.match(output(r), /key-store-file/);
    assert.equal(git(dir, 'rev-list', '--count', 'HEAD'), '1', 'no second commit was created');
  } finally {
    cleanup(dir);
  }
});
