import test from 'node:test';
import assert from 'node:assert/strict';
import {
  QUESTION_VOCABULARY,
  QUESTION_KEYS,
  questionKey,
  questionLabel,
  questionOptions,
  isSensitiveQuestion
} from './questions.js';

test('the vocabulary has one unique, labelled entry per question', () => {
  const keys = QUESTION_VOCABULARY.map((entry) => entry.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.deepEqual(QUESTION_KEYS, keys);
  for (const entry of QUESTION_VOCABULARY) {
    assert.ok(entry.label && entry.label.length <= 120, entry.key);
    assert.ok(Array.isArray(entry.aliases) && entry.aliases.length > 0, entry.key);
  }
});

test('real form labels map to the same canonical question', () => {
  const cases = [
    ['Notice period (in days)', 'noticePeriod'],
    ['Do you have a valid driver\'s licence?', 'driversLicense'],
    ['Highest level of education', 'highestQualification'],
    ['Are you willing to relocate?', 'willingToRelocate'],
    ['SA citizen or permanent resident', 'rightToWorkSA'],
    ['Expected salary per annum', 'expectedSalary'],
    ['Current cost to company', 'currentSalary'],
    ['Languages spoken', 'languages'],
    ['When can you start?', 'availabilityDate'],
    ['Please indicate your population group', 'eeRace'],
    ['Do you own a vehicle?', 'ownVehicle'],
    ['Years of relevant experience', 'yearsExperience']
  ];
  for (const [label, key] of cases) {
    assert.equal(questionKey(label), key, label);
  }
});

test('inverted, unrelated and ambiguous labels are refused', () => {
  const labels = [
    'Company name',
    'Name of previous employer',
    'Do you require visa sponsorship?',
    'Preferred pronouns',
    'Current salary expectation',
    'Have you ever been dismissed for misconduct?'
  ];
  for (const label of labels) {
    assert.equal(questionKey(label), null, label);
  }
});

test('the vocabulary carries the reviewed options and sensitivity marks', () => {
  assert.deepEqual(questionOptions('rightToWorkSA'), ['Yes', 'No']);
  assert.deepEqual(questionOptions('driversLicense'), ['None', 'Code A', 'Code B', 'Code C', 'Code EB', 'Other']);
  assert.deepEqual(questionOptions('noticePeriod'), []);
  assert.equal(questionLabel('expectedSalary'), 'Expected salary');
  assert.equal(isSensitiveQuestion('expectedSalary'), true);
  assert.equal(isSensitiveQuestion('noticePeriod'), false);
});
