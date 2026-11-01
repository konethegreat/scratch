// Match a packet's answers to plain form-field descriptors. No DOM here, so the
// rules run the same in the extension, in Node tests and in a future portal
// simulator. A field is filled only on an exact normalised match.
export const SENSITIVE = /password|passcode|pin\b|social security|credit card|cvv|csrf|secret/i;
const HONEYPOT = /^__|honeypot|(?:^|_)fax(?:_|$)|company_website/i;
const CAPTCHA = /captcha|not a robot|recaptcha|hcaptcha/i;
const FILE = /resume|curriculum|\bcv\b|cover letter|passport|identity|\bid\b|certif|qualification|degree|diploma|transcript|matric|portfolio/i;

const LEAD = /^(?:do you have|do you|are you|what is|what are|please enter|please provide|tell us|your|the)\s+/;

const SYNONYMS = new Map([
  ['first name', 'firstName'], ['given name', 'firstName'], ['forename', 'firstName'],
  ['last name', 'lastName'], ['surname', 'lastName'], ['family name', 'lastName'],
  ['full name', 'fullName'], ['name', 'fullName'],
  ['email', 'email'], ['email address', 'email'], ['e mail', 'email'],
  ['phone', 'phone'], ['phone number', 'phone'], ['mobile', 'phone'], ['mobile number', 'phone'], ['cell', 'phone'],
  ['linkedin', 'linkedInUrl'], ['linkedin profile', 'linkedInUrl'], ['linkedin url', 'linkedInUrl'],
  ['portfolio', 'portfolioUrl'], ['website', 'portfolioUrl'], ['portfolio or website', 'portfolioUrl'],
  ['github', 'githubUrl'], ['github profile', 'githubUrl'],
  ['city', 'city'], ['town', 'city'], ['province', 'province'], ['postal code', 'postalCode'], ['zip code', 'postalCode'],
  ['country', 'country'], ['current employer', 'currentCompany'], ['current company', 'currentCompany'],
  ['current job title', 'currentTitle'], ['job title', 'currentTitle'],
  ['years of experience', 'yearsExperience'], ['years experience', 'yearsExperience'],
  ['highest qualification', 'highestQualification'], ['qualification', 'highestQualification'],
  ['notice period', 'noticePeriod'], ['notice period days', 'noticePeriod'],
  ['availability', 'availabilityDate'], ['available from', 'availabilityDate'],
  ['current salary', 'currentSalary'], ['expected salary', 'expectedSalary'], ['salary expectation', 'expectedSalary'],
  ['right to work', 'rightToWorkSA'], ['right to work in south africa', 'rightToWorkSA'],
  ['willing to relocate', 'willingToRelocate'], ['relocate', 'willingToRelocate'],
  ['drivers licence', 'driversLicense'], ["driver's licence", 'driversLicense'], ['driver licence', 'driversLicense'],
  ['own vehicle', 'ownVehicle'], ['do you own a vehicle', 'ownVehicle'], ['vehicle', 'ownVehicle'],
  ['nationality', 'nationality'], ['criminal record', 'criminalRecord'],
  ['credit check consent', 'creditCheckConsent'], ['languages', 'languages'],
  ['employment equity group', 'eeRace'], ['race', 'eeRace'], ['gender', 'gender'], ['disability', 'disability'],
  ['preferred name', 'preferredName']
]);

const AUTOCOMPLETE = new Map([
  ['given-name', 'firstName'], ['family-name', 'lastName'], ['name', 'fullName'],
  ['email', 'email'], ['tel', 'phone'], ['tel-national', 'phone'],
  ['organization', 'currentCompany'], ['organization-title', 'currentTitle'],
  ['address-level2', 'city'], ['address-level1', 'province'], ['postal-code', 'postalCode'],
  ['country-name', 'country'], ['url', 'portfolioUrl']
]);

const CANONICAL = new Set([
  ...SYNONYMS.values()
]);
const CANONICAL_KEYS = new Map();
for (const key of CANONICAL) {
  CANONICAL_KEYS.set(key.toLowerCase(), key);
  CANONICAL_KEYS.set(normaliseLabel(key), key);
}

export function normaliseLabel(value) {
  return String(value == null ? '' : value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function stripLead(value) {
  let out = value;
  for (let index = 0; index < 4; index += 1) {
    const next = out.replace(LEAD, '');
    if (next === out) break;
    out = next;
  }
  return out;
}

function keyOf(value) {
  const normal = stripLead(normaliseLabel(value));
  return SYNONYMS.get(normal) || CANONICAL_KEYS.get(normal) || CANONICAL_KEYS.get(normal.replace(/\s+/g, '')) || null;
}

function candidateKey(descriptor, priority) {
  for (const source of priority) {
    if (source === 'autocomplete') {
      const token = normaliseLabel(descriptor.autocomplete);
      if (token && AUTOCOMPLETE.has(token)) return AUTOCOMPLETE.get(token);
      continue;
    }
    const raw = descriptor[source];
    if (!raw) continue;
    const key = keyOf(raw);
    if (key) return key;
  }
  return null;
}

function packetValues(packet) {
  const byKey = new Map();
  const byLabel = new Map();
  for (const entry of [...(packet.identity || []), ...(packet.questions || []), ...(packet.fields || [])]) {
    if (!entry || !entry.value) continue;
    byKey.set(entry.key, entry);
    for (const label of [entry.label, stripLead(normaliseLabel(entry.label))]) {
      const normal = normaliseLabel(label);
      if (normal && !byLabel.has(normal)) byLabel.set(normal, entry);
    }
  }
  return { byKey, byLabel };
}

function attachmentFor(label, attachments) {
  const text = normaliseLabel(label);
  const documents = attachments.filter((entry) => entry.kind !== 'tailored-cv');
  if (/cover letter/.test(text)) {
    return documents.find((entry) => /cover letter/.test(normaliseLabel(entry.label))) || null;
  }
  if (/resume|curriculum|\bcv\b/.test(text)) {
    return attachments.find((entry) => entry.kind === 'tailored-cv')
      || documents.find((entry) => /resume|curriculum|\bcv\b/.test(normaliseLabel(entry.label)))
      || null;
  }
  if (/passport|identity|\bid\b|certif/.test(text)) {
    return documents.find((entry) => /passport|identity|\bid\b|certif/.test(normaliseLabel(entry.label))) || null;
  }
  if (/qualification|degree|diploma|certificate|transcript|matric/.test(text)) {
    return documents.find((entry) => /qualification|degree|diploma|certificate|transcript|matric/.test(normaliseLabel(entry.label))) || null;
  }
  return null;
}

function chosenOption(descriptor, value) {
  if (!Array.isArray(descriptor.options) || !descriptor.options.length) return null;
  const wanted = normaliseLabel(value);
  return descriptor.options.find((option) => normaliseLabel(option.label) === wanted)
    || descriptor.options.find((option) => normaliseLabel(option.value) === wanted)
    || null;
}

export function matchFields(packet, descriptors, { adapter, captcha = false } = {}) {
  const priority = Array.isArray(adapter?.priority) && adapter.priority.length
    ? adapter.priority
    : ['autocomplete', 'name', 'label', 'id', 'placeholder'];
  const { byKey, byLabel } = packetValues(packet || {});
  const attachments = Array.isArray(packet?.attachments) ? packet.attachments : [];
  const fills = [];
  const skipped = [];
  const attachmentFills = [];
  const usedKeys = new Set();
  let captchaSeen = Boolean(captcha);

  for (const descriptor of Array.isArray(descriptors) ? descriptors : []) {
    const fieldId = descriptor.id || descriptor.name || '';
    const label = descriptor.label || '';
    const skip = (reason) => skipped.push({ fieldId, label, reason });

    if (descriptor.visible === false) { skip('invisible'); continue; }
    if (descriptor.disabled === true) { skip('disabled'); continue; }
    if (HONEYPOT.test(descriptor.name || '') || CAPTCHA.test(`${label} ${descriptor.name || ''}`)) {
      if (CAPTCHA.test(`${label} ${descriptor.name || ''}`)) captchaSeen = true;
      skip(CAPTCHA.test(`${label} ${descriptor.name || ''}`) ? 'captcha' : 'honeypot');
      continue;
    }
    if (descriptor.type === 'password' || SENSITIVE.test(`${label} ${descriptor.name || ''} ${descriptor.id || ''}`)) {
      skip('sensitive');
      continue;
    }
    if (descriptor.type === 'file') {
      const attachment = FILE.test(label) ? attachmentFor(label, attachments) : null;
      if (attachment) {
        fills.push({ fieldId, key: attachment.key, label, value: attachment.fileName, source: 'attachment' });
        attachmentFills.push({ fieldId, label, attachmentKey: attachment.key });
      } else {
        skip('no attachment');
      }
      continue;
    }

    let key = candidateKey(descriptor, priority);
    let entry = key ? byKey.get(key) : null;
    if (!entry) {
      const normal = normaliseLabel(stripLead(label || descriptor.name || descriptor.placeholder || ''));
      const byText = byLabel.get(normal);
      if (byText) {
        entry = byText;
        key = byText.key;
      }
    }
    if (!key && !entry) { skip('unknown'); continue; }
    if (!entry || !entry.value) { skip('no answer'); continue; }
    if (usedKeys.has(key)) { skip('duplicate'); continue; }

    if (descriptor.type === 'select' || descriptor.type === 'radio') {
      const option = chosenOption(descriptor, entry.value);
      if (!option) { skip('no answer'); continue; }
      usedKeys.add(key);
      fills.push({ fieldId, key, label, value: option.value, source: entry.source || 'profile' });
      continue;
    }

    usedKeys.add(key);
    fills.push({ fieldId, key, label, value: entry.value, source: entry.source || 'profile' });
  }

  return { fills, skipped, attachments: attachmentFills, captcha: captchaSeen };
}
