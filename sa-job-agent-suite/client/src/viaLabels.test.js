import test from 'node:test';
import assert from 'node:assert/strict';
import { viaLabel } from './viaLabels.js';

test('known extraction strategies get plain labels', () => {
  assert.equal(viaLabel('structured'), 'structured data');
  assert.equal(viaLabel('dom'), 'page layout');
  assert.equal(viaLabel('semantic'), 'semantic layout');
  assert.equal(viaLabel('ai'), 'AI assist');
  assert.equal(viaLabel('mixed'), 'mixed');
  assert.equal(viaLabel('none'), 'none');
});

test('old run values still read well', () => {
  assert.equal(viaLabel('css'), 'page layout');
  assert.equal(viaLabel('jsonld'), 'structured data');
  assert.equal(viaLabel('ai-extract'), 'AI assist');
});

test('unknown and empty values pass through unchanged', () => {
  assert.equal(viaLabel('custom'), 'custom');
  assert.equal(viaLabel(''), '');
  assert.equal(viaLabel(null), '');
});
