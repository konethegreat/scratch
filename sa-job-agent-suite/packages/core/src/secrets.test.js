import test from 'node:test';
import assert from 'node:assert/strict';
import { scrubSecrets, normalizeKeyInput, isAnthropicKeyShape, isAdminKeyShape } from './secrets.js';

// Fake keys are assembled at runtime so the repository never contains a
// key-shaped literal (the key-commit guard and GitHub push protection flag those).
const anthropicKey = (n = 40) => 'sk-' + 'ant-api03-' + 'A'.repeat(n);
const adminKey = () => 'sk-' + 'ant-admin01-' + 'B'.repeat(40);

test('scrubSecrets redacts provider API keys from log lines', () => {
  const anthropic = 'sk-' + 'ant-api03-AbCdEfGh1234567890xyz';
  const google = 'AIza' + 'SyA1234567890abcdefghijklm';
  const openrouter = 'sk-' + 'or-v1-9876543210abcdef';
  const out = scrubSecrets(`Error: bad key ${anthropic} used with ${google} and ${openrouter}`);
  for (const key of [anthropic, google, openrouter]) {
    assert.ok(!out.includes(key), 'a full key leaked');
    assert.ok(!out.includes(key.slice(0, 14)), 'a key prefix leaked');
  }
  assert.ok(out.includes('•••redacted-key•••'));
  assert.equal(scrubSecrets('Saved 12 jobs from PNet'), 'Saved 12 jobs from PNet');
  assert.equal(scrubSecrets(null), '');
  assert.equal(scrubSecrets(undefined), '');
});

test('normalizeKeyInput trims whitespace, quotes and newlines', () => {
  const k = anthropicKey();
  assert.equal(normalizeKeyInput(`  ${k}\n`), k);
  assert.equal(normalizeKeyInput(`"${k}"`), k);
  assert.equal(normalizeKeyInput(`'${k}'`), k);
  assert.equal(normalizeKeyInput(` "${k.slice(0, 20)}\r\n${k.slice(20)}" `), k);
  assert.equal(normalizeKeyInput(`${k.slice(0, 15)} ${k.slice(15)}`), k);
  assert.equal(normalizeKeyInput(null), '');
  assert.equal(normalizeKeyInput(undefined), '');
});

test('isAnthropicKeyShape accepts api03 keys and rejects admin keys, short strings and other text', () => {
  assert.equal(isAnthropicKeyShape(anthropicKey()), true);
  assert.equal(isAnthropicKeyShape('sk-' + 'ant-api04-' + 'a_-Z9'.repeat(6)), true);
  assert.equal(isAnthropicKeyShape(adminKey()), false);
  assert.equal(isAnthropicKeyShape('sk-' + 'ant-api03-short'), false);
  assert.equal(isAnthropicKeyShape('hello world'), false);
  assert.equal(isAnthropicKeyShape(''), false);
  assert.equal(isAnthropicKeyShape(null), false);
});

test('isAdminKeyShape recognises only admin keys', () => {
  assert.equal(isAdminKeyShape(adminKey()), true);
  assert.equal(isAdminKeyShape(anthropicKey()), false);
  assert.equal(isAdminKeyShape('random'), false);
  assert.equal(isAdminKeyShape(null), false);
});
