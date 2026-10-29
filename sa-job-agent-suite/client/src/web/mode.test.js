import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SERVER_ONLY_TABS,
  SERVER_ONLY_SETTINGS,
  WEB_ONLY_TABS,
  isTabVisible,
  filterSettingsTabs
} from './mode.js';

test('server-only tabs are visible on desktop', () => {
  for (const tab of SERVER_ONLY_TABS) assert.equal(isTabVisible(tab, false), true);
});

test('server-only tabs are hidden in web mode', () => {
  for (const tab of SERVER_ONLY_TABS) assert.equal(isTabVisible(tab, true), false);
});

test('core tabs stay visible in web mode', () => {
  for (const tab of ['landing', 'dashboard', 'hunter', 'tailor', 'memory', 'profile']) {
    assert.equal(isTabVisible(tab, true), true, tab);
  }
});

test('web settings hide answers and data, desktop keeps them', () => {
  const tabs = ['ai', 'profile', 'search', 'answers', 'data'].map((id) => ({ id }));
  assert.deepEqual(filterSettingsTabs(tabs, true).map((t) => t.id), ['ai', 'profile', 'search']);
  assert.deepEqual(filterSettingsTabs(tabs, false).map((t) => t.id), ['ai', 'profile', 'search', 'answers', 'data']);
});

test('the backup tab is hidden on desktop and shown on web', () => {
  const tabs = [{ id: 'ai' }, { id: 'data' }, { id: 'backup' }];
  assert.deepEqual(filterSettingsTabs(tabs, false).map((tab) => tab.id), ['ai', 'data']);
  assert.deepEqual(filterSettingsTabs(tabs, true).map((tab) => tab.id), ['ai', 'backup']);
});

test('server-only settings are a known subset', () => {
  for (const id of SERVER_ONLY_SETTINGS) {
    assert.ok(['answers', 'data'].includes(id), id);
  }
});

test('the apply tab is web-only', () => {
  assert.deepEqual([...WEB_ONLY_TABS], ['apply']);
  assert.equal(isTabVisible('apply', true), true);
  assert.equal(isTabVisible('apply', false), false);
});

test('demo shows copilot and logs, hides referrals, routines and backup', () => {
  for (const tab of ['copilot', 'logs', 'apply', 'dashboard', 'tailor', 'ask']) {
    assert.equal(isTabVisible(tab, true, true), true, tab);
  }
  for (const tab of ['referrals', 'routines']) {
    assert.equal(isTabVisible(tab, true, true), false, tab);
  }
  const tabs = [{ id: 'ai' }, { id: 'answers' }, { id: 'data' }, { id: 'backup' }];
  assert.deepEqual(filterSettingsTabs(tabs, true, true).map((tab) => tab.id), ['ai']);
});
