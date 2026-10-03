import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyControl, mayClick, isRefusedForModel } from './submitGuard.js';

// [label, class on a listing / landing page, class on a form page]
const TABLE = [
  // step-forward words: advance everywhere
  ['Next', 'advance', 'advance'],
  ['Next step', 'advance', 'advance'],
  ['Continue', 'advance', 'advance'],
  ['Save and continue', 'advance', 'advance'],
  ['Proceed', 'advance', 'advance'],
  // reaching the application: advance on listings only
  ['Apply', 'advance', 'other'],
  ['Apply now', 'advance', 'other'],
  ['Apply for this job', 'advance', 'other'],
  ['Apply on company website', 'advance', 'other'],
  ["I'm interested", 'advance', 'other'],
  ['View & apply', 'advance', 'other'],
  // anything that reads like a final submit: never, on any page
  ['Submit', 'final-submit', 'final-submit'],
  ['Submit application', 'final-submit', 'final-submit'],
  ['Send application', 'final-submit', 'final-submit'],
  ['Send my application', 'final-submit', 'final-submit'],
  ['Send', 'final-submit', 'final-submit'],
  ['Apply and send CV', 'final-submit', 'final-submit'],
  ['Finish', 'final-submit', 'final-submit'],
  ['Complete application', 'final-submit', 'final-submit'],
  ['Complete your application', 'final-submit', 'final-submit'],
  ['Confirm', 'final-submit', 'final-submit'],
  ['Confirm and submit', 'final-submit', 'final-submit'],
  ['Pay now', 'final-submit', 'final-submit'],
  ['Checkout', 'final-submit', 'final-submit'],
  ['Place order', 'final-submit', 'final-submit'],
  ['Sign and submit', 'final-submit', 'final-submit'],
  ['Accept and continue', 'final-submit', 'final-submit'],
  ['Agree and continue', 'final-submit', 'final-submit'],
  ['Next - submit your application', 'final-submit', 'final-submit'],
  // account actions: not the copilot's call either
  ['Sign in', 'account', 'account'],
  ['Log in', 'account', 'account'],
  ['Create account', 'account', 'account'],
  ['Create an account', 'account', 'account'],
  ['Continue with Google', 'account', 'account'],
  ['Continue as Thandi', 'account', 'account'],
  // unrelated controls
  ['Save job', 'other', 'other'],
  ['Back', 'other', 'other'],
  ['Cancel', 'other', 'other'],
  ['', 'other', 'other'],
  ['A very long label that goes on and on well past forty characters Apply', 'other', 'other']
];

test('classifyControl: every label lands in the right class on listing pages and on form pages', () => {
  for (const [label, listing, form] of TABLE) {
    assert.equal(classifyControl(label), listing, `"${label}" on a listing page`);
    assert.equal(classifyControl(label, { onFormPage: true }), form, `"${label}" on a form page`);
  }
});

test('classifyControl ignores case and stray whitespace', () => {
  assert.equal(classifyControl('  SUBMIT\n APPLICATION '), 'final-submit');
  assert.equal(classifyControl('\tnext\n'), 'advance');
  assert.equal(classifyControl(null), 'other');
  assert.equal(classifyControl(undefined, { onFormPage: true }), 'other');
});

test('a long label that reads like a submit is still refused; a long harmless label is just not advanced', () => {
  const long = 'Review everything one last time and then submit your application to the employer';
  assert.ok(long.length > 40);
  assert.equal(classifyControl(long), 'final-submit');
  assert.equal(classifyControl(long, { onFormPage: true }), 'final-submit');
  assert.equal(mayClick(long, { planned: true }), false);
  assert.equal(classifyControl('Senior software developer at Example Pty Ltd in Johannesburg, hybrid'), 'other');
  assert.equal(mayClick('Senior software developer at Example Pty Ltd in Johannesburg, hybrid', { planned: true }), true);
});
test('a bare Apply is clicked on a listing page and never on a form page', () => {
  assert.equal(mayClick('Apply'), true);
  assert.equal(mayClick('Apply', { onFormPage: true }), false);
  assert.equal(mayClick('Next', { onFormPage: true }), true);
});

test('the planner may pick a non-submit control by name off form pages, but is held to step-forward words on a form', () => {
  assert.equal(mayClick('View job details', { planned: true }), true);
  assert.equal(mayClick('View job details', { planned: true, onFormPage: true }), false);
  assert.equal(mayClick('Submit application', { planned: true }), false);
  assert.equal(mayClick('Sign in', { planned: true }), false);
  assert.equal(mayClick('Continue', { planned: true, onFormPage: true }), true);
});

test('isRefusedForModel: submits, account actions and the apply family are refused; form widgets and step-forward are not', () => {
  for (const label of ['Submit application', 'Send', 'Apply', 'Apply now', "I'm interested", 'Sign in', 'Continue with Google', 'Pay', 'Complete application']) {
    assert.equal(isRefusedForModel(label), true, label);
  }
  for (const label of ['Next', 'Continue', 'Add another', 'Choose date', 'Upload file', 'Select', 'Open calendar', '']) {
    assert.equal(isRefusedForModel(label), false, label);
  }
});