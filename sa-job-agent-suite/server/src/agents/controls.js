/**
 * Finding and clicking controls on a live page for the copilot, under the
 * click policy in submitGuard.js.
 *
 * This replaces the old "tag the element with data-sajas-adv, then click the
 * tag" hand-off. The tag was never removed, so a later click could land on an
 * element that had been relabelled since it was chosen (a "Next" button that
 * becomes "Submit application" on the last step of a form). Here a control is
 * identified by its position in the page's control list plus its label, and
 * the label is read again immediately before the click: if the element has
 * moved or now reads differently, nothing is clicked.
 *
 * Residual window: a relabel in the few milliseconds between that last check
 * and Playwright's own click is not covered. A wording policy can never be
 * airtight; see submitGuard.js and SECURITY.md.
 */
import { classifyControl, mayClick } from './submitGuard.js';

// Same selector the copilot has always used. `index` below is a position in
// document.querySelectorAll(CONTROL_SELECTOR).
export const CONTROL_SELECTOR = 'button, a, input[type="button"], input[type="submit"], [role="button"]';

// Labels are kept to this length when they cross from the page to Node.
const LABEL_LIMIT = 80;

/**
 * The visible, enabled controls on the page, in document order, as
 * [{ index, text }]. Returns [] if the page cannot be read (navigating,
 * closed).
 */
export async function listControls(page) {
  try {
    return await page.evaluate(({ selector, limit }) => {
      const out = [];
      document.querySelectorAll(selector).forEach((el, index) => {
        const raw = el.innerText || el.value || el.getAttribute('aria-label') || '';
        const text = raw.replace(/\s+/g, ' ').trim();
        if (!text) return;
        if (el.disabled || el.getAttribute('aria-disabled') === 'true') return;
        const rect = el.getBoundingClientRect();
        const cs = window.getComputedStyle(el);
        const visible = rect.width > 4 && rect.height > 4 &&
          cs.display !== 'none' && cs.visibility !== 'hidden' &&
          parseFloat(cs.opacity || '1') > 0.1;
        if (!visible) return;
        out.push({ index, text: text.slice(0, limit) });
      });
      return out;
    }, { selector: CONTROL_SELECTOR, limit: LABEL_LIMIT });
  } catch {
    return [];
  }
}

/**
 * The first control the policy lets autopilot advance with, or
 * { found: false }. `onFormPage` narrows it to Next / Continue / Proceed.
 */
export async function findAdvanceControl(page, { onFormPage = false } = {}) {
  const controls = await listControls(page);
  const hit = controls.find((c) => classifyControl(c.text, { onFormPage }) === 'advance');
  return hit ? { found: true, text: hit.text, index: hit.index } : { found: false, text: '' };
}

/**
 * Clicks a control returned by listControls / findAdvanceControl, after
 * checking again, right now, that the element at that position still reads
 * the same and that the policy still allows it. Returns
 * { clicked, text, reason? } where reason is one of:
 *   'no-control' | 'refused' | 'changed' (gone or relabelled) | 'click-failed'
 * `planned` is for a control the AI planner chose by name (see submitGuard.mayClick).
 */
export async function clickControl(page, control, { onFormPage = false, planned = false, timeout = 5000 } = {}) {
  const text = control?.text ?? '';
  if (!control || !Number.isInteger(control.index)) return { clicked: false, text, reason: 'no-control' };
  if (!mayClick(text, { onFormPage, planned })) return { clicked: false, text, reason: 'refused' };

  let handle = null;
  try {
    handle = await page.evaluateHandle(({ selector, index, expected, limit }) => {
      const el = document.querySelectorAll(selector)[index];
      if (!el) return null;
      const raw = el.innerText || el.value || el.getAttribute('aria-label') || '';
      const now = raw.replace(/\s+/g, ' ').trim().slice(0, limit);
      return now === expected ? el : null;
    }, { selector: CONTROL_SELECTOR, index: control.index, expected: text, limit: LABEL_LIMIT });
    const el = handle.asElement();
    if (!el) return { clicked: false, text, reason: 'changed' };
    await el.click({ timeout });
    return { clicked: true, text };
  } catch (err) {
    return { clicked: false, text, reason: 'click-failed', error: err.message };
  } finally {
    if (handle) await handle.dispose().catch(() => {});
  }
}