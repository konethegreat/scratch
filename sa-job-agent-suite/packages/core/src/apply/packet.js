export const VALUE_CAP = 500;
export const LABEL_CAP = 120;
const MAX_QUESTIONS = 200;
const MAX_DOCUMENTS = 20;

export const IDENTITY_FIELDS = Object.freeze([
  ['fullName', 'Full name'],
  ['email', 'Email address'],
  ['phone', 'Phone number'],
  ['linkedInUrl', 'LinkedIn profile'],
  ['portfolioUrl', 'Portfolio or website']
]);

export const QUESTION_FIELDS = Object.freeze([
  ['rightToWorkSA', 'Right to work in South Africa'],
  ['nationality', 'Nationality'],
  ['eeRace', 'Employment equity group'],
  ['gender', 'Gender'],
  ['disability', 'Disability'],
  ['noticePeriod', 'Notice period'],
  ['currentSalary', 'Current salary'],
  ['expectedSalary', 'Expected salary'],
  ['willingToRelocate', 'Willing to relocate'],
  ['driversLicense', "Driver's licence"],
  ['ownVehicle', 'Own vehicle'],
  ['highestQualification', 'Highest qualification'],
  ['yearsExperience', 'Years of experience'],
  ['criminalRecord', 'Criminal record'],
  ['creditCheckConsent', 'Credit check consent'],
  ['languages', 'Languages'],
  ['availabilityDate', 'Available from']
]);

export const HIGH_VALUE_ANSWERS = Object.freeze([
  'rightToWorkSA',
  'currentSalary',
  'expectedSalary',
  'noticePeriod'
]);

function text(value, cap) {
  return String(value == null ? '' : value).trim().slice(0, cap);
}

// Two questions that differ only by punctuation or spacing are the same
// question. Keeps "Notice period?" from repeating "Notice period".
function labelKey(value) {
  return String(value == null ? '' : value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function siteOf(url) {
  const raw = text(url, 2000);
  if (!raw) return '';
  try {
    return new URL(raw.includes('://') ? raw : `https://${raw}`).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function questionLabel(key) {
  const entry = QUESTION_FIELDS.find(([field]) => field === key);
  return entry ? entry[1] : key;
}

export function buildApplyPacket({ profile = {}, job = {}, answerBank = [], supportingDocs = [] } = {}) {
  const source = profile || {};
  const answers = source.applicationProfile || source;

  const identity = IDENTITY_FIELDS
    .map(([key, label]) => ({ key, label, value: text(source[key], VALUE_CAP) }))
    .filter((entry) => entry.value);

  const questions = [];
  for (const [key, label] of QUESTION_FIELDS) {
    const value = text(answers[key], VALUE_CAP);
    if (value) questions.push({ key, label, value, source: 'profile' });
  }
  const seen = new Set(questions.map((entry) => labelKey(entry.label)));
  for (const entry of Array.isArray(answerBank) ? answerBank : []) {
    if (questions.length >= MAX_QUESTIONS) break;
    const label = text(entry?.question, LABEL_CAP);
    const value = text(entry?.answer, VALUE_CAP);
    if (!label || !value) continue;
    const key = labelKey(label);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    questions.push({
      key: `bank-${text(entry.normalized, 80) || questions.length}`,
      label,
      value,
      source: 'answer-bank'
    });
  }

  const documents = (Array.isArray(supportingDocs) ? supportingDocs : [])
    .slice(0, MAX_DOCUMENTS)
    .map((doc) => ({
      key: text(doc?.key, 40),
      label: text(doc?.label, LABEL_CAP),
      fileName: text(doc?.fileName, 200),
      available: Boolean(doc?.available)
    }))
    .filter((doc) => doc.key && doc.label);

  const checklist = [
    { key: 'review-details', label: 'Read every detail below before you paste anything', done: true },
    {
      key: 'documents-ready',
      label: 'Have your CV and certified copies ready',
      done: documents.length > 0 && documents.every((doc) => doc.available)
    },
    { key: 'paste-id', label: 'Paste your ID or passport number straight from your own records', done: false }
  ];
  for (const key of HIGH_VALUE_ANSWERS) {
    if (questions.some((entry) => entry.key === key)) {
      checklist.push({ key: `answer-${key}`, label: `Copy: ${questionLabel(key)}`, done: false });
    }
  }
  checklist.push({
    key: 'open-portal',
    label: job && job.applyUrl ? 'Open the job site and start the form' : 'Add the application link in the tracker',
    done: false
  });
  checklist.push({ key: 'submit-on-portal', label: 'Submit on the job site, then press Mark applied', done: false });

  const warnings = [];
  if (!source.fullName) warnings.push('Add your full name in Settings so application forms are quicker to complete.');
  if (!source.email) warnings.push('Add your email address in Settings. Most portals ask for it first.');
  const missing = HIGH_VALUE_ANSWERS.filter((key) => !questions.some((entry) => entry.key === key));
  if (missing.length) {
    warnings.push(`Still missing: ${missing.map((key) => questionLabel(key).toLowerCase()).join(', ')}. Add them in Settings or type them from your own records.`);
  }
  if (!documents.some((doc) => doc.available)) {
    warnings.push('No documents are ready. You will need to upload your CV and certified copies by hand.');
  }
  if (!job || !job.applyUrl) {
    warnings.push('This job has no application link. Add one in the tracker before opening the portal.');
  }

  return {
    job: {
      id: text(job && job.id, 80),
      title: text(job && job.title, LABEL_CAP),
      company: text(job && job.company, LABEL_CAP),
      applyUrl: text(job && job.applyUrl, 2000),
      site: siteOf(job && job.applyUrl)
    },
    identity,
    questions,
    documents,
    checklist,
    warnings
  };
}
