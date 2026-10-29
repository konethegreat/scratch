// Post-deploy check in a fresh browser profile. It never touches the real vault:
// it only enters the demo, tailors one fictional job and exits.
import assert from 'node:assert/strict';

const base = process.argv[2] || 'https://sajas.pages.dev';

const demoKeys = (page) => page.evaluate(() => {
  const keys = [];
  for (let index = 0; index < sessionStorage.length; index += 1) keys.push(sessionStorage.key(index));
  return keys.filter((key) => key.startsWith('sajas:demo:'));
});

async function main() {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    const requests = [];
    const page = await context.newPage();
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('request', (request) => requests.push(request.url()));

    await page.goto(base, { waitUntil: 'networkidle' });
    // A fresh profile has no vault, so the startup screen offers the demo.
    await page.getByTestId('onboarding').waitFor({ timeout: 20_000 });
    await page.getByTestId('try-demo').click({ timeout: 20_000 });
    await page.getByTestId('demo-banner').waitFor({ timeout: 20_000 });
    await page.getByRole('button', { name: /^Document Tailor$/ }).click();
    await page.getByText('Data Engineer').first().click();
    await page.getByTestId('optimise-cv').click();
    await page.getByTestId('tailored-cv').waitFor({ timeout: 15_000 });
    assert.match(await page.getByTestId('tailored-cv').locator('textarea').inputValue(), /Sample Logistics/);
    await page.getByTestId('exit-demo').click();
    await page.getByTestId('onboarding').waitFor({ timeout: 20_000 });
    assert.equal(await page.getByTestId('demo-banner').count(), 0, 'the demo banner survived the exit');
    assert.deepEqual(await demoKeys(page), [], 'demo keys survived the exit');
    assert.deepEqual(errors, [], `console errors: ${errors.join(' | ')}`);
    const external = requests.filter((url) => /^https?:\/\//.test(url) && !url.startsWith(new URL(base).origin));
    assert.deepEqual(external, [], 'a request left the deployed origin');
    console.log(`web-demo-live: ok (${base})`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
