// One persistent-profile context factory for the hunter, canary, login browser
// and login status check.
import { chromium } from 'playwright';
import { BROWSER_PROFILE_PATH } from '../db/helper.js';

export const SCRAPE_LAUNCH_OPTS = Object.freeze({
  headless: true,
  args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-setuid-sandbox'],
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  viewport: { width: 1366, height: 768 },
  locale: 'en-ZA',
  timezoneId: 'Africa/Johannesburg'
});

export const LOGIN_LAUNCH_OPTS = Object.freeze({
  headless: false,
  args: ['--start-maximized'],
  viewport: null
});

export function profileLaunchOptions({ headless = true, args, viewport } = {}) {
  const options = headless ? { ...SCRAPE_LAUNCH_OPTS } : { ...LOGIN_LAUNCH_OPTS };
  if (Array.isArray(args)) options.args = [...args];
  if (viewport !== undefined) options.viewport = viewport;
  return options;
}

export async function openProfileContext({ headless = true, args, viewport, launch } = {}) {
  const options = profileLaunchOptions({ headless, args, viewport });
  const start = launch || chromium.launchPersistentContext.bind(chromium);
  try {
    return await start(BROWSER_PROFILE_PATH, { ...options, channel: 'chrome' });
  } catch {
    return await start(BROWSER_PROFILE_PATH, options);
  }
}

/**
 * A throwaway browser for sites the user has not connected. It shares no
 * cookies or storage with the persistent profile, so a site without consent
 * can never see another site's saved login.
 */
export async function openEphemeralContext({ headless = false, args, viewport, serviceWorkers, launch } = {}) {
  const options = profileLaunchOptions({ headless, args, viewport });
  const start = launch || chromium.launch.bind(chromium);
  const browser = await start({ headless: options.headless, args: options.args });
  const context = await browser.newContext({
    ...(options.userAgent ? { userAgent: options.userAgent } : {}),
    viewport: options.viewport || { width: 1440, height: 1100 },
    locale: options.locale || 'en-ZA',
    timezoneId: options.timezoneId || 'Africa/Johannesburg',
    ...(serviceWorkers ? { serviceWorkers } : {})
  });
  return { context, browser };
}
