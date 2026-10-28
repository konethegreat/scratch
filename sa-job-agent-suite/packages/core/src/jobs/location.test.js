import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROVINCES, classifyLocation, isSouthAfrican, jobLocationVerdict,
  jobProvince, jobRemote, countForeignJobs
} from './location.js';

const verdict = (raw) => classifyLocation(raw).verdict;

test('PROVINCES lists the nine provinces', () => {
  assert.equal(PROVINCES.length, 9);
  assert.ok(PROVINCES.includes('Gauteng'));
  assert.ok(PROVINCES.includes('North West'));
});

test('blank and malformed input is unknown and never throws', () => {
  for (const raw of ['', '   ', null, undefined, 42, {}, []]) {
    assert.equal(verdict(raw), 'unknown');
  }
  assert.equal(classifyLocation('').reason, 'blank');
});

test('South Africa country signals win outright', () => {
  assert.equal(verdict('South Africa'), 'sa');
  assert.equal(classifyLocation('South Africa').reason, 'country');
  assert.equal(verdict('south african'), 'sa');
  assert.equal(verdict('RSA'), 'sa');
  assert.equal(verdict('Cape Town, ZA'), 'sa');
  assert.equal(verdict('Remote, SA'), 'sa');
  assert.equal(verdict('Johannesburg or London'), 'sa');
  assert.equal(verdict('Gauteng, London'), 'sa');
});

test('unique provinces and their cities classify as SA', () => {
  assert.equal(verdict('Gauteng'), 'sa');
  assert.equal(verdict('Western Cape'), 'sa');
  assert.equal(verdict('KwaZulu-Natal'), 'sa');
  assert.equal(verdict('KZN'), 'sa');
  assert.equal(verdict('Free State'), 'sa');
  assert.equal(verdict('Limpopo'), 'sa');
  assert.equal(verdict('Mpumalanga'), 'sa');
  assert.equal(verdict('Northern Cape'), 'sa');
  assert.equal(verdict('Eastern Cape'), 'sa');
  for (const city of ['Johannesburg', 'Cape Town', 'Durban', 'Pretoria', 'Gqeberha',
    'Bloemfontein', 'Polokwane', 'Mbombela', 'Nelspruit', 'Port Elizabeth',
    'Pietermaritzburg', 'Rustenburg', 'Potchefstroom', 'Soweto', 'Sandton',
    'Midrand', 'Centurion', 'Stellenbosch', 'Paarl', 'Welkom', 'Mthatha',
    'Thohoyandou', 'Vereeniging', 'Vanderbijlpark', 'Alberton', 'Benoni',
    'Boksburg', 'Germiston', 'Randburg', 'Roodepoort', 'Tembisa', 'Edenvale',
    'Kempton Park']) {
    assert.equal(verdict(city), 'sa', city);
  }
  assert.equal(classifyLocation('Cape Town').province, 'Western Cape');
  assert.equal(classifyLocation('Cape Town').place, 'Cape Town');
});

test('a strong foreign signal beats a unique SA city', () => {
  assert.equal(verdict('East London, UK'), 'foreign');
  assert.equal(verdict('Durban, France'), 'foreign');
  assert.equal(verdict('Cape Town, US'), 'foreign');
  assert.equal(verdict('Johannesburg, United States'), 'foreign');
});

test('a unique SA city beats a foreign city', () => {
  assert.equal(verdict('East London'), 'sa');
  assert.equal(verdict('East London, Eastern Cape'), 'sa');
  assert.equal(verdict('Cape Town, London'), 'sa');
});

test('foreign countries, regions, states and cities are foreign', () => {
  for (const raw of ['London', 'Berlin', 'Lagos', 'Dubai', 'New York', 'Paris',
    'Nairobi, Kenya', 'Mumbai', 'Manila', 'Toronto', 'Sydney', 'Austin',
    'Remote - Europe', 'EMEA', 'APAC', 'California', 'Texas', 'Virginia',
    'British Columbia', 'New South Wales', 'Georgia', 'Washington']) {
    assert.equal(verdict(raw), 'foreign', raw);
  }
  assert.equal(verdict('US'), 'foreign');
  assert.equal(verdict('Lagos, Nigeria'), 'foreign');
});

test('ambiguous SA names are SA without a foreign signal and foreign with one', () => {
  for (const name of ['Springs', 'George', 'Worcester', 'Kimberley', 'Middelburg',
    'Queenstown', 'Newcastle', 'Ladysmith', 'Richmond', 'Phoenix', 'Wellington',
    'Bethlehem', 'Heidelberg', 'North West']) {
    assert.equal(verdict(name), 'sa', name);
  }
  assert.equal(classifyLocation('Springs').reason, 'ambiguous');
  assert.equal(verdict('Springs, Gauteng'), 'sa');
  assert.equal(verdict('North West'), 'sa');
  for (const raw of ['Springs, California', 'Palm Springs', 'Richmond, Virginia',
    'Phoenix, Arizona', 'Newcastle, Australia', 'Queenstown, New Zealand',
    'Wellington, New Zealand', 'Worcester, UK', 'Kimberley, British Columbia',
    'Middelburg, Netherlands', 'George, Washington', 'Heidelberg, Germany',
    'Bethlehem, Pennsylvania', 'Ladysmith, British Columbia',
    'North West England']) {
    assert.equal(verdict(raw), 'foreign', raw);
  }
});

test('worldwide is foreign and bare remote is unknown', () => {
  assert.equal(verdict('Remote (Worldwide)'), 'foreign');
  assert.equal(classifyLocation('Remote (Worldwide)').reason, 'worldwide');
  assert.equal(verdict('Anywhere'), 'foreign');
  assert.equal(verdict('Global'), 'foreign');
  assert.equal(verdict('Remote'), 'unknown');
  assert.equal(classifyLocation('Remote').reason, 'remote-unstated');
  assert.equal(verdict('Hybrid'), 'unknown');
  assert.equal(verdict('Work from home'), 'unknown');
});

test('token matching never fires inside an unrelated word', () => {
  assert.equal(verdict('Business Analyst'), 'unknown');
  assert.equal(verdict('Customer Success'), 'unknown');
  assert.equal(verdict('Auditor'), 'unknown');
  assert.equal(classifyLocation('Business Analyst').reason, 'unrecognised');
});

test('remote is reported independently of the verdict', () => {
  assert.equal(classifyLocation('Remote (Worldwide)').remote, true);
  assert.equal(classifyLocation('Cape Town, remote').remote, true);
  assert.equal(classifyLocation('Cape Town').remote, false);
});

test('isSouthAfrican applies strict and lenient policy', () => {
  assert.equal(isSouthAfrican('Cape Town'), true);
  assert.equal(isSouthAfrican('Cape Town', { strict: true }), true);
  assert.equal(isSouthAfrican('Somewhereville'), true);
  assert.equal(isSouthAfrican('Somewhereville', { strict: true }), false);
  assert.equal(isSouthAfrican('London'), false);
  assert.equal(isSouthAfrican('London', { strict: true }), false);
});

test('job helpers trust stored fields and classify when absent', () => {
  assert.equal(jobLocationVerdict({ location: 'Cape Town' }), 'sa');
  assert.equal(jobLocationVerdict({ locationVerdict: 'foreign', location: 'Cape Town' }), 'foreign');
  assert.equal(jobLocationVerdict({ locationVerdict: 'bogus', location: 'Cape Town' }), 'sa');
  assert.equal(jobProvince({ province: 'Gauteng', location: 'London' }), 'Gauteng');
  assert.equal(jobProvince({ location: 'Durban' }), 'KwaZulu-Natal');
  assert.equal(jobRemote({ remote: true, location: 'Cape Town' }), true);
  assert.equal(jobRemote({ location: 'Remote' }), true);
  assert.equal(countForeignJobs([
    { location: 'Cape Town' }, { location: 'London' }, { location: 'Remote' }, { location: 'Berlin' }
  ]), 2);
});
