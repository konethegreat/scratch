import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { clickButtonByText } from './pageBrain.js';
import { launchTestBrowser } from '../testSupport/browser.js';
import { listingPage, formPage } from '../testSupport/fixturePages.js';

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
const buttons = (...labels) => `<body>${labels.map((l) => `<button type="button">${l}</button>`).join('')}
  <script>window.__clicks=[]; document.addEventListener('click',e=>window.__clicks.push(e.target.textContent.trim()));</script></body>`;

withBrowser('the planner cannot make the copilot click a final button on a form page, even one labelled "Apply"', async () => {
  await withPage(formPage({ finalLabel: 'Apply' }), async (page) => {
    const r = await clickButtonByText(page, 'Apply', { onFormPage: true });
    assert.equal(r.clicked, false);
    assert.equal(r.reason, 'left-to-you');
    assert.deepEqual(await clicks(page), []);
  });
});

withBrowser('the planner is refused submit, send, accept-and and sign-in controls on any page', async () => {
  for (const label of ['Submit application', 'Send', 'Accept and continue', 'Agree and continue', 'Place order', 'Sign in', 'Continue with Google']) {
    for (const onFormPage of [false, true]) {
      await withPage(buttons(label), async (page) => {
        const r = await clickButtonByText(page, label, { onFormPage });
        assert.equal(r.clicked, false, `"${label}" (form page: ${onFormPage})`);
        assert.equal(r.reason, 'left-to-you');
        assert.deepEqual(await clicks(page), []);
      });
    }
  }
});

withBrowser('on a form page the planner may still press Next', async () => {
  await withPage(formPage({ finalLabel: 'Submit application', stepLabel: 'Next' }), async (page) => {
    const r = await clickButtonByText(page, 'next', { onFormPage: true });
    assert.deepEqual({ clicked: r.clicked, text: r.text }, { clicked: true, text: 'Next' });
    assert.deepEqual(await clicks(page), ['Next']);
  });
});

withBrowser('off a form page the planner can open a job by name', async () => {
  await withPage(listingPage().replace('<button type="button">Save job</button>', '<button type="button">View job details</button>'), async (page) => {
    const r = await clickButtonByText(page, 'View job details');
    assert.equal(r.clicked, true);
    assert.deepEqual(await clicks(page), ['View job details']);
  });
});

withBrowser('an exact label match wins over an earlier partial match', async () => {
  await withPage(buttons('Apply for similar jobs', 'Apply'), async (page) => {
    const r = await clickButtonByText(page, 'Apply');
    assert.equal(r.text, 'Apply');
    assert.deepEqual(await clicks(page), ['Apply']);
  });
});

withBrowser('an unknown or empty target clicks nothing, and a very short label is not matched backwards', async () => {
  await withPage(buttons('Go', 'Save job'), async (page) => {
    assert.equal((await clickButtonByText(page, 'Open the application page')).reason, 'not-found');
    assert.equal((await clickButtonByText(page, 'Go to the application page')).reason, 'not-found', '"Go" is too short to match a longer request');
    assert.equal((await clickButtonByText(page, '   ')).clicked, false);
    assert.equal((await clickButtonByText(page, undefined)).clicked, false);
    assert.deepEqual(await clicks(page), []);
  });
});