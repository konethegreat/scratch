// Profile schema v2 + Anthropic-only key handling. helper.js reads DB_PATH /
// KEYS_PATH at import time, so the env is set BEFORE the dynamic imports.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sajas-mig-'));
process.env.DB_PATH = path.join(dir, 'db.json');
process.env.KEYS_PATH = path.join(dir, 'keys.json');

const helper = await import('./helper.js');
const mig = await import('./migrations.js');
const { MODEL_IDS } = await import('@sajas/core');

// Key-shaped values are assembled at runtime (secret scanners reject literals).
const anthropicKey = (c = 'A') => 'sk-' + 'ant-api03-' + c.repeat(40);
const adminKey = () => 'sk-' + 'ant-admin01-' + 'B'.repeat(40);
const geminiKey = () => 'AI' + 'za' + 'C'.repeat(35);
const openRouterKey = () => 'sk-' + 'or-v1-' + 'D'.repeat(40);

const readKeysFile = () => JSON.parse(fs.readFileSync(process.env.KEYS_PATH, 'utf-8'));
const writeKeysFile = (k) => fs.writeFileSync(process.env.KEYS_PATH, JSON.stringify(k, null, 2));
const writeDbFile = (d) => fs.writeFileSync(process.env.DB_PATH, JSON.stringify(d, null, 2));

test('a legacy install loads: profile fields survive, aiProvider is gone, foreign model ids are reset', () => {
  writeDbFile({
    profile: {
      aiProvider: 'gemini',
      selectedModel: 'gemini-1.5-flash',
      aiSearchModel: 'claude-sonnet-4-6',
      fullName: 'Test User',
      baseCv: 'x'.repeat(100)
    }
  });
  const ak = anthropicKey();
  writeKeysFile({ geminiApiKey: geminiKey(), anthropicApiKey: ak, openRouterApiKey: openRouterKey() });

  const profile = helper.getProfile();
  assert.equal(profile.fullName, 'Test User');
  assert.equal(profile.baseCv, 'x'.repeat(100));
  assert.ok(!('aiProvider' in profile));
  assert.equal(profile.selectedModel, '');
  // A legacy Claude ID maps to the same family's current registry ID, never to ''.
  assert.equal(profile.aiSearchModel, MODEL_IDS.sonnet);
  assert.equal(profile.schemaVersion, 2);
  assert.equal(profile.anthropicApiKey, ak);
  assert.ok(!('geminiApiKey' in profile));
  assert.ok(!('openRouterApiKey' in profile));

  // Foreign keys are dropped from disk by the purge.
  assert.deepEqual(helper.purgeLegacyKeys(), { purged: true });
  assert.deepEqual(readKeysFile(), { anthropicApiKey: ak });
});

test('a legacy db.json that still holds keys migrates only the Anthropic key', () => {
  fs.rmSync(process.env.KEYS_PATH, { force: true });
  const ak = anthropicKey('E');
  writeDbFile({
    profile: { aiProvider: 'gemini', fullName: 'Old', geminiApiKey: geminiKey(), anthropicApiKey: ak, openRouterApiKey: openRouterKey() }
  });
  assert.equal(helper.getProfile().anthropicApiKey, ak);
  assert.deepEqual(readKeysFile(), { anthropicApiKey: ak });
});

test('purgeLegacyKeys rewrites keys.json with only the Anthropic key', () => {
  const ak = anthropicKey('F');
  writeKeysFile({ geminiApiKey: geminiKey(), anthropicApiKey: ak, openRouterApiKey: openRouterKey() });
  assert.deepEqual(helper.purgeLegacyKeys(), { purged: true });
  assert.deepEqual(Object.keys(readKeysFile()), ['anthropicApiKey']);
  assert.equal(readKeysFile().anthropicApiKey, ak);
  assert.deepEqual(helper.purgeLegacyKeys(), { purged: false });
});

test('saveProfile stores a normalised key and rejects admin and malformed keys', () => {
  fs.rmSync(process.env.KEYS_PATH, { force: true });
  writeDbFile({ profile: {} });
  const ak = anthropicKey('G');

  helper.saveProfile({ anthropicApiKey: `  ${ak}\n` });
  assert.deepEqual(readKeysFile(), { anthropicApiKey: ak });
  const before = fs.readFileSync(process.env.KEYS_PATH, 'utf-8');

  assert.throws(
    () => helper.saveProfile({ anthropicApiKey: adminKey() }),
    (e) => e instanceof helper.InvalidKeyError && e.code === 'INVALID_KEY' &&
      e.message === 'That is an Admin key. SA-JAS only needs a regular API key — create one in the Anthropic Console and paste it here.'
  );
  assert.equal(fs.readFileSync(process.env.KEYS_PATH, 'utf-8'), before);

  assert.throws(
    () => helper.saveProfile({ anthropicApiKey: 'hello' }),
    (e) => e instanceof helper.InvalidKeyError &&
      e.message === 'That does not look like an Anthropic API key (it should start with sk-ant-api).'
  );
  assert.equal(fs.readFileSync(process.env.KEYS_PATH, 'utf-8'), before);

  // Empty / whitespace keeps the existing key.
  helper.saveProfile({ anthropicApiKey: '' });
  helper.saveProfile({ anthropicApiKey: '   ' });
  assert.equal(readKeysFile().anthropicApiKey, ak);
});

test('clearKey accepts only anthropic', () => {
  writeKeysFile({ anthropicApiKey: anthropicKey('H') });
  assert.equal(helper.clearKey('gemini'), false);
  assert.equal(helper.clearKey('openrouter'), false);
  assert.equal(readKeysFile().anthropicApiKey, anthropicKey('H'));
  assert.equal(helper.clearKey('anthropic'), true);
  assert.deepEqual(readKeysFile(), { anthropicApiKey: '' });
});

test('migrateProfile is idempotent', () => {
  const input = {
    aiProvider: 'gemini',
    selectedModel: 'gemini-1.5-flash',
    aiSearchModel: MODEL_IDS.opus,
    computerUseModel: 'claude-sonnet-4-6',
    computerUseMaxSteps: 999,
    fullName: 'Keep'
  };
  const once = mig.migrateProfile(input);
  assert.ok(!('aiProvider' in once));
  assert.equal(once.selectedModel, '');
  assert.equal(once.aiSearchModel, MODEL_IDS.opus);
  assert.equal(once.computerUseModel, MODEL_IDS.sonnet);
  assert.equal(once.computerUseMaxSteps, 40);
  assert.equal(once.schemaVersion, mig.PROFILE_SCHEMA_VERSION);
  assert.equal(once.fullName, 'Keep');
  assert.deepEqual(mig.migrateProfile(once), once);
  assert.equal('aiProvider' in input, true, 'input is not mutated');
  assert.equal(mig.migrateProfile({ computerUseMaxSteps: 0 }).computerUseMaxSteps, 1);
  assert.deepEqual(mig.LEGACY_PROFILE_FIELDS, ['aiProvider']);
  assert.deepEqual(mig.LEGACY_KEY_FIELDS, ['geminiApiKey', 'openRouterApiKey']);
});

test('legacy Claude model IDs map to the same family; unknown and non-Claude IDs are blanked', () => {
  const m = (v) => mig.migrateProfile({ aiSearchModel: v }).aiSearchModel;
  assert.equal(m('claude-haiku-4-5'), MODEL_IDS.haiku);
  assert.equal(m('claude-3-5-haiku-20241022'), MODEL_IDS.haiku);
  assert.equal(m('claude-sonnet-4-6'), MODEL_IDS.sonnet);
  assert.equal(m('claude-opus-4-8'), MODEL_IDS.opus);
  assert.equal(m('Claude-Fable-2'), MODEL_IDS.fable);
  // A registry ID is kept as is.
  for (const id of Object.values(MODEL_IDS)) assert.equal(m(id), id);
  // No family word, or not a Claude ID at all: blank.
  assert.equal(m('claude-mystery'), '');
  assert.equal(m('gemini-1.5-flash'), '');
  assert.equal(m('gpt-sonnet-fan'), '');
  assert.equal(m(''), '');
  // Non-string values are left untouched (they are not model IDs).
  assert.equal(m(undefined), undefined);
  // Idempotent.
  const once = mig.migrateProfile({ selectedModel: 'claude-opus-4-8', aiSearchModel: 'claude-mystery' });
  assert.deepEqual(mig.migrateProfile(once), once);
});

test('a Token Saver user whose legacy Haiku id was migrated still reads as the Saver preset', () => {
  writeDbFile({ profile: {} });
  fs.rmSync(process.env.KEYS_PATH, { force: true });
  helper.applyPerformancePreset('saver');
  // Simulate the stored value an older release wrote for the same preset.
  const db = JSON.parse(fs.readFileSync(process.env.DB_PATH, 'utf-8'));
  db.profile.aiSearchModel = 'claude-haiku-4-' + '5';
  db.profile.schemaVersion = 1;
  writeDbFile(db);
  const profile = helper.getProfile();
  assert.equal(profile.aiSearchModel, MODEL_IDS.haiku);
  assert.equal(helper.detectActivePreset(profile), 'saver');
});

test('a plaintext key left in db.json is stripped once keys.json holds a key', () => {
  const stored = anthropicKey('K');
  const stale = anthropicKey('L');
  writeKeysFile({ anthropicApiKey: stored });
  writeDbFile({ profile: { fullName: 'Keep', anthropicApiKey: stale } });

  // Reads never expose the stale db.json copy: keys.json wins.
  assert.equal(helper.getProfile().anthropicApiKey, stored);
  assert.equal(helper.readDb().profile.anthropicApiKey, undefined);

  // Any write rewrites db.json without it.
  helper.saveProfile({ fullName: 'Keep' });
  const onDisk = fs.readFileSync(process.env.DB_PATH, 'utf-8');
  assert.ok(!onDisk.includes('anthropicApiKey'), 'db.json holds no anthropicApiKey');
  assert.ok(!onDisk.includes(stale));
  assert.equal(readKeysFile().anthropicApiKey, stored);

  // writeDb of a db read earlier cannot reintroduce one either.
  const db = helper.readDb();
  db.profile.anthropicApiKey = stale;
  helper.writeDb(db);
  assert.ok(!fs.readFileSync(process.env.DB_PATH, 'utf-8').includes('anthropicApiKey'));
});
