import { openProfileContext } from './browser.js';
import { loginSite } from './loginSites.js';
import { setSiteConsent, clearSiteConsent } from '../db/helper.js';

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_POLL_MS = 3000;

export async function connectSite(siteKey, { site = loginSite(siteKey), openContext = openProfileContext, timeoutMs = DEFAULT_TIMEOUT_MS, pollMs = DEFAULT_POLL_MS } = {}) {
  if (!site) throw new Error('That job site is not supported yet.');
  let context;
  try {
    context = await openContext({ headless: false, viewport: null });
    const page = context.pages()[0] || await context.newPage();
    await page.goto(site.loginUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, pollMs));
      if (page.isClosed()) return null;
      try {
        if (await site.isLoggedIn(page)) {
          return setSiteConsent({ siteKey: site.key, label: site.label, origin: site.origin, method: 'login' });
        }
      } catch {
        // The page is mid-navigation; check again on the next poll.
      }
    }
    return null;
  } finally {
    if (context) await context.close().catch(() => {});
  }
}

export async function disconnectSite(siteKey, { site = loginSite(siteKey), openContext = openProfileContext } = {}) {
  if (!site) throw new Error('That job site is not supported yet.');
  let context;
  try {
    context = await openContext({ headless: true });
    const page = context.pages()[0] || await context.newPage();
    const cdp = await context.newCDPSession(page);
    try {
      const { cookies } = await cdp.send('Network.getCookies', { urls: [site.origin] });
      for (const cookie of cookies || []) {
        await cdp.send('Network.deleteCookies', {
          name: cookie.name,
          domain: cookie.domain,
          path: cookie.path
        });
      }
    } finally {
      await cdp.detach().catch(() => {});
    }
    await page.goto(site.origin, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    await page.evaluate(() => {
      try { localStorage.clear(); } catch {}
      try { sessionStorage.clear(); } catch {}
    }).catch(() => {});
  } finally {
    if (context) await context.close().catch(() => {});
  }
  clearSiteConsent(site.key);
  return true;
}
