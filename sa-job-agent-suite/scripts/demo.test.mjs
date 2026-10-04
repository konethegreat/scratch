import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
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
  const post = answer => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answer }) });
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
      assert.deepEqual(JSON.parse(await fs.readFile(runtime.env.KEYS_PATH, 'utf8')), {});
      assert.deepEqual(await json('/api/routines'), []);
      assert.equal((await json('/api/jobs'))[0].source, 'Synthetic local fixture');
      client = await startDemoClient(runtime.origin, { port: 0 });
      const html = await (await fetch(`http://127.0.0.1:${client.httpServer.address().port}`)).text();
      assert.match(html, /id="root"/);
      assert.doesNotMatch(html, /fonts\.(googleapis|gstatic)\.com/);
    });
    await t.test('API blocks live work, credentials, backup restore and arbitrary applications', async () => {
      for (const [method, route] of [['POST', '/api/jobs/hunter'], ['POST', `/api/jobs/${DEMO_JOB_ID}/tailor`],
        ['POST', '/api/jobs/tailor-batch'], ['POST', '/api/jobs/revalidate'], ['POST', '/api/browser/setup'],
        ['GET', '/api/browser/login-status'], ['POST', '/api/profile'], ['POST', '/api/profile/preset'],
        ['POST', '/api/backup/restore'], ['POST', '/api/routines'], ['POST', '/api/memory/dream'],
        ['POST', `/api/jobs/${DEMO_JOB_ID}/referral`], ['POST', '/api/jobs/other-job/apply']]) {
        const response = await fetch(runtime.origin + route, { method });
        assert.equal(response.status, 403, route);
      }
    });
    await t.test('both AI entry points refuse before provider SDK calls', async () => {
      await assert.rejects(callLlm({ aiProvider: 'gemini' }, 'synthetic prompt'), /AI calls are disabled/);
      await assert.rejects(callLlmVision({ aiProvider: 'anthropic' }, 'synthetic prompt'), /AI calls are disabled/);
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
