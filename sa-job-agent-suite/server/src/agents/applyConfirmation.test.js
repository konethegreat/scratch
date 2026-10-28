import test from 'node:test';
import assert from 'node:assert/strict';
import { createPendingConfirmation, confirmationDecision, pageOrigin, CONFIRM_TTL_MS } from './applyConfirmation.js';

const job = { id: 'job-1', title: 'Developer', company: 'Example' };
const control = { index: 3, text: 'Submit application' };
const now = Date.parse('2026-10-28T10:00:00.000Z');

function pending() {
  return createPendingConfirmation({
    job,
    pageUrl: 'https://jobs.example.co.za/apply/review',
    control,
    fieldsFilled: 7,
    fileNames: ['cv.pdf'],
    now,
    nonce: 'nonce-1'
  });
}

test('a pending confirmation names the job, site and counts but no field values', () => {
  const entry = pending();
  assert.equal(entry.jobTitle, 'Developer');
  assert.equal(entry.company, 'Example');
  assert.equal(entry.site, 'https://jobs.example.co.za');
  assert.equal(entry.controlText, 'Submit application');
  assert.equal(entry.controlIndex, 3);
  assert.equal(entry.fieldsFilled, 7);
  assert.deepEqual(entry.documents, ['cv.pdf']);
  assert.equal(entry.expiresAt, new Date(now + CONFIRM_TTL_MS).toISOString());
  assert.equal(JSON.stringify(entry).includes('Thandi'), false);
});

test('only a matching nonce may approve or cancel', () => {
  const entry = { ...pending(), status: 'pending' };
  assert.equal(confirmationDecision(entry, { nonce: 'other' }, now).action, 'ignore');
  assert.equal(confirmationDecision(entry, { nonce: 'nonce-1' }, now).action, 'approve');
  assert.equal(confirmationDecision(entry, { nonce: 'nonce-1', cancel: true }, now).action, 'cancel');
  assert.equal(confirmationDecision(entry, { nonce: 'nonce-1' }, now + CONFIRM_TTL_MS + 1).action, 'expired');
  assert.equal(confirmationDecision({ ...entry, status: 'approved' }, { nonce: 'nonce-1' }, now).action, 'ignore');
  assert.equal(confirmationDecision(null, { nonce: 'nonce-1' }, now).action, 'ignore');
});

test('pageOrigin survives malformed URLs by returning an empty origin', () => {
  assert.equal(pageOrigin('https://jobs.example.co.za/a'), 'https://jobs.example.co.za');
  assert.equal(pageOrigin(''), '');
  assert.equal(pageOrigin('not a url'), '');
});
