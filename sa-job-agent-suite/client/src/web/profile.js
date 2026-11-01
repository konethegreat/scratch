// Profile v2: the flat v1 fields stay untouched because the packet, the tailor
// prompts and the desktop app read them. New structured fields are additive and
// every value is rebuilt from a safe type, so a hand-edited vault cannot break
// a screen.
import { webLink } from './links.js';

export const PROFILE_VERSION = 2;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const stringOf = (value) => (typeof value === 'string' ? value : '');
const numberOrNull = (value) => {
  const number = Number(value);
  return value !== null && value !== '' && Number.isFinite(number) ? number : null;
};

function stringList(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

function scalarObjectList(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(isObject).map((entry) => {
    const out = {};
    for (const [key, child] of Object.entries(entry)) {
      if (typeof child === 'string' || typeof child === 'number' || typeof child === 'boolean' || child === null) {
        out[key] = child;
      } else if (Array.isArray(child) && child.every((item) => typeof item === 'string')) {
        out[key] = child;
      }
    }
    return out;
  });
}

export function emptyProfileV2() {
  return {
    v: PROFILE_VERSION,
    headline: '',
    summary: '',
    preferredName: '',
    fullName: '',
    email: '',
    phone: '',
    linkedInUrl: '',
    portfolioUrl: '',
    githubUrl: '',
    yearsExperience: null,
    highestQualification: '',
    address: { line1: '', line2: '', suburb: '', city: '', province: '', postalCode: '' },
    eeOptIn: false,
    salary: {
      currentAmount: null,
      currentPeriod: 'month',
      expectedAmount: null,
      expectedPeriod: 'month',
      negotiable: false
    },
    workHistory: [],
    education: [],
    certifications: [],
    skills: [],
    languages: [],
    references: [],
    preferences: { roles: [], sectors: [], locations: [], remote: '', minSalary: null }
  };
}

export function hasEmploymentEquity(profile) {
  const answers = isObject(profile?.applicationProfile) ? profile.applicationProfile : {};
  return ['eeRace', 'gender', 'disability'].some(
    (key) => typeof answers[key] === 'string' && answers[key].trim() !== ''
  );
}

export function migrateProfile(raw) {
  if (!isObject(raw)) return {};
  if (Number(raw.v) >= PROFILE_VERSION) return raw;

  const base = emptyProfileV2();
  const address = isObject(raw.address) ? raw.address : {};
  const salary = isObject(raw.salary) ? raw.salary : {};
  const preferences = isObject(raw.preferences) ? raw.preferences : {};

  return {
    ...base,
    ...raw,
    v: PROFILE_VERSION,
    headline: stringOf(raw.headline),
    summary: stringOf(raw.summary),
    preferredName: stringOf(raw.preferredName),
    fullName: stringOf(raw.fullName),
    email: stringOf(raw.email),
    phone: stringOf(raw.phone),
    linkedInUrl: webLink(raw.linkedInUrl),
    portfolioUrl: webLink(raw.portfolioUrl),
    githubUrl: webLink(raw.githubUrl),
    yearsExperience: numberOrNull(raw.yearsExperience),
    highestQualification: stringOf(raw.highestQualification),
    address: {
      line1: stringOf(address.line1),
      line2: stringOf(address.line2),
      suburb: stringOf(address.suburb),
      city: stringOf(address.city),
      province: stringOf(address.province),
      postalCode: stringOf(address.postalCode)
    },
    eeOptIn: typeof raw.eeOptIn === 'boolean' ? raw.eeOptIn : hasEmploymentEquity(raw),
    salary: {
      currentAmount: numberOrNull(salary.currentAmount),
      currentPeriod: salary.currentPeriod === 'year' ? 'year' : 'month',
      expectedAmount: numberOrNull(salary.expectedAmount),
      expectedPeriod: salary.expectedPeriod === 'year' ? 'year' : 'month',
      negotiable: salary.negotiable === true
    },
    workHistory: scalarObjectList(raw.workHistory),
    education: scalarObjectList(raw.education),
    certifications: scalarObjectList(raw.certifications),
    skills: stringList(raw.skills),
    languages: stringList(raw.languages),
    references: scalarObjectList(raw.references),
    preferences: {
      roles: stringList(preferences.roles),
      sectors: stringList(preferences.sectors),
      locations: stringList(preferences.locations),
      remote: ['yes', 'hybrid', 'no'].includes(preferences.remote) ? preferences.remote : '',
      minSalary: numberOrNull(preferences.minSalary)
    }
  };
}
