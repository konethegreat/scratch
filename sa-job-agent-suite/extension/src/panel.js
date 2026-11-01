// The visible half of the hand-off: what was filled, what still needs a
// person, and one submit the person explicitly confirms. Shadow DOM keeps the
// host page's styles out and our markup in.
const REASONS = {
  invisible: 'hidden on the page',
  disabled: 'the page disables it',
  honeypot: 'looks like a bot trap',
  captcha: 'CAPTCHA, handle it yourself',
  sensitive: 'sensitive, fill it yourself',
  unknown: 'no matching saved answer',
  'no answer': 'no saved answer for this',
  duplicate: 'another field already used this answer',
  'no attachment': 'no matching document',
  'no matching option': 'no option matched your saved answer',
  'attachment could not be attached': 'the file could not be attached'
};

const STYLE = `
  .card {
    width: 384px;
    max-width: calc(100vw - 24px);
    max-height: 82vh;
    overflow: auto;
    background: #fffdf8;
    color: #1c1b19;
    border: 1px solid #ded8cc;
    border-radius: 16px;
    box-shadow: 0 18px 50px rgba(28, 27, 25, 0.18);
    font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
    padding: 18px;
    box-sizing: border-box;
  }
  h2 { margin: 0 0 2px; font-size: 18px; line-height: 1.25; }
  .site { margin: 0 0 10px; color: #6d675d; font-size: 13px; }
  .status { margin: 0 0 12px; padding: 8px 10px; border-radius: 8px; background: #f2efe7; font-size: 13px; min-height: 18px; }
  .status.warn { background: #fdf1da; color: #7a4a06; }
  h3 { margin: 14px 0 6px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em; color: #6d675d; }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
  li { border-left: 2px solid #0f766e; padding-left: 8px; overflow-wrap: anywhere; }
  li.skip { border-left-color: #b9b2a4; }
  .label { display: block; font-weight: 600; font-size: 12px; color: #3d3a34; }
  .value { display: block; }
  .reason { display: block; color: #6d675d; font-size: 12px; }
  .review { display: flex; gap: 8px; align-items: flex-start; margin: 16px 0 10px; font-size: 13px; }
  .review input { margin-top: 2px; }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; }
  button { font: inherit; border-radius: 9px; border: 1px solid #d5cfc2; background: #fff; color: #1c1b19; padding: 8px 12px; cursor: pointer; }
  button.primary { background: #0f766e; border-color: #0f766e; color: #fff; font-weight: 600; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  .note { margin: 10px 0 0; color: #6d675d; font-size: 12px; }
`;

const reasonFor = (reason) => REASONS[reason] || 'needs your attention';

export function openPanel({ packet, result, applied, captcha, error, onSubmit, onRefill }) {
  const doc = document;
  const host = doc.createElement('div');
  host.id = 'sajas-panel';
  host.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483647;';
  const root = host.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent = STYLE;
  root.append(style);

  const card = doc.createElement('section');
  card.className = 'card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'SA-JAS application review');
  root.append(card);

  const el = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  const title = el('h2', null, 'Review before you submit');
  card.append(title);

  const destroy = () => host.remove();
  const status = el('p', 'status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const say = (message, warn = false) => {
    status.textContent = message;
    status.classList.toggle('warn', Boolean(warn));
  };

  if (error) {
    card.append(el('p', 'site', 'This page is not ready for a fill.'));
    say(error, true);
    card.append(status);
    const close = el('button', null, 'Close');
    close.id = 'sajas-close';
    close.addEventListener('click', destroy);
    const actions = el('div', 'actions');
    actions.append(close);
    card.append(actions);
    doc.documentElement.append(host);
    return { destroy, say };
  }

  card.append(el('p', 'site', `${packet.job.title} at ${packet.job.company}`));
  card.append(status);

  const filled = Array.isArray(applied) ? applied : [];
  const skipped = Array.isArray(result?.skipped) ? result.skipped : [];
  const attachments = Array.isArray(result?.attachments) ? result.attachments : [];
  say(`${filled.length} field${filled.length === 1 ? '' : 's'} filled, ${skipped.length} need${skipped.length === 1 ? 's' : ''} you.`);

  if (captcha) {
    const warning = el('p', 'status warn', `${captcha} Complete it yourself, then press Submit application.`);
    card.append(warning);
  }

  const section = (heading, items, skip) => {
    const list = el('ul');
    for (const item of items) {
      const row = el('li', skip ? 'skip' : null);
      row.append(el('span', 'label', item.label));
      if (item.value) row.append(el('span', 'value', item.value));
      if (item.reason) row.append(el('span', 'reason', reasonFor(item.reason)));
      list.append(row);
    }
    if (!items.length) list.append(el('li', 'skip', skip ? 'Nothing was left for you.' : 'Nothing was filled.'));
    const wrapper = doc.createElement('div');
    wrapper.append(el('h3', null, heading), list);
    return wrapper;
  };

  card.append(section('Filled', filled, false));
  card.append(section('Needs you', skipped.map((entry) => ({
    label: entry.label || entry.fieldId || 'A field',
    reason: entry.reason
  })), true));
  if (attachments.length) {
    card.append(section('Attachments', attachments.map((entry) => {
      const attachment = (packet.attachments || []).find((item) => item.key === entry.attachmentKey);
      return { label: entry.label, value: attachment?.fileName || '' };
    }), false));
  }

  const review = doc.createElement('label');
  review.className = 'review';
  const box = doc.createElement('input');
  box.type = 'checkbox';
  box.id = 'sajas-review';
  review.append(box, el('span', null, 'I reviewed these details and the page before submitting.'));
  card.append(review);

  const actions = el('div', 'actions');
  const submit = el('button', 'primary', 'Submit application');
  submit.id = 'sajas-submit';
  submit.type = 'button';
  submit.disabled = true;
  const again = el('button', null, 'Fill again');
  again.id = 'sajas-refill';
  again.type = 'button';
  const close = el('button', null, 'Close');
  close.id = 'sajas-close';
  close.type = 'button';
  actions.append(submit, again, close);
  card.append(actions);
  card.append(el('p', 'note', 'Submit presses the page button for you once. You can always finish on the page yourself.'));

  box.addEventListener('change', () => { submit.disabled = !box.checked || Boolean(submit.dataset.sent); });
  close.addEventListener('click', destroy);
  again.addEventListener('click', () => {
    destroy();
    onRefill?.();
  });

  submit.addEventListener('click', async () => {
    if (!box.checked) { say('Tick the review box first.', true); return; }
    submit.disabled = true;
    again.disabled = true;
    say('Submitting...');
    let outcome;
    try {
      outcome = await onSubmit(true);
    } catch {
      outcome = { ok: false, error: 'Submitting failed. Check the page and try again.' };
    }
    if (outcome?.ok) {
      submit.dataset.sent = 'yes';
      box.disabled = true;
      again.disabled = false;
      say(`Submitted. ${outcome.confirmation || 'The page confirmed it.'}`.trim());
      return;
    }
    submit.disabled = false;
    again.disabled = false;
    say(outcome?.error || 'Could not submit.', true);
  });

  doc.documentElement.append(host);
  return { destroy, say };
}
