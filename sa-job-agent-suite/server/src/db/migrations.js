// Profile schema migrations. Pure functions only (no fs) so they can be applied
// on every read and unit-tested directly.
import { modelSpec } from '@sajas/core';

export const PROFILE_SCHEMA_VERSION = 2;
export const LEGACY_PROFILE_FIELDS = ['aiProvider'];
export const LEGACY_KEY_FIELDS = ['geminiApiKey', 'openRouterApiKey'];

const MODEL_FIELDS = ['selectedModel', 'aiSearchModel', 'computerUseModel'];

/**
 * Bring a stored profile up to schema v2: Anthropic-only, registry model IDs
 * only. Pure and idempotent; never mutates its input.
 */
export function migrateProfile(profile) {
  const out = { ...(profile || {}) };
  for (const f of LEGACY_PROFILE_FIELDS) delete out[f];
  for (const f of MODEL_FIELDS) {
    const v = out[f];
    if (typeof v === 'string' && v !== '' && modelSpec(v) === null) out[f] = '';
  }
  if (out.computerUseMaxSteps !== undefined) {
    const n = parseInt(out.computerUseMaxSteps, 10);
    out.computerUseMaxSteps = Number.isFinite(n) ? Math.min(40, Math.max(1, n)) : 20;
  }
  out.schemaVersion = PROFILE_SCHEMA_VERSION;
  return out;
}
