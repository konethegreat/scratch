import test from 'node:test';
import assert from 'node:assert/strict';
import {
  absolutize, stripHtml, mapJsonLd, mapStructured, findJobArrays, dedupeCards
} from './structured.js';

const origin = 'https://jobs.test';
const posting = (over = {}) => ({
  '@type': 'JobPosting',
  title: 'Backend Developer',
  description: '<p>Build <b>APIs</b></p>',
  url: '/jobs/1',
  datePosted: '2026-10-20',
  hiringOrganization: { name: 'Acme' },
  jobLocation: { address: { addressLocality: 'Cape Town', addressRegion: 'Western Cape', addressCountry: 'ZA' } },
  ...over
});

test('absolutize and stripHtml handle hostile input', () => {
  assert.equal(absolutize('/jobs/1', origin), 'https://jobs.test/jobs/1');
  assert.equal(absolutize('https://other.test/x', origin), 'https://other.test/x');
  assert.equal(absolutize('', origin), '');
  assert.equal(absolutize('http://[', origin), '');
  assert.equal(stripHtml('<p>Hello <b>world</b></p>'), 'Hello world');
  assert.equal(stripHtml('<script>alert(1)</script>Safe'), 'Safe');
  assert.equal(stripHtml(null), '');
});

test('JSON-LD postings map inside arrays, @graph and single objects', () => {
  const payloads = [
    { kind: 'jsonld', json: posting() },
    { kind: 'jsonld', json: [posting({ title: 'Frontend Developer', url: '/jobs/2' })] },
    { kind: 'jsonld', json: { '@graph': [posting({ title: 'Data Engineer', url: '/jobs/3' }), { '@type': 'Organization', name: 'Acme' }] } }
  ];
  const items = mapJsonLd(payloads, origin);
  assert.equal(items.length, 3);
  assert.equal(items[0].title, 'Backend Developer');
  assert.equal(items[0].company, 'Acme');
  assert.equal(items[0].location, 'Cape Town, Western Cape, ZA');
  assert.equal(items[0].applyUrl, 'https://jobs.test/jobs/1');
  assert.equal(items[0].description, 'Build APIs');
  assert.equal(items[1].applyUrl, 'https://jobs.test/jobs/2');
});

test('JSON-LD split locations are joined and remote type is kept', () => {
  const items = mapJsonLd([{ kind: 'jsonld', json: posting({
    title: 'Remote Developer',
    jobLocation: [{ address: { addressLocality: 'Cape Town' } }, { address: { addressLocality: 'Durban' } }]
  }) }], origin);
  assert.equal(items[0].location, 'Cape Town, Durban');
});

test('generic arrays need a title-like and a link-like key', () => {
  const root = {
    data: {
      jobs: [
        { title: 'Backend Developer', url: '/j/1', companyName: 'Acme', city: 'Cape Town' },
        { title: 'Frontend Developer', url: '/j/2', employer: 'Beta', area: 'Durban', snippet: '<b>Great</b> role' }
      ]
    },
    nav: [{ name: 'Home', link: '/' }, { name: 'Jobs', link: '/jobs' }]
  };
  const arrays = findJobArrays(root);
  assert.equal(arrays.length, 1);
  assert.equal(arrays[0].length, 2);
  const items = mapStructured([{ kind: 'state', json: root }], { origin });
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Backend Developer');
  assert.equal(items[0].company, 'Acme');
  assert.equal(items[0].location, 'Cape Town');
  assert.equal(items[1].company, 'Beta');
  assert.equal(items[1].description, 'Great role');
});

test('generic detection is bounded by depth and node count', () => {
  let deep = { jobs: [{ title: 'Backend Developer', url: '/j/1' }, { title: 'Frontend Developer', url: '/j/2' }] };
  for (let i = 0; i < 15; i += 1) deep = { next: deep };
  assert.equal(findJobArrays(deep).length, 0);
  const wide = { jobs: [{ title: 'Backend Developer', url: '/j/1' }, { title: 'Frontend Developer', url: '/j/2' }] };
  assert.equal(findJobArrays(wide, { maxNodes: 0 }).length, 0);
});

test('a source adapter wins over JSON-LD and generic arrays', () => {
  const source = {
    mapStructured: ({ payloads, origin: base }) => [{ title: 'Adapter Developer', applyUrl: `${base}/adapter`, company: 'Adapter Co' }]
  };
  const payloads = [
    { kind: 'jsonld', json: posting() },
    { kind: 'state', json: { jobs: [{ title: 'Array Developer', url: '/j/1' }, { title: 'Array Developer 2', url: '/j/2' }] } }
  ];
  const items = mapStructured(payloads, { source, origin });
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Adapter Developer');
});

test('a throwing adapter falls through to the generic readers', () => {
  const source = { mapStructured: () => { throw new Error('bad adapter'); } };
  const items = mapStructured([{ kind: 'jsonld', json: posting() }], { source, origin });
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Backend Developer');
});

test('dedupe removes the same URL and the same title plus company', () => {
  const items = dedupeCards([
    { title: 'Backend Developer', company: 'Acme', applyUrl: 'https://jobs.test/j/1' },
    { title: 'Backend Developer', company: 'Acme', applyUrl: 'https://jobs.test/j/1#top' },
    { title: 'Frontend Developer', company: 'Acme' },
    { title: 'Frontend Developer', company: 'Acme' },
    { title: 'Data Engineer', company: 'Beta' }
  ]);
  assert.equal(items.length, 3);
});
