import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptSecret, decryptSecret } from './keyCrypto.js';

const API_KEY = ['sk', 'ant', 'api03', 'A'.repeat(24)].join('-');
const FAST = { iterations: 1000 };

test('encrypt/decrypt round-trips and stores no plaintext', async () => {
  const blob = await encryptSecret(API_KEY, 'correct horse battery', FAST);
  assert.equal(blob.v, 1);
  assert.equal(blob.alg, 'AES-GCM');
  assert.equal(blob.kdf, 'PBKDF2-SHA-256');
  assert.equal(blob.iterations, 1000);
  for (const field of ['salt', 'iv', 'ciphertext']) {
    assert.equal(typeof blob[field], 'string');
    assert.ok(blob[field].length > 8);
  }
  assert.equal(JSON.stringify(blob).includes(API_KEY), false);
  assert.equal(await decryptSecret(blob, 'correct horse battery'), API_KEY);
});

test('a wrong passphrase is a VALIDATION error, not a crash', async () => {
  const blob = await encryptSecret(API_KEY, 'correct horse battery', FAST);
  await assert.rejects(() => decryptSecret(blob, 'wrong passphrase'), (err) => err.code === 'VALIDATION');
});

test('a tampered ciphertext is rejected', async () => {
  const blob = await encryptSecret(API_KEY, 'correct horse battery', FAST);
  const raw = Buffer.from(blob.ciphertext, 'base64');
  raw[0] ^= 0xff;
  await assert.rejects(
    () => decryptSecret({ ...blob, ciphertext: raw.toString('base64') }, 'correct horse battery'),
    (err) => err.code === 'VALIDATION'
  );
});

test('a malformed blob is rejected before deriving', async () => {
  await assert.rejects(() => decryptSecret({ v: 2 }, 'x'), (err) => err.code === 'VALIDATION');
  await assert.rejects(() => decryptSecret(null, 'x'), (err) => err.code === 'VALIDATION');
});
