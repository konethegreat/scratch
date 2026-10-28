import test from 'node:test';
import assert from 'node:assert/strict';
import { profileLaunchOptions, openProfileContext, openEphemeralContext, SCRAPE_LAUNCH_OPTS, LOGIN_LAUNCH_OPTS } from './browser.js';

test('headless scrape options keep the South African locale and timezone', () => {
  const options = profileLaunchOptions();
  assert.equal(options.locale, 'en-ZA');
  assert.equal(options.timezoneId, 'Africa/Johannesburg');
  assert.deepEqual(options.viewport, { width: 1366, height: 768 });
  assert.ok(options.args.includes('--disable-blink-features=AutomationControlled'));
  assert.equal(options.headless, true);
});

test('headful login options stay visible and maximised', () => {
  const options = profileLaunchOptions({ headless: false });
  assert.equal(options.headless, false);
  assert.deepEqual(options.args, LOGIN_LAUNCH_OPTS.args);
  assert.equal(options.viewport, null);
});

test('args and viewport can be overridden without losing the base', () => {
  const options = profileLaunchOptions({ args: ['--no-sandbox'], viewport: { width: 800, height: 600 } });
  assert.deepEqual(options.args, ['--no-sandbox']);
  assert.deepEqual(options.viewport, { width: 800, height: 600 });
  assert.equal(options.locale, SCRAPE_LAUNCH_OPTS.locale);
});

test('openProfileContext tries Chrome first, then bundled Chromium, with one option set', async () => {
  const calls = [];
  const launch = async (path, options) => {
    calls.push(options);
    if (options.channel === 'chrome') throw new Error('no chrome');
    return { ok: true };
  };
  const context = await openProfileContext({ launch });
  assert.deepEqual(context, { ok: true });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].channel, 'chrome');
  assert.equal(calls[1].channel, undefined);
  assert.equal(calls[0].locale, calls[1].locale);
});

test('openEphemeralContext creates a throwaway context without the persistent profile', async () => {
  const seen = [];
  const browser = {
    newContext: async (options) => { seen.push(options); return { kind: 'ephemeral' }; },
    close: async () => { seen.push('closed'); }
  };
  const { context, browser: started } = await openEphemeralContext({
    headless: false,
    launch: async (options) => { seen.push(options.headless); return browser; }
  });
  assert.deepEqual(context, { kind: 'ephemeral' });
  assert.equal(started, browser);
  assert.equal(seen[0], false);
  assert.equal(seen[1].locale, 'en-ZA');
});
