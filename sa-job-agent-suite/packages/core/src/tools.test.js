import test from 'node:test';
import assert from 'node:assert/strict';
import { webSearchTool, WEB_SEARCH_TOOL_TYPE } from './tools.js';

test('webSearchTool builds the 20260209 tool with ZA location and max_uses', () => {
  const t = webSearchTool({ maxUses: 5 });
  assert.equal(WEB_SEARCH_TOOL_TYPE, 'web_search_20260209');
  assert.equal(t.type, 'web_search_20260209');
  assert.equal(t.name, 'web_search');
  assert.equal(t.max_uses, 5);
  assert.deepEqual(t.user_location, { type: 'approximate', country: 'ZA', timezone: 'Africa/Johannesburg' });
});

test('webSearchTool omits max_uses when not given and honours overrides', () => {
  const t = webSearchTool({ country: 'GB', timezone: 'Europe/London' });
  assert.equal('max_uses' in t, false);
  assert.equal(t.user_location.country, 'GB');
});
