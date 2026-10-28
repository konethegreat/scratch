import { VALUE_CAP, LABEL_CAP } from './packet.js';

export const SUBMISSION_DELIVERIES = Object.freeze(['web-guided', 'desktop-copilot']);
export const SUBMISSION_SUBMITTERS = Object.freeze(['user', 'copilot-confirmed']);
const MAX_FIELDS = 80;
const MAX_DOCUMENTS = 20;

function text(value, cap) {
  return String(value == null ? '' : value).trim().slice(0, cap);
}

export function cleanSubmission({ documents = [], fields = [], confirmation = null } = {}) {
  const cleanDocuments = (Array.isArray(documents) ? documents : [])
    .slice(0, MAX_DOCUMENTS)
    .map((doc) => ({
      key: text(doc?.key, 40),
      label: text(doc?.label, LABEL_CAP),
      fileName: text(doc?.fileName, 200)
    }))
    .filter((doc) => doc.key && doc.label);

  const cleanFields = (Array.isArray(fields) ? fields : [])
    .slice(0, MAX_FIELDS)
    .map((field) => ({
      label: text(field?.label, LABEL_CAP),
      value: text(field?.value, VALUE_CAP)
    }))
    .filter((field) => field.label && field.value);

  let cleanConfirmation = null;
  if (confirmation && typeof confirmation === 'object') {
    const confirmedAt = text(confirmation.confirmedAt, 40);
    const label = text(confirmation.text, VALUE_CAP);
    if (confirmedAt || label) cleanConfirmation = { confirmedAt, text: label };
  }

  return { documents: cleanDocuments, fields: cleanFields, confirmation: cleanConfirmation };
}

export function summariseSubmission(packet, { delivery, submittedBy = 'user', fields = null, confirmation = null } = {}) {
  if (!SUBMISSION_DELIVERIES.includes(delivery)) {
    throw new TypeError(`Unknown application delivery: ${delivery}`);
  }
  if (!SUBMISSION_SUBMITTERS.includes(submittedBy)) {
    throw new TypeError(`Unknown application submitter: ${submittedBy}`);
  }
  const available = (packet?.documents || []).filter((doc) => doc.available);
  const sourceFields = fields || [
    ...(packet?.identity || []),
    ...(packet?.questions || [])
  ].map(({ label, value }) => ({ label, value }));
  const clean = cleanSubmission({ documents: available, fields: sourceFields, confirmation });
  return {
    delivery,
    submittedBy,
    site: packet?.job?.site || '',
    ...clean
  };
}
