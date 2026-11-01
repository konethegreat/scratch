// Finds the page's own submit control and watches for a confirmation. It never
// clicks: the review panel asks the person first, then calls this.
import { hasCaptcha, visible } from './dom.js';

export function findSubmit(document, adapter) {
  for (const selector of adapter?.submitSelectors || []) {
    // An untyped button is only a submit candidate inside a form; outside one
    // it is usually a link or a navigation control.
    const inForm = selector.includes(':not([type])');
    const candidate = [...(document.querySelectorAll?.(selector) || [])]
      .find((element) => !element.disabled && visible(element) && (!inForm || element.closest?.('form')));
    if (candidate) return candidate;
  }
  return null;
}

export function captchaText(document) {
  return hasCaptcha(document) ? 'This page has a CAPTCHA.' : '';
}

// An adapter phrase is often only part of the page's sentence ("Thank you for
// applying"), so widen it to the full sentence for the person to read back.
function sentenceAround(text, index, length) {
  const stop = /[.!?\n]/;
  const floor = Math.max(0, index - 200);
  let start = index;
  while (start > floor && !stop.test(text[start - 1])) start -= 1;
  let end = index + length;
  const ceiling = Math.min(text.length, end + 200);
  while (end < ceiling && !stop.test(text[end])) end += 1;
  return text.slice(start, Math.min(text.length, end + 1)).replace(/\s+/g, ' ').trim();
}

// The smallest block that carries the phrase is the page's own confirmation,
// which reads better than a bare regex match and works when no selector fits.
const BLOCKS = 'div, p, section, main, span, h1, h2, h3, li';
function confirmationText(document, regex) {
  let best = '';
  for (const node of document.body?.querySelectorAll?.(BLOCKS) || []) {
    const text = String(node.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text || text.length > 300 || !regex.test(text)) continue;
    if (!best || text.length < best.length) best = text;
  }
  return best;
}

export function watchSuccess(document, adapter, { timeoutMs = 8000, intervalMs = 400 } = {}) {
  return new Promise((resolve) => {
    const view = document.defaultView;
    const startedHref = view?.location?.href || '';
    let observer = null;
    let poll = null;
    let timer = null;
    let done = false;

    const finish = (ok, confirmation) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      if (poll) clearInterval(poll);
      observer?.disconnect?.();
      resolve({ ok, confirmation: String(confirmation || '').slice(0, 200) });
    };

    const check = () => {
      if (done) return;
      for (const selector of adapter?.successSelectors || []) {
        const node = document.querySelector?.(selector);
        const text = String(node?.innerText || node?.textContent || '').replace(/\s+/g, ' ').trim();
        if (text) { finish(true, text); return; }
      }
      const pageText = String(document.body?.innerText || document.body?.textContent || '');
      const match = adapter?.successText ? pageText.match(adapter.successText) : null;
      if (match) {
        const block = confirmationText(document, adapter.successText);
        const text = block || (typeof match.index === 'number'
          ? sentenceAround(pageText, match.index, match[0].length)
          : match[0]);
        finish(true, text);
        return;
      }
      const href = view?.location?.href || '';
      // A URL change alone is not a confirmation. Only a URL that reads like a
      // thank-you or receipt page counts, and never the page we started on.
      if (startedHref && href && href !== startedHref && /thank|confirm|success|applied|submitted|complete/i.test(href)) {
        finish(true, 'The page moved to a confirmation page.');
      }
    };

    const Observer = view?.MutationObserver;
    if (Observer && document.documentElement) {
      observer = new Observer(check);
      observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    }
    poll = setInterval(check, intervalMs);
    timer = setTimeout(() => { check(); finish(false, ''); }, timeoutMs);
  });
}
