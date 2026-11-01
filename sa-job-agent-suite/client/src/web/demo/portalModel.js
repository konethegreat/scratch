const IDENTITY_KEYS = new Set([
  'fullName', 'firstName', 'lastName', 'preferredName', 'email', 'phone',
  'linkedInUrl', 'portfolioUrl', 'githubUrl', 'city', 'province', 'postalCode',
  'country', 'currentCompany', 'currentTitle', 'yearsExperience', 'highestQualification'
]);

export function portalSections(fields = []) {
  const identity = fields.filter((field) => IDENTITY_KEYS.has(field.key));
  const employer = fields.filter((field) => field.source === 'answer-bank');
  const eligibility = fields.filter(
    (field) => !IDENTITY_KEYS.has(field.key) && field.source !== 'answer-bank'
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
    .filter((field) => field.label && field.value)
    .map(({ label, value }) => ({ label, value }));
}
