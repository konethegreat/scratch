import test from 'node:test';
import assert from 'node:assert/strict';
import { describeRejected, gateJobsByLocation } from './jobLocationGate.js';

const job = (location, over = {}) => ({ title: 'Engineer', company: 'Acme', location, ...over });

test('every policy rejects a foreign location', () => {
  for (const mode of ['strict', 'soft', 'none']) {
    const { kept, rejected } = gateJobsByLocation([job('London, UK')], mode);
    assert.equal(kept.length, 0, mode);
    assert.equal(rejected.length, 1, mode);
    assert.equal(rejected[0].locationVerdict, 'foreign', mode);
  }
});

test('strict rejects an unknown location and labels it', () => {
  const { kept, rejected } = gateJobsByLocation([job('Somewhereville')], 'strict');
  assert.equal(kept.length, 0);
  assert.equal(rejected[0].locationVerdict, 'unknown');
});

test('soft and none keep unknown locations and label them', () => {
  for (const mode of ['soft', 'none']) {
    const { kept } = gateJobsByLocation([job('Somewhereville')], mode);
    assert.equal(kept.length, 1, mode);
    assert.equal(kept[0].locationVerdict, 'unknown', mode);
  }
});

test('SA jobs pass every policy with a province when known', () => {
  for (const mode of ['strict', 'soft', 'none']) {
    const { kept } = gateJobsByLocation([job('Cape Town')], mode);
    assert.equal(kept.length, 1, mode);
    assert.equal(kept[0].locationVerdict, 'sa', mode);
    assert.equal(kept[0].province, 'Western Cape', mode);
  }
});

test('the gate does not mutate the input', () => {
  const input = job('Cape Town');
  gateJobsByLocation([input], 'strict');
  assert.equal('locationVerdict' in input, false);
});

test('an omitted or unknown policy behaves like soft', () => {
  assert.equal(gateJobsByLocation([job('Somewhereville')], undefined).kept.length, 1);
  assert.equal(gateJobsByLocation([job('Somewhereville')], 'weird').kept.length, 1);
});

test('the rejection summary separates foreign from unconfirmed', () => {
  const { rejected } = gateJobsByLocation(
    [job('London, UK'), job('Somewhereville'), job('Nowhere Co')],
    'strict'
  );
  assert.equal(describeRejected(rejected), '1 outside South Africa and 2 with an unconfirmed location');
  assert.equal(describeRejected([rejected[0]]), '1 outside South Africa');
  assert.equal(describeRejected([]), '');
});
