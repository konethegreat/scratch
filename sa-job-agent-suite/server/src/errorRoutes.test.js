// Route-level checks for the error contract. Boots the real server against a
// disposable temp database (same pattern as scripts/demo-runtime.mjs), so the
// assertions cover the routes, the guard and the HTTP adapter together.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const suite = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function unusedPort() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function startServer() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sajas-routes-'));
  const port = await unusedPort();
  const env = {
    ...process.env,
    PORT: String(port),
    HOST: '127.0.0.1',
    DB_PATH: path.join(directory, 'db.json'),
    KEYS_PATH: path.join(directory, 'keys.json'),
    BROWSER_PROFILE_PATH: path.join(directory, 'browser-profile'),
    GENERATED_DOCS_PATH: path.join(directory, 'generated-docs'),
    SUPPORTING_DOCS_PATH: path.join(directory, 'supporting-docs')
  };
  delete env.SAJAS_DEMO_ORIGIN;
  const child = spawn(process.execPath, ['server/src/index.js'], {
    cwd: suite,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const origin = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited early.\n${output}`);
    try {
      const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return { child, directory, origin };
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill();
  throw new Error(`server startup timed out.\n${output}`);
}

let runtime;

before(async () => {
  runtime = await startServer();
});

after(async () => {
  if (!runtime) return;
  await new Promise((resolve) => {
    if (runtime.child.exitCode !== null) return resolve();
    runtime.child.once('exit', resolve);
    runtime.child.kill();
  });
  await fs.rm(runtime.directory, { recursive: true, force: true });
});

const postJson = (route, body) => fetch(runtime.origin + route, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-SAJAS-Client': '1' },
  body: JSON.stringify(body)
});

// Key-shaped fixtures are assembled from fragments so this file never contains
// a literal that looks like a credential.
const malformedKey = ['sk', 'ant', 'api03', 'F'.repeat(12)].join('-');
const adminKey = ['sk', 'ant', 'admin', 'G'.repeat(12)].join('-');

test('a malformed profile key answers KEY_INVALID without echoing the key', async () => {
  const response = await postJson('/api/profile', { anthropicApiKey: malformedKey });
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.code, 'KEY_INVALID');
  assert.equal(body.retryable, false);
  assert.equal(body.error, body.message);
  assert.equal(response.headers.get('x-request-id'), body.requestId);
  assert.ok(!JSON.stringify(body).includes(malformedKey));
});

test('an admin profile key answers KEY_ADMIN without echoing the key', async () => {
  const response = await postJson('/api/profile', { anthropicApiKey: adminKey });
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.code, 'KEY_ADMIN');
  assert.equal(body.retryable, false);
  assert.equal(body.error, body.message);
  assert.equal(response.headers.get('x-request-id'), body.requestId);
  assert.ok(!JSON.stringify(body).includes(adminKey));
});

test('an unknown /api path answers a contract-shaped 404', async () => {
  const response = await fetch(`${runtime.origin}/api/does-not-exist`);
  const body = await response.json();
  assert.equal(response.status, 404);
  assert.equal(body.code, 'NOT_FOUND');
  assert.equal(body.error, body.message);
  assert.match(body.requestId, /^local-/);
  assert.equal(response.headers.get('x-request-id'), body.requestId);
});

test('RAG status answers counts without a key', async () => {
  const response = await fetch(`${runtime.origin}/api/rag/status`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(typeof body.documents, 'number');
  assert.equal(typeof body.chunks, 'number');
  assert.equal(body.hasKey, false);
  assert.ok(Array.isArray(body.missing));
});

test('RAG ask without a key answers KEY_INVALID', async () => {
  const response = await postJson('/api/rag/ask', { question: 'What is my notice period?' });
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.code, 'KEY_INVALID');
});
