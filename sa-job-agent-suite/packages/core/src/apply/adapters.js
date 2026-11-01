// Host adapters carry only what differs between application portals: how to
// read a label first, which control submits, and what a confirmation looks like.
const GENERIC = Object.freeze({
  id: 'generic',
  hosts: [],
  submitSelectors: ['button[type="submit"]', 'input[type="submit"]', 'button:not([type])'],
  successSelectors: [],
  successText: /thank you for applying|application (?:was )?(?:submitted|received)|we (?:have )?received your application/i,
  priority: ['autocomplete', 'name', 'label', 'id', 'placeholder']
});

const GREENHOUSE = Object.freeze({
  id: 'greenhouse',
  hosts: ['boards.greenhouse.io', 'job-boards.greenhouse.io'],
  submitSelectors: ['#submit_app', 'button[type="submit"]'],
  successSelectors: ['.application-confirmation', '#application_confirmation'],
  successText: /thank you for applying|application submitted|we (?:have )?received your application/i,
  priority: ['id', 'name', 'label', 'autocomplete']
});

const LEVER = Object.freeze({
  id: 'lever',
  hosts: ['jobs.lever.co'],
  submitSelectors: ['.template-btn-submit', 'button[type="submit"]'],
  successSelectors: ['.application-confirmation', '.posting-confirmation'],
  successText: /thank you for applying|application submitted|we (?:have )?received your application/i,
  priority: ['name', 'label', 'id', 'autocomplete']
});

export const adapters = Object.freeze([GREENHOUSE, LEVER, GENERIC]);

export function adapterForHost(host) {
  const clean = String(host || '')
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/^www\./, '');
  return adapters.find((adapter) => adapter.hosts.includes(clean)) || GENERIC;
}
