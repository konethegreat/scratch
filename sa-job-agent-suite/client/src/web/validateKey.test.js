import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAnthropicKey } from './validateKey.js';

const API_KEY = ['sk', 'ant', 'api03', 'E'.repeat(24)].join('-');
const ADMIN_KEY = ['sk', 'ant', 'admin01', 'F'.repeat(24)].join('-');

function fakeFetch(status, body = '{}') {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return new Response(body, { status, headers: { 'content-type': 'application/json' } });
  };
  impl.calls = calls;
  return impl;
}

test('a working key validates with the browser-access header', async () => {
  const fetchImpl = fakeFetch(200, '{"data":[]}');
  assert.equal(await validateAnthropicKey(API_KEY, { fetchImpl }), true);
  const [call] = fetchImpl.calls;
  assert.equal(call.url, 'https://api.anthropic.com/v1/models?limit=1');
  assert.equal(call.init.headers['x-api-key'], API_KEY);
  assert.equal(call.init.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(call.init.headers['anthropic-version'], '2026-10-21');
});

test('admin and malformed keys are refused without a request', async () => {
  const fetchImpl = fakeFetch(200);
  await assert.rejects(() => validateAnthropicKey(ADMIN_KEY, { fetchImpl }), (e) => e.code === 'KEY_ADMIN');
  await assert.rejects(() => validateAnthropicKey('not-a-key', { fetchImpl }), (e) => e.code === 'KEY_INVALID');
  assert.equal(fetchImpl.calls.length, 0);
});

test('SDK-style statuses map to typed errors', async () => {
  for (const [status, code] of [[401, 'AUTH_REJECTED'], [403, 'KEY_PERMISSION'], [429, 'RATE_LIMITED'], [529, 'OVERLOADED'], [500, 'OVERLOADED']]) {
    await assert.rejects(() => validateAnthropicKey(API_KEY, { fetchImpl: fakeFetch(status) }), (e) => e.code === code, String(status));
  }
});

test('a blocked fetch maps to offline or CORS using the online hint', async () => {
  const failing = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(() => validateAnthropicKey(API_KEY, { fetchImpl: failing, online: false }), (e) => e.code === 'NETWORK_OFFLINE');
  await assert.rejects(() => validateAnthropicKey(API_KEY, { fetchImpl: failing, online: true }), (e) => e.code === 'CORS_BLOCKED');
});

test('any TypeError from fetch lands on the network contract, never UNKNOWN', async () => {
  const failing = async () => { throw new TypeError('boom'); };
  await assert.rejects(() => validateAnthropicKey(API_KEY, { fetchImpl: failing, online: false }), (e) => e.code === 'NETWORK_OFFLINE');
  await assert.rejects(() => validateAnthropicKey(API_KEY, { fetchImpl: failing, online: true }), (e) => e.code === 'CORS_BLOCKED');
});
