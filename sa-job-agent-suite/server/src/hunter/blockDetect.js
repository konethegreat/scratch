/**
 * Block-page detection for the scrapers. Pure: no Playwright, no I/O.
 *
 * A bot-wall, a rate limit or a login wall returns a perfectly valid page with
 * zero job cards, which would otherwise look exactly like "no jobs matched".
 * Naming the cause lets the hunter report it and keep source health honest.
 *
 * @param {{ status?: number|null, title?: string, text?: string, url?: string }} a
 *   `text` is the visible body text (only its first 2,000 characters are read).
 * @returns {{ blocked: boolean, kind: 'challenge'|'denied'|'rate-limit'|'login'|null }}
 */

const CHALLENGE_RE = /just a moment|attention required|access denied|verify you are human|are you a robot|captcha|unusual traffic|cloudflare/i;
const LOGIN_RE = /sign in|log in|login/i;
const PASSWORD_RE = /password/i;

/** A 401/403 body shorter than this carries no real page, only a refusal. */
const SHORT_BODY_CHARS = 200;
/** How much of the page text the heuristics look at. */
const TEXT_WINDOW = 2000;

function pathOf(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

export function detectBlock({ status = null, title = '', text = '', url = '' } = {}) {
  const t = typeof title === 'string' ? title : '';
  const body = typeof text === 'string' ? text.slice(0, TEXT_WINDOW) : '';

  if (status === 429) return { blocked: true, kind: 'rate-limit' };
  if ((status === 403 || status === 401) && body.trim().length < SHORT_BODY_CHARS) {
    return { blocked: true, kind: 'denied' };
  }
  if (CHALLENGE_RE.test(t) || CHALLENGE_RE.test(body)) return { blocked: true, kind: 'challenge' };
  if ((LOGIN_RE.test(t) || LOGIN_RE.test(pathOf(url))) && PASSWORD_RE.test(body)) {
    return { blocked: true, kind: 'login' };
  }
  return { blocked: false, kind: null };
}
