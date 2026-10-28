// South Africa location classification for the hunter, the feeds and both job
// views. Pure and total: it never throws and it never touches the network.
import { normalizeText } from '../text.js';

export const PROVINCES = Object.freeze([
  'Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal', 'Limpopo',
  'Mpumalanga', 'Northern Cape', 'North West', 'Western Cape'
]);

const SA_COUNTRY_TERMS = Object.freeze(['south africa', 'south african', 'rsa']);

const UNIQUE_PROVINCES = Object.freeze([
  ['gauteng', 'Gauteng'],
  ['western cape', 'Western Cape'],
  ['eastern cape', 'Eastern Cape'],
  ['kwazulu natal', 'KwaZulu-Natal'],
  ['kzn', 'KwaZulu-Natal'],
  ['free state', 'Free State'],
  ['limpopo', 'Limpopo'],
  ['mpumalanga', 'Mpumalanga'],
  ['northern cape', 'Northern Cape']
]);

const AMBIGUOUS_PROVINCES = Object.freeze([
  ['north west', 'North West']
]);

const UNIQUE_CITIES = Object.freeze([
  ['johannesburg', 'Johannesburg', 'Gauteng'],
  ['sandton', 'Sandton', 'Gauteng'],
  ['midrand', 'Midrand', 'Gauteng'],
  ['centurion', 'Centurion', 'Gauteng'],
  ['soweto', 'Soweto', 'Gauteng'],
  ['roodepoort', 'Roodepoort', 'Gauteng'],
  ['boksburg', 'Boksburg', 'Gauteng'],
  ['germiston', 'Germiston', 'Gauteng'],
  ['benoni', 'Benoni', 'Gauteng'],
  ['randburg', 'Randburg', 'Gauteng'],
  ['tembisa', 'Tembisa', 'Gauteng'],
  ['edenvale', 'Edenvale', 'Gauteng'],
  ['kempton park', 'Kempton Park', 'Gauteng'],
  ['pretoria', 'Pretoria', 'Gauteng'],
  ['vereeniging', 'Vereeniging', 'Gauteng'],
  ['vanderbijlpark', 'Vanderbijlpark', 'Gauteng'],
  ['alberton', 'Alberton', 'Gauteng'],
  ['cape town', 'Cape Town', 'Western Cape'],
  ['stellenbosch', 'Stellenbosch', 'Western Cape'],
  ['paarl', 'Paarl', 'Western Cape'],
  ['durban', 'Durban', 'KwaZulu-Natal'],
  ['pietermaritzburg', 'Pietermaritzburg', 'KwaZulu-Natal'],
  ['port elizabeth', 'Port Elizabeth', 'Eastern Cape'],
  ['gqeberha', 'Gqeberha', 'Eastern Cape'],
  ['east london', 'East London', 'Eastern Cape'],
  ['mthatha', 'Mthatha', 'Eastern Cape'],
  ['bloemfontein', 'Bloemfontein', 'Free State'],
  ['welkom', 'Welkom', 'Free State'],
  ['polokwane', 'Polokwane', 'Limpopo'],
  ['thohoyandou', 'Thohoyandou', 'Limpopo'],
  ['nelspruit', 'Nelspruit', 'Mpumalanga'],
  ['mbombela', 'Mbombela', 'Mpumalanga'],
  ['rustenburg', 'Rustenburg', 'North West'],
  ['potchefstroom', 'Potchefstroom', 'North West']
]);

// Real SA places whose names are also well-known places elsewhere. They are
// checked only after every foreign signal, so "Richmond, Virginia" is foreign
// while bare "Richmond" is SA.
const AMBIGUOUS_CITIES = Object.freeze([
  ['springs', 'Springs', 'Gauteng'],
  ['george', 'George', 'Western Cape'],
  ['worcester', 'Worcester', 'Western Cape'],
  ['kimberley', 'Kimberley', 'Northern Cape'],
  ['middelburg', 'Middelburg', 'Mpumalanga'],
  ['queenstown', 'Queenstown', 'Eastern Cape'],
  ['newcastle', 'Newcastle', 'KwaZulu-Natal'],
  ['ladysmith', 'Ladysmith', 'KwaZulu-Natal'],
  ['richmond', 'Richmond', 'KwaZulu-Natal'],
  ['phoenix', 'Phoenix', 'KwaZulu-Natal'],
  ['wellington', 'Wellington', 'Western Cape'],
  ['bethlehem', 'Bethlehem', 'Free State'],
  ['heidelberg', 'Heidelberg', 'Gauteng']
]);

const FOREIGN_STRONG = Object.freeze([
  'united states', 'usa', 'america', 'united kingdom', 'uk', 'england',
  'scotland', 'wales', 'northern ireland', 'ireland', 'canada', 'australia',
  'new zealand', 'germany', 'france', 'netherlands', 'belgium', 'spain',
  'portugal', 'italy', 'switzerland', 'austria', 'poland', 'sweden', 'norway',
  'denmark', 'finland', 'india', 'pakistan', 'bangladesh', 'sri lanka', 'china',
  'japan', 'south korea', 'korea', 'singapore', 'malaysia', 'indonesia',
  'philippines', 'vietnam', 'thailand', 'nigeria', 'kenya', 'ghana', 'egypt',
  'morocco', 'tunisia', 'zimbabwe', 'zambia', 'botswana', 'namibia',
  'mozambique', 'mauritius', 'uganda', 'tanzania', 'rwanda', 'ethiopia',
  'senegal', 'cameroon', 'brazil', 'argentina', 'chile', 'colombia', 'peru',
  'mexico', 'israel', 'turkey', 'saudi arabia', 'qatar', 'kuwait', 'bahrain',
  'oman', 'united arab emirates', 'uae', 'europe', 'emea', 'apac', 'asia',
  'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado',
  'connecticut', 'delaware', 'florida', 'hawaii', 'idaho', 'illinois',
  'indiana', 'iowa', 'kansas', 'kentucky', 'louisiana', 'maine', 'maryland',
  'massachusetts', 'michigan', 'minnesota', 'mississippi', 'missouri',
  'montana', 'nebraska', 'nevada', 'new hampshire', 'new jersey', 'new mexico',
  'new york', 'north carolina', 'north dakota', 'ohio', 'oklahoma', 'oregon',
  'pennsylvania', 'rhode island', 'south carolina', 'south dakota', 'tennessee',
  'texas', 'utah', 'vermont', 'virginia', 'washington', 'west virginia',
  'wisconsin', 'wyoming', 'georgia', 'alberta', 'british columbia', 'manitoba',
  'new brunswick', 'newfoundland', 'nova scotia', 'ontario',
  'prince edward island', 'quebec', 'saskatchewan', 'new south wales',
  'queensland', 'south australia', 'tasmania', 'western australia'
]);

const FOREIGN_CITIES = Object.freeze([
  'london', 'manchester', 'birmingham', 'leeds', 'glasgow', 'edinburgh',
  'dublin', 'berlin', 'munich', 'hamburg', 'frankfurt', 'paris', 'lyon',
  'amsterdam', 'rotterdam', 'brussels', 'madrid', 'barcelona', 'lisbon',
  'rome', 'milan', 'zurich', 'geneva', 'vienna', 'warsaw', 'prague',
  'budapest', 'stockholm', 'oslo', 'copenhagen', 'helsinki', 'moscow',
  'istanbul', 'athens', 'dubai', 'abu dhabi', 'doha', 'riyadh', 'tel aviv',
  'mumbai', 'delhi', 'new delhi', 'bangalore', 'bengaluru', 'hyderabad',
  'chennai', 'pune', 'kolkata', 'karachi', 'lahore', 'dhaka', 'colombo',
  'kuala lumpur', 'jakarta', 'manila', 'bangkok', 'hanoi', 'ho chi minh',
  'beijing', 'shanghai', 'shenzhen', 'hong kong', 'tokyo', 'osaka', 'seoul',
  'sydney', 'melbourne', 'brisbane', 'perth', 'adelaide', 'auckland',
  'toronto', 'vancouver', 'montreal', 'ottawa', 'calgary', 'edmonton',
  'new york city', 'los angeles', 'san francisco', 'chicago', 'boston',
  'seattle', 'austin', 'dallas', 'houston', 'miami', 'atlanta', 'denver',
  'palm springs', 'lagos', 'abuja', 'nairobi', 'accra', 'cairo', 'casablanca',
  'tunis', 'kampala', 'kigali', 'dar es salaam', 'lusaka', 'harare',
  'gaborone', 'windhoek', 'maputo', 'port louis', 'sao paulo',
  'rio de janeiro', 'buenos aires', 'santiago', 'bogota', 'lima', 'mexico city'
]);

// Two-letter US and Canadian state and province codes that are safe to read as
// a trailing address code. South African province abbreviations (EC, FS, GP,
// KZN, LP, MP, NC, NW, WC) are absent on purpose, so "Kimberley, NC" stays SA.
const FOREIGN_TRAILING_CODES = Object.freeze([
  'al', 'ak', 'az', 'ar', 'ca', 'co', 'ct', 'de', 'fl', 'hi', 'id', 'il', 'in',
  'ia', 'ks', 'ky', 'la', 'me', 'md', 'ma', 'mi', 'mn', 'ms', 'mo', 'mt', 'ne',
  'nv', 'nh', 'nj', 'nm', 'ny', 'nd', 'oh', 'ok', 'or', 'pa', 'ri', 'sc', 'sd',
  'tn', 'tx', 'ut', 'vt', 'va', 'wa', 'wv', 'wi', 'wy', 'dc',
  'ab', 'bc', 'mb', 'nb', 'nl', 'ns', 'nt', 'nu', 'on', 'pe', 'qc', 'sk', 'yt'
]);

const WORLDWIDE_TERMS = Object.freeze(['worldwide', 'anywhere', 'global']);
const REMOTE_TERMS = Object.freeze([
  'remote', 'work from home', 'wfh', 'hybrid', 'telecommute', 'home based'
]);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function phrasePattern(phrase) {
  const parts = normalizeText(phrase).split(' ').filter(Boolean);
  if (!parts.length) return null;
  return new RegExp(`(?:^|\\s)${parts.map(escapeRegExp).join('\\s+')}(?:\\s|$)`);
}

function hasPhrase(text, phrase) {
  const pattern = phrasePattern(phrase);
  return Boolean(pattern && pattern.test(text));
}

function hasAny(text, terms) {
  return terms.some((term) => hasPhrase(text, term));
}

function hasTrailingCode(raw, code) {
  const parts = String(raw == null ? '' : raw).split(',');
  if (parts.length < 2) return false;
  return normalizeText(parts[parts.length - 1]) === code;
}

function firstMatch(text, entries) {
  for (const entry of entries) {
    if (hasPhrase(text, entry[0])) return entry;
  }
  return null;
}

function uniqueProvinceOf(text) {
  const hit = firstMatch(text, UNIQUE_PROVINCES);
  return hit ? hit[1] : null;
}

function uniqueCityOf(text) {
  const hit = firstMatch(text, UNIQUE_CITIES);
  return hit ? { place: hit[1], province: hit[2] } : null;
}

function ambiguousPlaceOf(text) {
  const provinceHit = firstMatch(text, AMBIGUOUS_PROVINCES);
  if (provinceHit) return { place: null, province: provinceHit[1] };
  const cityHit = firstMatch(text, AMBIGUOUS_CITIES);
  if (cityHit) return { place: cityHit[1], province: cityHit[2] };
  return null;
}

function hasForeignTrailingCode(raw) {
  const parts = String(raw == null ? '' : raw).split(',');
  if (parts.length < 2) return false;
  return FOREIGN_TRAILING_CODES.includes(normalizeText(parts[parts.length - 1]));
}

function strongForeign(text, raw) {
  return hasPhrase(text, 'us') || hasPhrase(text, 'u s') ||
    hasAny(text, FOREIGN_STRONG) || hasTrailingCode(raw, 'us') || hasForeignTrailingCode(raw);
}

function anyForeign(text, raw) {
  return strongForeign(text, raw) || hasAny(text, FOREIGN_CITIES);
}

function make(verdict, province, place, remote, reason) {
  return { verdict, province: province || null, place: place || null, remote, reason };
}

export function classifyLocation(raw) {
  const text = normalizeText(raw);
  const remote = hasAny(text, REMOTE_TERMS);
  if (!text) return make('unknown', null, null, remote, 'blank');

  if (hasAny(text, SA_COUNTRY_TERMS) || hasPhrase(text, 'sa') || hasPhrase(text, 'za')) {
    const ambiguous = ambiguousPlaceOf(text);
    const city = uniqueCityOf(text);
    return make(
      'sa',
      uniqueProvinceOf(text) || ambiguous?.province || null,
      city?.place || ambiguous?.place || null,
      remote,
      'country'
    );
  }

  const province = uniqueProvinceOf(text);
  if (province) {
    return make('sa', province, uniqueCityOf(text)?.place || null, remote, 'province');
  }

  const city = uniqueCityOf(text);
  if (city && strongForeign(text, raw)) return make('foreign', null, null, remote, 'foreign');
  if (city) return make('sa', city.province, city.place, remote, 'city');

  if (anyForeign(text, raw)) return make('foreign', null, null, remote, 'foreign');

  const ambiguous = ambiguousPlaceOf(text);
  if (ambiguous) return make('sa', ambiguous.province, ambiguous.place, remote, 'ambiguous');

  if (hasAny(text, WORLDWIDE_TERMS)) return make('foreign', null, null, remote, 'worldwide');
  if (remote) return make('unknown', null, null, remote, 'remote-unstated');
  return make('unknown', null, null, remote, 'unrecognised');
}

export function isSouthAfrican(raw, { strict = false } = {}) {
  const value = classifyLocation(raw).verdict;
  return value === 'sa' || (!strict && value === 'unknown');
}

const VERDICTS = new Set(['sa', 'foreign', 'unknown']);

export function jobLocationVerdict(job) {
  if (job && VERDICTS.has(job.locationVerdict)) return job.locationVerdict;
  return classifyLocation(job?.location).verdict;
}

export function jobProvince(job) {
  if (job?.province) return job.province;
  return classifyLocation(job?.location).province;
}

export function jobRemote(job) {
  if (typeof job?.remote === 'boolean') return job.remote;
  return classifyLocation(job?.location).remote;
}

export function countForeignJobs(jobs = []) {
  return jobs.reduce((count, job) => count + (jobLocationVerdict(job) === 'foreign' ? 1 : 0), 0);
}
