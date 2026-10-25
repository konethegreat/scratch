/**
 * Process-wide single-owner lock for the persistent browser profile.
 *
 * The profile directory cannot be opened by two Chromium instances at once, so
 * a hunt, a canary run, a login-status check and an apply session must never
 * overlap. Pure and process-local: no Playwright, no I/O.
 */

export const BROWSER_LOCK_KINDS = Object.freeze(['hunt', 'canary', 'login-check', 'apply']);

let holder = null;

/**
 * @param {'hunt'|'canary'|'login-check'|'apply'} kind
 * @returns {(() => void) | null} a release function, or null when someone else holds the browser.
 *   Release is idempotent and a stale release can never free a newer holder.
 */
export function tryAcquireBrowser(kind) {
  if (!BROWSER_LOCK_KINDS.includes(kind)) {
    throw new TypeError(`unknown browser lock kind: ${String(kind)}`);
  }
  if (holder) return null;
  const mine = { kind };
  holder = mine;
  return () => {
    if (holder === mine) holder = null;
  };
}

/** The kind currently holding the browser, or null when it is free. */
export function browserOwner() {
  return holder ? holder.kind : null;
}
