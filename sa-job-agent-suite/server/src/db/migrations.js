// Profile schema migrations. Pure functions only (no fs) so they can be applied
// on every read and unit-tested directly.
import { modelSpec, MODEL_IDS } from '@sajas/core';

export const PROFILE_SCHEMA_VERSION = 2;
export const LEGACY_PROFILE_FIELDS = ['aiProvider'];
export const LEGACY_KEY_FIELDS = ['geminiApiKey', 'openRouterApiKey'];

const MODEL_FIELDS = ['selectedModel', 'aiSearchModel', 'computerUseModel'];
const FAMILY = /haiku|sonnet|opus|fable/i;

/**
 * Registry ID for a stored model value. A registry ID is kept; an older Claude
 * ID maps to the SAME family's current registry ID (so a Token Saver user's
 * Haiku never silently becomes Sonnet, ~20x the input price); anything else
 * (non-Claude, or no recognisable family) becomes '' (= the task default).
 */
function migrateModelId(v) {
  if (modelSpec(v) !== null) return v;
  if (!v.toLowerCase().startsWith('claude')) return '';
  const family = (v.match(FAMILY) || [])[0];
  return family ? MODEL_IDS[family.toLowerCase()] : '';
}

/**
 * Bring a stored profile up to schema v2: Anthropic-only, registry model IDs
 * only (legacy Claude IDs map to their family's current registry ID). Pure and idempotent; never mutates its input.
 */
export function migrateProfile(profile) {
  const out = { ...(profile || {}) };
  for (const f of LEGACY_PROFILE_FIELDS) delete out[f];
  for (const f of MODEL_FIELDS) {
    const v = out[f];
    if (typeof v === 'string' && v !== '') out[f] = migrateModelId(v);
  }
  if (out.computerUseMaxSteps !== undefined) {
    const n = parseInt(out.computerUseMaxSteps, 10);
    out.computerUseMaxSteps = Number.isFinite(n) ? Math.min(40, Math.max(1, n)) : 20;
  }
  out.schemaVersion = PROFILE_SCHEMA_VERSION;
  return out;
}
