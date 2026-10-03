// ── Computer-use form filler (T3) ─────────────────────────────────────────────
// An opt-in driver that lets Claude *see and operate* the live application form
// via Anthropic's computer-use tool, bound to the existing Playwright page. It
// runs as a FINISHER after the DOM-based smart-fill (which stays the cheap,
// memory-capturing default): it handles the tricky/custom widgets that label-
// matching can't — canvas pickers, non-standard inputs, multi-step panes.
//
// SAFETY — this never submits an application:
//   • The system prompt forbids clicking Submit / Send / Apply (final) / Pay /
//     Confirm / Finish.
//   • That is ALSO enforced in code: every click is hit-tested against the DOM
//     element under the cursor; if that element (or its button/anchor ancestor)
//     reads as a submit/finish control, the click is REFUSED and the model is
//     told to leave it for the human. A coordinate click can't bypass this.
//   • It stops on any CAPTCHA / "verify you are human" / login text.
//   • Bounded by a per-session step cap so cost can't run away.
//
// Anthropic-only (the computer-use tool is Anthropic's). Gated by
// profile.useComputerUse; skipped silently otherwise.

import Anthropic from '@anthropic-ai/sdk';
import { addLog, addUsage, budgetStatus, budgetMessage } from '../db/helper.js';
import { fromAnthropicUsage } from '../db/costs.js';
import { isRefusedForModel, classifyControl } from './submitGuard.js';

const COMPUTER_USE_BETA = 'computer-use-2025-11-24';
const COMPUTER_TOOL_TYPE = 'computer_20251124';
const DEFAULT_MODEL = 'claude-sonnet-4-6';

// Which controls the model must never click is decided in submitGuard.js, the
// same policy autopilot and the planner use. It is matched against the visible
// text of the element under the cursor.
const CHALLENGE_RE = /(captcha|recaptcha|hcaptcha|verify (you('| a)re|that you('| a)re) (a )?human|are you a robot|security check|i'?m not a robot|cloudflare)/i;

/** True if this provider/key can drive computer-use (Anthropic only). */
export function computerUseSupported(profile) {
  const provider = profile?.aiProvider || 'gemini';
  const key = profile?.anthropicApiKey;
  return provider === 'anthropic' && Boolean(key) && !String(key).includes('your_');
}

/**
 * Exported for testing: is the model refused a click on a control with this
 * text? True for final-submit wording, account actions (sign in, continue with
 * Google) and the apply family; see submitGuard.isRefusedForModel.
 */
export function isSubmitText(text) {
  return isRefusedForModel(text);
}

/** Reads width/height from a PNG buffer's IHDR chunk (bytes 16–24). */
export function pngDimensions(buf) {
  if (!buf || buf.length < 24) return { width: 0, height: 0 };
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/**
 * Maps a computer-use key string ("Return", "ctrl+a", "Tab") to a Playwright
 * keyboard.press string ("Enter", "Control+a", "Tab"). Exported for testing.
 */
export function mapKey(spec) {
  const MOD = { ctrl: 'Control', control: 'Control', alt: 'Alt', option: 'Alt', shift: 'Shift', cmd: 'Meta', command: 'Meta', super: 'Meta', meta: 'Meta' };
  const NAMED = {
    return: 'Enter', enter: 'Enter', tab: 'Tab', escape: 'Escape', esc: 'Escape',
    space: 'Space', backspace: 'Backspace', delete: 'Delete', up: 'ArrowUp',
    down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', home: 'Home',
    end: 'End', page_up: 'PageUp', pageup: 'PageUp', page_down: 'PageDown', pagedown: 'PageDown'
  };
  const parts = String(spec || '').split('+').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return '';
  return parts.map((p) => {
    const low = p.toLowerCase();
    if (MOD[low]) return MOD[low];
    if (NAMED[low]) return NAMED[low];
    return p.length === 1 ? p : (p[0].toUpperCase() + p.slice(1));
  }).join('+');
}

// The deepest element at a point in a frame's viewport, looking through open
// shadow roots (a custom-element button is otherwise just its host).
function deepestElementAt({ x, y }) {
  let el = document.elementFromPoint(x, y);
  for (let i = 0; el && el.shadowRoot && i < 5; i++) {
    const inner = el.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === el) break;
    el = inner;
  }
  return el;
}

/**
 * Hit-test the element under a point and return the label of the control there
 * (the element itself or its nearest button / link / button-like ancestor), so
 * the caller can refuse submit controls. The point is followed into iframes,
 * same-origin or not, because the top document alone only sees the <iframe>
 * and a Submit button inside it would read as "nothing".
 * @returns {Promise<{text: string, opaque: boolean}>} opaque is true when the
 *   point lands somewhere that cannot be read (a frame that cannot be entered,
 *   or too many frames deep); callers must refuse the click then.
 */
export async function elementTextAt(page, cssX, cssY) {
  let frame = page.mainFrame();
  let x = cssX, y = cssY;
  for (let depth = 0; depth < 4; depth++) {
    let handle = null;
    try {
      handle = await frame.evaluateHandle(deepestElementAt, { x, y });
      const el = handle.asElement();
      if (!el) return { text: '', opaque: false };
      const info = await el.evaluate((node) => {
        const tag = node.tagName ? node.tagName.toLowerCase() : '';
        if (['iframe', 'frame', 'object', 'embed'].includes(tag)) {
          const r = node.getBoundingClientRect();
          const cs = window.getComputedStyle(node);
          return {
            kind: 'frame',
            left: r.left + node.clientLeft + (parseFloat(cs.paddingLeft) || 0),
            top: r.top + node.clientTop + (parseFloat(cs.paddingTop) || 0)
          };
        }
        let cur = node;
        for (let hops = 0; cur && hops < 5; hops++) {
          const t = cur.tagName ? cur.tagName.toLowerCase() : '';
          const type = (cur.getAttribute && (cur.getAttribute('type') || '')).toLowerCase();
          if (t === 'button' || t === 'a' || (t === 'input' && ['submit', 'button', 'image'].includes(type)) || cur.getAttribute?.('role') === 'button') {
            return { kind: 'control', text: (cur.innerText || cur.value || cur.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 80) };
          }
          cur = cur.parentElement || (cur.getRootNode && cur.getRootNode().host) || null;
        }
        return { kind: 'control', text: '' };
      });
      if (info.kind === 'control') return { text: info.text, opaque: false };
      const child = await el.contentFrame();
      if (!child) return { text: '', opaque: true };
      frame = child;
      x -= info.left;
      y -= info.top;
    } catch {
      return { text: '', opaque: false };
    } finally {
      if (handle) await handle.dispose().catch(() => {});
    }
  }
  return { text: '', opaque: true };
}
// ── Keyboard and typing guards ───────────────────────────────────────────────
// A click is only one way to send a form. Enter in a text field presses the
// form's default button, Enter or Space on a focused button presses it, and a
// "\n" in typed text is an Enter keypress. These look at what has focus before
// the model's keys or text reach the page.

const BUTTON_INPUT_TYPES = ['submit', 'button', 'image', 'reset'];

function isButtonLike(focus) {
  return focus.tag === 'button' || focus.tag === 'a' || focus.role === 'button' ||
    (focus.tag === 'input' && BUTTON_INPUT_TYPES.includes(focus.type));
}

/**
 * What has focus right now, followed through open shadow roots and into
 * frames: { tag, type, role, label, multiline, editable, typeahead, inForm,
 * formDefault, opaque } or null if it cannot be read. `formDefault` is the
 * label of the form's default (first submit) button, '' if it has none.
 * Exported for testing.
 */
export async function describeFocus(page) {
  let frame = page.mainFrame();
  for (let depth = 0; depth < 4; depth++) {
    let handle = null;
    try {
      handle = await frame.evaluateHandle(() => {
        let el = document.activeElement;
        for (let i = 0; el && el.shadowRoot && el.shadowRoot.activeElement && i < 5; i++) el = el.shadowRoot.activeElement;
        return el;
      });
      const el = handle.asElement();
      if (!el) return null;
      const info = await el.evaluate((node) => {
        const tag = node.tagName ? node.tagName.toLowerCase() : '';
        if (tag === 'body' || tag === 'html') return { tag: 'body' };
        const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 80);
        const role = (node.getAttribute('role') || '').toLowerCase();
        const form = node.form || (node.closest && node.closest('form')) || null;
        let formDefault = '';
        if (form) {
          const def = Array.from(form.elements || []).find((c) =>
            (c.tagName === 'BUTTON' && c.type === 'submit') ||
            (c.tagName === 'INPUT' && (c.type === 'submit' || c.type === 'image')));
          if (def) formDefault = clean(def.innerText || def.value || def.getAttribute('aria-label'));
        }
        return {
          tag,
          type: (node.getAttribute('type') || '').toLowerCase(),
          role,
          label: clean(node.innerText || node.value || node.getAttribute('aria-label')),
          multiline: tag === 'textarea',
          editable: Boolean(node.isContentEditable) || (role === 'textbox' && node.getAttribute('aria-multiline') === 'true'),
          typeahead: role === 'combobox' || node.hasAttribute('aria-autocomplete') || Boolean(node.getAttribute('list')),
          inForm: Boolean(form),
          formDefault
        };
      });
      if (info.tag !== 'iframe' && info.tag !== 'frame') return info;
      const child = await el.contentFrame();
      if (!child) return { ...info, opaque: true };
      frame = child;
    } catch {
      return null;
    } finally {
      if (handle) await handle.dispose().catch(() => {});
    }
  }
  return { tag: 'iframe', opaque: true };
}

/**
 * May the model press this key (a Playwright key string such as "Enter",
 * "Control+Enter" or "Space") given what has focus? Only Enter and Space can
 * send anything, so every other key is allowed. Exported for testing.
 * @returns {{allowed: boolean, reason?: string}}
 */
export function keyPressVerdict(key, focus) {
  const parts = String(key || '').split('+').filter(Boolean);
  const main = parts[parts.length - 1] || '';
  const mods = parts.slice(0, -1);
  const isEnter = /^(?:numpad)?enter$/i.test(main);
  const isSpace = /^space$/i.test(main) || main === ' ';
  if (!isEnter && !isSpace) return { allowed: true };

  const no = (reason) => ({ allowed: false, reason });
  if (!focus) return no('could not tell what has focus');
  if (focus.opaque) return no('focus is inside a frame it cannot inspect');
  if (isButtonLike(focus)) {
    // Enter and Space both press a focused button or link.
    if (!focus.label) return no('focus is on a control with no readable label');
    return isRefusedForModel(focus.label) ? no(`focus is on "${focus.label}"`) : { allowed: true };
  }
  if (isSpace) return { allowed: true };          // a space in a field, or ticking a box
  // Enter from here on.
  if (focus.tag === 'body') return { allowed: true };   // nothing focused: Enter does nothing
  if (mods.length) return no('a modified Enter can send from a text area');
  if (focus.multiline || focus.editable) return { allowed: true };
  if (focus.inForm) {
    const stepForward = focus.formDefault && classifyControl(focus.formDefault, { onFormPage: true }) === 'advance';
    return stepForward
      ? { allowed: true }
      : no(`Enter here would press the form's default button${focus.formDefault ? ` "${focus.formDefault}"` : ''}`);
  }
  return focus.typeahead ? { allowed: true } : no('Enter outside a text area could send the form');
}

/**
 * What may the model type, and how? Newlines and tabs are keypresses (Enter
 * can send a form, Tab moves focus), so outside a <textarea> they become
 * spaces; other control characters are dropped. Typing at a focused submit
 * button is refused, since a typed space presses it. Exported for testing.
 * @returns {{allowed: boolean, text?: string, reason?: string}}
 */
export function planTyping(text, focus) {
  if (!focus) return { allowed: false, reason: 'could not tell what has focus' };
  if (focus.opaque) return { allowed: false, reason: 'focus is inside a frame it cannot inspect' };
  if (isButtonLike(focus) && (!focus.label || isRefusedForModel(focus.label))) {
    return { allowed: false, reason: `focus is on the ${focus.label ? `"${focus.label}" ` : ''}button, not a field` };
  }
  const raw = String(text ?? '');
  const lines = focus.multiline ? raw.replace(/\r\n?/g, '\n') : raw.replace(/[\r\n]+/g, ' ');
  // eslint-disable-next-line no-control-regex
  const clean = lines.replace(/\t/g, ' ').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  return { allowed: true, text: clean };
}
async function shoot(page) {
  const buf = await page.screenshot({ type: 'png' });
  const { width, height } = pngDimensions(buf);
  return { b64: buf.toString('base64'), width, height };
}

function imageResult(toolUseId, b64) {
  return {
    type: 'tool_result',
    tool_use_id: toolUseId,
    content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: b64 } }]
  };
}
function textResult(toolUseId, text, isError = false) {
  return { type: 'tool_result', tool_use_id: toolUseId, content: [{ type: 'text', text }], is_error: isError };
}

/**
 * Carries out ONE computer-use tool_use against the page and returns the
 * tool_result to send back. Every click is hit-tested (through shadow roots and
 * frames) and every key press or typed string is checked against what has focus,
 * so nothing here can send the application. `stats` is updated in place
 * ({ filled, refusals }). Exported so tests can drive it with a synthetic
 * tool_use and no model.
 */
export async function executeComputerAction(page, tu, { toCss = (v) => Math.round(v), stats = { filled: 0, refusals: 0 } } = {}) {
  const toolResults = [];
  const result = stats;
  const action = tu.input?.action;
  const coord = tu.input?.coordinate || tu.input?.start_coordinate;
  try {
    if (action === 'screenshot') {
      const s = await shoot(page);
      toolResults.push(imageResult(tu.id, s.b64));
    } else if (action === 'left_click' || action === 'double_click' || action === 'middle_click' || action === 'right_click') {
      const cx = toCss(coord?.[0] ?? 0), cy = toCss(coord?.[1] ?? 0);
      const hit = await elementTextAt(page, cx, cy);
      const label = hit.text;
      if (hit.opaque) {
        result.refusals++;
        addLog('Computer-use refused a click it could not read (the point is inside a frame it cannot inspect).', 'agent3');
        toolResults.push(textResult(tu.id, 'Refused: that point is inside a frame whose controls cannot be read, so it could be a submit button. Leave it for the human. Continue with other empty fields, or stop if none remain.'));
      } else if (isSubmitText(label)) {
        result.refusals++;
        addLog(`🛑 Computer-use refused to click "${label}" (final-submit control reserved for you).`, 'agent3');
        toolResults.push(textResult(tu.id, `Refused: "${label}" submits/finishes the application. Leave it for the human. Continue with other empty fields, or stop if none remain.`));
      } else {
        if (action === 'double_click') await page.mouse.dblclick(cx, cy);
        else await page.mouse.click(cx, cy, { button: action === 'right_click' ? 'right' : action === 'middle_click' ? 'middle' : 'left' });
        await page.waitForTimeout(200);
        const s = await shoot(page);
        toolResults.push(imageResult(tu.id, s.b64));
      }
    } else if (action === 'mouse_move') {
      await page.mouse.move(toCss(coord?.[0] ?? 0), toCss(coord?.[1] ?? 0));
      const s = await shoot(page);
      toolResults.push(imageResult(tu.id, s.b64));
    } else if (action === 'type') {
      const plan = planTyping(String(tu.input?.text || ''), await describeFocus(page));
      if (!plan.allowed) {
        result.refusals++;
        addLog(`Computer-use refused to type: ${plan.reason}.`, 'agent3');
        toolResults.push(textResult(tu.id, `Refused: not typing, ${plan.reason}. Click the field you mean to fill first.`));
      } else {
        await page.keyboard.type(plan.text);
        result.filled++;
        const s = await shoot(page);
        toolResults.push(imageResult(tu.id, s.b64));
      }
    } else if (action === 'key') {
      const k = mapKey(tu.input?.text);
      const verdict = k ? keyPressVerdict(k, await describeFocus(page)) : { allowed: true };
      if (!verdict.allowed) {
        result.refusals++;
        addLog(`Computer-use refused to press ${k}: ${verdict.reason}.`, 'agent3');
        toolResults.push(textResult(tu.id, `Refused: not pressing ${k}, ${verdict.reason}. Leave sending the application to the human. Continue with other empty fields, or stop if none remain.`));
      } else {
        if (k) await page.keyboard.press(k);
        const s = await shoot(page);
        toolResults.push(imageResult(tu.id, s.b64));
      }
    } else if (action === 'scroll') {
      const dir = tu.input?.scroll_direction;
      const amt = (parseInt(tu.input?.scroll_amount, 10) || 3) * 100;
      const dx = dir === 'left' ? -amt : dir === 'right' ? amt : 0;
      const dy = dir === 'up' ? -amt : dir === 'down' ? amt : 0;
      await page.mouse.wheel(dx, dy);
      await page.waitForTimeout(150);
      const s = await shoot(page);
      toolResults.push(imageResult(tu.id, s.b64));
    } else if (action === 'wait') {
      await page.waitForTimeout(Math.min(3000, (parseInt(tu.input?.duration, 10) || 1) * 1000));
      const s = await shoot(page);
      toolResults.push(imageResult(tu.id, s.b64));
    } else {
      // cursor_position, left_mouse_down/up, hold_key, etc. — acknowledge
      // with a fresh screenshot rather than failing the turn.
      const s = await shoot(page);
      toolResults.push(imageResult(tu.id, s.b64));
    }
  } catch (e) {
    toolResults.push(textResult(tu.id, `Action failed: ${e.message}`, true));
  }

  return toolResults[0];
}

/**
 * Run the computer-use loop to finish filling the current form page.
 * @returns {Promise<{filled:number, steps:number, refusals:number, stopped:string}>}
 */
export async function computerUseFillForm(page, profile, job, { maxSteps = 12 } = {}) {
  const result = { filled: 0, steps: 0, refusals: 0, stopped: '' };
  if (!computerUseSupported(profile)) { result.stopped = 'unsupported'; return result; }
  {
    // Budget gate: this is the single most token-hungry feature (a screenshot +
    // model call per step), so it respects the daily cap strictly.
    const budget = budgetStatus();
    if (budget.exceeded) {
      addLog(`🖥️ Computer-use skipped — ${budgetMessage(budget)}`, 'system');
      result.stopped = 'budget';
      return result;
    }
  }

  const steps = Math.max(1, Math.min(25, parseInt(maxSteps, 10) || 12));
  const model = (profile.computerUseModel || '').trim() || DEFAULT_MODEL;
  const anthropic = new Anthropic({ apiKey: profile.anthropicApiKey });

  // Logical (CSS) viewport + device pixel ratio so we can map the model's
  // image-space coordinates back to page coordinates.
  let dpr = 1;
  try { dpr = await page.evaluate(() => window.devicePixelRatio || 1); } catch {}

  let snap;
  try { snap = await shoot(page); } catch (e) { result.stopped = 'screenshot-failed'; return result; }
  // The model reasons in screenshot-pixel space; report those exact dims.
  const display_width_px = snap.width || 1280;
  const display_height_px = snap.height || 800;
  const toCss = (v) => Math.round(v / (dpr || 1));

  const data = buildCandidateData(profile, job);
  const system = `You are operating a web form on the user's screen to help them apply for a job. You can see the page via screenshots and act with the mouse and keyboard.

YOUR ONLY TASK: fill in empty or incomplete application form fields using the candidate data below. Some fields may already be filled by an earlier pass — leave correct values alone.

ABSOLUTE RULES:
- NEVER click any button that submits, sends, finishes, confirms, pays for, or completes the application. The human will click that. If the only remaining action is to submit, you are DONE.
- If you see a CAPTCHA, "verify you are human", a login wall, or any human-verification step, STOP — do not attempt it.
- Do not navigate away from this page. Do not open new tabs. Only fill what is visible (scroll if needed to reach a field).
- Only use the candidate data provided. Do not invent personal details (ID numbers, salaries, etc.) that aren't given.
- When all reachable fields are filled, stop and briefly say you're done.

CANDIDATE DATA:
${data}`;

  let messages = [{
    role: 'user',
    content: [
      { type: 'text', text: `This is the application form for "${job.title}" at "${job.company}". Fill the remaining empty fields, then stop. Here is the current screenshot:` },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: snap.b64 } }
    ]
  }];

  addLog(`🖥️ Computer-use finisher engaged (model ${model}, up to ${steps} steps).`, 'agent3');

  for (let i = 0; i < steps; i++) {
    result.steps = i + 1;
    let resp;
    try {
      resp = await anthropic.beta.messages.create({
        model,
        max_tokens: 1200,
        betas: [COMPUTER_USE_BETA],
        tools: [{ type: COMPUTER_TOOL_TYPE, name: 'computer', display_width_px, display_height_px }],
        system,
        messages
      });
    } catch (e) {
      addLog(`Computer-use call failed: ${e.message}`, 'error');
      result.stopped = 'api-error';
      break;
    }
    addUsage({ ...fromAnthropicUsage(model, resp.usage || {}), bucket: 'computer-use' });
    // Stop mid-session the moment the cap trips — each step is expensive.
    if (budgetStatus().exceeded) {
      addLog('🖥️ Computer-use stopped mid-form — daily AI budget reached.', 'system');
      result.stopped = 'budget';
      break;
    }

    messages.push({ role: 'assistant', content: resp.content });
    const toolUses = (resp.content || []).filter((b) => b.type === 'tool_use');

    if (!toolUses.length || resp.stop_reason === 'end_turn') {
      result.stopped = 'model-done';
      break;
    }

    const toolResults = [];
    let challengeHit = false;
    for (const tu of toolUses) {
      toolResults.push(await executeComputerAction(page, tu, { toCss, stats: result }));
    }

    // Stop the loop if a verification challenge has appeared on the page.
    try {
      const txt = await page.evaluate(() => document.body?.innerText?.slice(0, 4000) || '');
      if (CHALLENGE_RE.test(txt)) challengeHit = true;
    } catch {}
    if (challengeHit) {
      addLog('🛑 Computer-use stopped — a verification/CAPTCHA step appeared. Over to you.', 'agent3');
      result.stopped = 'challenge';
      break;
    }

    messages.push({ role: 'user', content: toolResults });
  }

  if (!result.stopped) result.stopped = 'step-cap';
  addLog(`🖥️ Computer-use finished (${result.stopped}): ${result.filled} input action(s), ${result.refusals} submit refusal(s) over ${result.steps} step(s).`, 'agent3');
  return result;
}

// Compact, trusted candidate data block for the system prompt. Mirrors what
// smart-fill grounds on (structured profile + free text + tailored docs), but
// kept short. No API keys, no raw base CV dump beyond a snippet.
function buildCandidateData(profile, job) {
  const ap = profile.applicationProfile || {};
  const lines = [];
  if (profile.fullName) lines.push(`Full name: ${profile.fullName}`);
  if (profile.email) lines.push(`Email: ${profile.email}`);
  if (profile.phone) lines.push(`Phone: ${profile.phone}`);
  if (profile.linkedInUrl) lines.push(`LinkedIn: ${profile.linkedInUrl}`);
  if (profile.portfolioUrl) lines.push(`Portfolio: ${profile.portfolioUrl}`);
  for (const [k, v] of Object.entries(ap)) {
    if (v && String(v).trim()) lines.push(`${k}: ${v}`);
  }
  if (profile.applicationDefaultsText) lines.push(`Other notes: ${String(profile.applicationDefaultsText).slice(0, 600)}`);
  if (job?.tailoredCoverLetterText) lines.push(`\nCover letter (for any "why this role / motivation" free-text box):\n${String(job.tailoredCoverLetterText).slice(0, 1200)}`);
  return lines.join('\n') || '(no structured data provided — fill only what you can infer safely, never invent personal identifiers)';
}
