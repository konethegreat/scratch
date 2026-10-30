// The beta notice shown in the hosted app until the visitor dismisses this
// version of it. Bumping the version brings the notice back for everyone.
export const BETA_KEY = 'sajas.betaNotice.v1';

export const BETA_NOTICE = Object.freeze({
  version: '2026-10-30',
  body: 'SA-JAS is in open beta. Features can change without notice. Your data is stored in this browser, and only the text an AI task needs goes to Anthropic. Read the terms and the privacy notice in Help.'
});

// Resolve the store inside the try so a blocked localStorage getter cannot
// crash startup.
function store(storage) {
  try {
    return storage ?? globalThis.localStorage;
  } catch {
    return null;
  }
}

export function loadBetaDismissed(storage) {
  try {
    return store(storage)?.getItem(BETA_KEY) === BETA_NOTICE.version;
  } catch {
    return false;
  }
}

export function saveBetaDismissed(storage) {
  try {
    store(storage)?.setItem(BETA_KEY, BETA_NOTICE.version);
  } catch {
    // Storage can be blocked; the notice stays dismissed for this visit.
  }
}
