/**
 * Block-page detection for the scrapers. Pure: no Playwright, no I/O.
 *
 * A bot-wall, a rate limit or a login wall returns a perfectly valid page with
 * zero job cards, which would otherwise look exactly like "no jobs matched".
 * Naming the cause lets the hunter report it and keep source health honest.
 *
 * Signals have different strengths:
 *  - STRONG (`status`, `title`, `url`): HTTP 429, a short 401/403, a challenge
 *    title, a login title/path with a password field. The caller should treat
 *    the page as blocked and skip extraction.
 *  - SOFT (`text`): interstitial wording in the body text only. Real job boards
 *    mention such phrases in cookie banners and descriptions, so the caller
 *    should still try extraction and only keep the block when nothing is found.
 *
 * @param {{ status?: number|null, title?: string, text?: string, url?: string }} a
 *   `text` is the visible body text (only its first 2,000 characters are read).
 * @returns {{ blocked: boolean, kind: 'challenge'|'denied'|'rate-limit'|'login'|null,
 *   signal: 'status'|'title'|'url'|'text'|null }}
 */

/** Full list: used on the TITLE, where a hit is unambiguous. */
const TITLE_CHALLENGE_RE = /just a moment|attention required|access denied|verify you are human|are you a robot|captcha|unusual traffic|cloudflare/i;
/** Narrow list of interstitial phrases only: used on the body text. No bare "captcha"/"cloudflare". */
const TEXT_CHALLENGE_RE = /just a moment|checking your browser|verify you are human|are you a robot|attention required|access denied|unusual traffic|ray id|performance (&|and) security by cloudflare/i;
const LOGIN_RE = /\b(?:sign[\s-]?in|log[\s-]?in|login)\b/i;
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

export function detectBlock(input) {
  const { status = null, title = '', text = '', url = '' } = input ?? {};
  const t = typeof title === 'string' ? title : '';
  const body = typeof text === 'string' ? text.slice(0, TEXT_WINDOW) : '';

  if (status === 429) return { blocked: true, kind: 'rate-limit', signal: 'status' };
  if ((status === 403 || status === 401) && body.trim().length < SHORT_BODY_CHARS) {
    return { blocked: true, kind: 'denied', signal: 'status' };
  }
  if (TITLE_CHALLENGE_RE.test(t)) return { blocked: true, kind: 'challenge', signal: 'title' };
  if (PASSWORD_RE.test(body)) {
    if (LOGIN_RE.test(t)) return { blocked: true, kind: 'login', signal: 'title' };
    if (LOGIN_RE.test(pathOf(url))) return { blocked: true, kind: 'login', signal: 'url' };
  }
  if (TEXT_CHALLENGE_RE.test(body)) return { blocked: true, kind: 'challenge', signal: 'text' };
  return { blocked: false, kind: null, signal: null };
}
