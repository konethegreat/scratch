import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sajas-sites-'));
process.env.DB_PATH = path.join(dir, 'db.json');
process.env.KEYS_PATH = path.join(dir, 'keys.json');

const { connectSite, disconnectSite } = await import('./siteSessions.js');
const { getSiteConsent } = await import('../db/helper.js');

const site = {
  key: 'example',
  label: 'Example Jobs',
  origin: 'https://jobs.example.test',
  loginUrl: 'https://jobs.example.test/login',
  checkUrl: 'https://jobs.example.test/account',
  isLoggedIn: (page) => page.isLoggedIn()
};

function fakeContext({ loggedIn = false } = {}) {
  const deleted = [];
  let state = loggedIn;
  const page = {
    isClosed: () => false,
    isLoggedIn: () => state,
    goto: async () => {},
    evaluate: async () => {},
    url: () => site.checkUrl
  };
  return {
    deleted,
    login: () => { state = true; },
    context: {
      pages: () => [page],
      newPage: async () => page,
      newCDPSession: async () => ({
        send: async (method, params) => {
          if (method === 'Network.getCookies') return { cookies: [{ name: 'session', domain: 'jobs.example.test', path: '/' }] };
          if (method === 'Network.deleteCookies') { deleted.push(params); return {}; }
          return {};
        },
        detach: async () => {}
      }),
      close: async () => {}
    }
  };
}

test('connect stores consent only after the site reports a signed-in page', async () => {
  const fake = fakeContext();
  const pending = connectSite('example', { site, openContext: async () => fake.context, timeoutMs: 900, pollMs: 10 });
  setTimeout(fake.login, 30);
  const entry = await pending;
  assert.equal(entry.siteKey, 'example');
  assert.equal(entry.origin, 'https://jobs.example.test');
  assert.equal(getSiteConsent().example.label, 'Example Jobs');
});

test('connect returns null when sign-in is never detected', async () => {
  assert.equal(await connectSite('example', { site, openContext: async () => fakeContext().context, timeoutMs: 120, pollMs: 10 }), null);
});

test('disconnect clears only that site cookies and removes consent', async () => {
  const fake = fakeContext({ loggedIn: true });
  await connectSite('example', { site, openContext: async () => fake.context, timeoutMs: 300, pollMs: 5 });
  await disconnectSite('example', { site, openContext: async () => fake.context });
  assert.deepEqual(fake.deleted, [{ name: 'session', domain: 'jobs.example.test', path: '/' }]);
  assert.equal(getSiteConsent().example, undefined);
});

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
