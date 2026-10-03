/**
 * The copilot's click policy, in one place.
 *
 * Three code paths can click on a live application page: autopilot's advance
 * step and the planner's click (both in controls.js) and the computer-use
 * finisher (computerUse.js). They used to carry three slightly different word
 * lists; they now all ask this module.
 *
 * It is a WORDING policy. It can judge what a control says, never what it
 * does, so it is deliberately conservative where the stakes are highest:
 *
 *  - anything that reads like a final submit, or like an account action
 *    (sign in, create account, "continue with Google"), is never clicked,
 *    on any page;
 *  - on a form page only step-forward words (Next, Continue, Proceed) are
 *    clicked; every other label, including a bare "Apply", is left to the human;
 *  - on other pages (listings, landing pages) the wider "take me to the
 *    application" words (Apply, I'm interested, ...) are allowed.
 *
 * What no wording rule can catch: a one-click "Apply" button on a listing page
 * that submits straight away from a stored profile. See SECURITY.md.
 *
 * Pure module: no imports, so it is safe to use from anywhere and trivial to test.
 */

// Final-submit wording. Never auto-clicked, on any page.
const FINAL_SUBMIT = /\b(?:submit|send|finish|complete(?:\s+(?:my|your|the))?\s+application|confirm|pay|checkout|place\s+order|sign\s+and\s+submit|accept\s+and|agree\s+and)\b/i;

// Account actions. Not a submit, but not the copilot's decision either.
const ACCOUNT = /\b(?:sign\s*in|log\s*in|sign\s*up|register|create\s+(?:an\s+|your\s+|my\s+)?account|(?:continue|sign\s*in|log\s*in)\s+(?:with|as))\b/i;

// Wider advance words, used only OFF form pages to reach the application. They
// include the cross-site hand-offs South African aggregators use: a LinkedIn,
// Careers24 or PNet listing whose "Apply on company website" or "View & apply"
// link carries you onto the employer's own application system.
const ADVANCE = /\b(?:apply now|apply online|apply external(?:ly)?|apply on (?:the )?company(?:'?s)? (?:website|site)|apply (?:for|to) this (?:job|position|role|vacancy)|apply here|apply with|easy apply|apply|i'?m interested|interested|continue|next step|next|proceed|start application|begin application|go to application|view application|view (?:&|and) apply|view (?:this )?(?:job|posting|vacancy|advert)|see (?:this )?(?:job|posting)|open (?:job|posting))\b/i;

// The only words clicked ON a form page: move to the next step of the form.
const FORM_STEP = /\b(?:next|continue|proceed)\b/i;

// Words that mean "send what I just filled in" on a form page, whatever else the label says.
const APPLY_FAMILY = /\b(?:apply|i'?m\s+interested)\b/i;

const clean = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

// The longest label autopilot will advance with. Longer text is a paragraph or
// a whole card, not a button label. It can still read like a final submit, so
// the deny checks in classifyControl run before this limit.
const MAX_ADVANCE_LABEL = 40;

/**
 * Classifies a control by its visible label.
 * @returns {'final-submit' | 'account' | 'advance' | 'other'}
 */
export function classifyControl(text, { onFormPage = false } = {}) {
  const t = clean(text);
  if (!t) return 'other';
  if (FINAL_SUBMIT.test(t)) return 'final-submit';
  if (ACCOUNT.test(t)) return 'account';
  if (t.length > MAX_ADVANCE_LABEL) return 'other';
  if (onFormPage) return FORM_STEP.test(t) ? 'advance' : 'other';
  return ADVANCE.test(t) ? 'advance' : 'other';
}

/**
 * May the copilot click this control by itself?
 * `planned` is for a click the AI planner chose by name: off form pages it may
 * pick any control that is not a submit or account action; on a form page it
 * is held to the same step-forward words as autopilot.
 */
export function mayClick(text, { onFormPage = false, planned = false } = {}) {
  const verdict = classifyControl(text, { onFormPage });
  if (verdict === 'advance') return true;
  return planned && !onFormPage && verdict === 'other';
}

/**
 * Should the computer-use model be refused a click on this control? It works
 * on form pages, where custom widgets are buttons too (date pickers, "add
 * another"), so this is a deny list rather than an allow list: submits, account
 * actions and the apply family are refused, step-forward controls are not.
 */
export function isRefusedForModel(text) {
  const t = clean(text);
  if (!t) return false;
  return FINAL_SUBMIT.test(t) || ACCOUNT.test(t) || APPLY_FAMILY.test(t);
}