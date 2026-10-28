// Maps captured payloads to raw job cards: source adapter first, then JSON-LD,
// then generic job arrays found anywhere in the captured JSON. Pure, no I/O.
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const textOf = (value) => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  return '';
};
const firstText = (...values) => {
  for (const value of values) {
    const text = textOf(value);
    if (text) return text;
  }
  return '';
};

export function stripHtml(value) {
  return String(value ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export function absolutize(value, origin = '') {
  const raw = textOf(value);
  if (!raw) return '';
  try { return new URL(raw, origin || undefined).toString(); } catch { return ''; }
}

const typeNames = (node) => {
  const type = node?.['@type'];
  return (Array.isArray(type) ? type : [type]).filter(Boolean).map((value) => String(value).toLowerCase());
};

export function isJobPosting(node) {
  return isObject(node) && typeNames(node).includes('jobposting');
}

export function locationOf(node) {
  const parts = [];
  const addText = (value) => {
    const text = stripHtml(value);
    if (text && !parts.includes(text)) parts.push(text);
  };
  const add = (location) => {
    if (!location) return;
    if (Array.isArray(location)) { location.forEach(add); return; }
    if (typeof location === 'string') { addText(location); return; }
    if (!isObject(location)) return;
    if (location.address) {
      const address = location.address;
      if (typeof address === 'string') addText(address);
      else {
        addText(address.addressLocality);
        addText(address.addressRegion);
        addText(isObject(address.addressCountry) ? address.addressCountry.name : address.addressCountry);
      }
    } else {
      addText(location.name);
    }
  };
  add(node?.jobLocation);
  add(node?.applicantLocationRequirements);
  return parts.join(', ');
}

export function mapJsonLdNode(node, origin = '') {
  const organization = node?.hiringOrganization;
  const company = isObject(organization) ? firstText(organization.name, organization.legalName) : textOf(organization);
  return {
    title: stripHtml(node?.title ?? node?.name),
    company: stripHtml(company),
    location: locationOf(node),
    description: stripHtml(node?.description),
    applyUrl: absolutize(firstText(node?.url, node?.sameAs), origin),
    datePosted: firstText(node?.datePosted)
  };
}

export function mapJsonLd(payloads = [], origin = '') {
  const items = [];
  const visit = (node) => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!isObject(node)) return;
    if (isJobPosting(node)) { items.push(mapJsonLdNode(node, origin)); return; }
    if (Array.isArray(node['@graph'])) node['@graph'].forEach(visit);
  };
  for (const entry of Array.isArray(payloads) ? payloads : []) visit(entry?.json);
  return items;
}

const TITLE_KEYS = ['title', 'jobtitle', 'positiontitle', 'position', 'role', 'jobtitletext'];
const LINK_KEYS = ['url', 'applyurl', 'link', 'joburl', 'href', 'externalurl', 'redirecturl'];
const COMPANY_KEYS = ['company', 'companyname', 'employer', 'advertiser', 'hiringorganization'];
const LOCATION_KEYS = ['location', 'city', 'town', 'place', 'area', 'locationname', 'region'];
const DESC_KEYS = ['description', 'summary', 'snippet', 'teaser'];
const DATE_KEYS = ['dateposted', 'posteddate', 'published', 'publishedat', 'createdat', 'date'];

const lower = (key) => String(key || '').toLowerCase();
const hasAnyKey = (node, keys) => Object.keys(node).some((key) => keys.includes(lower(key)));

function pick(node, keys) {
  for (const key of Object.keys(node)) {
    if (!keys.includes(lower(key))) continue;
    const value = node[key];
    const text = textOf(value);
    if (text) return text;
    if (isObject(value)) {
      const nested = firstText(value.name, value.title);
      if (nested) return nested;
    }
  }
  return '';
}

export function looksLikeJobObject(node) {
  return isObject(node) && hasAnyKey(node, TITLE_KEYS) && hasAnyKey(node, LINK_KEYS);
}

export function mapGenericObject(node, origin = '') {
  return {
    title: stripHtml(pick(node, TITLE_KEYS)),
    company: stripHtml(pick(node, COMPANY_KEYS)),
    location: stripHtml(pick(node, LOCATION_KEYS)),
    description: stripHtml(pick(node, DESC_KEYS)),
    applyUrl: absolutize(pick(node, LINK_KEYS), origin),
    datePosted: pick(node, DATE_KEYS)
  };
}

export function findJobArrays(root, { maxDepth = 12, maxNodes = 5000, maxItems = 200 } = {}) {
  const found = [];
  const queue = [{ node: root, depth: 0 }];
  let visited = 0;
  while (queue.length && visited < maxNodes) {
    const { node, depth } = queue.shift();
    visited += 1;
    if (depth > maxDepth) continue;
    if (Array.isArray(node)) {
      const jobs = node.filter(looksLikeJobObject).slice(0, maxItems);
      if (jobs.length) { found.push(jobs); continue; }
      for (const child of node.slice(0, maxItems)) {
        if (child && typeof child === 'object') queue.push({ node: child, depth: depth + 1 });
      }
      continue;
    }
    if (isObject(node)) {
      for (const value of Object.values(node)) {
        if (value && typeof value === 'object') queue.push({ node: value, depth: depth + 1 });
      }
    }
  }
  return found;
}

export function dedupeCards(items = []) {
  const seen = new Set();
  const out = [];
  for (const card of Array.isArray(items) ? items : []) {
    if (!isObject(card)) continue;
    const url = textOf(card.applyUrl).toLowerCase().replace(/#.*$/, '').replace(/\/$/, '');
    const key = url || `${textOf(card.title).toLowerCase()}::${textOf(card.company).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(card);
  }
  return out;
}

export function mapStructured(payloads = [], { source = null, origin = '' } = {}) {
  const list = Array.isArray(payloads) ? payloads : [];
  if (typeof source?.mapStructured === 'function') {
    try {
      const adapted = source.mapStructured({ payloads: list, origin });
      if (Array.isArray(adapted) && adapted.length) return dedupeCards(adapted);
    } catch { /* a broken adapter must not block the generic readers */ }
  }
  const jsonLd = mapJsonLd(list, origin);
  if (jsonLd.length) return dedupeCards(jsonLd);
  const generic = [];
  for (const entry of list) {
    for (const array of findJobArrays(entry?.json)) {
      for (const node of array) generic.push(mapGenericObject(node, origin));
    }
  }
  return dedupeCards(generic);
}
