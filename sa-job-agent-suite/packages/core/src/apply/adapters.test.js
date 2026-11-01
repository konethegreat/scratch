import test from 'node:test';
import assert from 'node:assert/strict';
import { adapterForHost, adapters } from './adapters.js';

test('known hosts get their adapter and everything else is generic', () => {
  assert.equal(adapterForHost('boards.greenhouse.io').id, 'greenhouse');
  assert.equal(adapterForHost('job-boards.greenhouse.io').id, 'greenhouse');
  assert.equal(adapterForHost('boards.greenhouse.io.').id, 'greenhouse');
  assert.equal(adapterForHost('jobs.lever.co').id, 'lever');
  assert.equal(adapterForHost('careers.example.test').id, 'generic');
  assert.equal(adapterForHost('').id, 'generic');
  assert.equal(adapterForHost(undefined).id, 'generic');
});

test('every adapter names a submit control and a success signal', () => {
  for (const adapter of adapters) {
    assert.ok(adapter.submitSelectors.length > 0, `${adapter.id} has no submit selector`);
    assert.ok(adapter.successText instanceof RegExp, `${adapter.id} has no success text`);
    assert.ok(adapter.priority.length > 0, `${adapter.id} has no priority`);
  }
  assert.ok(adapterForHost('boards.greenhouse.io').submitSelectors.includes('#submit_app'));
  assert.ok(adapterForHost('jobs.lever.co').submitSelectors.some((selector) => selector.includes('submit')));
  assert.equal(adapterForHost('localhost').hosts.length, 0);
});
