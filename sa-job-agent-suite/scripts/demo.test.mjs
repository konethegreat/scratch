import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startDemoBackend } from './demo-runtime.mjs';
import { startDemoClient } from './demo-client.mjs';
import { DEMO_JOB_ID, DEMO_QUESTION } from '../server/src/demo.js';

async function unusedPort() {
  const server = http.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('disposable SA-JAS workflow with the real API and copilot', { timeout: 90000 }, async t => {
  const runtime = await startDemoBackend({ port: await unusedPort() });
  Object.assign(process.env, runtime.env);
  const { runApplyAssistantAgent, closeDemoBrowsers } = await import('../server/src/agents/agent3-applier.js');
  const { readDb } = await import('../server/src/db/helper.js');
  const { callLlm, callLlmVision } = await import('../server/src/agents/llm.js');
  const json = async (route, options) => {
    const response = await fetch(runtime.origin + route, options);
    assert.equal(response.status, 200, `${route}: ${await response.clone().text()}`);
    return response.json();
  };
  const post = answer => ({ method: 'POST', headers: { 'Content-Type': 'application/json', 'X-SAJAS-Client': '1' }, body: JSON.stringify({ answer }) });
  let session;
  let client;
  const evidence = process.env.SAJAS_DEMO_EVIDENCE_DIR;
  const capture = async (page, name) => {
    if (!evidence) return;
    await fs.mkdir(evidence, { recursive: true });
    await page.screenshot({ path: path.join(evidence, name), fullPage: true });
  };
  try {
    await t.test('fresh fictional profile, empty keys and no unattended routines', async () => {
      const profile = await json('/api/profile');
      assert.equal(profile.fullName, 'Alex Example');
      assert.equal(profile.email, 'alex@example.test');
      assert.equal(profile.hasAnthropicKey, false);
      for (const gone of ['hasGeminiKey', 'hasOpenRouterKey', 'aiProvider', 'anthropicApiKey']) {
        assert.ok(!(gone in profile), `profile must not expose ${gone}`);
      }
      assert.deepEqual(JSON.parse(await fs.readFile(runtime.env.KEYS_PATH, 'utf8')), {});
      assert.deepEqual(await json('/api/routines'), []);
      assert.equal((await json('/api/models')).length, 4, 'the Settings model dropdown can load in demo mode');
      assert.equal((await json('/api/jobs'))[0].source, 'Synthetic local fixture');
      const sources = await json('/api/hunter/sources');
      assert.equal(sources.sources.length, 12, 'the source health board is readable in the demo');
      assert.ok(sources.sources.every(source => source.status === 'unknown'));
      client = await startDemoClient(runtime.origin, { port: 0 });
      const html = await (await fetch(`http://127.0.0.1:${client.httpServer.address().port}`)).text();
      assert.match(html, /id="root"/);
      assert.doesNotMatch(html, /fonts\.(googleapis|gstatic)\.com/);
    });
    await t.test('API blocks live work, credentials, backup restore and arbitrary applications', async () => {
      for (const [method, route] of [['POST', '/api/jobs/hunter'], ['POST', `/api/jobs/${DEMO_JOB_ID}/tailor`],
        ['POST', '/api/jobs/tailor-batch'], ['POST', '/api/jobs/revalidate'], ['POST', '/api/browser/setup'],
        ['POST', '/api/browser/login-status'], ['POST', '/api/profile'], ['POST', '/api/profile/preset'],
        ['POST', '/api/backup/restore'], ['POST', '/api/routines'], ['POST', '/api/memory/dream'],
        ['POST', '/api/hunter/sources/test'], ['PATCH', '/api/hunter/sources/pnet'],
        ['POST', `/api/jobs/${DEMO_JOB_ID}/referral`], ['POST', '/api/jobs/other-job/apply']]) {
        // The client header is sent so the refusal is the demo allowlist's, not the local guard's.
        const response = await fetch(runtime.origin + route, { method, headers: { 'X-SAJAS-Client': '1' } });
        assert.equal(response.status, 403, route);
      }
    });
    await t.test('both AI entry points refuse before provider SDK calls', async () => {
      await assert.rejects(callLlm({}, 'synthetic prompt'), /AI calls are disabled/);
      await assert.rejects(callLlmVision({}, 'synthetic prompt'), /AI calls are disabled/);
    });

    let ready;
    const pageReady = new Promise(resolve => { ready = resolve; });
    session = runApplyAssistantAgent(DEMO_JOB_ID, { headless: true, pollIntervalMs: 300,
      onPageReady: page => { ready(page); } });
    const page = await Promise.race([pageReady, session.then(() => { throw new Error('Copilot ended before opening a page.'); })]);
    page.on('pageerror', error => console.error('Fixture page error:', error.message));
    await t.test('copilot follows the listing to a real form, fills saved answers and attaches a real PDF', async () => {
      await page.waitForURL('**/demo/application', { timeout: 20000 });
      await page.waitForFunction(() => document.querySelector('#notice')?.value === '30 days' &&
        document.querySelector('#cv')?.files.length === 1, { timeout: 15000 });
      assert.equal(await page.locator('#fullName').inputValue(), 'Alex Example');
      assert.equal(await page.locator('#email').inputValue(), 'alex@example.test');
      assert.equal(await page.locator('#phone').inputValue(), '0000000000');
      assert.equal(await page.locator('#work').inputValue(), 'Yes');
      assert.equal(await page.locator('#project').inputValue(), '');
      assert.equal(await page.locator('#sajas-copilot-hud').count(), 1);
      const pdf = await fs.readFile(readDb().jobs[0].tailoredCvPath);
      assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
      await capture(page, '02-copilot-form.png');
    });
    await t.test('unknown required answer stays blank and is captured for the human', async () => {
      const pending = await json('/api/application/pending');
      assert.deepEqual(pending.map(entry => entry.question), [DEMO_QUESTION]);
      assert.equal((await json('/api/demo')).submissions, 0);
      // Pause advancement while the human answers and reviews the fields.
      await page.locator('#sajas-btn-autopilot').click();
      await page.waitForFunction(() => window.sajasAutopilot === false);
      const entry = pending[0];
      await json(`/api/application/pending/${entry.id}/resolve`, post('My fictional accessibility dashboard.'));
      assert.deepEqual(await json('/api/application/pending'), []);
      assert.ok((await json('/api/application/bank')).some(answer => answer.question === DEMO_QUESTION));
      // The HUD action is a human request to reuse the newly saved answer.
      await page.locator('#sajas-btn-smartfill').click();
      await page.waitForFunction(() => document.querySelector('#project')?.value === 'My fictional accessibility dashboard.');
      // Regression: the second pass must never overwrite old name/email fields.
      assert.equal(await page.locator('#fullName').inputValue(), 'Alex Example');
      assert.equal(await page.locator('#email').inputValue(), 'alex@example.test');
      await page.locator('#continue').click();
      await page.waitForURL('**/demo/review');
    });
    await t.test('review page retains the HUD and the copilot never presses the final Submit', async () => {
      await page.locator('#sajas-copilot-hud').waitFor();
      await page.locator('#sajas-btn-autopilot').click();
      await page.waitForFunction(() => window.sajasAutopilot === true);
      await new Promise(resolve => setTimeout(resolve, 2100)); // seven copilot ticks
      assert.equal((await json('/api/demo')).submissions, 0);
      assert.equal(readDb().jobs[0].status, 'tailored');
      assert.match(await page.locator('#details').innerText(), /Alex Example/);
      assert.match(await page.locator('#details').innerText(), /alex@example.test/);
      assert.match(await page.locator('#details').innerText(), /My fictional accessibility dashboard/);
      await capture(page, '03-human-review.png');
    });
    await t.test('copilot browser refuses requests outside the fixture origin', async () => {
      let requests = 0;
      const canary = http.createServer((_req, res) => { requests++; res.end('unexpected request'); });
      await new Promise(resolve => canary.listen(0, '127.0.0.1', resolve));
      try {
        const result = await page.evaluate(async url => {
          try { await fetch(url); return 'allowed'; } catch { return 'blocked'; }
        }, `http://127.0.0.1:${canary.address().port}/canary`);
        assert.equal(result, 'blocked');
        assert.equal(requests, 0);
      } finally { await new Promise(resolve => canary.close(resolve)); }
    });
    await t.test('explicit human fixture submission records a local receipt and candidate memory', async () => {
      await page.locator('#submit').click();
      await session;
      const job = readDb().jobs[0];
      assert.equal((await json('/api/demo')).submissions, 1);
      assert.equal(job.status, 'applied');
      assert.ok(job.appliedAt);
      assert.ok((await fs.stat(job.confirmationShotPath)).size > 0);
      const memory = await json('/api/memory');
      assert.equal(memory.applications.length, 1);
      assert.ok(memory.applications[0].transcript.some(entry => entry.answer === 'My fictional accessibility dashboard.'));
      if (evidence) await fs.copyFile(job.confirmationShotPath, path.join(evidence, '04-local-receipt.png'));
      const usage = await json('/api/usage');
      assert.equal(usage.today.calls, 0);
    });
  } finally {
    await closeDemoBrowsers();
    if (session) await session.catch(() => {});
    await client?.close();
    await runtime.stop();
  }
  await t.test('all disposable profile, key, browser and document files are removed', async () => {
    await assert.rejects(fs.stat(runtime.directory), { code: 'ENOENT' });
  });
});

// The demo API is read-only, so the Anthropic-only profile routes are exercised
// against a plain (non-demo) server that runs on throwaway files.
test('Anthropic-only profile routes, models endpoint and startup key purge', { timeout: 60000 }, async t => {
  const suite = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sajas-synthetic-'));
  const port = await unusedPort();
  const origin = `http://127.0.0.1:${port}`;
  // Key-shaped values are assembled at runtime so no literal ever reaches the repo.
  const legacy = { geminiApiKey: 'AIza' + 'x'.repeat(35), openRouterApiKey: 'sk-' + 'or-v1-' + 'b'.repeat(40) };
  const adminKey = 'sk-' + 'ant-admin01-' + 'A'.repeat(40);
  const realKey = 'sk-' + 'ant-api03-' + 'A'.repeat(40);
  await fs.writeFile(path.join(directory, 'db.json'), JSON.stringify({
    profile: { fullName: 'Alex Example', aiProvider: 'gemini', selectedModel: 'gemini-1.5-flash' }
  }));
  await fs.writeFile(path.join(directory, 'keys.json'), JSON.stringify({ ...legacy, anthropicApiKey: '' }));
  const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1',
    DB_PATH: path.join(directory, 'db.json'), KEYS_PATH: path.join(directory, 'keys.json'),
    BROWSER_PROFILE_PATH: path.join(directory, 'browser-profile'),
    GENERATED_DOCS_PATH: path.join(directory, 'generated-docs'),
    SUPPORTING_DOCS_PATH: path.join(directory, 'supporting-docs') };
  delete env.SAJAS_DEMO_ORIGIN;
  const child = spawn(process.execPath, ['server/src/index.js'], { cwd: suite, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', b => { output += b; });
  child.stderr.on('data', b => { output += b; });
  const call = (route, options = {}) => fetch(origin + route, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'X-SAJAS-Client': '1', ...(options.headers || {}) }
  });
  // http.request lets a test set an explicit Host header, which fetch forbids.
  const rawRequest = (route, { method = 'GET', headers = {} } = {}) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: route, method, headers }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
  try {
    const deadline = Date.now() + 15000;
    for (;;) {
      if (child.exitCode !== null) throw new Error('Server exited early.\n' + output);
      if (Date.now() > deadline) throw new Error('Server startup timed out.\n' + output);
      try { if ((await fetch(origin + '/api/health', { signal: AbortSignal.timeout(500) })).ok) break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    await t.test('startup purges legacy provider keys from keys.json and logs it', async () => {
      assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, 'keys.json'), 'utf8')), { anthropicApiKey: '' });
      const logs = await (await call('/api/logs')).json();
      assert.ok(logs.some(entry => entry.message === 'Removed legacy provider keys from the key store.'));
    });
    await t.test('GET /api/profile is Anthropic-only and never exposes a key', async () => {
      const response = await call('/api/profile');
      assert.equal(response.status, 200);
      const profile = await response.json();
      assert.equal(profile.fullName, 'Alex Example');
      assert.equal(profile.hasAnthropicKey, false);
      for (const gone of ['hasGeminiKey', 'hasOpenRouterKey', 'aiProvider', 'anthropicApiKey', 'geminiApiKey', 'openRouterApiKey']) {
        assert.ok(!(gone in profile), `profile must not expose ${gone}`);
      }
    });
    await t.test('local guard: a POST without X-SAJAS-Client is 403 and changes nothing; with it, it succeeds', async () => {
      const before = (await (await call('/api/profile')).json()).fullName;
      const body = JSON.stringify({ fullName: 'Guard Probe' });
      const blocked = await fetch(origin + '/api/profile', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body });
      assert.equal(blocked.status, 403);
      assert.deepEqual(await blocked.json(), { error: 'Missing X-SAJAS-Client header' });
      assert.equal((await (await call('/api/profile')).json()).fullName, before);
      const allowed = await call('/api/profile', { method: 'POST', body });
      assert.equal(allowed.status, 200);
      assert.equal((await (await call('/api/profile')).json()).fullName, 'Guard Probe');
      assert.equal((await call('/api/profile', { method: 'POST', body: JSON.stringify({ fullName: before }) })).status, 200);
    });
    await t.test('local guard: a foreign Host (DNS rebinding) or Origin is 403 even for GET', async () => {
      const rebinding = await rawRequest('/api/profile', { headers: { Host: 'evil.example' } });
      assert.equal(rebinding.status, 403);
      assert.deepEqual(JSON.parse(rebinding.body), { error: 'Host not allowed' });
      const rebindingPort = await rawRequest('/api/health', { headers: { Host: '127.0.0.1.evil.example:' + port } });
      assert.equal(rebindingPort.status, 403);
      const foreign = await call('/api/profile', { headers: { Origin: 'https://evil.example' } });
      assert.equal(foreign.status, 403);
      assert.deepEqual(await foreign.json(), { error: 'Origin not allowed' });
      const viteOrigin = await call('/api/profile', { headers: { Origin: 'http://localhost:4173' } });
      assert.equal(viteOrigin.status, 200);
    });
    await t.test('login-status launches Chrome, so it is POST-only: GET is not a route and POST needs the header', async () => {
      const get = await fetch(origin + '/api/browser/login-status');
      assert.equal(get.status, 404);
      const head = await fetch(origin + '/api/browser/login-status', { method: 'HEAD' });
      assert.equal(head.status, 404);
      const noHeader = await fetch(origin + '/api/browser/login-status', { method: 'POST' });
      assert.equal(noHeader.status, 403);
      assert.deepEqual(await noHeader.json(), { error: 'Missing X-SAJAS-Client header' });
    });
    await t.test('CORS preflight: the custom header is reflected for localhost, a foreign Origin gets no CORS headers', async () => {
      const preflight = await fetch(origin + '/api/profile', { method: 'OPTIONS', headers: {
        Origin: 'http://localhost:4173', 'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'x-sajas-client,content-type' } });
      assert.equal(preflight.status, 204);
      assert.equal(preflight.headers.get('access-control-allow-origin'), 'http://localhost:4173');
      assert.match(preflight.headers.get('access-control-allow-headers') || '', /x-sajas-client/i);
      const foreign = await fetch(origin + '/api/profile', { method: 'OPTIONS', headers: {
        Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'x-sajas-client,content-type' } });
      assert.equal(foreign.status, 403);
      assert.equal(foreign.headers.get('access-control-allow-origin'), null);
    });
    await t.test('POST /api/profile rejects an Admin key with 400 and stores nothing', async () => {
      const response = await call('/api/profile', { method: 'POST', body: JSON.stringify({ anthropicApiKey: adminKey }) });
      assert.equal(response.status, 400);
      const text = await response.text();
      assert.match(JSON.parse(text).error, /Admin key/);
      assert.ok(!text.includes(adminKey));
      assert.equal((await (await call('/api/profile')).json()).hasAnthropicKey, false);
      assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, 'keys.json'), 'utf8')), { anthropicApiKey: '' });
    });
    await t.test('POST /api/profile stores a valid key without echoing it; DELETE clears it', async () => {
      const response = await call('/api/profile', { method: 'POST', body: JSON.stringify({ anthropicApiKey: realKey }) });
      assert.equal(response.status, 200);
      const text = await response.text();
      assert.ok(!text.includes(realKey));
      const body = JSON.parse(text);
      assert.equal(body.profile.hasAnthropicKey, true);
      for (const gone of ['hasGeminiKey', 'hasOpenRouterKey', 'aiProvider', 'anthropicApiKey']) {
        assert.ok(!(gone in body.profile), `POST response must not expose ${gone}`);
      }
      assert.equal((await (await call('/api/profile')).json()).hasAnthropicKey, true);
      assert.equal((await call('/api/profile/key/anthropic', { method: 'DELETE' })).status, 200);
      assert.equal((await (await call('/api/profile')).json()).hasAnthropicKey, false);
      assert.ok(!output.includes(realKey) && !output.includes(adminKey));
    });
    await t.test('DELETE /api/profile/key/:provider is 404 for anything but anthropic', async () => {
      for (const provider of ['gemini', 'openrouter', 'openai']) {
        assert.equal((await call(`/api/profile/key/${provider}`, { method: 'DELETE' })).status, 404, provider);
      }
    });
    await t.test('preset route response is Anthropic-only too', async () => {
      const response = await call('/api/profile/preset', { method: 'POST', body: JSON.stringify({ mode: 'balanced' }) });
      assert.equal(response.status, 200);
      const { profile } = await response.json();
      assert.equal(profile.hasAnthropicKey, false);
      for (const gone of ['hasGeminiKey', 'hasOpenRouterKey', 'aiProvider', 'anthropicApiKey']) {
        assert.ok(!(gone in profile), `preset response must not expose ${gone}`);
      }
    });
    await t.test('GET /api/models lists the four registry models', async () => {
      const response = await call('/api/models');
      assert.equal(response.status, 200);
      const models = await response.json();
      assert.equal(models.length, 4);
      const sonnet = models.find(model => model.label === 'Claude Sonnet 5.5');
      assert.ok(sonnet, 'Sonnet is listed');
      assert.deepEqual(Object.keys(sonnet).sort(), ['id', 'inputPerMTok', 'label', 'optIn', 'outputPerMTok', 'tier']);
      assert.equal(sonnet.optIn, false);
      assert.equal(models.filter(model => model.optIn).length, 1);
      assert.ok(models.every(model => typeof model.id === 'string' && Number.isFinite(model.inputPerMTok) && Number.isFinite(model.outputPerMTok)));
    });
    await t.test('GET /api/hunter/sources returns the twelve sources as unknown on a fresh install', async () => {
      const response = await call('/api/hunter/sources');
      assert.equal(response.status, 200);
      const board = await response.json();
      assert.deepEqual(board.sources.map(source => source.id), ['linkedin', 'indeed', 'pnet', 'careerjunction',
        'googlejobs', 'adzuna', 'executive', 'jobplacements', 'govza', 'jobmail', 'jobscoza', 'gumtree']);
      for (const row of board.sources) {
        assert.equal(row.status, 'unknown', row.id);
        assert.equal(row.enabled, true, row.id);
        assert.equal(row.canary, null, row.id);
        assert.equal(row.lastRunAt, null, row.id);
        assert.equal(row.lastSuccessAt, null, row.id);
        assert.equal(row.lastRaw, null, row.id);
        assert.equal(row.typicalRaw, 0, row.id);
        assert.deepEqual(row.completeness, { title: 0, url: 0, company: 0, location: 0 }, row.id);
        assert.equal(row.pages, 0, row.id);
        assert.equal(row.stopReason, '', row.id);
        assert.equal(row.via, '', row.id);
        assert.ok(['major', 'secondary'].includes(row.tier), row.id);
        assert.equal(row.pagination.verified, false, row.id);
        assert.ok(row.pagination.param === null || typeof row.pagination.param === 'string', row.id);
      }
      assert.equal(board.browserBusy, null);
      assert.equal(board.testing, false);
    });
    await t.test('PATCH /api/hunter/sources/:id flips enabled and accepts resetCircuit', async () => {
      const response = await call('/api/hunter/sources/pnet', { method: 'PATCH', body: JSON.stringify({ enabled: false }) });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.success, true);
      assert.equal(body.source.id, 'pnet');
      assert.equal(body.source.enabled, false);
      assert.equal(body.source.status, 'disabled');
      assert.equal(body.source.reason, 'turned off');
      const row = (await (await call('/api/hunter/sources')).json()).sources.find(source => source.id === 'pnet');
      assert.equal(row.status, 'disabled');
      const reset = await call('/api/hunter/sources/pnet', { method: 'PATCH', body: JSON.stringify({ enabled: true, resetCircuit: true }) });
      assert.equal(reset.status, 200);
      const after = await reset.json();
      assert.equal(after.source.enabled, true);
      assert.equal(after.source.circuitOpen, false);
    });
    await t.test('PATCH /api/hunter/sources/:id answers 404 for an unknown source', async () => {
      const response = await call('/api/hunter/sources/not-a-source', { method: 'PATCH', body: JSON.stringify({ enabled: false }) });
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: 'Unknown source.' });
    });
    await t.test('POST /api/hunter/sources/test needs the client header and validates ids before any browser work', async () => {
      const noHeader = await fetch(origin + '/api/hunter/sources/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
      });
      assert.equal(noHeader.status, 403);
      assert.deepEqual(await noHeader.json(), { error: 'Missing X-SAJAS-Client header' });
      const notArray = await call('/api/hunter/sources/test', { method: 'POST', body: JSON.stringify({ ids: 'pnet' }) });
      assert.equal(notArray.status, 400);
      assert.deepEqual(await notArray.json(), { error: 'ids must be an array of source ids.' });
      const unknown = await call('/api/hunter/sources/test', { method: 'POST', body: JSON.stringify({ ids: ['pnet', 'nope'] }) });
      assert.equal(unknown.status, 404);
      assert.deepEqual(await unknown.json(), { error: 'Unknown source: nope.' });
      const board = await (await call('/api/hunter/sources')).json();
      assert.equal(board.browserBusy, null, 'validation happens before the lock is taken');
      assert.equal(board.testing, false);
    });
  } finally {
    if (child.exitCode === null) {
      const ended = new Promise(resolve => child.once('exit', resolve));
      child.kill();
      await ended;
    }
    if (path.dirname(directory) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('sajas-synthetic-')) {
      throw new Error('Refusing to remove an unexpected test directory.');
    }
    await fs.rm(directory, { recursive: true, force: true });
  }
});
