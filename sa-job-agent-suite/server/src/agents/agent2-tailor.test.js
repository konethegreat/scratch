// Agent 2 must never save a cut-off or empty model output as a finished CV or
// cover letter. DB_PATH is set BEFORE the dynamic imports (helper.js reads it at
// import time). PDF rendering is injected so no browser is needed.
import test, { before, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fakeClient } from '@sajas/core/testing';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sajas-agent2-'));
process.env.DB_PATH = path.join(dir, 'db.json');
process.env.KEYS_PATH = path.join(dir, 'keys.json');
delete process.env.SAJAS_DEMO_ORIGIN;

// Assembled at runtime: no key-shaped literals in the repo.
const KEY = 'sk-' + 'ant-api03-' + 'A'.repeat(40);

let helper, llm, agent2;

before(async () => {
  helper = await import('../db/helper.js');
  llm = await import('./llm.js');
  agent2 = await import('./agent2-tailor.js');
});

const JOB_ID = 'job-1';
let pdfCalls;
const renderPdf = async (md, outPath) => { pdfCalls.push(outPath); return outPath; };

beforeEach(() => {
  pdfCalls = [];
  helper.clearUsage();
  helper.saveProfile({
    anthropicApiKey: KEY,
    fullName: 'Test User',
    baseCv: 'Test User\nSenior Engineer with eight years of experience in Node.js and React.\n'.repeat(3),
    useResearchFanout: false,
    useMemoryReflection: false
  });
  const db = helper.readDb();
  db.jobs = [{ id: JOB_ID, title: 'Software Engineer', company: 'Acme', location: 'Cape Town', description: 'Build things.', status: 'found' }];
  helper.writeDb(db);
});

afterEach(() => llm.setClaudeClientForTests(null));
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const reply = (content, extra = {}) => ({
  id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5',
  content, stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 }, ...extra
});
const text = (t) => ({ type: 'text', text: t });
const job = () => helper.readDb().jobs.find((j) => j.id === JOB_ID);

test('good CV and cover letter are saved and rendered as before', async () => {
  const f = fakeClient([reply([text('# Tailored CV\n\n- did things')]), reply([text('Dear Hiring Manager, hello.')])]);
  llm.setClaudeClientForTests(f.client);
  const out = await agent2.runDocumentTailorAgent(JOB_ID, { renderPdf });
  assert.equal(out.status, 'tailored');
  assert.equal(job().tailoredCvText, '# Tailored CV\n\n- did things');
  assert.equal(job().tailoredCoverLetterText, 'Dear Hiring Manager, hello.');
  assert.equal(pdfCalls.length, 2);
});

test('a truncated CV throws, the job is not marked tailored and no PDF is rendered', async () => {
  const f = fakeClient([reply([text('# Tailored CV\n\n- half a sent')], { stop_reason: 'max_tokens' })]);
  llm.setClaudeClientForTests(f.client);
  await assert.rejects(agent2.runDocumentTailorAgent(JOB_ID, { renderPdf }), /cut off|too long|incomplete|truncat/i);
  assert.notEqual(job().status, 'tailored');
  assert.ok(!job().tailoredCvText);
  assert.equal(pdfCalls.length, 0);
});

test('an empty CV result (thinking used the whole budget) throws and saves nothing', async () => {
  const f = fakeClient([reply([{ type: 'thinking', thinking: 'hmm', signature: 'x' }], { stop_reason: 'max_tokens' })]);
  llm.setClaudeClientForTests(f.client);
  await assert.rejects(agent2.runDocumentTailorAgent(JOB_ID, { renderPdf }), /empty|no text|cut off|truncat/i);
  assert.notEqual(job().status, 'tailored');
  assert.ok(!job().tailoredCvText);
  assert.equal(pdfCalls.length, 0);

  // Empty even though the stop reason was a clean end_turn.
  const g = fakeClient([reply([text('   ')])]);
  llm.setClaudeClientForTests(g.client);
  await assert.rejects(agent2.runDocumentTailorAgent(JOB_ID, { renderPdf }), /empty|no text/i);
  assert.ok(!job().tailoredCvText);
});

test('a truncated cover letter keeps the CV and does not save the letter', async () => {
  const f = fakeClient([
    reply([text('# Tailored CV\n\n- fine')]),
    reply([text('Dear Hiring Manager, I am writ')], { stop_reason: 'max_tokens' })
  ]);
  llm.setClaudeClientForTests(f.client);
  const out = await agent2.runDocumentTailorAgent(JOB_ID, { renderPdf });
  assert.equal(out.status, 'tailored');
  assert.equal(job().tailoredCvText, '# Tailored CV\n\n- fine');
  assert.ok(!job().tailoredCoverLetterText);
  assert.ok(!job().tailoredCoverLetterPath);
  assert.equal(pdfCalls.length, 1, 'only the CV was rendered');
  assert.ok(helper.getLogs().some((l) => /Cover letter generation failed \(CV was saved\)/.test(l.message)));
});
