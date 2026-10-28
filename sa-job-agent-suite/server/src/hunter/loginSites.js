// One registry for the job sites that benefit from a saved login. Agent 1's
// setup/status checks, the consent store and the copilot's session gate all
// read this list, so a new site is added in exactly one place.
export const LOGIN_SITES = Object.freeze([
  {
    key: 'linkedin',
    label: 'LinkedIn',
    origin: 'https://www.linkedin.com',
    loginUrl: 'https://www.linkedin.com/login',
    checkUrl: 'https://www.linkedin.com/feed/',
    isLoggedIn: (page) => {
      const url = page.url();
      return !url.includes('/login') && !url.includes('/authwall') && !url.includes('/uas/');
    }
  },
  {
    key: 'indeedSa',
    label: 'Indeed SA',
    origin: 'https://za.indeed.com',
    loginUrl: 'https://za.indeed.com/account/login',
    checkUrl: 'https://za.indeed.com/account/view?hl=en',
    isLoggedIn: (page) => {
      const url = page.url();
      return !url.includes('/account/login') && !url.includes('/account/register');
    }
  },
  {
    key: 'pnet',
    label: 'PNet',
    origin: 'https://www.pnet.co.za',
    loginUrl: 'https://www.pnet.co.za',
    checkUrl: 'https://www.pnet.co.za',
    isLoggedIn: (page) => page.evaluate(() => {
      const header = document.querySelector('nav, header');
      if (!header) return true;
      return !Array.from(header.querySelectorAll('a, button'))
        .some((element) => /^(sign\s?in|log\s?in)$/i.test(element.textContent.trim()));
    })
  },
  {
    key: 'careerJunction',
    label: 'CareerJunction',
    origin: 'https://www.careerjunction.co.za',
    loginUrl: 'https://www.careerjunction.co.za',
    checkUrl: 'https://www.careerjunction.co.za',
    isLoggedIn: (page) => page.evaluate(() =>
      !Array.from(document.querySelectorAll('a, button'))
        .some((element) => /^(sign\s?in|log\s?in)$/i.test(element.textContent.trim()))
    )
  },
  {
    key: 'gumtreeSa',
    label: 'Gumtree SA',
    origin: 'https://www.gumtree.co.za',
    loginUrl: 'https://www.gumtree.co.za/t-login-register.html',
    checkUrl: 'https://www.gumtree.co.za/t-account.html',
    isLoggedIn: (page) => {
      const url = page.url();
      return !url.includes('login') && !url.includes('register');
    }
  }
]);

export function loginSite(key) {
  return LOGIN_SITES.find((site) => site.key === key) || null;
}

// A host matches a site when it is the site's own host or a subdomain of it,
// with a leading www. ignored on both sides (pnet.co.za == www.pnet.co.za).
export function siteForHost(host) {
  const target = String(host || '').toLowerCase().replace(/^www\./, '');
  if (!target) return null;
  return LOGIN_SITES.find((site) => {
    const base = new URL(site.origin).hostname.toLowerCase().replace(/^www\./, '');
    return target === base || target.endsWith(`.${base}`);
  }) || null;
}
