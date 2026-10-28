import { listControls } from './controls.js';
import { classifyControl } from './submitGuard.js';

const MAX_FIELDS = 80;
const MAX_VALUE = 500;
const MAX_LABEL = 120;

export async function scanSubmitControls(page) {
  const controls = await listControls(page);
  const submit = controls.find((control) => classifyControl(control.text, { onFormPage: true }) === 'final-submit') || null;
  const advance = controls.find((control) => classifyControl(control.text, { onFormPage: true }) === 'advance') || null;
  return { submit, advance };
}

export async function captureFieldSnapshot(page) {
  let rows = [];
  try {
    rows = await page.evaluate(() => {
      const out = [];
      for (const element of document.querySelectorAll('input, textarea, select')) {
        if (['file', 'password', 'hidden'].includes(element.type)) continue;
        if (!element.value) continue;
        if (!element.getClientRects().length) continue;
        let label = element.getAttribute('aria-label') || '';
        if (!label && element.labels && element.labels[0]) label = element.labels[0].innerText || '';
        if (!label) label = element.getAttribute('name') || element.id || '';
        out.push({ label: String(label).replace(/\s+/g, ' ').trim(), value: String(element.value) });
      }
      return out;
    });
  } catch {
    return [];
  }
  return (Array.isArray(rows) ? rows : [])
    .slice(0, MAX_FIELDS)
    .map((row) => ({ label: String(row.label || '').slice(0, MAX_LABEL), value: String(row.value || '').slice(0, MAX_VALUE) }))
    .filter((row) => row.label && row.value);
}

export async function attachedFileNames(page) {
  try {
    const names = await page.evaluate(() => Array.from(document.querySelectorAll('input[type=file]'))
      .flatMap((element) => Array.from(element.files || []).map((file) => file.name)));
    return Array.isArray(names) ? names.slice(0, 20).map((name) => String(name).slice(0, 200)) : [];
  } catch {
    return [];
  }
}

export function documentsFromFiles(fileNames) {
  return (Array.isArray(fileNames) ? fileNames : []).slice(0, 20).map((fileName, index) => ({
    key: `attachment-${index + 1}`,
    label: 'Attached document',
    fileName: String(fileName).slice(0, 200)
  }));
}

export async function confirmationExcerpt(page) {
  try {
    const text = await page.evaluate(() => String(document.body?.innerText || ''));
    return String(text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_VALUE);
  } catch {
    return '';
  }
}
