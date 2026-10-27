// Offline browser proof for the theme, the portfolio landing page, keyboard
// access, responsive layout and console cleanliness. All requests stay on the
// local static server.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { startStaticServer } from './lib/staticServer.mjs';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'client/dist');

const PROJECTS = ['SA-JAS', 'ClearCut', 'Vigil', 'TimeLex', 'Diary', 'MuniSolve ZA'];
const TOP_LINKS = [
  'https://konethegreat.github.io',
  'https://k-one-it-solutions-website.erictshivhinda.workers.dev',
  'https://github.com/konethegreat'
];

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function assertBuiltDist() {
  try {
    await fs.access(path.join(dist, 'index.html'));
  } catch {
    throw new Error('client/dist/index.html is missing. Run npm run build:web first.');
  }
}

async function themeOf(page) {
  return page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    choice: document.documentElement.dataset.themeChoice,
    colourScheme: document.documentElement.style.colorScheme,
    stored: localStorage.getItem('sajas-theme')
  }));
}

async function enterLanding(page) {
  await page.getByTestId('onboarding').waitFor({ timeout: 20_000 });
  await page.getByTestId('key-skip').click();
  await page.getByRole('button', { name: /Enter the Suite/i }).waitFor({ timeout: 15_000 });
}

async function main() {
  await assertBuiltDist();
  const server = await startStaticServer({ root: dist });
  const origin = new URL(server.url).origin;
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });

  try {
    // 1. Boot: with the React bundle blocked, the head script alone must set dark.
    {
      const context = await browser.newContext();
      await context.addInitScript(() => {
        try { localStorage.setItem('sajas-theme', 'dark'); } catch { /* first document */ }
      });
      const page = await context.newPage();
      await page.route('**/*', (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) return route.abort();
        if (url.pathname.endsWith('.js') && !url.pathname.endsWith('theme-boot.js')) return route.abort();
        return route.continue();
      });
      await page.goto(server.url, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark', null, { timeout: 10_000 });
      assert.equal(await page.evaluate(() => document.documentElement.dataset.themeChoice), 'dark');
      assert.equal(
        await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
        'rgb(11, 13, 18)',
        'the boot script did not paint the dark app surface before React loaded'
      );
      await context.close();
    }

    const context = await browser.newContext({ colorScheme: 'dark', viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    const requests = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('request', (request) => requests.push(request.url()));

    await page.goto(server.url, { waitUntil: 'networkidle' });

    // 2. First visit follows the OS.
    await page.getByTestId('onboarding').waitFor({ timeout: 20_000 });
    await page.getByTestId('theme-toggle').waitFor();
    assert.equal((await themeOf(page)).theme, 'dark');

    await enterLanding(page);

    // 3. Landing content.
    const heading = await page.locator('h1').count();
    assert.equal(heading, 1, 'the landing page must have exactly one h1');
    for (const name of PROJECTS) {
      assert.equal(
        await page.getByRole('heading', { name, exact: true }).count(),
        1,
        `the ${name} card heading is missing or duplicated`
      );
    }
    assert.equal(await page.getByText('Server Health Monitor', { exact: false }).count(), 0, 'excluded project on the landing page');
    assert.equal(await page.getByText('Mostoeneng', { exact: false }).count(), 0, 'excluded client work on the landing page');
    for (const href of TOP_LINKS) {
      assert.ok(await page.locator(`a[href="${href}"]`).count() > 0, `missing link ${href}`);
    }

    const order = await page.evaluate(() =>
      Array.from(document.querySelectorAll('h1,h2,h3')).map((element) => element.tagName)
    );
    let sawSection = false;
    for (const tag of order) {
      if (tag === 'H2') sawSection = true;
      if (tag === 'H3') assert.ok(sawSection, 'a card heading appears before a section heading');
    }

    // 4. Skip link.
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.className), 'skip-link');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.activeElement?.id === 'main-content');

    // 5. Toggle, persistence and system follow.
    await page.getByTestId('theme-light').click();
    let state = await themeOf(page);
    assert.equal(state.theme, 'light');
    assert.equal(state.choice, 'light');
    assert.equal(state.colourScheme, 'light');
    assert.equal(state.stored, 'light');

    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /Enter the Suite/i }).waitFor({ timeout: 15_000 });
    assert.equal((await themeOf(page)).theme, 'light', 'a stored light choice did not survive a dark OS reload');

    await page.getByTestId('theme-system').click();
    assert.equal((await themeOf(page)).theme, 'dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');

    // 6. Keyboard operation and a visible focus ring.
    for (let index = 0; index < 40; index += 1) {
      const active = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
      if (active === 'theme-dark') break;
      await page.keyboard.press('Tab');
    }
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-testid')), 'theme-dark');
    const ring = await page.evaluate(() => {
      const style = getComputedStyle(document.activeElement);
      return { width: style.outlineWidth, style: style.outlineStyle };
    });
    assert.notEqual(ring.style, 'none', 'the theme control has no visible focus ring');
    assert.notEqual(ring.width, '0px');
    await page.keyboard.press('Enter');
    assert.equal((await themeOf(page)).theme, 'dark');

    // 7. Enter the shell.
    await page.getByRole('button', { name: /Enter the Suite/i }).click();
    await page.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor({ timeout: 15_000 });
    assert.equal(await page.evaluate(() => document.body.style.overflowX), '', 'the shell sets a horizontal overflow hack');
    assert.equal(
      await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
      'rgb(11, 13, 18)'
    );

    // 8. Responsive layout on the dashboard and the landing page.
    for (const width of [360, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await delay(150);
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      assert.ok(overflow <= 1, `the dashboard overflows horizontally at ${width}px by ${overflow}px`);
    }
    await page.getByRole('button', { name: 'Home / About' }).click();
    await page.getByRole('button', { name: /Enter the Suite/i }).waitFor();
    for (const width of [360, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await delay(150);
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      assert.ok(overflow <= 1, `the landing page overflows horizontally at ${width}px by ${overflow}px`);
    }

    // 9. Reduced motion.
    {
      const reduced = await browser.newContext({ colorScheme: 'light', reducedMotion: 'reduce' });
      const reducedPage = await reduced.newPage();
      await reducedPage.goto(server.url, { waitUntil: 'networkidle' });
      await enterLanding(reducedPage);
      const reveal = await reducedPage.evaluate(() => {
        const element = document.querySelector('.reveal');
        if (!element) return null;
        const style = getComputedStyle(element);
        return { opacity: Number(style.opacity), duration: parseFloat(style.animationDuration) };
      });
      assert.ok(reveal, 'the landing page has no reveal element');
      assert.ok(reveal.opacity > 0.99, 'a reduced-motion reveal element stays hidden');
      assert.ok(reveal.duration < 0.02, `reduced motion still animates for ${reveal.duration}s`);
      await reduced.close();
    }

    // 10. No off-origin request and no console error.
    assert.deepEqual(
      requests.filter((url) => new URL(url).origin !== origin),
      [],
      'the landing and dashboard reached an origin outside the local bundle'
    );
    assert.deepEqual(errors, [], `console errors: ${errors.join(' | ')}`);

    await context.close();
    console.log(`web ui: PASS (${requests.length} requests checked)`);
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((error) => {
  console.error(`web ui: FAIL - ${error.message}`);
  process.exitCode = 1;
});
