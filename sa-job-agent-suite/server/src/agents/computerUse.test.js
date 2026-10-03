import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { keyPressVerdict, planTyping, describeFocus, elementTextAt, executeComputerAction, isSubmitText, mapKey } from './computerUse.js';
import { launchTestBrowser } from '../testSupport/browser.js';
import { page as fixturePage, RECORDER } from '../testSupport/fixturePages.js';

// ---- headless Chrome: the real page, a synthetic tool_use, no model ---------------

const browser = await launchTestBrowser();
after(() => browser?.close());
const withBrowser = browser ? test : test.skip;

async function withContext(fn) {
  const context = await browser.newContext({ viewport: { width: 900, height: 700 } });
  try {
    return await fn(context);
  } finally {
    await context.close();
  }
}
async function withPage(html, fn) {
  return withContext(async (context) => {
    const p = await context.newPage();
    await p.setContent(html);
    return fn(p);
  });
}

const use = (input) => ({ type: 'tool_use', id: 'toolu_test', name: 'computer', input });
const clicks = (p) => p.evaluate(() => window.__clicks);
const centre = async (locator) => {
  const b = await locator.boundingBox();
  return [Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2)];
};
const isRefusal = (r) => r.content[0].type === 'text' && /^Refused/.test(r.content[0].text);

const formHtml = (defaultLabel) => fixturePage('Form', `
  <form onsubmit="return false">
    <input id="name" name="fullname">
    <textarea id="cover" name="cover"></textarea>
    <button type="button" id="back">Back</button>
    <button type="submit" id="go">${defaultLabel}</button>
  </form>`);

// ---- the click guard, driven through executeComputerAction ----------------------------

test("mapKey still maps the model's key names to Playwright's", () => {
  assert.equal(mapKey('Return'), 'Enter');
  assert.equal(mapKey('ctrl+Return'), 'Control+Enter');
  assert.equal(mapKey('space'), 'Space');
});

test('isSubmitText: the click guard shares the policy (account actions and a bare Apply are refused too)', () => {
  for (const label of ['Submit application', 'Apply', 'Apply now', 'Sign in', 'Continue with Google', 'Send', 'Pay']) assert.equal(isSubmitText(label), true, label);
  for (const label of ['Next', 'Continue', 'Add another', 'Choose date', '']) assert.equal(isSubmitText(label), false, label);
});

withBrowser('click guard: Submit is refused, Next is clicked', async () => {
  const html = fixturePage('Buttons', '<button type="button" id="n">Next</button> <button type="button" id="s">Submit application</button>');
  await withPage(html, async (p) => {
    const stats = { filled: 0, refusals: 0 };
    const refused = await executeComputerAction(p, use({ action: 'left_click', coordinate: await centre(p.locator('#s')) }), { stats });
    assert.equal(isRefusal(refused), true);
    assert.equal(stats.refusals, 1);
    assert.deepEqual(await clicks(p), []);

    const done = await executeComputerAction(p, use({ action: 'left_click', coordinate: await centre(p.locator('#n')) }), { stats });
    assert.equal(done.content[0].type, 'image');
    assert.deepEqual(await clicks(p), ['Next']);
    assert.equal(stats.refusals, 1);
  });
});

withBrowser('other actions are untouched: scroll, wait, an unknown action and a bare tool_use all return a result', async () => {
  await withPage(formHtml('Next'), async (p) => {
    for (const input of [{ action: 'scroll', coordinate: [100, 100], scroll_direction: 'down', scroll_amount: 1 }, { action: 'wait', duration: 1 }, { action: 'cursor_position' }, { action: 'screenshot' }]) {
      const r = await executeComputerAction(p, use(input));
      assert.equal(r.content[0].type, 'image', input.action);
    }
    const bare = await executeComputerAction(p, { type: 'tool_use', id: 'toolu_bare', name: 'computer' });
    assert.equal(bare.tool_use_id, 'toolu_bare');
  });
});

// ---- the hit test looks through frames and shadow roots -------------------------------

withBrowser('click guard sees a Submit button inside a nested frame and inside a shadow root', async () => {
  const html = fixturePage('Hidden buttons', `
    <iframe id="a" width="320" height="120"></iframe>
    <div id="host" style="margin-top:10px"></div>
    <script>
      document.getElementById('host').attachShadow({ mode: 'open' }).innerHTML =
        '<button type="button" onclick="window.__clicks.push(\\'Submit application\\')">Submit application</button>';
      document.getElementById('a').srcdoc = '<iframe id="b" width="280" height="80"></iframe>';
    </script>`);
  await withPage(html, async (p) => {
    const outer = p.frameLocator('#a');
    await outer.locator('#b').waitFor();
    await outer.locator('body').evaluate((_, doc) => { document.getElementById('b').srcdoc = doc; }, RECORDER + '<button type="button">Submit application</button>');
    const button = outer.frameLocator('#b').locator('button');
    await button.waitFor();
    const where = { frame: await centre(button), shadow: await centre(p.locator('#host button')) };

    // Control: the top document alone sees only the <iframe> or the shadow host, never the button.
    assert.equal(await p.evaluate(([x, y]) => document.elementFromPoint(x, y).tagName, where.frame), 'IFRAME');
    assert.equal(await p.evaluate(([x, y]) => document.elementFromPoint(x, y).id, where.shadow), 'host');

    assert.equal((await elementTextAt(p, ...where.frame)).text, 'Submit application');
    assert.equal((await elementTextAt(p, ...where.shadow)).text, 'Submit application');
    for (const point of [where.frame, where.shadow]) {
      assert.equal(isRefusal(await executeComputerAction(p, use({ action: 'left_click', coordinate: point }))), true);
    }
    for (const f of p.frames()) assert.deepEqual(await f.evaluate(() => window.__clicks || []), [], f.url());
  });
});

withBrowser('click guard reads a button in a cross-origin frame', async () => {
  await withContext(async (context) => {
    await context.route('https://app.example.test/**', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><iframe id="x" src="https://ats.example.test/apply" width="400" height="160"></iframe>' }));
    await context.route('https://ats.example.test/**', (route) => route.fulfill({ contentType: 'text/html', body: fixturePage('ATS', '<button type="button" id="s">Submit application</button> <button type="button" id="n">Next</button>') }));
    const p = await context.newPage();
    await p.goto('https://app.example.test/');
    const inner = p.frameLocator('#x');
    await inner.locator('#s').waitFor();
    const submit = await centre(inner.locator('#s'));
    const next = await centre(inner.locator('#n'));
    assert.equal((await elementTextAt(p, ...submit)).text, 'Submit application');
    assert.equal(isRefusal(await executeComputerAction(p, use({ action: 'left_click', coordinate: submit }))), true);
    assert.equal((await executeComputerAction(p, use({ action: 'left_click', coordinate: next }))).content[0].type, 'image');
    const frame = p.frames().find((f) => f.url().startsWith('https://ats.example.test'));
    assert.deepEqual(await frame.evaluate(() => window.__clicks), ['Next']);
  });
});

withBrowser('a click that lands on something unreadable (an embedded object) is refused rather than guessed', async () => {
  const html = fixturePage('Embed', '<embed type="application/x-sajas-test" width="200" height="100" style="display:block">');
  await withPage(html, async (p) => {
    const stats = { filled: 0, refusals: 0 };
    const hit = await elementTextAt(p, 50, 50);
    assert.deepEqual(hit, { text: '', opaque: true });
    const r = await executeComputerAction(p, use({ action: 'left_click', coordinate: [50, 50] }), { stats });
    assert.equal(isRefusal(r), true);
    assert.equal(stats.refusals, 1);
  });
  await withPage(fixturePage('Blank', '<p>nothing here</p>'), async (p) => {
    assert.deepEqual(await elementTextAt(p, 600, 600), { text: '', opaque: false }, 'a click on plain page background is not opaque');
  });
});

// ---- keyboard and typing: what may be pressed, what may be typed ---------------------

const field = (extra = {}) => ({ tag: 'input', type: 'text', role: '', label: '', multiline: false, editable: false, typeahead: false, inForm: false, formDefault: '', ...extra });
const F = {
  inputIn: (defaultLabel) => field({ inForm: true, formDefault: defaultLabel }),
  inputAlone: () => field(),
  typeaheadAlone: () => field({ role: 'combobox', typeahead: true }),
  typeaheadIn: (d) => field({ role: 'combobox', typeahead: true, inForm: true, formDefault: d }),
  textarea: () => field({ tag: 'textarea', multiline: true, inForm: true, formDefault: 'Submit application' }),
  editable: () => field({ tag: 'div', editable: true }),
  checkbox: () => field({ type: 'checkbox', inForm: true, formDefault: 'Submit application' }),
  button: (label) => ({ tag: 'button', type: '', role: '', label, multiline: false, editable: false, typeahead: false, inForm: true, formDefault: label }),
  link: (label) => ({ tag: 'a', type: '', role: '', label }),
  body: () => ({ tag: 'body' })
};

test('keyPressVerdict: keys other than Enter and Space are always allowed', () => {
  for (const key of ['Tab', 'Escape', 'ArrowDown', 'Backspace', 'Control+a', 'Shift+Tab', 'a']) {
    assert.equal(keyPressVerdict(key, null).allowed, true, key);
    assert.equal(keyPressVerdict(key, F.button('Submit application')).allowed, true, key);
  }
});

test("keyPressVerdict: Enter in a single-line field is judged by the form's default button", () => {
  assert.equal(keyPressVerdict('Enter', F.inputIn('Submit application')).allowed, false);
  assert.equal(keyPressVerdict('Enter', F.inputIn('Apply')).allowed, false);
  assert.equal(keyPressVerdict('Enter', F.inputIn('Send')).allowed, false);
  assert.equal(keyPressVerdict('Enter', F.inputIn('')).allowed, false, 'a form with no default button we can read');
  assert.equal(keyPressVerdict('Enter', F.inputIn('Next')).allowed, true);
  assert.equal(keyPressVerdict('Enter', F.inputIn('Continue')).allowed, true);
  assert.equal(keyPressVerdict('NumpadEnter', F.inputIn('Submit application')).allowed, false);
  assert.match(keyPressVerdict('Enter', F.inputIn('Submit application')).reason, /default button "Submit application"/);
});

test("keyPressVerdict: Enter outside a form is allowed only in a typeahead; a typeahead inside a form is judged by its default button", () => {
  assert.equal(keyPressVerdict('Enter', F.inputAlone()).allowed, false);
  assert.equal(keyPressVerdict('Enter', F.typeaheadAlone()).allowed, true);
  assert.equal(keyPressVerdict('Enter', F.typeaheadIn('Submit application')).allowed, false);
  assert.equal(keyPressVerdict('Enter', F.typeaheadIn('Next')).allowed, true);
});

test('keyPressVerdict: plain Enter makes a new line in a textarea or editor; a modified Enter does not get through', () => {
  assert.equal(keyPressVerdict('Enter', F.textarea()).allowed, true);
  assert.equal(keyPressVerdict('Enter', F.editable()).allowed, true);
  for (const key of ['Control+Enter', 'Meta+Enter', 'Shift+Enter', 'Alt+Enter']) {
    assert.equal(keyPressVerdict(key, F.textarea()).allowed, false, key);
  }
});

test('keyPressVerdict: Enter or Space on a focused button or link is judged by its label', () => {
  for (const key of ['Enter', 'Space']) {
    assert.equal(keyPressVerdict(key, F.button('Next')).allowed, true, `${key} on Next`);
    assert.equal(keyPressVerdict(key, F.button('Submit application')).allowed, false, `${key} on Submit application`);
    assert.equal(keyPressVerdict(key, F.button('')).allowed, false, `${key} on an unlabelled button`);
    assert.equal(keyPressVerdict(key, F.link('Apply now')).allowed, false, `${key} on Apply now`);
    assert.equal(keyPressVerdict(key, F.link('Sign in')).allowed, false, `${key} on Sign in`);
  }
});

test('keyPressVerdict: Space types a space or ticks a box; nothing focused is harmless; unknown focus is refused', () => {
  assert.equal(keyPressVerdict('Space', F.inputIn('Submit application')).allowed, true);
  assert.equal(keyPressVerdict('Space', F.checkbox()).allowed, true);
  assert.equal(keyPressVerdict('Enter', F.body()).allowed, true);
  assert.equal(keyPressVerdict('Enter', null).allowed, false);
  assert.equal(keyPressVerdict('Space', null).allowed, false);
  assert.equal(keyPressVerdict('Enter', { tag: 'iframe', opaque: true }).allowed, false);
});

test('planTyping: outside a textarea newlines and tabs become spaces and control characters are dropped', () => {
  assert.deepEqual(planTyping('Line one\nLine two\r\n\r\nLine three', F.inputIn('Submit application')), { allowed: true, text: 'Line one Line two Line three' });
  assert.deepEqual(planTyping('a\tb', F.inputAlone()), { allowed: true, text: 'a b' });
  assert.deepEqual(planTyping('a\u0000b\u0007c\u001bd', F.inputAlone()), { allowed: true, text: 'abcd' });
  assert.deepEqual(planTyping('Line one\r\nLine two', F.textarea()), { allowed: true, text: 'Line one\nLine two' });
  assert.deepEqual(planTyping('', F.inputAlone()), { allowed: true, text: '' });
});

test('planTyping: typing at a submit button, in an unreadable frame, or with unknown focus is refused', () => {
  assert.equal(planTyping('hello world', F.button('Submit application')).allowed, false);
  assert.equal(planTyping('hello world', F.button('')).allowed, false);
  assert.equal(planTyping('hello', F.button('Next')).allowed, true);
  assert.equal(planTyping('hello', null).allowed, false);
  assert.equal(planTyping('hello', { tag: 'iframe', opaque: true }).allowed, false);
});

withBrowser("describeFocus reads the focused field, its form and the form's default button", async () => {
  await withPage(formHtml('Submit application'), async (p) => {
    assert.equal((await describeFocus(p)).tag, 'body');
    await p.focus('#name');
    assert.deepEqual(await describeFocus(p), { tag: 'input', type: '', role: '', label: '', multiline: false, editable: false, typeahead: false, inForm: true, formDefault: 'Submit application' });
    await p.focus('#cover');
    assert.equal((await describeFocus(p)).multiline, true);
    await p.focus('#back');
    const back = await describeFocus(p);
    assert.equal(back.label, 'Back');
    assert.equal(back.formDefault, 'Submit application');
  });
});

withBrowser('describeFocus follows focus into a frame and into a shadow root', async () => {
  const html = fixturePage('Frames', `
    <div id="host"></div>
    <iframe id="f" width="300" height="80"></iframe>
    <script>
      document.getElementById('host').attachShadow({ mode: 'open' }).innerHTML = '<input id="deep" aria-label="Deep field">';
      document.getElementById('f').srcdoc = '<form><input id="inner"><button>Submit application</button></form>';
    </script>`);
  await withPage(html, async (p) => {
    await p.frameLocator('#f').locator('#inner').waitFor();
    await p.locator('#host input').focus();
    assert.equal((await describeFocus(p)).label, 'Deep field');
    await p.frameLocator('#f').locator('#inner').focus();
    const inner = await describeFocus(p);
    assert.equal(inner.tag, 'input');
    assert.equal(inner.formDefault, 'Submit application');
  });
});

withBrowser('Enter in a text field: refused when the default button submits, allowed when it is Next', async () => {
  // Control: with no guard the same keypress presses the default button.
  await withPage(formHtml('Submit application'), async (p) => {
    await p.focus('#name');
    await p.keyboard.press('Enter');
    assert.deepEqual(await clicks(p), ['Submit application'], 'control: Enter presses the default button');
  });
  await withPage(formHtml('Submit application'), async (p) => {
    await p.focus('#name');
    const stats = { filled: 0, refusals: 0 };
    const r = await executeComputerAction(p, use({ action: 'key', text: 'Return' }), { stats });
    assert.equal(isRefusal(r), true);
    assert.equal(stats.refusals, 1);
    assert.deepEqual(await clicks(p), []);
  });
  await withPage(formHtml('Next'), async (p) => {
    await p.focus('#name');
    const r = await executeComputerAction(p, use({ action: 'key', text: 'Return' }));
    assert.equal(r.content[0].type, 'image');
    assert.deepEqual(await clicks(p), ['Next']);
  });
});

withBrowser('Enter and Space on a focused button, and Control+Enter in a textarea', async () => {
  await withPage(formHtml('Submit application'), async (p) => {
    await p.focus('#go');
    for (const text of ['Return', 'space']) {
      assert.equal(isRefusal(await executeComputerAction(p, use({ action: 'key', text }))), true, text);
    }
    await p.focus('#cover');
    assert.equal(isRefusal(await executeComputerAction(p, use({ action: 'key', text: 'ctrl+Return' }))), true);
    assert.equal(isRefusal(await executeComputerAction(p, use({ action: 'key', text: 'Return' }))), false, 'plain Enter in a textarea is a new line');
    assert.equal(await p.inputValue('#cover'), '\n');
    assert.deepEqual(await clicks(p), []);
  });
  await withPage(fixturePage('Next', '<button type="button" id="n">Next</button>'), async (p) => {
    await p.focus('#n');
    assert.equal(isRefusal(await executeComputerAction(p, use({ action: 'key', text: 'Return' }))), false);
    assert.deepEqual(await clicks(p), ['Next']);
  });
});

withBrowser('typed text cannot carry an Enter into a single-line field', async () => {
  // Control: raw typing of a newline presses Enter, which presses the default button.
  await withPage(formHtml('Submit application'), async (p) => {
    await p.focus('#name');
    await p.keyboard.type('line one\nline two');
    assert.deepEqual(await clicks(p), ['Submit application'], 'control: a typed newline is an Enter keypress');
  });
  await withPage(formHtml('Submit application'), async (p) => {
    await p.focus('#name');
    const stats = { filled: 0, refusals: 0 };
    await executeComputerAction(p, use({ action: 'type', text: 'line one\nline two' }), { stats });
    assert.equal(await p.inputValue('#name'), 'line one line two');
    assert.equal(stats.filled, 1);
    assert.deepEqual(await clicks(p), []);

    await p.focus('#cover');
    await executeComputerAction(p, use({ action: 'type', text: 'Dear team,\nI am interested.' }), { stats });
    assert.equal(await p.inputValue('#cover'), 'Dear team,\nI am interested.');
    assert.deepEqual(await clicks(p), []);
  });
});

withBrowser('typing while a submit button has focus is refused', async () => {
  await withPage(formHtml('Submit application'), async (p) => {
    await p.focus('#go');
    const r = await executeComputerAction(p, use({ action: 'type', text: 'hello world' }));
    assert.equal(isRefusal(r), true);
    assert.deepEqual(await clicks(p), []);
  });
});
