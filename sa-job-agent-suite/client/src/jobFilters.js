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
    globalThis.localStorage?.setItem(JOB_FILTERS_KEY, JSON.stringify(normalizeViewFilters(filters)));
  } catch {
    // Storage can be unavailable in private mode; the view still works.
  }
}
