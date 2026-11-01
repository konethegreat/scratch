import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyProfileV2, migrateProfile, hasEmploymentEquity, PROFILE_VERSION } from './profile.js';

test('a v1 profile gains every v2 field and keeps its existing values', () => {
  const legacy = {
    fullName: 'Thandi Mokoena',
    email: 'thandi@example.test',
    keywords: 'developer',
    linkedInUrl: 'linkedin.com/in/thandi',
    portfolioUrl: 'javascript:alert(1)',
    applicationProfile: { noticePeriod: '30 days' },
    unknownFutureKey: { kept: true }
  };
  const profile = migrateProfile(legacy);
  assert.equal(PROFILE_VERSION, 2);
  assert.equal(profile.v, 2);
  assert.equal(profile.fullName, 'Thandi Mokoena');
  assert.equal(profile.keywords, 'developer');
  assert.deepEqual(profile.applicationProfile, { noticePeriod: '30 days' });
  assert.deepEqual(profile.unknownFutureKey, { kept: true });
  assert.equal(profile.linkedInUrl, 'https://linkedin.com/in/thandi');
  assert.equal(profile.portfolioUrl, '');
  assert.deepEqual(profile.address, emptyProfileV2().address);
  assert.deepEqual(profile.salary, emptyProfileV2().salary);
  assert.deepEqual(profile.workHistory, []);
  assert.equal(profile.headline, '');
  assert.equal(profile.yearsExperience, null);
});

test('migration is idempotent and returns the same record once it is v2', () => {
  const first = migrateProfile({ fullName: 'Thandi' });
  assert.equal(migrateProfile(first), first);
});

test('malformed legacy values are replaced instead of throwing', () => {
  const profile = migrateProfile({
    fullName: 42,
    address: 'Cape Town',
    salary: { currentAmount: 'lots' },
    workHistory: ['not a record'],
    skills: ['JavaScript', 7, null],
    preferences: { roles: 'engineer', remote: 'sometimes' },
    v: 1
  });
  assert.equal(profile.fullName, '');
  assert.equal(profile.address.city, '');
  assert.equal(profile.salary.currentAmount, null);
  assert.deepEqual(profile.workHistory, []);
  assert.deepEqual(profile.skills, ['JavaScript']);
  assert.deepEqual(profile.preferences.roles, []);
  assert.equal(profile.preferences.remote, '');
});

test('employment equity is opted in only when a legacy profile already holds an answer', () => {
  assert.equal(hasEmploymentEquity({ applicationProfile: { eeRace: 'African' } }), true);
  assert.equal(hasEmploymentEquity({ applicationProfile: { gender: 'Female' } }), true);
  assert.equal(hasEmploymentEquity({ applicationProfile: { disability: 'No' } }), true);
  assert.equal(hasEmploymentEquity({ applicationProfile: { eeRace: '   ' } }), false);
  assert.equal(hasEmploymentEquity({}), false);
  const migrated = migrateProfile({ applicationProfile: { eeRace: 'African' } });
  assert.equal(migrated.eeOptIn, true);
  assert.equal(migrateProfile({ applicationProfile: {} }).eeOptIn, false);
});
