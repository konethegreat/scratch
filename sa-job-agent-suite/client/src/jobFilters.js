import { DEFAULT_VIEW_FILTERS, normalizeViewFilters } from '@sajas/core/jobs';

export const JOB_FILTERS_KEY = 'sajas.jobFilters.v1';

export function loadJobFilters() {
  try {
    const raw = globalThis.localStorage?.getItem(JOB_FILTERS_KEY);
    if (!raw) return { ...DEFAULT_VIEW_FILTERS };
    return normalizeViewFilters(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_VIEW_FILTERS };
  }
}

export function saveJobFilters(filters) {
  try {
    const normalized = normalizeViewFilters(filters);
    // A visitor who never touches the filters leaves no trace behind. Both
    // objects come from the same constructor order, so the JSON is comparable.
    if (JSON.stringify(normalized) === JSON.stringify(DEFAULT_VIEW_FILTERS)) {
      globalThis.localStorage?.removeItem(JOB_FILTERS_KEY);
      return;
    }
    globalThis.localStorage?.setItem(JOB_FILTERS_KEY, JSON.stringify(normalized));
  } catch {
    // Storage can be unavailable in private mode; the view still works.
  }
}
