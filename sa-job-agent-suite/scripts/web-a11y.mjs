// Offline accessibility gate. Loads the built web app in Chromium, injects
// axe-core from node_modules and fails on any WCAG A/AA violation on the
// onboarding screen, the landing page, the app shell at desktop and narrow
// widths, and the demo. It also presses Tab and fails when a focused control
// has no visible focus indicator. No network: every request stays on the local
// static server.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { startStaticServer } from './lib/staticServer.mjs';

const require = createRequire(import.meta.url);
const axePath = require.resolve('axe-core/axe.min.js');
const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'client/dist');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function assertBuiltDist() {
  try {
    await fs.access(path.join(dist, 'index.html'));
  } catch {
    throw new Error('client/dist/index.html is missing. Run npm run build:web first.');
  }
}

async function settle(page) {
  // Contrast is measured on the composited colour, so a reveal element caught
  // mid-transition reports a false failure. Wait for it to reach full opacity.
  await page.waitForFunction(() => {
    const reveals = Array.from(document.querySelectorAll('.reveal'));
    return reveals.every((element) => Number(getComputedStyle(element).opacity) > 0.99);
  }, null, { timeout: 5000 }).catch(() => {});
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  await page.waitForTimeout(300);
}

async function scan(page, label, axeSource) {
  await settle(page);
  const hasAxe = await page.evaluate(() => typeof window.axe !== 'undefined');
  // The built page sends `script-src 'self'`, which blocks addScriptTag. An
  // evaluate call runs through the debugging protocol and is not a page script.
  if (!hasAxe) await page.evaluate(axeSource);
  const violations = await page.evaluate(async (tags) => {
    const results = await window.axe.run(document, { runOnly: { type: 'tag', values: tags } });
    return results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.slice(0, 6).map((node) => ({
        target: node.target.join(' '),
        summary: (node.failureSummary || '').replace(/\s+/g, ' ').trim()
      }))
    }));
  }, TAGS);
  if (violations.length > 0) {
    const detail = violations.map((violation) => {
      const nodes = violation.nodes.map((node) => `    ${node.target}\n      ${node.summary}`).join('\n');
      return `  ${violation.id} (${violation.impact}): ${violation.help}\n${nodes}`;
    }).join('\n');
    assert.fail(`${label} has ${violations.length} accessibility violation(s):\n${detail}`);
  }
  console.log(`a11y: ${label} clean`);
}

async function focusIndicators(page, label, presses = 15) {
  await page.evaluate(() => document.activeElement?.blur());
  const seen = [];
  for (let index = 0; index < presses; index += 1) {
    await page.keyboard.press('Tab');
    const state = await page.evaluate(() => {
      const element = document.activeElement;
      if (!element || element === document.body) return { tag: 'BODY' };
      const style = getComputedStyle(element);
      const outline = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
      const shadow = style.boxShadow !== 'none';
      return {
        tag: element.tagName,
        name: element.getAttribute('aria-label') || (element.textContent || '').trim().slice(0, 30),
        visible: outline || shadow
      };
    });
    seen.push(state);
  }
  const invisible = seen.filter((state) => state.tag !== 'BODY' && state.visible === false);
  assert.deepEqual(
    invisible,
    [],
    `${label}: ${invisible.length} focused control(s) had no focus indicator: ${invisible.map((state) => `${state.tag} ${state.name}`).join(', ')}`
  );
}

async function main() {
  await assertBuiltDist();
  const axeSource = await fs.readFile(axePath, 'utf8');
  const server = await startStaticServer({ root: dist });
  const origin = new URL(server.url).origin;
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });

  try {
    // Real mode: onboarding, landing and the shell.
    {
      const context = await browser.newContext({ colorScheme: 'light', viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      const requests = [];
      page.on('request', (request) => requests.push(request.url()));

      await page.goto(server.url, { waitUntil: 'networkidle' });
      await page.getByTestId('onboarding').waitFor({ timeout: 20_000 });
      await scan(page, 'onboarding', axeSource);

      await page.getByTestId('key-skip').click();
      await page.getByRole('button', { name: /Enter the Suite/i }).waitFor({ timeout: 15_000 });
      await scan(page, 'landing', axeSource);

      await page.getByRole('button', { name: /Enter the Suite/i }).click();
      await page.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor({ timeout: 15_000 });
      await scan(page, 'dashboard', axeSource);
      await focusIndicators(page, 'dashboard');

      await page.setViewportSize({ width: 360, height: 800 });
      await page.getByTestId('sidebar-toggle').waitFor();
      await scan(page, 'dashboard at 360px', axeSource);
      await page.getByTestId('sidebar-toggle').click();
      await page.getByTestId('sidebar-toggle').waitFor();
      await scan(page, 'open navigation at 360px', axeSource);

      const external = requests.filter((url) => new URL(url).origin !== origin);
      assert.deepEqual(external, [], 'the accessibility walk reached an origin outside the local bundle');
      await context.close();
    }

    // Demo mode: the dashboard and the simulated portal review.
    {
      const context = await browser.newContext({ colorScheme: 'light', viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      await page.goto(server.url, { waitUntil: 'networkidle' });
      await page.getByTestId('onboarding').waitFor({ timeout: 20_000 });
      await page.getByTestId('try-demo').click({ timeout: 20_000 });
      await page.getByTestId('demo-banner').waitFor({ timeout: 20_000 });
      await page.getByText('Bokamoso Bank', { exact: false }).first().waitFor({ timeout: 20_000 });
      await scan(page, 'demo dashboard', axeSource);
      await focusIndicators(page, 'demo dashboard');

      await page.getByRole('button', { name: /^Apply$/ }).click();
      await page.getByText('Base CV', { exact: false }).first().waitFor({ timeout: 15_000 });
      await scan(page, 'demo apply packet', axeSource);

      await page.getByRole('button', { name: /^Apply Copilot$/ }).click();
      await page.getByTestId('open-simulated-portal').click();
      await page.getByTestId('demo-form-continue').waitFor({ timeout: 20_000 });
      await scan(page, 'simulated portal form', axeSource);

      await page.getByTestId('demo-form-continue').click();
      await page.getByTestId('demo-question').waitFor();
      await page.getByTestId('demo-question').fill('The accessibility dashboard project.');
      await page.getByTestId('demo-question-continue').click();
      await page.getByTestId('demo-review').waitFor({ timeout: 15_000 });
      await scan(page, 'simulated portal review', axeSource);
      await focusIndicators(page, 'simulated portal review', 20);

      await context.close();
    }

    console.log('web a11y: PASS');
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((error) => {
  console.error(`web a11y: FAIL - ${error.message}`);
  process.exitCode = 1;
});
