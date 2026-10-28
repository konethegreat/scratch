import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseStrategy, mergeRejectReasons, extractPage } from './extract.js';
import { snapshotCandidatesInPage } from './semanticDom.js';

const origin = 'https://jobs.test';
const posting = (n, over = {}) => ({
  '@type': 'JobPosting',
  title: `Backend Developer ${n}`,
  url: `/jobs/${n}`,
  hiringOrganization: { name: 'Acme' },
  jobLocation: { address: { addressLocality: 'Cape Town' } },
  ...over
});

const fakePage = ({ snapshot = [] } = {}) => ({
  evaluate: async (fn, arg) => (
    fn === snapshotCandidatesInPage || fn?.name === 'snapshotCandidatesInPage' ? snapshot : fn(arg)
  )
});

const source = (over = {}) => ({
  id: 'fake',
  name: 'Fake',
  origin,
  extractInPage: () => [],
  ...over
});

const card = (n) => ({
  title: `Backend Developer ${n}`,
  applyUrl: `${origin}/jobs/${n}`,
  company: 'Acme',
  location: 'Cape Town'
});

test('chooseStrategy takes the most valid rows and breaks ties by order', () => {
  const entry = (n) => ({ raw: n, valid: Array.from({ length: n }, (_, i) => card(i)), rejected: [], rejectReasons: [], error: null });
  assert.equal(chooseStrategy({ structured: entry(2), dom: entry(3) }).name, 'dom');
  assert.equal(chooseStrategy({ structured: entry(3), dom: entry(3) }).name, 'structured');
  assert.equal(chooseStrategy({ structured: entry(0), dom: entry(0), semantic: entry(1) }).name, 'semantic');
  assert.equal(chooseStrategy({ structured: entry(0), dom: entry(0), semantic: entry(0) }), null);
});

test('reject reasons merge by frequency and keep three', () => {
  assert.deepEqual(mergeRejectReasons([['a', 'a'], ['b'], ['c'], ['d']]), ['a', 'b', 'c']);
});

test('structured wins when it has more valid rows than the DOM', async () => {
  const result = await extractPage({
    page: fakePage(),
    source: source({ extractInPage: () => [card(1)] }),
    query: { keyword: 'developer' },
    captured: { payloads: [{ kind: 'jsonld', json: [posting(1), posting(2), posting(3)] }] }
  });
  assert.equal(result.strategy, 'structured');
  assert.equal(result.valid, 3);
  assert.equal(result.items.length, 3);
});

test('invalid rows are rejected before they are returned', async () => {
  const result = await extractPage({
    page: fakePage(),
    source: source({ extractInPage: () => [{ title: 'Dev' }, { title: 'Backend Developer', applyUrl: 'javascript:alert(1)' }, card(9)] }),
    query: { keyword: 'developer' }
  });
  assert.equal(result.strategy, 'dom');
  assert.equal(result.valid, 1);
  assert.equal(result.rejected, 2);
  assert.ok(result.rejectReasons.length >= 1);
});

test('a throwing strategy does not stop the others', async () => {
  const result = await extractPage({
    page: fakePage(),
    source: source({ extractInPage: () => { throw new Error('selector exploded'); } }),
    query: { keyword: 'developer' },
    captured: { payloads: [{ kind: 'jsonld', json: posting(1) }] }
  });
  assert.equal(result.strategy, 'structured');
  assert.equal(result.strategies.dom.error, 'selector exploded');
  assert.equal(result.valid, 1);
});

test('AI runs only when every free strategy returns zero valid rows', async () => {
  let calls = 0;
  const aiExtract = async () => { calls += 1; return [card(7)]; };
  const free = await extractPage({
    page: fakePage({ dom: [card(1)] }),
    source: source({ extractInPage: () => [card(1)] }),
    query: { keyword: 'developer' },
    aiExtract
  });
  assert.equal(calls, 0);
  assert.equal(free.strategy, 'dom');
  const recovered = await extractPage({
    page: fakePage(),
    source: source(),
    query: { keyword: 'developer' },
    aiExtract
  });
  assert.equal(calls, 1);
  assert.equal(recovered.strategy, 'ai');
  assert.equal(recovered.valid, 1);
});

test('AI rows pass the same schema gate and a throwing AI is contained', async () => {
  const invalid = await extractPage({
    page: fakePage(),
    source: source(),
    query: { keyword: 'developer' },
    aiExtract: async () => [{ title: 'x' }]
  });
  assert.equal(invalid.strategy, 'none');
  assert.equal(invalid.rejected, 1);
  const thrown = await extractPage({
    page: fakePage(),
    source: source(),
    query: { keyword: 'developer' },
    aiExtract: async () => { throw new Error('budget'); }
  });
  assert.equal(thrown.strategy, 'none');
  assert.equal(thrown.strategies.ai.error, 'budget');
});

test('AI rows without a verified link are kept as leads', async () => {
  const result = await extractPage({
    page: fakePage(),
    source: source(),
    query: { keyword: 'developer' },
    aiExtract: async () => [{ title: 'Backend Developer', company: 'Acme', applyUrl: '' }]
  });
  assert.equal(result.strategy, 'ai');
  assert.equal(result.valid, 1);
  assert.equal(result.rejected, 0);
  assert.equal(result.items[0].applyUrl, undefined);
});

test('semantic extraction runs and can win when the DOM breaks', async () => {
  const snapshot = [{
    tag: 'li', className: 'job-card', testId: '', ariaLabel: '',
    itemprops: [], headings: [{ tag: 'h2', text: 'Frontend Developer' }],
    links: [{ href: '/jobs/5', text: 'Frontend Developer', className: '' }],
    fields: [{ className: 'company', itemprop: '', tag: 'span', text: 'Beta' }],
    text: 'Frontend Developer Beta'
  }];
  const result = await extractPage({
    page: fakePage({ dom: [], snapshot }),
    source: source(),
    query: { keyword: 'developer' }
  });
  assert.equal(result.strategy, 'semantic');
  assert.equal(result.items[0].title, 'Frontend Developer');
  assert.equal(result.items[0].applyUrl, 'https://jobs.test/jobs/5');
});

test('the result cap is enforced', async () => {
  const many = Array.from({ length: 10 }, (_, i) => card(i));
  const result = await extractPage({
    page: fakePage({ dom: many }),
    source: source({ extractInPage: () => many }),
    query: { keyword: 'developer' },
    maxCards: 4
  });
  assert.equal(result.items.length, 4);
});
