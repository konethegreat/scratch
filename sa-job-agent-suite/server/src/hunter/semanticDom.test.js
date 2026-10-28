import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchTestBrowser } from '../testSupport/browser.js';
import { snapshotCandidatesInPage, extractSemanticCards } from './semanticDom.js';

const origin = 'https://jobs.test';
const card = (over = {}) => ({
  tag: 'li',
  className: 'job-card',
  testId: 'job-card',
  ariaLabel: '',
  itemprops: [],
  headings: [{ tag: 'h2', text: 'Backend Developer' }],
  links: [{ href: '/jobs/1', text: 'Backend Developer', className: 'job-link' }],
  fields: [
    { className: 'company-name', itemprop: '', tag: 'span', text: 'Acme' },
    { className: 'job-location', itemprop: '', tag: 'span', text: 'Cape Town' },
    { className: 'posted-date', itemprop: '', tag: 'time', text: '2 days ago' }
  ],
  text: 'Backend Developer Acme Cape Town 2 days ago',
  ...over
});

test('a semantic card maps its heading, link and fields', () => {
  const [item] = extractSemanticCards([card()], { origin });
  assert.equal(item.title, 'Backend Developer');
  assert.equal(item.company, 'Acme');
  assert.equal(item.location, 'Cape Town');
  assert.equal(item.datePosted, '2 days ago');
  assert.equal(item.applyUrl, 'https://jobs.test/jobs/1');
  assert.ok(item.description.length > 0);
});

test('itemprop values win over class heuristics', () => {
  const [item] = extractSemanticCards([card({
    itemprops: [
      { name: 'title', text: 'Data Engineer' },
      { name: 'hiringOrganization', text: 'Beta' },
      { name: 'jobLocation', text: 'Durban' },
      { name: 'description', text: 'Build pipelines' }
    ]
  })], { origin });
  assert.equal(item.title, 'Data Engineer');
  assert.equal(item.company, 'Beta');
  assert.equal(item.location, 'Durban');
  assert.equal(item.description, 'Build pipelines');
});

test('cards without a usable title or link are skipped', () => {
  const noTitle = card({ headings: [], ariaLabel: '', itemprops: [], text: 'tiny' });
  const noLink = card({ links: [] });
  assert.equal(extractSemanticCards([noTitle, noLink], { origin }).length, 0);
  assert.equal(extractSemanticCards([noLink], { origin, linkless: true }).length, 1);
});

test('relative links are absolutised and duplicates collapse', () => {
  const items = extractSemanticCards([
    card(),
    card({ links: [{ href: '/jobs/1#apply', text: 'Backend Developer', className: '' }] }),
    card({ headings: [{ tag: 'h3', text: 'Frontend Developer' }], links: [{ href: '/jobs/2', text: 'Frontend Developer', className: '' }] })
  ], { origin });
  assert.equal(items.length, 2);
  assert.equal(items[1].applyUrl, 'https://jobs.test/jobs/2');
});

test('the aria label is used when no heading exists', () => {
  const [item] = extractSemanticCards([card({ headings: [], ariaLabel: 'Backend Developer at Acme' })], { origin });
  assert.equal(item.title, 'Backend Developer at Acme');
});

test('the card cap is respected', () => {
  const many = Array.from({ length: 20 }, (_, i) => card({
    headings: [{ tag: 'h2', text: `Developer ${i}` }],
    links: [{ href: `/jobs/${i}`, text: `Developer ${i}`, className: '' }]
  }));
  assert.equal(extractSemanticCards(many, { origin, maxCards: 5 }).length, 5);
});

let browser = null;
before(async () => { browser = await launchTestBrowser(); });
after(async () => { if (browser) await browser.close(); });

test('the in-page snapshot reads headings, links, attributes and fields', async (t) => {
  if (!browser) return t.skip('no browser available');
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.setContent(`<!doctype html><html><body><ul>
      <li class="job-card" data-testid="job-card" aria-label="Backend Developer at Acme">
        <h2>Backend Developer</h2>
        <a href="/jobs/1">Backend Developer</a>
        <span class="company-name">Acme</span>
        <span class="job-location">Cape Town</span>
        <time datetime="2026-10-26">2 days ago</time>
      </li>
      <li class="news-item"><h3>Not a job</h3></li>
    </ul></body></html>`);
    const snapshot = await page.evaluate(snapshotCandidatesInPage, { maxCards: 10 });
    assert.equal(snapshot.length, 1);
    assert.equal(snapshot[0].headings[0].text, 'Backend Developer');
    assert.equal(snapshot[0].links[0].href, '/jobs/1');
    assert.equal(snapshot[0].testId, 'job-card');
    assert.ok(snapshot[0].fields.some((field) => field.className.includes('company-name') && field.text === 'Acme'));
    const [item] = extractSemanticCards(snapshot, { origin });
    assert.equal(item.title, 'Backend Developer');
    assert.equal(item.company, 'Acme');
    assert.equal(item.location, 'Cape Town');
  } finally {
    await context.close();
  }
});
