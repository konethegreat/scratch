import test from 'node:test';
import assert from 'node:assert/strict';
import { LOGIN_SITES, loginSite, siteForHost } from './loginSites.js';

test('the registry lists the five supported sites once each', () => {
  assert.deepEqual(LOGIN_SITES.map((site) => site.key), ['linkedin', 'indeedSa', 'pnet', 'careerJunction', 'gumtreeSa']);
  assert.equal(new Set(LOGIN_SITES.map((site) => site.key)).size, LOGIN_SITES.length);
  for (const site of LOGIN_SITES) {
    assert.match(site.origin, /^https:\/\//);
    assert.equal(typeof site.isLoggedIn, 'function');
  }
});

test('hosts match the site itself and its subdomains only', () => {
  assert.equal(siteForHost('www.linkedin.com').key, 'linkedin');
  assert.equal(siteForHost('za.indeed.com').key, 'indeedSa');
  assert.equal(siteForHost('www.pnet.co.za').key, 'pnet');
  assert.equal(siteForHost('careerjunction.co.za').key, 'careerJunction');
  assert.equal(siteForHost('evil-linkedin.com'), null);
  assert.equal(siteForHost(''), null);
  assert.equal(loginSite('missing'), null);
});
