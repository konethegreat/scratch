// Bounds for untrusted feed text. Everything that reaches the vault or the DOM
// passes through one of these helpers first.
export const MAXES = Object.freeze({
  title: 300,
  company: 200,
  location: 200,
  description: 20000,
  url: 2000,
  tags: 10,
  tag: 40,
  salary: 120
});

export class FeedShapeError extends Error {
  constructor(source, detail) {
    super(`${source} sent data this app does not understand.`);
    this.name = 'FeedShapeError';
    this.source = source;
    this.detail = detail;
  }
}

export function clip(value, max) {
  return String(value == null ? '' : value).slice(0, max);
}

const ENTITIES = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'"
};

export function plainText(value, max = MAXES.description) {
  return String(value == null ? '' : value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(nbsp|amp|lt|gt|quot|#39|apos);/g, (match) => ENTITIES[match] || ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function httpUrl(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.href.slice(0, MAXES.url);
  } catch {
    return '';
  }
}

export function dateOnly(value) {
  if (value == null || value === '') return '';
  const raw = String(value).trim();
  const direct = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (direct) return direct[1];
  const numeric = typeof value === 'number' ? value : /^\d+$/.test(raw) ? Number(raw) : NaN;
  const date = Number.isFinite(numeric)
    ? new Date((numeric > 1e12 ? numeric : numeric * 1000))
    : new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getUTCFullYear();
  if (year < 1990 || year > 2100) return '';
  return date.toISOString().slice(0, 10);
}

const REMOTE = /remote|worldwide|anywhere|work from home|distributed/i;

export function looksRemote(...values) {
  return values.some((value) => REMOTE.test(String(value || '')));
}

export function makeRawJob(source, row) {
  const title = plainText(row.title, MAXES.title);
  const company = plainText(row.company, MAXES.company);
  if (!title || !company) return null;
  const tags = Array.isArray(row.tags)
    ? [...new Set(row.tags.map((tag) => clip(tag, MAXES.tag).trim()).filter(Boolean))].slice(0, MAXES.tags)
    : [];
  return {
    source,
    sourceId: clip(row.sourceId, 200),
    title,
    company,
    location: plainText(row.location, MAXES.location),
    description: plainText(row.description, MAXES.description),
    applyUrl: httpUrl(row.applyUrl),
    datePosted: dateOnly(row.datePosted),
    remote: Boolean(row.remote),
    tags,
    salaryText: clip(row.salaryText, MAXES.salary)
  };
}
