// Secret/key helpers. Keep scrubbing every provider's key shape (defence in depth).

const KEY_PATTERNS = [
  /sk-ant-[A-Za-z0-9_-]{8,}/g,   // Anthropic
  /sk-or-[A-Za-z0-9_-]{8,}/g,    // OpenRouter
  /AIza[0-9A-Za-z_-]{20,}/g      // Google API keys
];

/** Redact anything key-shaped from a string (log lines, error messages). */
export function scrubSecrets(s) {
  let out = String(s == null ? '' : s);
  for (const re of KEY_PATTERNS) out = out.replace(re, '•••redacted-key•••');
  return out;
}

/** Trim, strip surrounding quotes, and drop internal whitespace/newlines from a pasted key. */
export function normalizeKeyInput(s) {
  let out = String(s == null ? '' : s).trim();
  out = out.replace(/^["'`]+|["'`]+$/g, '');
  return out.replace(/\s+/g, '');
}

const ANTHROPIC_KEY_RE = /^sk-ant-api\d{2}-[A-Za-z0-9_-]{20,}$/;

export function isAnthropicKeyShape(s) {
  return typeof s === 'string' && ANTHROPIC_KEY_RE.test(s);
}

export function isAdminKeyShape(s) {
  return typeof s === 'string' && s.startsWith('sk-ant-admin');
}
