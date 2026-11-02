// Match a packet's answers to plain form-field descriptors. No DOM here, so the
// rules run the same in the extension, in Node tests and in a future portal
// simulator. A field is filled only on an exact or reviewed variant match.
import { normaliseLabel, questionKey } from './questions.js';

export { normaliseLabel };

export const SENSITIVE = /password|passcode|pin\b|social security|credit card|cvv|csrf|secret/i;
const HONEYPOT = /^__|honeypot|(?:^|_)fax(?:_|$)|company_website/i;
const CAPTCHA = /captcha|not a robot|recaptcha|hcaptcha/i;
const FILE = /resume|curriculum|\bcv\b|cover letter|passport|identity|\bid\b|certif|qualification|degree|diploma|transcript|matric|portfolio/i;

const LEAD = /^(?:do you have|do you|are you|what is|what are|please enter|please provide|tell us|your|the)\s+/;

// Identity and contact fields. Application questions live in questions.js so
// the Settings form, the packet and this matcher cannot drift apart.
const SYNONYMS = new Map([
  ['first name', 'firstName'], ['first names', 'firstName'], ['given name', 'firstName'],
  ['given names', 'firstName'], ['forename', 'firstName'],
  ['last name', 'lastName'], ['last names', 'lastName'], ['surname', 'lastName'], ['family name', 'lastName'],
  ['full name', 'fullName'], ['name', 'fullName'],
  ['email', 'email'], ['email address', 'email'], ['e mail', 'email'], ['e mail address', 'email'],
  ['electronic mail', 'email'],
  ['phone', 'phone'], ['phone number', 'phone'], ['mobile', 'phone'], ['mobile number', 'phone'],
  ['mobile phone', 'phone'], ['mobile phone number', 'phone'], ['cell', 'phone'], ['cell number', 'phone'],
  ['cellphone', 'phone'], ['cell phone', 'phone'], ['telephone', 'phone'], ['telephone number', 'phone'],
  ['contact number', 'phone'], ['contact phone', 'phone'], ['tel', 'phone'],
  ['linkedin', 'linkedInUrl'], ['linkedin profile', 'linkedInUrl'], ['linkedin url', 'linkedInUrl'],
  ['portfolio', 'portfolioUrl'], ['website', 'portfolioUrl'], ['portfolio or website', 'portfolioUrl'],
  ['personal website', 'portfolioUrl'],
  ['github', 'githubUrl'], ['github profile', 'githubUrl'],
  ['city', 'city'], ['town', 'city'], ['city of residence', 'city'],
  ['province', 'province'], ['state', 'province'], ['province or state', 'province'],
  ['postal code', 'postalCode'], ['postcode', 'postalCode'], ['zip code', 'postalCode'], ['zip', 'postalCode'],
  ['country', 'country'],
  ['current employer', 'currentCompany'], ['current company', 'currentCompany'],
  ['current employer name', 'currentCompany'], ['employer name', 'currentCompany'],
  ['current job title', 'currentTitle'], ['job title', 'currentTitle'], ['current position', 'currentTitle'],
  ['current role', 'currentTitle'],
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
  const question = questionKey(value);
  if (question) return question;
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

const YES = new Set(['yes', 'y', 'true', '1', 'agree', 'consent', 'i agree', 'i consent']);
const NO = new Set(['no', 'n', 'false', '0', 'decline', 'do not']);

function yesNoOf(value) {
  const normal = normaliseLabel(value).replace(/[.!]+$/, '').trim();
  if (YES.has(normal)) return true;
  if (NO.has(normal)) return false;
  return null;
}

function optionYesNo(option) {
  for (const text of [option.label, option.value]) {
    const head = normaliseLabel(text).split(' ')[0];
    if (YES.has(head)) return true;
    if (NO.has(head)) return false;
  }
  return null;
}

function numberIn(value) {
  const match = normaliseLabel(value).match(/^(\d{1,2})(?:\s*(?:years?|yrs?))?(?:\s*\+)?$/);
  return match ? Number(match[1]) : null;
}

// Experience bands ("3-5 years", "5+ years") are the usual select options for
// a numeric answer. A band is chosen only when the number falls inside it.
// Read the raw label and value: normalising first would erase the dash in "3-5".
function optionBand(option) {
  for (const text of [option.label, option.value]) {
    const raw = String(text == null ? '' : text).toLowerCase();
    const range = raw.match(/\b(\d{1,2})\s*(?:-|to|–)\s*(\d{1,2})\b/);
    if (range) return { min: Number(range[1]), max: Number(range[2]) };
    const open = raw.match(/\b(\d{1,2})\s*(?:\+|plus)(?=\s|$)/);
    if (open) return { min: Number(open[1]), max: Infinity };
    const year = raw.match(/\b(\d{1,2})\s*(?:years?|yrs?)\b/);
    if (year) return { min: Number(year[1]), max: Number(year[1]) };
    const bare = raw.trim().match(/^(\d{1,2})$/);
    if (bare) return { min: Number(bare[1]), max: Number(bare[1]) };
  }
  return null;
}

function chosenOption(descriptor, value) {
  if (!Array.isArray(descriptor.options) || !descriptor.options.length) return null;
  const wanted = normaliseLabel(value);
  const exact = descriptor.options.find((option) => normaliseLabel(option.label) === wanted)
    || descriptor.options.find((option) => normaliseLabel(option.value) === wanted);
  if (exact) return exact;
  const wantedBoolean = yesNoOf(value);
  if (wantedBoolean !== null) {
    return descriptor.options.find((option) => optionYesNo(option) === wantedBoolean) || null;
  }
  const wantedNumber = numberIn(value);
  if (wantedNumber !== null) {
    const bands = descriptor.options.filter((option) => {
      const band = optionBand(option);
      return band && wantedNumber >= band.min && wantedNumber <= band.max;
    });
    return bands.length === 1 ? bands[0] : null;
  }
  return null;
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
      if (!option) { skip('no matching option'); continue; }
      usedKeys.add(key);
      fills.push({ fieldId, key, label, value: option.value, source: entry.source || 'profile' });
      continue;
    }

    usedKeys.add(key);
    fills.push({ fieldId, key, label, value: entry.value, source: entry.source || 'profile' });
  }

  return { fills, skipped, attachments: attachmentFills, captcha: captchaSeen };
}
