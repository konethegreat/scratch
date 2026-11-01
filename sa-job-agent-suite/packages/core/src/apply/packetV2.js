// Packet v2 for the extension hand-off. It extends v1 display data with a
// canonical matcher list and validated attachment bytes; the desktop keeps v1.
import { LABEL_CAP, VALUE_CAP, buildApplyPacket, siteOf } from './packet.js';

export const PACKET_VERSION = 2;
export const MAX_ATTACHMENTS = 10;
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_PACKET_ID = 80;
const MAX_QUESTIONS = 200;
const MAX_FIELDS = 120;
const MAX_CHECKLIST = 30;
const MAX_WARNINGS = 30;
const MAX_BASE64 = Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const MIME_BY_KIND = {
  'tailored-cv': ['application/pdf'],
  document: ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain']
};

const text = (value, cap) => String(value == null ? '' : value).trim().slice(0, cap);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// No field on an application form needs a credential, and a provider key must
// never travel in a packet, so both the builder and the sanitiser drop or
// refuse anything that names or looks like one.
const SECRET_FIELD = /(?:api|access|secret|private|signing)[\s_-]?key|apikey|token|password|passphrase|credential|authorization/i;
const KEY_SHAPE = /\b(?:sk|rk)[-_](?:ant|or|proj|svcacct|admin|live|test)[-_][A-Za-z0-9_-]{8,}/i;
const carriesSecret = (key, value) => SECRET_FIELD.test(key) || KEY_SHAPE.test(value);

export function looksLikeCredential(key, value) {
  return carriesSecret(text(key, 120), text(value, VALUE_CAP));
}

function money(amount, period) {
  const number = Number(amount);
  if (!Number.isFinite(number) || number <= 0) return '';
  const grouped = String(Math.round(number)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `R ${grouped} per ${period === 'year' ? 'year' : 'month'}`;
}

function toBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

function byteLength(dataBase64) {
  return atob(dataBase64).length;
}

function attachmentOf(raw, seen) {
  if (!isObject(raw)) throw new TypeError('An attachment was not a record.');
  const key = text(raw.key, 40);
  const kind = text(raw.kind, 20);
  const label = text(raw.label, LABEL_CAP);
  const fileName = text(raw.fileName, 200);
  const mime = text(raw.mime, 120);
  if (!key || !label || !fileName) throw new TypeError('An attachment was missing its name.');
  if (seen.has(key)) throw new TypeError('Two attachments used the same key.');
  seen.add(key);
  if (!MIME_BY_KIND[kind] || !MIME_BY_KIND[kind].includes(mime)) {
    throw new TypeError('Only PDF, DOCX or text files can be attached.');
  }
  const bytes = raw.bytes instanceof Uint8Array ? raw.bytes : new Uint8Array(raw.bytes || []);
  if (!bytes.length) throw new TypeError('An attachment was empty.');
  if (bytes.length > MAX_ATTACHMENT_BYTES) throw new TypeError('Each attachment must be 8 MB or smaller.');
  return { key, kind, label, fileName, mime, size: bytes.length, dataBase64: toBase64(bytes) };
}

export function buildApplyPacketV2({
  profile = {}, job = {}, answerBank = [], documents = [], attachments = [],
  now = () => new Date(), newId = () => crypto.randomUUID()
} = {}) {
  if (!Array.isArray(attachments)) throw new TypeError('Attachments must be a list.');
  if (attachments.length > MAX_ATTACHMENTS) throw new TypeError('You can attach up to 10 files.');
  const seen = new Set();
  const cleanAttachments = attachments.map((entry) => attachmentOf(entry, seen));
  const total = cleanAttachments.reduce((sum, entry) => sum + entry.size, 0);
  if (total > MAX_TOTAL_ATTACHMENT_BYTES) throw new TypeError('Attachments must total 20 MB or less.');

  const supportingDocs = (Array.isArray(documents) ? documents : []).map((doc) => ({
    key: text(doc.key, 40), label: text(doc.label, LABEL_CAP), fileName: text(doc.fileName, 200), available: Boolean(doc.available)
  }));
  const base = buildApplyPacket({ profile, job, answerBank, supportingDocs });
  const identity = base.identity.filter((entry) => !carriesSecret(entry.key, entry.value));
  const questions = base.questions.filter((entry) => !carriesSecret(entry.key, entry.value));

  const fields = [];
  const add = (key, label, value, source = 'profile') => {
    const clean = text(value, VALUE_CAP);
    if (clean && !carriesSecret(key, clean)) fields.push({ key, label, value: clean, source });
  };
  const name = text(profile.fullName, VALUE_CAP);
  const [firstName, ...rest] = name.split(' ').filter(Boolean);
  const address = isObject(profile.address) ? profile.address : {};
  const salary = isObject(profile.salary) ? profile.salary : {};
  const history = Array.isArray(profile.workHistory) ? profile.workHistory.filter(isObject) : [];
  const current = history.find((entry) => entry.current === true) || history[0] || {};
  const answers = isObject(profile.applicationProfile) ? profile.applicationProfile : profile;

  add('fullName', 'Full name', name);
  add('firstName', 'First name', firstName || '');
  add('lastName', 'Last name', rest.join(' '));
  add('preferredName', 'Preferred name', profile.preferredName);
  add('email', 'Email address', profile.email);
  add('phone', 'Phone number', profile.phone);
  add('linkedInUrl', 'LinkedIn profile', profile.linkedInUrl);
  add('portfolioUrl', 'Portfolio or website', profile.portfolioUrl);
  add('githubUrl', 'GitHub profile', profile.githubUrl);
  add('city', 'City', address.city);
  add('province', 'Province', address.province);
  add('postalCode', 'Postal code', address.postalCode);
  add('country', 'Country', 'South Africa');
  add('currentCompany', 'Current employer', current.company);
  add('currentTitle', 'Current job title', current.title);
  add('yearsExperience', 'Years of experience', profile.yearsExperience);
  add('highestQualification', 'Highest qualification', profile.highestQualification);
  add('noticePeriod', 'Notice period', answers.noticePeriod);
  add('currentSalary', 'Current salary', money(salary.currentAmount, salary.currentPeriod));
  add('expectedSalary', 'Expected salary', money(salary.expectedAmount, salary.expectedPeriod));
  add('rightToWorkSA', 'Right to work in South Africa', answers.rightToWorkSA);
  add('willingToRelocate', 'Willing to relocate', answers.willingToRelocate);
  add('driversLicense', "Driver's licence", answers.driversLicense);
  add('ownVehicle', 'Own vehicle', answers.ownVehicle);
  add('availabilityDate', 'Available from', answers.availabilityDate);
  if (profile.eeOptIn === true) {
    add('eeRace', 'Employment equity group', answers.eeRace);
    add('gender', 'Gender', answers.gender);
    add('disability', 'Disability', answers.disability);
  }
  for (const entry of questions.filter((question) => question.source === 'answer-bank')) {
    const key = entry.key.startsWith('bank-') ? `bank:${entry.key.slice('bank-'.length)}` : entry.key;
    add(key, entry.label, entry.value, 'answer-bank');
  }

  return {
    version: PACKET_VERSION,
    packetId: text(newId(), MAX_PACKET_ID),
    createdAt: now().toISOString(),
    job: { ...base.job, applyUrl: text(job && job.applyUrl, 2000) },
    identity,
    questions,
    fields: fields.slice(0, MAX_FIELDS),
    attachments: cleanAttachments,
    checklist: base.checklist,
    warnings: base.warnings
  };
}

export function sanitisePacketV2(raw) {
  if (!isObject(raw) || raw.version !== PACKET_VERSION) throw new TypeError('That is not a version 2 apply packet.');
  const packetId = text(raw.packetId, MAX_PACKET_ID);
  if (!packetId) throw new TypeError('That packet has no id.');
  if (typeof raw.createdAt !== 'string' || Number.isNaN(Date.parse(raw.createdAt))) {
    throw new TypeError('That packet has no valid creation time.');
  }
  if (!isObject(raw.job) || !text(raw.job.id, 80)) throw new TypeError('That packet has no job.');
  let applyUrl = text(raw.job.applyUrl, 2000);
  if (applyUrl && !/^https?:\/\//i.test(applyUrl)) applyUrl = '';
  const entries = (list, cap, withSource) => {
    if (!Array.isArray(list)) throw new TypeError('That packet has an invalid field list.');
    return list.slice(0, cap).map((entry) => {
      if (!isObject(entry)) throw new TypeError('That packet has an invalid field.');
      const key = text(entry.key, 80);
      const label = text(entry.label, LABEL_CAP);
      const value = text(entry.value, VALUE_CAP);
      if (!key || !label) throw new TypeError('That packet has an invalid field.');
      if (carriesSecret(key, value)) throw new TypeError('That packet carries a field that looks like a credential.');
      return withSource ? { key, label, value, source: text(entry.source, 20) || 'profile' } : { key, label, value };
    });
  };
  const seen = new Set();
  if (!Array.isArray(raw.attachments)) throw new TypeError('That packet has no attachment list.');
  if (raw.attachments.length > MAX_ATTACHMENTS) throw new TypeError('That packet has too many attachments.');
  let total = 0;
  const attachments = raw.attachments.map((entry) => {
    if (!isObject(entry)) throw new TypeError('That packet has an invalid attachment.');
    const key = text(entry.key, 40);
    const kind = text(entry.kind, 20);
    const label = text(entry.label, LABEL_CAP);
    const fileName = text(entry.fileName, 200);
    const mime = text(entry.mime, 120);
    if (!key || !label || !fileName || seen.has(key)) throw new TypeError('That packet has an invalid attachment.');
    seen.add(key);
    if (!MIME_BY_KIND[kind] || !MIME_BY_KIND[kind].includes(mime)) throw new TypeError('That packet has an unsupported attachment type.');
    const dataBase64 = typeof entry.dataBase64 === 'string' ? entry.dataBase64 : '';
    if (!dataBase64 || dataBase64.length > MAX_BASE64 || dataBase64.length % 4 !== 0 || !BASE64.test(dataBase64)) {
      throw new TypeError('That packet has invalid base64 data.');
    }
    let size;
    try {
      size = byteLength(dataBase64);
    } catch {
      throw new TypeError('That packet has invalid base64 data.');
    }
    if (size > MAX_ATTACHMENT_BYTES) throw new TypeError('That packet has an attachment over 8 MB.');
    if (Number(entry.size) !== size) throw new TypeError('That packet has an attachment whose size does not match its data.');
    total += size;
    if (total > MAX_TOTAL_ATTACHMENT_BYTES) throw new TypeError('That packet has attachments over 20 MB in total.');
    return { key, kind, label, fileName, mime, size, dataBase64 };
  });
  const checklist = Array.isArray(raw.checklist)
    ? raw.checklist.slice(0, MAX_CHECKLIST).map((entry) => {
      const label = text(entry?.label, LABEL_CAP);
      if (KEY_SHAPE.test(label)) throw new TypeError('That packet carries a field that looks like a credential.');
      return { key: text(entry?.key, 80), label, done: entry?.done === true };
    })
    : [];
  const warnings = Array.isArray(raw.warnings)
    ? raw.warnings.slice(0, MAX_WARNINGS).map((entry) => {
      const warning = text(entry, LABEL_CAP);
      if (KEY_SHAPE.test(warning)) throw new TypeError('That packet carries a field that looks like a credential.');
      return warning;
    })
    : [];
  return {
    version: PACKET_VERSION,
    packetId,
    createdAt: raw.createdAt,
    job: { id: text(raw.job.id, 80), title: text(raw.job.title, LABEL_CAP), company: text(raw.job.company, LABEL_CAP), applyUrl, site: applyUrl ? siteOf(applyUrl) : '' },
    identity: entries(raw.identity || [], MAX_FIELDS, false),
    questions: entries(raw.questions || [], MAX_QUESTIONS, true),
    fields: entries(raw.fields || [], MAX_FIELDS, true),
    attachments,
    checklist,
    warnings
  };
}
