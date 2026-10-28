const LABELS = Object.freeze({
  structured: 'structured data',
  dom: 'page layout',
  semantic: 'semantic layout',
  ai: 'AI assist',
  mixed: 'mixed',
  none: 'none',
  css: 'page layout',
  jsonld: 'structured data',
  'ai-extract': 'AI assist'
});

export function viaLabel(value) {
  const key = String(value || '').toLowerCase();
  return LABELS[key] || value || '';
}
