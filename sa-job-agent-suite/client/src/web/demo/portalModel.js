const IDENTITY_KEYS = new Set([
  'fullName', 'firstName', 'lastName', 'preferredName', 'email', 'phone',
  'linkedInUrl', 'portfolioUrl', 'githubUrl', 'city', 'province', 'postalCode',
  'country', 'currentCompany', 'currentTitle', 'yearsExperience', 'highestQualification'
]);

export function portalSections(fields = [], employerKeys = new Set()) {
  const fromEmployer = employerKeys.size
    ? (field) => employerKeys.has(field.key)
    : (field) => field.source === 'answer-bank';
  const identity = fields.filter((field) => IDENTITY_KEYS.has(field.key));
  const employer = fields.filter((field) => !IDENTITY_KEYS.has(field.key) && fromEmployer(field));
  const eligibility = fields.filter(
    (field) => !IDENTITY_KEYS.has(field.key) && !fromEmployer(field)
  );
  return [
    { id: 'identity', title: 'Your details', fields: identity },
    { id: 'eligibility', title: 'Eligibility and availability', fields: eligibility },
    { id: 'employer', title: "This employer's questions", fields: employer }
  ].filter((section) => section.fields.length);
}

export function withEdits(fields = [], edits = {}) {
  return fields.map((field) => (
    Object.prototype.hasOwnProperty.call(edits, field.key)
      ? { ...field, value: String(edits[field.key] ?? '').trim() }
      : field
  ));
}

export function submissionFields(fields = []) {
  return fields
    .filter((field) => field.key && field.label)
    .map(({ key, label, value }) => ({ key, label, value: String(value ?? '').trim() }));
}
