// The beta notice shown in the hosted app until the visitor dismisses this
// version of it. Bumping the version brings the notice back for everyone.
export const BETA_KEY = 'sajas.betaNotice.v1';

export const BETA_NOTICE = Object.freeze({
  version: '2026-10-30',
  body: 'SA-JAS is in open beta. Features can change without notice, and everything you enter stays in this browser. Read the terms and the privacy notice in Help.'
});

export function loadBetaDismissed(storage = globalThis.localStorage) {
  try {
    return storage?.getItem(BETA_KEY) === BETA_NOTICE.version;
  } catch {
    return false;
  }
}

export function saveBetaDismissed(storage = globalThis.localStorage) {
  try {
    storage?.setItem(BETA_KEY, BETA_NOTICE.version);
  } catch {
    // Storage can be blocked; the notice stays dismissed for this visit.
  }
}
