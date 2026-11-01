// Applies matcher fills to real elements. Anything the matcher skipped stays
// untouched, so the review panel can show what still needs a person.
import { matchFields, normaliseLabel } from '@sajas/core/apply';
import { applyFileInput, base64ToBytes, describeFields } from './dom.js';

const YES = /^(?:yes|true|1|on|y)$/i;

function dispatch(element, type) {
  const view = element.ownerDocument.defaultView;
  element.dispatchEvent(new view.Event(type, { bubbles: true }));
}

function setTextValue(element, value) {
  const view = element.ownerDocument.defaultView;
  const proto = element.tagName === 'TEXTAREA' ? view.HTMLTextAreaElement.prototype : view.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(element, value);
  else element.value = value;
  dispatch(element, 'input');
  dispatch(element, 'change');
}

function chooseOption(element, value) {
  const wanted = normaliseLabel(value);
  const option = [...element.options].find((entry) => normaliseLabel(entry.value) === wanted)
    || [...element.options].find((entry) => normaliseLabel(entry.textContent) === wanted);
  if (!option) return false;
  element.value = option.value;
  dispatch(element, 'input');
  dispatch(element, 'change');
  return true;
}

function chooseRadio(descriptor, value) {
  const wanted = normaliseLabel(value);
  const group = descriptor.element.ownerDocument.querySelectorAll(`input[type="radio"][name="${String(descriptor.name).replace(/["\\]/g, '\\$&')}"]`);
  const chosen = [...group].find((radio) => normaliseLabel(radio.value) === wanted
    || normaliseLabel(descriptor.options?.find((option) => option.value === radio.value)?.label) === wanted);
  if (!chosen) return false;
  chosen.checked = true;
  dispatch(chosen, 'input');
  dispatch(chosen, 'change');
  return true;
}

function setCheckbox(element, value) {
  const wanted = YES.test(value) || normaliseLabel(value) === normaliseLabel(element.value) || element.value === '';
  if (!wanted) return false;
  element.checked = true;
  dispatch(element, 'input');
  dispatch(element, 'change');
  return true;
}

export function fillForm(packet, document, { adapter, host } = {}) {
  const descriptors = describeFields(document);
  const result = matchFields(packet, descriptors, { adapter, host });
  const applied = [];
  const find = (fieldId) => descriptors.find((descriptor) => (descriptor.id || descriptor.name) === fieldId);

  for (const fill of result.fills) {
    const descriptor = find(fill.fieldId);
    if (!descriptor || !descriptor.element) continue;
    if (descriptor.type === 'file') continue;
    let done = false;
    try {
      if (descriptor.type === 'select') done = chooseOption(descriptor.element, fill.value);
      else if (descriptor.type === 'radio') done = chooseRadio(descriptor, fill.value);
      else if (descriptor.type === 'checkbox') done = setCheckbox(descriptor.element, fill.value);
      else { setTextValue(descriptor.element, fill.value); done = true; }
    } catch {
      done = false;
    }
    if (done) applied.push({ fieldId: fill.fieldId, label: fill.label, value: fill.value });
    else result.skipped.push({ fieldId: fill.fieldId, label: fill.label, reason: 'no matching option' });
  }

  for (const entry of result.attachments) {
    const descriptor = find(entry.fieldId);
    const attachment = (packet.attachments || []).find((item) => item.key === entry.attachmentKey);
    if (!descriptor?.element || !attachment) continue;
    try {
      applyFileInput(descriptor.element, base64ToBytes(attachment.dataBase64), attachment.fileName, attachment.mime);
      applied.push({ fieldId: entry.fieldId, label: entry.label, value: attachment.fileName });
    } catch {
      result.skipped.push({ fieldId: entry.fieldId, label: entry.label, reason: 'attachment could not be attached' });
    }
  }

  return { result, applied };
}
