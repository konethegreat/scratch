import { hashText } from './text.js';

export const KIND_LABELS = Object.freeze({
  'base-cv': { one: 'base CV', many: 'base CVs' },
  profile: { one: 'application profile', many: 'application profiles' },
  'tailored-cv': { one: 'tailored CV', many: 'tailored CVs' },
  'cover-letter': { one: 'cover letter', many: 'cover letters' },
  'job-description': { one: 'job description', many: 'job descriptions' },
  answer: { one: 'saved answer', many: 'saved answers' },
  insight: { one: 'candidate insight', many: 'candidate insights' },
  employer: { one: 'employer note', many: 'employer notes' },
  application: { one: 'application record', many: 'application records' }
});

const KIND_ORDER = Object.keys(KIND_LABELS);
const SOURCE_KINDS = ['base-cv', 'profile', 'job-description', 'answer', 'insight', 'employer', 'application'];

const PROFILE_FIELDS = [
  ['rightToWorkSA', 'Right to work in SA'],
  ['nationality', 'Nationality'],
  ['eeRace', 'Race / population group (EE)'],
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
  ['creditCheckConsent', 'Consent to credit check'],
  ['languages', 'Languages'],
  ['availabilityDate', 'Available from']
];

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function addDoc(docs, id, kind, title, lines) {
  const text = lines.filter(Boolean).join('\n').trim();
  if (text.length < 40) return;
  docs.push({ id, kind, title, text });
}

function roleLabel(title, company) {
  const role = clean(title) || 'Untitled role';
  const org = clean(company);
  return org ? `${role} at ${org}` : role;
}

function stableId(prefix, id, fallback) {
  return `${prefix}:${clean(id) || hashText(String(fallback ?? ''))}`;
}

export function buildCorpus({ profile = {}, jobs = [], memory = {}, answers = [] } = {}) {
  const docs = [];

  addDoc(docs, 'base-cv', 'base-cv', 'Base CV', [clean(profile.baseCv)]);

  const app = profile.applicationProfile && typeof profile.applicationProfile === 'object' ? profile.applicationProfile : {};
  const profileLines = [];
  for (const [key, label] of PROFILE_FIELDS) {
    const value = clean(app[key]);
    if (value) profileLines.push(`${label}: ${value}`);
  }
  const defaults = clean(profile.applicationDefaultsText);
  if (defaults) profileLines.push(`Other application notes: ${defaults}`);
  addDoc(docs, 'profile', 'profile', 'Application profile', profileLines);

  for (const job of Array.isArray(jobs) ? jobs : []) {
    if (!job || !job.id) continue;
    const label = roleLabel(job.title, job.company);
    addDoc(docs, `tailored-cv:${job.id}`, 'tailored-cv', `Tailored CV: ${label}`, [clean(job.tailoredCvText)]);
    addDoc(docs, `cover-letter:${job.id}`, 'cover-letter', `Cover letter: ${label}`, [clean(job.tailoredCoverLetterText)]);
    addDoc(docs, `job-description:${job.id}`, 'job-description', `Job description: ${label}`, [clean(job.description)]);
  }

  for (const answer of Array.isArray(answers) ? answers : []) {
    if (!answer) continue;
    const question = clean(answer.question);
    const value = clean(answer.answer);
    addDoc(docs, stableId('answer', answer.id, question), 'answer', `Saved answer: ${question || 'Application question'}`, [
      question ? `Question: ${question}` : '',
      value ? `Answer: ${value}` : ''
    ]);
  }

  const insights = Array.isArray(memory?.insights) ? memory.insights : [];
  const byCategory = new Map();
  for (const insight of insights) {
    const text = clean(insight?.text);
    if (!text) continue;
    const category = clean(insight.category) || 'other';
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category).push(`- ${text}`);
  }
  for (const [category, lines] of byCategory) {
    addDoc(docs, `insight:${category}`, 'insight', `Candidate insights: ${category}`, lines);
  }

  for (const employer of Array.isArray(memory?.employers) ? memory.employers : []) {
    if (!employer) continue;
    const company = clean(employer.company);
    const notes = (Array.isArray(employer.notes) ? employer.notes : []).map((note) => clean(note)).filter(Boolean);
    addDoc(docs, stableId('employer', employer.id, company), 'employer', `Employer notes: ${company || 'Unknown company'}`, [
      company ? `Company: ${company}` : '',
      ...notes.map((note) => `- ${note}`)
    ]);
  }

  const applications = Array.isArray(memory?.applications) ? memory.applications : [];
  addDoc(docs, 'application', 'application', 'Application history', applications.map((entry) => {
    if (!entry) return '';
    const role = roleLabel(entry.title, entry.company);
    const outcome = clean(entry.outcome) || 'applied';
    const when = clean(entry.appliedAt);
    return `- ${role}: ${outcome}${when ? ` (${when})` : ''}`;
  }));

  docs.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  return docs;
}

export function corpusSignature(docs = []) {
  return hashText((Array.isArray(docs) ? docs : [])
    .map((doc) => `${doc.id}:${hashText(doc.text)}`)
    .sort()
    .join('\n'));
}

function joinList(parts) {
  if (parts.length <= 1) return parts[0] || '';
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

export function describeCorpus(docs = []) {
  const counts = {};
  for (const doc of Array.isArray(docs) ? docs : []) {
    counts[doc.kind] = (counts[doc.kind] || 0) + 1;
  }
  const parts = KIND_ORDER.filter((kind) => counts[kind]).map((kind) => {
    const label = KIND_LABELS[kind];
    return `${counts[kind]} ${counts[kind] === 1 ? label.one : label.many}`;
  });
  return {
    searched: parts.length ? `I searched ${joinList(parts)}.` : 'There were no saved documents to search.',
    missing: SOURCE_KINDS.filter((kind) => !counts[kind]).map((kind) => KIND_LABELS[kind].one)
  };
}
