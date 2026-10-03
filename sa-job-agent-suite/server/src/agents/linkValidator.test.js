// Unit tests for the Agent 1 link validator — run with `npm test` (node:test).
// These cover the PURE, deterministic behaviour only (URL shape + the keep/strip
// policy with liveness OFF), so they need no network and never hit a real site.
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyPostingUrl, validateLink, validateJobs, isJunkAggregatorHost } from './linkValidator.js';

test('isJunkAggregatorHost flags repost aggregators, passes real boards', () => {
  const junk = [
    'https://za.jooble.org/jdp/123456789',
    'https://www.jobrapido.com/jobpreview/9988776655',
    'https://za.whatjobs.com/job/software-engineer/12345',
    'https://za.expertini.com/jobs/job/software-developer-jhb-1234/',
    'https://www.learn4good.com/jobs/johannesburg/software/12345/',
    'https://www.adzuna.com/details/5001234567'           // non-SA adzuna
  ];
  const fine = [
    'https://www.adzuna.co.za/details/5001234567',        // SA adzuna is a real board here
    'https://za.linkedin.com/jobs/view/engineer-3812345678',
    'https://www.pnet.co.za/jobs/software-engineer-1234567',
    'https://boards.greenhouse.io/acme/jobs/4567890'
  ];
  for (const u of junk) assert.equal(isJunkAggregatorHost(u), true, `should flag ${u}`);
  for (const u of fine) assert.equal(isJunkAggregatorHost(u), false, `should pass ${u}`);
});

test('validateLink strips junk-aggregator links but keeps the job as a lead', async () => {
  const v = await validateLink('https://za.jooble.org/jdp/123456789', { checkLiveness: false });
  assert.equal(v.verdict, 'keep');
  assert.equal(v.strip, true);
  assert.equal(v.linkStatus, 'no-link');
  assert.match(v.reason, /junk/i);
});

test('classifyPostingUrl accepts real postings, rejects search/category/home/bad', () => {
  const accept = [
    'https://za.linkedin.com/jobs/view/software-engineer-at-acme-3812345678', // slug-then-id
    'https://www.linkedin.com/jobs/view/4056789012',
    'https://www.pnet.co.za/jobs/software-engineer-cape-town-1234567',
    'https://www.indeed.co.za/viewjob?jk=abcd1234ef',
    'https://za.indeed.com/viewjob?jk=ab1cd2ef3gh',      // jk id with no 3-digit run
    'https://boards.greenhouse.io/acme/jobs/4567890',
    'https://jobs.lever.co/acme/9f1c2b3d-1111-2222-3333-aaaabbbbcccc',
    'https://www.careers24.com/jobs/adverts/123456-developer'
  ];
  const reject = [
    'https://www.linkedin.com/jobs/search/?keywords=developer', // search
    'https://za.indeed.com/jobs?q=developer&l=Cape+Town',       // query
    'https://careers.acme.co.za/',                              // bare home
    'https://www.careers24.com/jobs/in-western-cape',           // category, no id
    'not-a-url',
    'ftp://example.com/job/123'                                 // non-http
  ];
  for (const u of accept) assert.equal(classifyPostingUrl(u), true, `should accept ${u}`);
  for (const u of reject) assert.equal(classifyPostingUrl(u), false, `should reject ${u}`);
});

test('validateLink (liveness off): linkless → lead, search → stripped lead, posting → kept', async () => {
  const none = await validateLink('', { checkLiveness: false });
  assert.equal(none.verdict, 'keep');
  assert.equal(none.linkStatus, 'no-link');

  const search = await validateLink('https://site.co.za/jobs/search?q=dev', { checkLiveness: false });
  assert.equal(search.verdict, 'keep');
  assert.equal(search.linkStatus, 'no-link');
  assert.equal(search.strip, true);

  const post = await validateLink('https://boards.greenhouse.io/acme/jobs/123456', { checkLiveness: false });
  assert.equal(post.verdict, 'keep');
  assert.notEqual(post.linkStatus, 'no-link');
});

test('validateJobs (liveness off): keeps all, strips junk links, drops nothing', async () => {
  const { kept, dropped } = await validateJobs([
    { title: 'No link', applyUrl: '' },
    { title: 'Search page', applyUrl: 'https://site.co.za/jobs/search?q=dev' },
    { title: 'Real posting', applyUrl: 'https://boards.greenhouse.io/acme/jobs/123456' }
  ], { checkLiveness: false });

  assert.equal(dropped.length, 0);
  assert.equal(kept.length, 3);
  const byTitle = Object.fromEntries(kept.map((j) => [j.title, j]));
  assert.equal(byTitle['Search page'].applyUrl, '');          // junk link stripped
  assert.equal(byTitle['Search page'].linkStatus, 'no-link');
  assert.equal(byTitle['Real posting'].applyUrl, 'https://boards.greenhouse.io/acme/jobs/123456'); // kept intact
  assert.ok(byTitle['Real posting'].linkCheckedAt);           // stamped
});
