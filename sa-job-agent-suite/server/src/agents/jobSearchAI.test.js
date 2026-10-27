// Tests for AI search (Agent 1 Phase 0) and link repair on the core adapter.
// DB_PATH must point at a throwaway file BEFORE helper.js / llm.js load.
import test, { before, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fakeClient } from '@sajas/core/testing';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sajas-search-'));
process.env.DB_PATH = path.join(dir, 'db.json');
delete process.env.SAJAS_DEMO_ORIGIN;

// Assembled at runtime: no key-shaped literals in the repo.
const KEY = 'sk-' + 'ant-api03-' + 'A'.repeat(40);

let search;
let llm;
let helper;

before(async () => {
  helper = await import('../db/helper.js');
  llm = await import('./llm.js');
  search = await import('./jobSearchAI.js');
});

beforeEach(() => {
  helper.clearUsage();
  helper.clearLogs();
  const db = helper.readDb();
  db.profile.dailyBudgetUSD = 0;
  helper.writeDb(db);
});

afterEach(() => {
  llm.setClaudeClientForTests(null);
  delete process.env.SAJAS_DEMO_ORIGIN;
});

after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const text = (t) => ({ type: 'text', text: t });
const reply = (content, extra = {}) => ({
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-sonnet-5-5',
  content,
  stop_reason: 'end_turn',
  usage: { input_tokens: 10, output_tokens: 5 },
  ...extra
});
const profile = (extra = {}) => ({ anthropicApiKey: KEY, ...extra });

const job = (n, extra = {}) => ({
  title: `Software Engineer ${n}`,
  company: `Acme ${n}`,
  location: 'Cape Town, Western Cape',
  applyUrl: `https://www.pnet.co.za/jobs/software-engineer-${n}`,
  source: 'PNet',
  description: 'Build things.',
  datePosted: '2 days ago',
  ...extra
});

test('parseJobs reads an object-wrapped or bare array and normalises fields', () => {
  const wrapped = search.parseJobs(JSON.stringify({ jobs: [job(1), job(2, { applyUrl: '' , source: ''})] }), 'Gauteng');
  assert.equal(wrapped.length, 2);
  assert.equal(wrapped[0].title, 'Software Engineer 1');
  assert.equal(wrapped[0].source, 'PNet'); // derived from the URL host
  assert.equal(wrapped[1].applyUrl, '');
  assert.equal(wrapped[1].source, 'AI Search'); // linkless lead, no self-reported source

  const bare = search.parseJobs('Here you go:\n```json\n' + JSON.stringify([job(3)]) + '\n```', 'Gauteng');
  assert.equal(bare.length, 1);
  assert.equal(bare[0].company, 'Acme 3');

  // Field normalisation: junk URL dropped, missing company/location/date defaulted.
  const [n] = search.parseJobs(JSON.stringify({ jobs: [{ title: ' Data Engineer ', applyUrl: 'javascript:alert(1)' }] }), 'Durban');
  assert.equal(n.title, 'Data Engineer');
  assert.equal(n.company, 'Confidential');
  assert.equal(n.location, 'Durban');
  assert.equal(n.applyUrl, '');
  assert.equal(n.datePosted, 'Recently');

  assert.equal(search.parseJobs('no json here at all', 'x'), null);
  assert.deepEqual(search.parseJobs('{"jobs":[]}', 'x'), []);
});

test('parseJobs keeps the complete jobs from a truncated response', () => {
  const full = JSON.stringify({ jobs: [job(1), job(2), job(3)] });
  // Cut mid-way through the third object.
  const cut = full.slice(0, full.indexOf('"title":"Software Engineer 3"') + 20);
  assert.ok(!cut.endsWith('}]}'), 'fixture must really be truncated');
  const jobs = search.parseJobs(cut, 'Cape Town');
  assert.equal(jobs.length, 2);
  assert.deepEqual(jobs.map((j) => j.title), ['Software Engineer 1', 'Software Engineer 2']);

  // Same for a truncated bare array.
  const bareFull = JSON.stringify([job(1), job(2), job(3)]);
  const bareCut = bareFull.slice(0, bareFull.lastIndexOf('{') + 15);
  assert.equal(search.parseJobs(bareCut, 'Cape Town').length, 2);
});

test('huntViaClaudeSearch sends the current web_search tool and no beta computer or old search types', async () => {
  const f = fakeClient([reply([text(JSON.stringify({ jobs: [job(1)] }))])]);
  llm.setClaudeClientForTests(f.client);
  const jobs = await search.huntViaClaudeSearch(profile({ searchDepth: 'standard' }), 'software engineer', ['Cape Town']);
  assert.equal(jobs.length, 1);
  assert.equal(f.calls.length, 1);

  const tools = f.calls[0].tools;
  assert.equal(tools.length, 1);
  assert.equal(tools[0].type, 'web_search_20260318');
  assert.equal(tools[0].name, 'web_search');
  assert.equal(tools[0].max_uses, 5);
  assert.deepEqual(tools[0].user_location, { type: 'approximate', country: 'ZA', timezone: 'Africa/Johannesburg' });
  for (const t of tools) {
    assert.ok(!/computer/.test(t.type), 'no computer tool on a search request');
    assert.notEqual(t.type, 'web_search_20250305');
  }
  for (const b of f.calls[0].betas || []) assert.ok(!/computer/.test(b), `unexpected beta ${b}`);

  // Structured output follows the SEARCH_USES_SCHEMA switch.
  if (search.SEARCH_USES_SCHEMA) {
    assert.equal(f.calls[0].output_config.format.type, 'json_schema');
    assert.deepEqual(f.calls[0].output_config.format.schema, search.JOBS_SCHEMA);
  } else {
    assert.equal(f.calls[0].output_config.format, undefined);
  }
  // Metered under the ai-search bucket.
  assert.equal(helper.getUsageSummary().today.byBucket['ai-search'].calls, 1);
});

test('huntViaClaudeSearch survives a pause_turn then end_turn and returns the jobs from the final text', async () => {
  const f = fakeClient([
    reply([{ type: 'server_tool_use', id: 'srv_1', name: 'web_search', input: { query: 'x' } }], { stop_reason: 'pause_turn' }),
    reply([text(JSON.stringify({ jobs: [job(1), job(2)] }))])
  ]);
  llm.setClaudeClientForTests(f.client);
  const jobs = await search.huntViaClaudeSearch(profile(), 'software engineer', ['Johannesburg']);
  assert.equal(f.calls.length, 2);
  assert.deepEqual(jobs.map((j) => j.title).sort(), ['Software Engineer 1', 'Software Engineer 2']);
});

test('huntViaClaudeSearch keeps the complete jobs when output is cut off at max_tokens and says so', async () => {
  const full = JSON.stringify({ jobs: [job(1), job(2), job(3)] });
  const cut = full.slice(0, full.indexOf('"title":"Software Engineer 3"') + 20);
  const f = fakeClient([reply([text(cut)], { stop_reason: 'max_tokens' })]);
  llm.setClaudeClientForTests(f.client);
  const jobs = await search.huntViaClaudeSearch(profile(), 'software engineer', ['Cape Town']);
  assert.equal(jobs.length, 2);
  assert.ok(
    helper.getLogs().some((l) => l.message.includes('Search output was cut off; kept 2 complete result(s).')),
    'expected the cut-off log line'
  );
});

test('deep depth makes a second request that continues the first conversation', async () => {
  const firstContent = [text(JSON.stringify({ jobs: [job(1)] }))];
  const f = fakeClient([
    reply(firstContent),
    reply([text(JSON.stringify({ jobs: [job(1), job(2)] }))])
  ]);
  llm.setClaudeClientForTests(f.client);
  const jobs = await search.huntViaClaudeSearch(profile({ searchDepth: 'deep' }), 'software engineer', ['Cape Town']);

  assert.equal(f.calls.length, 2);
  const [c1, c2] = f.calls;
  assert.equal(c1.tools[0].max_uses, 8);
  assert.equal(c2.tools[0].type, 'web_search_20260318');
  assert.equal(c2.tools[0].max_uses, 4);

  // Second call = first prompt, the first assistant answer, then the follow-up.
  assert.equal(c2.messages.length, 3);
  assert.deepEqual(c2.messages[0], c1.messages[0]);
  assert.equal(c2.messages[0].role, 'user');
  assert.equal(c2.messages[1].role, 'assistant');
  assert.deepEqual(c2.messages[1].content, firstContent);
  assert.equal(c2.messages[2].role, 'user');
  assert.match(c2.messages[2].content, /search AGAIN/);

  // Duplicates across rounds are collapsed.
  assert.equal(jobs.length, 2);
});

test('huntViaClaudeSearch returns [] without a key and makes no request', async () => {
  const f = fakeClient([reply([text('[]')])]);
  llm.setClaudeClientForTests(f.client);
  assert.deepEqual(await search.huntViaClaudeSearch({}, 'software engineer', ['Cape Town']), []);
  assert.equal(f.calls.length, 0);
});

test('findDirectPostingUrl returns \'\' for NONE and the first https URL otherwise', async () => {
  const j = { title: 'Software Engineer', company: 'Acme', location: 'Cape Town' };

  const none = fakeClient([reply([text('NONE')])]);
  llm.setClaudeClientForTests(none.client);
  assert.equal(await search.findDirectPostingUrl(profile(), j), '');
  assert.equal(none.calls[0].tools[0].type, 'web_search_20260318');
  assert.equal(none.calls[0].tools[0].max_uses, 3);
  assert.equal(helper.getUsageSummary().today.byBucket['link-repair'].calls, 1);

  const found = fakeClient([reply([text('The posting is at https://boards.greenhouse.io/acme/jobs/12345. Also https://other.example/x')])]);
  llm.setClaudeClientForTests(found.client);
  assert.equal(await search.findDirectPostingUrl(profile(), j), 'https://boards.greenhouse.io/acme/jobs/12345');

  assert.equal(await search.findDirectPostingUrl({}, j), '');
});

test('researchCompany and findReferralContact use the current web_search tool under their own task buckets', async () => {
  const research = await import('./companyResearch.js');
  const referral = await import('./referralAgent.js');
  const j = { title: 'Software Engineer', company: 'Acme', location: 'Cape Town' };

  const r = fakeClient([reply([text('Acme builds payments software.')])]);
  llm.setClaudeClientForTests(r.client);
  assert.equal(await research.researchCompany(profile({ useResearchFanout: true }), j), 'Acme builds payments software.');
  assert.equal(r.calls[0].tools[0].type, 'web_search_20260318');
  assert.equal(r.calls[0].tools[0].max_uses, 3);
  assert.equal(helper.getUsageSummary().today.byBucket.research.calls, 1);

  const c = fakeClient([reply([text('{"full_name":"Thandi Nkosi","exact_role":"Engineering Manager","profile_url":"https://www.linkedin.com/in/thandi-nkosi","confidence":"high"}')])]);
  llm.setClaudeClientForTests(c.client);
  const contact = await referral.findReferralContact(profile(), j);
  assert.equal(contact.full_name, 'Thandi Nkosi');
  assert.equal(contact.grounded, true);
  assert.equal(c.calls[0].tools[0].type, 'web_search_20260318');
  assert.equal(helper.getUsageSummary().today.byBucket['referral-search'].calls, 1);
});
