// Finds the page's own submit control and watches for a confirmation. It never
// clicks: the review panel asks the person first, then calls this.
import { hasCaptcha, visible } from './dom.js';

export function findSubmit(document, adapter) {
  for (const selector of adapter?.submitSelectors || []) {
    const candidate = [...(document.querySelectorAll?.(selector) || [])]
      .find((element) => !element.disabled && visible(element));
    if (candidate) return candidate;
  }
  return null;
}

export function captchaText(document) {
  return hasCaptcha(document) ? 'This page has a CAPTCHA.' : '';
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
      if (match) { finish(true, match[0]); return; }
      const href = view?.location?.href || '';
      if (startedHref && href && href !== startedHref) finish(true, 'The page changed after submitting.');
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
