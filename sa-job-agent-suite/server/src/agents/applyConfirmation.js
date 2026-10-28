import { randomUUID } from 'crypto';

export const CONFIRM_TTL_MS = 2 * 60 * 1000;

export function pageOrigin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

export function createPendingConfirmation({ job, pageUrl, control, fieldsFilled = 0, fileNames = [], now = Date.now(), nonce } = {}) {
  return {
    nonce: nonce || randomUUID(),
    jobId: job?.id || '',
    jobTitle: job?.title || '',
    company: job?.company || '',
    site: pageOrigin(pageUrl),
    pageUrl: String(pageUrl || ''),
    controlText: String(control?.text || ''),
    controlIndex: Number.isInteger(control?.index) ? control.index : null,
    fieldsFilled: Number(fieldsFilled) || 0,
    documents: (Array.isArray(fileNames) ? fileNames : []).slice(0, 20).map((name) => String(name).slice(0, 200)),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + CONFIRM_TTL_MS).toISOString(),
    status: 'pending'
  };
}

export function confirmationDecision(pending, { nonce, cancel = false } = {}, now = Date.now()) {
  if (!pending || pending.status !== 'pending') return { action: 'ignore' };
  if (!nonce || nonce !== pending.nonce) return { action: 'ignore' };
  const expiresAt = Date.parse(pending.expiresAt || '');
  if (Number.isFinite(expiresAt) && now > expiresAt) return { action: 'expired' };
  if (cancel) return { action: 'cancel' };
  return { action: 'approve' };
}
