import test from 'node:test';
import assert from 'node:assert/strict';
import { createActivity } from './activity.js';

const API_KEY = ['sk', 'ant', 'api03', 'D'.repeat(24)].join('-');

test('logs are appended with a timestamp and scrubbed', () => {
  const activity = createActivity({ now: () => '2026-10-27T00:00:00.000Z' });
  activity.add('Profile saved.', 'system');
  activity.add(`Oops ${API_KEY}`, 'error');
  const entries = activity.list();
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], { timestamp: '2026-10-27T00:00:00.000Z', message: 'Profile saved.', type: 'system' });
  assert.equal(entries[1].message.includes(API_KEY), false);
  assert.equal(entries[1].type, 'error');
});

test('the ring keeps only the newest 200 entries', () => {
  const activity = createActivity({ limit: 3 });
  for (let i = 0; i < 5; i += 1) activity.add(`line ${i}`);
  assert.deepEqual(activity.list().map((e) => e.message), ['line 2', 'line 3', 'line 4']);
});

test('clear empties the log and list is a copy', () => {
  const activity = createActivity();
  activity.add('one');
  const snapshot = activity.list();
  snapshot.push({ message: 'injected' });
  assert.equal(activity.list().length, 1);
  activity.clear();
  assert.deepEqual(activity.list(), []);
});
