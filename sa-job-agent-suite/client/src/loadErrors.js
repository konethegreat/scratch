// One load failure per data source, so a successful retry clears only its own
// source and a still-failing source keeps the banner up.

export function setSourceError(state, where, info) {
  return { ...state, [where]: info };
}

export function clearSourceError(state, where) {
  if (!(where in state)) return state;
  const next = { ...state };
  delete next[where];
  return next;
}

export function firstSourceError(state) {
  return Object.values(state)[0] ?? null;
}
