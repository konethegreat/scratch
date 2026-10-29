// Suggested-step progress for the demo. It lives in the demo namespace, so the
// exit wipe removes it with everything else.
export const DEMO_PROGRESS_KEY = 'sajas:demo:progress';

export const DEMO_STEPS = Object.freeze([
  { id: 'feeds', label: 'Browse feeds', tab: 'feeds' },
  { id: 'tailor', label: 'Tailor a CV', tab: 'tailor' },
  { id: 'ask', label: 'Ask a question', tab: 'ask' },
  { id: 'hunter', label: 'Run the Hunter', tab: 'hunter' },
  { id: 'copilot', label: 'Watch the copilot apply', tab: 'copilot' }
]);

function store() {
  try {
    return globalThis.sessionStorage || null;
  } catch {
    return null;
  }
}

export function loadDemoProgress() {
  const session = store();
  const raw = session ? session.getItem(DEMO_PROGRESS_KEY) : null;
  if (!raw) return { done: [], dismissed: false };
  try {
    const parsed = JSON.parse(raw);
    return {
      done: Array.isArray(parsed.done) ? parsed.done.filter((id) => typeof id === 'string') : [],
      dismissed: Boolean(parsed.dismissed)
    };
  } catch {
    return { done: [], dismissed: false };
  }
}

export function saveDemoProgress(progress) {
  const session = store();
  if (session) {
    try {
      session.setItem(DEMO_PROGRESS_KEY, JSON.stringify(progress));
    } catch {
      // The strip still works in memory for this render.
    }
  }
  return progress;
}

export function markStepDone(id) {
  const current = loadDemoProgress();
  if (!DEMO_STEPS.some((step) => step.id === id) || current.done.includes(id)) return current;
  return saveDemoProgress({ ...current, done: [...current.done, id] });
}

export function dismissDemoStrip() {
  return saveDemoProgress({ ...loadDemoProgress(), dismissed: true });
}
