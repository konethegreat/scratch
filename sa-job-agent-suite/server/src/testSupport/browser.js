import { chromium } from 'playwright';

/**
 * Launches a headless browser for tests: the system Chrome first (what the app
 * itself prefers), then a Playwright-managed Chromium. Returns null when
 * neither exists, so callers can skip. On CI a missing browser is an error:
 * skipping silently there would hide a broken pipeline.
 */
export async function launchTestBrowser() {
  let lastError = null;
  for (const options of [{ channel: 'chrome' }, {}]) {
    try {
      return await chromium.launch({ headless: true, ...options });
    } catch (err) {
      lastError = err;
    }
  }
  if (process.env.CI) throw new Error(`no browser available on CI: ${lastError?.message}`);
  return null;
}