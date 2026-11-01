// Reads a page into plain descriptors for the shared matcher, and applies the
// few DOM effects a fill needs. Everything here runs inside the job page.
const SKIP_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image']);
const CAPTCHA = 'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], .g-recaptcha, .h-captcha, [data-sitekey]';
const LABEL_CAP = 120;

const textOf = (node) => String(node?.innerText || node?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, LABEL_CAP);

export function visible(element) {
  if (!element || element.hidden) return false;
  const view = element.ownerDocument?.defaultView;
  const style = view?.getComputedStyle?.(element);
  if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) return false;
  const rect = element.getBoundingClientRect?.();
  if (rect && rect.width === 0 && rect.height === 0) return false;
  return true;
}

export function labelOf(element) {
  const aria = element.getAttribute('aria-label');
  if (aria) return textOf({ textContent: aria });
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const owner = element.ownerDocument;
    const parts = labelledBy.split(/\s+/).map((id) => textOf(owner.getElementById(id))).filter(Boolean);
    if (parts.length) return parts.join(' ').slice(0, LABEL_CAP);
  }
  if (element.id) {
    const escaped = String(element.id).replace(/["\\]/g, '\\$&');
    const explicit = element.ownerDocument?.querySelector(`label[for="${escaped}"]`);
    if (explicit) return textOf(explicit);
  }
  const wrapping = element.closest?.('label');
  if (wrapping) return textOf(wrapping);
  return textOf({ textContent: element.placeholder || '' });
}

function radioOptions(element) {
  const name = element.name;
  if (!name) return [];
  const group = element.ownerDocument.querySelectorAll(`input[type="radio"][name="${String(name).replace(/["\\]/g, '\\$&')}"]`);
  return [...group].map((radio) => ({ value: radio.value, label: labelOf(radio) || radio.value }));
}

export function describeFields(root) {
  const scope = root || globalThis.document;
  if (!scope?.querySelectorAll) return [];
  const descriptors = [];
  for (const element of scope.querySelectorAll('input, select, textarea')) {
    const tag = element.tagName.toLowerCase();
    const type = tag === 'select' ? 'select' : (element.type || 'text').toLowerCase();
    if (SKIP_TYPES.has(type)) continue;
    const descriptor = {
      element,
      id: element.id || '',
      name: element.name || '',
      type,
      label: labelOf(element),
      placeholder: element.placeholder || '',
      autocomplete: element.getAttribute('autocomplete') || '',
      visible: visible(element),
      disabled: element.disabled === true || element.getAttribute('aria-disabled') === 'true'
    };
    if (type === 'select') {
      descriptor.options = [...element.options].map((option) => ({ value: option.value, label: textOf(option) || option.value }));
    } else if (type === 'radio') {
      descriptor.options = radioOptions(element);
    }
    descriptors.push(descriptor);
  }
  return descriptors;
}

export function hasCaptcha(root) {
  return Boolean((root || globalThis.document)?.querySelector?.(CAPTCHA));
}

export function base64ToBytes(value) {
  const binary = atob(String(value || ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function applyFileInput(input, bytes, fileName, mime) {
  const view = input.ownerDocument?.defaultView || globalThis;
  const file = new view.File([bytes], fileName, { type: mime });
  const transfer = new view.DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new view.Event('input', { bubbles: true }));
  input.dispatchEvent(new view.Event('change', { bubbles: true }));
  return file;
}
