// Pure job-card validation shared by every extraction strategy. No I/O.
export const CARD_LIMITS = Object.freeze({
  titleMin: 4,
  titleMax: 300,
  companyMax: 200,
  locationMax: 200,
  descriptionMax: 5000,
  datePostedMax: 100,
  sourceMax: 100,
  urlMax: 500
});

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value) => (typeof value === 'string' ? value.trim() : '');

export function isHttpUrl(value) {
  const raw = text(value);
  if (!raw || raw.length > CARD_LIMITS.urlMax) return false;
  try {
    const url = new URL(raw);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.length > 0;
  } catch {
    return false;
  }
}

function copyOptional(raw, key, max, value) {
  const trimmed = text(raw[key]);
  if (trimmed && trimmed.length <= max) value[key] = trimmed;
}

export function validateJobCard(raw, { linkless = false } = {}) {
  if (!isObject(raw)) {
    return { ok: false, value: null, issues: [{ field: 'row', code: 'invalid-row', message: 'not a job card object' }] };
  }
  const issues = [];
  const title = text(raw.title);
  if (title.length < CARD_LIMITS.titleMin) {
    issues.push({ field: 'title', code: 'title-required', message: `title needs at least ${CARD_LIMITS.titleMin} characters` });
  } else if (title.length > CARD_LIMITS.titleMax) {
    issues.push({ field: 'title', code: 'title-too-long', message: `title is over ${CARD_LIMITS.titleMax} characters` });
  }

  const applyUrl = text(raw.applyUrl ?? raw.url);
  if (!applyUrl && !linkless) {
    issues.push({ field: 'applyUrl', code: 'url-required', message: 'applyUrl is missing' });
  } else if (applyUrl && !isHttpUrl(applyUrl)) {
    issues.push({ field: 'applyUrl', code: 'url-invalid', message: 'applyUrl is not an absolute http(s) link' });
  }

  if (issues.length) return { ok: false, value: null, issues };

  const value = { title };
  if (applyUrl) value.applyUrl = applyUrl;
  copyOptional(raw, 'company', CARD_LIMITS.companyMax, value);
  copyOptional(raw, 'location', CARD_LIMITS.locationMax, value);
  copyOptional(raw, 'description', CARD_LIMITS.descriptionMax, value);
  copyOptional(raw, 'datePosted', CARD_LIMITS.datePostedMax, value);
  copyOptional(raw, 'source', CARD_LIMITS.sourceMax, value);
  return { ok: true, value, issues: [] };
}

const REASON_TEXT = Object.freeze({
  'invalid-row': 'not a job card',
  'title-required': 'no usable title',
  'title-too-long': 'an overlong title',
  'url-required': 'no apply link',
  'url-invalid': 'a link that is not a web address'
});

export function validateJobCards(list, options = {}) {
  const rows = Array.isArray(list) ? list : [];
  const valid = [];
  const rejected = [];
  const counts = new Map();
  for (const row of rows) {
    const result = validateJobCard(row, options);
    if (result.ok) {
      valid.push(result.value);
      continue;
    }
    rejected.push({ row, issues: result.issues });
    const code = result.issues[0]?.code || 'invalid-row';
    counts.set(code, (counts.get(code) || 0) + 1);
  }
  const rejectReasons = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([code, n]) => `${n} ${n === 1 ? 'row' : 'rows'} with ${REASON_TEXT[code] || REASON_TEXT['invalid-row']}`);
  return { valid, rejected, rejectReasons };
}
