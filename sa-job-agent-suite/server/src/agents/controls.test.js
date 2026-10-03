import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { listControls, findAdvanceControl, clickControl } from './controls.js';
import { launchTestBrowser } from '../testSupport/browser.js';
import { listingPage, formPage, reviewPage } from '../testSupport/fixturePages.js';

const browser = await launchTestBrowser();
after(() => browser?.close());
const withBrowser = browser ? test : test.skip;

async function withPage(html, fn) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.setContent(html);
    return await fn(page);
  } finally {
    await context.close();
  }
}
const clicks = (page) => page.evaluate(() => window.__clicks);

withBrowser('listControls: visible, enabled controls in document order, labels tidied, the rest skipped', async () => {
  const html = `<body>
    <button>  Save   job </button>
    <button disabled>Disabled one</button>
    <button style="display:none">Hidden one</button>
    <button style="visibility:hidden">Invisible one</button>
    <button aria-disabled="true">Aria disabled</button>
    <button></button>
    <input type="submit" value="Send it">
    <a href="#" aria-label="Open menu"><svg width="10" height="10"></svg></a>
    <div role="button">Custom   control</div>
  </body>`;
  await withPage(html, async (page) => {
    const controls = await listControls(page);
    assert.deepEqual(controls.map((c) => c.text), ['Save job', 'Send it', 'Open menu', 'Custom control']);
    assert.ok(controls.every((c, i) => Number.isInteger(c.index) && (i === 0 || c.index > controls[i - 1].index)));
  });
});

withBrowser('listControls returns [] when the page is gone instead of throwing', async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await context.close();
  assert.deepEqual(await listControls(page), []);
});

withBrowser('a listing page: the Apply link is found and clicked', async () => {
  await withPage(listingPage({ applyLabel: 'Apply now' }), async (page) => {
    const adv = await findAdvanceControl(page);
    assert.equal(adv.found, true);
    assert.equal(adv.text, 'Apply now');
    const result = await clickControl(page, adv);
    assert.deepEqual({ clicked: result.clicked, text: result.text }, { clicked: true, text: 'Apply now' });
    assert.deepEqual(await clicks(page), ['Apply now']);
  });
});

withBrowser('a filled form whose final button reads "Apply": nothing is advanced on a form page', async () => {
  await withPage(formPage({ finalLabel: 'Apply' }), async (page) => {
    // Control: with the wider listing-page words the same button WOULD be found,
    // so it is the form-page rule that protects it, and this test can tell.
    const wide = await findAdvanceControl(page);
    assert.equal(wide.text, 'Apply', 'control: the listing-page rule would advance this button');

    const narrow = await findAdvanceControl(page, { onFormPage: true });
    assert.equal(narrow.found, false);
    assert.deepEqual(await clicks(page), []);
  });
});

withBrowser('a review step with no inputs and a final "Apply" button: the narrow rule keeps it for the human', async () => {
  await withPage(reviewPage({ finalLabel: 'Apply' }), async (page) => {
    assert.equal((await findAdvanceControl(page)).text, 'Apply', 'control: the wide rule would click it');
    assert.equal((await findAdvanceControl(page, { onFormPage: true })).found, false);
  });
});

withBrowser('a form with a Next button: Next is advanced, the final button is not touched', async () => {
  await withPage(formPage({ finalLabel: 'Submit application', stepLabel: 'Next' }), async (page) => {
    const adv = await findAdvanceControl(page, { onFormPage: true });
    assert.equal(adv.text, 'Next');
    assert.equal((await clickControl(page, adv, { onFormPage: true })).clicked, true);
    assert.deepEqual(await clicks(page), ['Next']);
  });
});

withBrowser('final-submit and account wording is never found, on either kind of page', async () => {
  const labels = ['Submit application', 'Submit', 'Send', 'Send application', 'Confirm and submit', 'Finish', 'Place order', 'Accept and continue', 'Sign in', 'Continue with Google'];
  for (const finalLabel of labels) {
    await withPage(formPage({ finalLabel }), async (page) => {
      assert.equal((await findAdvanceControl(page)).found, false, `"${finalLabel}" on a listing-style page`);
      assert.equal((await findAdvanceControl(page, { onFormPage: true })).found, false, `"${finalLabel}" on a form page`);
    });
  }
});

withBrowser('a button relabelled after it was chosen is not clicked (the stale-tag bug)', async () => {
  const html = `<body><button id="b">Next</button>
    <script>window.__clicks=[]; document.getElementById('b').addEventListener('click',()=>window.__clicks.push('b'));</script></body>`;
  const relabel = (page) => page.evaluate(() => { document.getElementById('b').textContent = 'Submit application'; });

  // Control: the old approach tagged the element and clicked the tag later. The same relabel gets clicked.
  await withPage(html, async (page) => {
    await page.evaluate(() => document.getElementById('b').setAttribute('data-sajas-adv', '1'));
    await relabel(page);
    await page.click('[data-sajas-adv]');
    assert.deepEqual(await clicks(page), ['b'], 'control: a stale tag lands on the relabelled button');
  });

  await withPage(html, async (page) => {
    const adv = await findAdvanceControl(page, { onFormPage: true });
    assert.equal(adv.text, 'Next');
    await relabel(page);
    const result = await clickControl(page, adv, { onFormPage: true });
    assert.equal(result.clicked, false);
    assert.equal(result.reason, 'changed');
    assert.deepEqual(await clicks(page), []);
  });
});

withBrowser('a control that moved or disappeared since it was chosen is not clicked', async () => {
  const html = `<body><button>Back</button><button id="n">Next</button>
    <script>window.__clicks=[]; document.addEventListener('click',e=>window.__clicks.push(e.target.textContent));</script></body>`;
  await withPage(html, async (page) => {
    const adv = await findAdvanceControl(page, { onFormPage: true });
    assert.equal(adv.text, 'Next');
    // A new control is inserted ahead of it: the chosen position now holds something else.
    await page.evaluate(() => document.body.insertAdjacentHTML('afterbegin', '<button>Cookie settings</button>'));
    assert.equal((await clickControl(page, adv, { onFormPage: true })).reason, 'changed');
    // And when the element is removed altogether.
    await page.evaluate(() => document.getElementById('n').remove());
    assert.equal((await clickControl(page, adv, { onFormPage: true })).reason, 'changed');
    assert.deepEqual(await clicks(page), []);
  });
});

withBrowser('clickControl re-applies the policy itself, whatever it was handed', async () => {
  await withPage(formPage({ finalLabel: 'Apply', stepLabel: 'Next' }), async (page) => {
    const controls = await listControls(page);
    const apply = controls.find((c) => c.text === 'Apply');
    assert.equal((await clickControl(page, apply, { onFormPage: true })).reason, 'refused');
    assert.equal((await clickControl(page, apply, { onFormPage: true, planned: true })).reason, 'refused');
    const submit = { ...apply, text: 'Submit application' };
    assert.equal((await clickControl(page, submit, { planned: true })).reason, 'refused');
    assert.equal((await clickControl(page, null)).reason, 'no-control');
    assert.equal((await clickControl(page, { text: 'Next' })).reason, 'no-control');
    assert.deepEqual(await clicks(page), []);
  });
});