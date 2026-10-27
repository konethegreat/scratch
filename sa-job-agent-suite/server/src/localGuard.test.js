import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { checkLocalRequest, localGuard, CLIENT_HEADER, CLIENT_HEADER_VALUE } from './localGuard.js';
import { requestContext } from './httpErrors.js';

const PORT = 5000;
const ok = (req) => checkLocalRequest({ method: 'GET', ...req }, { port: PORT });

test('localGuard: header constants', () => {
  assert.equal(CLIENT_HEADER, 'x-sajas-client');
  assert.equal(CLIENT_HEADER_VALUE, '1');
});

test('localGuard: allows localhost, 127.0.0.1 and [::1] hosts on the configured port', () => {
  for (const host of ['localhost:5000', '127.0.0.1:5000', '[::1]:5000', 'LOCALHOST:5000']) {
    assert.deepEqual(ok({ host }), { ok: true }, host);
  }
  // The port may be passed as a string (process.env.PORT).
  assert.deepEqual(checkLocalRequest({ method: 'GET', host: 'localhost:5000' }, { port: '5000' }), { ok: true });
});

test('localGuard: refuses a foreign Host and a rebinding hostname even for GET', () => {
  for (const host of ['evil.example:5000', 'attacker.test', '127.0.0.1.evil.example:5000', 'localhost.evil.example:5000', 'evil.example']) {
    assert.deepEqual(ok({ host }), { ok: false, status: 403, error: 'Host not allowed' }, host);
  }
});

test('localGuard: refuses a missing Host header and a wrong port', () => {
  assert.deepEqual(ok({}), { ok: false, status: 403, error: 'Host not allowed' });
  assert.deepEqual(ok({ host: '' }), { ok: false, status: 403, error: 'Host not allowed' });
  for (const host of ['localhost', '127.0.0.1:4173', 'localhost:5001', 'localhost:50000', '[::1]', 'localhost:5000/x']) {
    assert.deepEqual(ok({ host }), { ok: false, status: 403, error: 'Host not allowed' }, host);
  }
});

test('localGuard: refuses a foreign Origin and allows an absent or localhost Origin on any port', () => {
  const host = 'localhost:5000';
  assert.deepEqual(ok({ host, origin: 'https://evil.example' }), { ok: false, status: 403, error: 'Origin not allowed' });
  assert.deepEqual(ok({ host, origin: 'null' }), { ok: false, status: 403, error: 'Origin not allowed' });
  assert.deepEqual(ok({ host, origin: 'http://localhost.evil.example:4173' }), { ok: false, status: 403, error: 'Origin not allowed' });
  for (const origin of ['http://localhost:4173', 'http://127.0.0.1:5000', 'http://[::1]:4173', 'http://localhost']) {
    assert.deepEqual(ok({ host, origin }), { ok: true }, origin);
  }
  assert.deepEqual(ok({ host }), { ok: true });
});

test('localGuard: non-GET requests need the custom header', () => {
  const host = 'localhost:5000';
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const missing = { ok: false, status: 403, error: 'Missing X-SAJAS-Client header' };
    assert.deepEqual(checkLocalRequest({ method, host }, { port: PORT }), missing, method);
    assert.deepEqual(checkLocalRequest({ method, host, clientHeader: '0' }, { port: PORT }), missing, method + ' 0');
    assert.deepEqual(checkLocalRequest({ method, host, clientHeader: 'yes' }, { port: PORT }), missing, method + ' yes');
    assert.deepEqual(checkLocalRequest({ method, host, clientHeader: '1' }, { port: PORT }), { ok: true }, method + ' 1');
  }
});

test('localGuard: GET HEAD and OPTIONS do not need the header', () => {
  for (const method of ['GET', 'HEAD', 'OPTIONS']) {
    assert.deepEqual(checkLocalRequest({ method, host: 'localhost:5000' }, { port: PORT }), { ok: true }, method);
  }
});

function request(port, { method = 'GET', path = '/', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('localGuard: the middleware answers 403 JSON and does not call the route', async () => {
  let hits = 0;
  const app = express();
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  app.use(requestContext);
  app.use(localGuard({ port }));
  app.post('/count', (req, res) => { hits += 1; res.json({ hits }); });
  app.get('/count', (req, res) => res.json({ hits }));
  try {
    // Default Host header is 127.0.0.1:<port>, which is allowed.
    const blocked = await request(port, { method: 'POST', path: '/count' });
    assert.equal(blocked.status, 403);
    const blockedBody = JSON.parse(blocked.body);
    assert.equal(blockedBody.error, 'Missing X-SAJAS-Client header');
    assert.equal(blockedBody.code, 'FORBIDDEN');
    assert.equal(blockedBody.retryable, false);
    assert.match(blockedBody.requestId, /^local-/);
    assert.equal(blocked.headers['x-request-id'], blockedBody.requestId);
    assert.equal(hits, 0);

    const allowed = await request(port, { method: 'POST', path: '/count', headers: { 'X-SAJAS-Client': '1' } });
    assert.equal(allowed.status, 200);
    assert.equal(hits, 1);

    const rebinding = await request(port, { path: '/count', headers: { Host: 'evil.example' } });
    assert.equal(rebinding.status, 403);
    const rebindingBody = JSON.parse(rebinding.body);
    assert.equal(rebindingBody.error, 'Host not allowed');
    assert.equal(rebindingBody.code, 'FORBIDDEN');

    const foreignOrigin = await request(port, { method: 'POST', path: '/count', headers: { 'X-SAJAS-Client': '1', Origin: 'https://evil.example' } });
    assert.equal(foreignOrigin.status, 403);
    assert.equal(hits, 1);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
