// Last free resort before AI: read cards from semantic attributes, headings and
// heading anchors. The snapshot runs in the page; extraction is pure Node so it
// stays unit-testable without a browser.
import { absolutize, dedupeCards } from './structured.js';

const textOf = (value) => (typeof value === 'string' ? value.trim() : '');

// Runs inside the page. Self-contained on purpose.
export function snapshotCandidatesInPage({ maxCards = 100 } = {}) {
  const SELECTOR = 'article, li, [role="listitem"], [data-job-id], [data-jobid], [data-testid*="job" i], [class*="job" i], [class*="vacanc" i], [class*="position" i]';
  const clip = (value, max) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
  const attr = (element, name) => element.getAttribute(name) || '';
  const all = Array.from(document.querySelectorAll(SELECTOR));
  const useful = all.filter((element) => element.querySelector('h1, h2, h3, h4, h5, h6') && element.querySelector('a[href]'));
  const roots = (useful.length ? useful : all)
    .filter((element) => !useful.some((other) => other !== element && element.contains(other)))
    .slice(0, maxCards);
  return roots.map((element) => ({
    tag: element.tagName.toLowerCase(),
    className: clip(attr(element, 'class'), 200),
    testId: clip(attr(element, 'data-testid'), 100),
    ariaLabel: clip(attr(element, 'aria-label'), 300),
    itemprops: Array.from(element.querySelectorAll('[itemprop]')).slice(0, 40).map((node) => ({
      name: attr(node, 'itemprop'),
      text: clip(node.getAttribute('content') || node.getAttribute('href') || node.textContent, 300)
    })),
    headings: Array.from(element.querySelectorAll('h1, h2, h3, h4, h5, h6')).slice(0, 10).map((heading) => ({
      tag: heading.tagName.toLowerCase(),
      text: clip(heading.textContent, 300)
    })),
    links: Array.from(element.querySelectorAll('a[href]')).slice(0, 20).map((link) => ({
      href: attr(link, 'href'),
      text: clip(link.textContent, 200),
      className: clip(attr(link, 'class'), 200)
    })),
    fields: Array.from(element.querySelectorAll('[class], [itemprop], time')).slice(0, 40).map((node) => ({
      className: clip(attr(node, 'class'), 200),
      itemprop: clip(attr(node, 'itemprop'), 100),
      tag: node.tagName.toLowerCase(),
      text: clip(node.getAttribute('datetime') || node.textContent, 300)
    })),
    text: clip(element.innerText || element.textContent, 2000)
  }));
}

const byProp = (card, name) => (card.itemprops || []).find((entry) => entry.name === name)?.text || '';

const byClass = (card, words) => {
  for (const field of card.fields || []) {
    const classes = String(field.className || '').toLowerCase();
    if (!words.some((word) => classes.includes(word))) continue;
    const text = String(field.text || '').trim();
    if (text) return text;
  }
  return '';
};

const headingOf = (card) => (card.headings || []).map((heading) => heading.text).find((text) => text && text.length >= 4) || '';

const ageOf = (card) => {
  const field = byClass(card, ['date', 'posted', 'age']);
  if (field && field.length <= 100) return field;
  const match = /(posted\s+)?(yesterday|today|\d+\s*(hour|day|week|month)s?\s+ago)/i.exec(card.text || '');
  return match ? match[0].slice(0, 100) : '';
};

export function extractSemanticCards(snapshot, { origin = '', linkless = false, maxCards = 100 } = {}) {
  const cards = [];
  for (const card of (Array.isArray(snapshot) ? snapshot : []).slice(0, maxCards)) {
    if (!card || typeof card !== 'object') continue;
    const title = textOf(byProp(card, 'title'))
      || textOf(byProp(card, 'name'))
      || headingOf(card)
      || textOf(card.ariaLabel).split('|')[0].trim();
    if (title.length < 4) continue;
    const links = Array.isArray(card.links) ? card.links : [];
    const chosen = links.find((link) => /url|apply|job|vacanc/i.test(`${link.className} ${link.text}`)) || links[0];
    const applyUrl = absolutize(chosen?.href, origin);
    if (!linkless && !applyUrl) continue;
    cards.push({
      title,
      company: textOf(byProp(card, 'hiringOrganization')) || byClass(card, ['company', 'employer', 'advertiser', 'org']),
      location: textOf(byProp(card, 'jobLocation')) || byClass(card, ['location', 'place', 'area', 'city', 'region']),
      description: textOf(byProp(card, 'description')) || String(card.text || '').slice(0, 5000),
      applyUrl,
      datePosted: ageOf(card)
    });
  }
  return dedupeCards(cards);
}
