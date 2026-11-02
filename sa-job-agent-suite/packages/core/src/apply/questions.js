// One reviewed vocabulary for the questions South African job sites repeat in
// different words. The packet, the deterministic matcher and the Settings form
// all read this list, so a label added here is understood everywhere.
export const QUESTION_VOCABULARY = Object.freeze([
  {
    key: 'rightToWorkSA',
    label: 'Right to work in South Africa',
    aliases: [
      'right to work', 'right to work in south africa', 'legal right to work',
      'legal right to work in south africa', 'legally permitted to work',
      'authorised to work in south africa', 'authorized to work in south africa',
      'eligible to work in south africa', 'permitted to work in south africa',
      'valid work permit', 'work permit', 'sa citizen or permanent resident',
      'south african citizen or permanent resident', 'permanent resident'
    ],
    options: ['Yes', 'No']
  },
  {
    key: 'nationality',
    label: 'Nationality',
    aliases: ['nationality', 'citizenship', 'country of citizenship', 'national status'],
    placeholder: 'e.g. South African'
  },
  {
    key: 'eeRace',
    label: 'Employment equity group',
    aliases: [
      'race', 'population group', 'employment equity group', 'employment equity',
      'equity group', 'ethnic group', 'ethnicity', 'designated group'
    ],
    options: ['African', 'Coloured', 'Indian', 'White', 'Other', 'Prefer not to say'],
    sensitive: true
  },
  {
    key: 'gender',
    label: 'Gender',
    aliases: ['gender', 'sex'],
    options: ['Male', 'Female', 'Other', 'Prefer not to say'],
    sensitive: true
  },
  {
    key: 'disability',
    label: 'Disability',
    aliases: ['disability', 'disability status', 'do you have a disability', 'any disability'],
    options: ['No', 'Yes', 'Prefer not to say'],
    sensitive: true
  },
  {
    key: 'noticePeriod',
    label: 'Notice period',
    aliases: [
      'notice period', 'notice', 'notice period days', 'notice duration',
      'notice period in months', 'current notice period', 'required notice'
    ],
    placeholder: 'e.g. 30 days / Immediate'
  },
  {
    key: 'currentSalary',
    label: 'Current salary',
    aliases: [
      'current salary', 'present salary', 'current ctc', 'current cost to company',
      'current remuneration', 'current package', 'current monthly salary',
      'current annual salary', 'current gross salary'
    ],
    placeholder: 'e.g. R45 000 p/m',
    sensitive: true
  },
  {
    key: 'expectedSalary',
    label: 'Expected salary',
    aliases: [
      'expected salary', 'salary expectation', 'salary expectations', 'expected ctc',
      'expected remuneration', 'expected package', 'salary required', 'required salary',
      'desired salary', 'expected monthly salary', 'expected annual salary',
      'expected gross salary', 'salary requirement', 'remuneration expectation',
      'expected salary per annum'
    ],
    placeholder: 'e.g. R650 000 p/a (neg.)',
    sensitive: true
  },
  {
    key: 'willingToRelocate',
    label: 'Willing to relocate',
    aliases: [
      'willing to relocate', 'relocation', 'relocation willingness', 'willing to move',
      'able to relocate', 'open to relocation', 'relocate'
    ],
    options: ['Yes', 'No']
  },
  {
    key: 'driversLicense',
    label: "Driver's licence",
    aliases: [
      "driver's licence", 'drivers licence', 'driver licence', 'driving licence',
      "driver's license", 'drivers license', 'driver license', 'driving license',
      "valid driver's licence", 'valid drivers licence', "valid driver's license",
      'licence code', 'license code'
    ],
    options: ['None', 'Code A', 'Code B', 'Code C', 'Code EB', 'Other']
  },
  {
    key: 'ownVehicle',
    label: 'Own vehicle',
    aliases: [
      'own vehicle', 'own a vehicle', 'own car', 'own transport', 'private vehicle',
      'do you own a vehicle', 'do you have your own vehicle', 'vehicle'
    ],
    options: ['Yes', 'No']
  },
  {
    key: 'highestQualification',
    label: 'Highest qualification',
    aliases: [
      'highest qualification', 'highest level of education', 'highest education',
      'education level', 'level of education', 'qualification level', 'qualification',
      'highest academic qualification', 'highest grade passed',
      'highest qualification obtained', 'highest qualification completed'
    ],
    placeholder: 'e.g. BSc Computer Science'
  },
  {
    key: 'yearsExperience',
    label: 'Years of experience',
    aliases: [
      'years of experience', 'years experience', 'years of relevant experience',
      'years relevant experience', 'work experience years', 'total experience',
      'total years experience', 'number of years experience', 'years of work experience',
      'years in the workforce'
    ],
    placeholder: 'e.g. 5'
  },
  {
    key: 'criminalRecord',
    label: 'Criminal record',
    aliases: [
      'criminal record', 'criminal history', 'criminal offence', 'criminal offense',
      'criminal convictions', 'have you been convicted', 'ever been convicted'
    ],
    options: ['No', 'Yes'],
    sensitive: true
  },
  {
    key: 'creditCheckConsent',
    label: 'Credit check consent',
    aliases: [
      'credit check consent', 'consent to credit check', 'consent to a credit check',
      'credit check', 'credit record check consent', 'permission for credit check',
      'agree to credit check', 'willing to undergo a credit check',
      'credit history consent'
    ],
    options: ['Yes', 'No']
  },
  {
    key: 'languages',
    label: 'Languages',
    aliases: [
      'languages', 'language', 'languages spoken', 'home language',
      'languages you speak', 'language proficiency', 'spoken languages'
    ],
    placeholder: 'e.g. English, isiZulu, Afrikaans'
  },
  {
    key: 'availabilityDate',
    label: 'Available from',
    aliases: [
      'availability', 'available from', 'availability date', 'date available',
      'available date', 'start date', 'earliest start date', 'available to start',
      'when can you start', 'when are you available', 'commencement date'
    ],
    placeholder: 'e.g. Immediate / 2026-07-01'
  }
]);

export const QUESTION_KEYS = Object.freeze(QUESTION_VOCABULARY.map((entry) => entry.key));
const BY_KEY = new Map(QUESTION_VOCABULARY.map((entry) => [entry.key, entry]));

export function normaliseLabel(value) {
  return String(value == null ? '' : value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const LEAD = /^(?:do you have|do you|are you|have you|what is|what are|please enter|please provide|please indicate|please select|please choose|kindly|please|tell us|indicate|select|choose|enter|provide|your|the|a)\s+/;
const NOISE = /\s*(?:required|optional|details?|information|info|specify|indicate|select|choose|enter|provide|field|value)$/;

function stripLead(value) {
  let out = value;
  for (let index = 0; index < 4; index += 1) {
    const next = out.replace(LEAD, '');
    if (next === out) break;
    out = next;
  }
  return out;
}

function trimNoise(value) {
  let out = value;
  for (let index = 0; index < 4; index += 1) {
    const next = out.replace(NOISE, '').trim();
    if (next === out) break;
    out = next;
  }
  return out;
}

// Parenthetical hints and lead-ins are not part of the question itself.
function cleanLabel(value) {
  const withoutBrackets = normaliseLabel(value).replace(/\([^)]*\)|\[[^\]]*\]/g, ' ');
  return trimNoise(stripLead(withoutBrackets.replace(/\s+/g, ' ').trim()));
}

const ALIASES = new Map();
for (const entry of QUESTION_VOCABULARY) {
  for (const alias of [entry.label, ...entry.aliases]) {
    const normal = normaliseLabel(alias);
    const cleaned = cleanLabel(alias);
    if (normal && !ALIASES.has(normal)) ALIASES.set(normal, entry.key);
    if (cleaned && !ALIASES.has(cleaned)) ALIASES.set(cleaned, entry.key);
  }
}
const CONTAINED = [...ALIASES.entries()]
  .filter(([alias]) => alias.split(' ').length >= 2 && alias.length >= 10)
  .sort(([left], [right]) => right.length - left.length);

function containedKey(value) {
  const keys = new Set();
  for (const [alias, key] of CONTAINED) {
    if (new RegExp(`(?:^| )${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?: |$)`).test(value)) {
      keys.add(key);
      if (keys.size > 1) return null;
    }
  }
  return keys.size === 1 ? [...keys][0] : null;
}

export function questionKey(value) {
  const normal = normaliseLabel(value);
  if (!normal) return null;
  const exact = ALIASES.get(normal);
  if (exact) return exact;
  const cleaned = cleanLabel(value);
  if (!cleaned) return null;
  return ALIASES.get(cleaned) || containedKey(cleaned);
}

export function questionLabel(key) {
  return BY_KEY.get(key)?.label || '';
}

export function questionOptions(key) {
  const options = BY_KEY.get(key)?.options;
  return Array.isArray(options) ? [...options] : [];
}

export function questionPlaceholder(key) {
  return BY_KEY.get(key)?.placeholder || '';
}

export function isSensitiveQuestion(key) {
  return BY_KEY.get(key)?.sensitive === true;
}
