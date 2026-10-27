// Merge-blocking zero-knowledge check. Builds on the real web bundle, serves it
// with the production headers, and asserts the canary key appears ONLY in the
// x-api-key header of a request to api.anthropic.com.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { startStaticServer } from './lib/staticServer.mjs';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'client/dist');
const publicDir = path.join(root, 'client/public');
// Assembled at runtime so no key-shaped literal ever exists in the repository.
const canary = ['sk', 'ant', 'api03', randomBytes(24).toString('base64url')].join('-');

async function readIfPresent(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

// A missing dist means "build first"; a dist whose Cloudflare files differ from
// client/public means the bundle predates the config and the header checks
// below would be testing the wrong thing. Only `_headers` and `_redirects` have
// a `client/public` source: `client/public/index.html` does not exist, so
// comparing it would be inert today and a false "stale" the day one is added.
// The built `index.html` still has to exist.
async function assertBuiltDist() {
  if ((await readIfPresent(path.join(dist, 'index.html'))) === null) {
    throw new Error('client/dist/index.html is missing - run npm run build:web first.');
  }
  for (const file of ['_headers', '_redirects']) {
    const built = await readIfPresent(path.join(dist, file));
    if (built === null) {
      throw new Error(`client/dist/${file} is missing - run npm run build:web first.`);
    }
    const source = await readIfPresent(path.join(publicDir, file));
    if (source !== null && built !== source) {
      throw new Error(`client/dist/${file} is stale - run npm run build:web again.`);
    }
  }
}

// Every request the page made, checked once at the end (the request and block
// lists are cumulative, so a single call after the last flow covers every
// phase). Three things must hold: nothing may reach the desktop API origin,
// nothing may reach an origin the router blocked, and no request may target an
// origin outside the local server and the mocked Anthropic endpoint.
function assertNetworkSurface({ requests, blocked, allowedOrigins }) {
  const offOrigin = (url) => {
    try {
      return !allowedOrigins.has(new URL(url).origin);
    } catch {
      return true;
    }
  };
  const localApiHits = requests.filter((req) => {
    try {
      return new URL(req.url).origin === 'http://localhost:5000';
    } catch {
      return false;
    }
  });
  assert.deepEqual(localApiHits.map((req) => req.url), [], 'web mode called the desktop API origin');
  assert.deepEqual(blocked, [], 'the web build tried to reach an origin the canary blocked');
  assert.deepEqual(
    requests.filter((req) => offOrigin(req.url)).map((req) => req.url),
    [],
    'the web build made a request outside the local server and api.anthropic.com'
  );
}

// Serialise a console argument (or argument list) for the leak scan. Object
// arguments come back from `jsonValue()` already JSON-ish, but guard the
// stringify anyway so a self-referencing or unserialisable value cannot crash
// the run instead of being scanned.
function jsonText(value) {
  const seen = new WeakSet();
  try {
    const text = JSON.stringify(value, (_key, item) => {
      if (item && typeof item === 'object') {
        if (seen.has(item)) return '[Circular]';
        seen.add(item);
      }
      return item;
    });
    return text === undefined ? String(value) : text;
  } catch {
    return String(value);
  }
}

// The visible DOM surface. `outerHTML` alone cannot see live field state
// (`fill()` sets the `value` property, never the attribute) or into a frame's
// document, so capture every form control's current value and the HTML of every
// same-origin iframe as well. Cross-origin frames expose no `contentDocument`
// and contribute nothing; their tag is still in the parent's outerHTML.
async function readDomSurface(page) {
  return page.evaluate(() => {
    const formValues = [];
    const iframes = [];
    const walk = (doc) => {
      for (const el of Array.from(doc.querySelectorAll('input, textarea, select'))) {
        const values = [String(el.value ?? '')];
        if (el.tagName.toLowerCase() === 'select') {
          for (const option of Array.from(el.selectedOptions || [])) values.push(option.value);
        }
        formValues.push({
          tag: el.tagName.toLowerCase(),
          name: el.getAttribute('name') || '',
          value: values.join('\n')
        });
      }
      for (const frame of Array.from(doc.querySelectorAll('iframe, frame'))) {
        const child = frame.contentDocument;
        if (!child) continue;
        iframes.push(child.documentElement.outerHTML);
        walk(child);
      }
    };
    walk(document);
    return { dom: document.documentElement.outerHTML, formValues, iframes };
  });
}

// All IndexedDB rows for every database (or one named database). Returned to
// Node as plain JSON so the scan runs outside the page's own globals.
async function readStores(page, dbName = null) {
  return page.evaluate(async (name) => {
    const dbs = (await indexedDB.databases()).filter((info) => !name || info.name === name);
    const out = [];
    for (const info of dbs) {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open(info.name);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      for (const store of Array.from(db.objectStoreNames)) {
        const rows = await new Promise((resolve, reject) => {
          const tx = db.transaction(store, 'readonly');
          const req = tx.objectStore(store).getAll();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        out.push({ db: info.name, store, json: JSON.stringify(rows) });
      }
      db.close();
    }
    return out;
  }, dbName);
}

async function main() {
  await assertBuiltDist();
  const html = await fs.readFile(path.join(dist, 'index.html'), 'utf8');
  assert.equal(/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), false, 'index.html has an inline script the CSP would block');
  assert.equal(html.includes('fonts.googleapis.com'), false, 'the web build still references Google Fonts');
  assert.equal(html.includes('fonts.gstatic.com'), false, 'the web build still references Google Fonts');
  for (const match of html.matchAll(/<script[^>]*\bsrc="([^"]+)"/gi)) {
    assert.equal(/^(?:https?:)?\/\//.test(match[1]), false, `third-party script in index.html: ${match[1]}`);
  }
  for (const match of html.matchAll(/<link[^>]*\bhref="([^"]+)"/gi)) {
    assert.equal(/fonts\.(?:googleapis|gstatic)\.com/.test(match[1]), false, `third-party font in index.html: ${match[1]}`);
  }

  const server = await startStaticServer({ root: dist });
  const { chromium } = await import('playwright');

  // The offline proof starts here: every origin the page is allowed to talk to.
  const allowedOrigins = new Set([new URL(server.url).origin, 'https://api.anthropic.com']);

  try {
    const served = await fetch(server.url);
    assert.equal(served.status, 200, 'the static server did not serve index.html');
    const servedCsp = served.headers.get('content-security-policy') || '';
    assert.match(servedCsp, /script-src 'self'/, '_headers CSP was not applied by the server');
    assert.equal(servedCsp.includes('unsafe-eval'), false, 'served CSP allows unsafe-eval');
    assert.equal(/\*/.test(servedCsp.split(';').find((s) => s.trim().startsWith('connect-src')) || ''), false, 'served CSP has a wildcard connect-src');

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const requests = [];
    const consoleLines = [];
    page.on('request', (req) => requests.push({
      url: req.url(),
      method: req.method(),
      headers: req.headers(),
      postData: req.postData() || ''
    }));
    // `msg.text()` renders object arguments as `JSHandle@object`, so a
    // `console.log({ key })` would evade the text scan. Resolve the arguments
    // too; they settle asynchronously, so track the promises and await them
    // before each scan.
    const consoleArgs = [];
    page.on('console', (msg) => {
      consoleLines.push(msg.text());
      consoleArgs.push(
        Promise.all(msg.args().map((arg) => arg.jsonValue().catch(() => '<unserializable>')))
          .then((args) => consoleLines.push(jsonText(args)))
          .catch(() => {})
      );
    });
    page.on('pageerror', (err) => consoleLines.push(String(err)));
    const settleConsole = () => Promise.all(consoleArgs);

    // One router for every request: Anthropic is answered locally, the static
    // bundle is served by the local server, and anything else is blocked so a
    // regression can never reach the live network during this test.
    const blocked = [];
    const serverOrigin = new URL(server.url).origin;
    await page.route('**/*', async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      if (url.origin === 'https://api.anthropic.com') {
        const cors = {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': 'x-api-key,anthropic-version,anthropic-dangerous-direct-browser-access,content-type',
          'access-control-allow-methods': 'GET,POST,OPTIONS'
        };
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: cors,
          body: JSON.stringify({ data: [], has_more: false })
        });
      }
      if (url.origin === serverOrigin) return route.continue();
      blocked.push(req.url());
      return route.abort('blockedbyclient');
    });

    try {
      await page.goto(server.url, { waitUntil: 'networkidle' });
      await page.getByTestId('onboarding').waitFor({ timeout: 15_000 }).catch(() => {
        throw new Error('client/dist did not render the web onboarding screen - it is not a web build, run npm run build:web first.');
      });
      await page.getByTestId('key-input').waitFor({ timeout: 15_000 });
      await page.getByTestId('key-input').fill(canary);
      const probe = page.waitForRequest(
        (req) => req.method() === 'GET' && req.url().startsWith('https://api.anthropic.com/v1/models'),
        { timeout: 15_000 }
      );
      await page.getByTestId('key-submit').click();
      await probe;
      // Onboarding hands off to the landing page; enter the shell from there.
      await page.getByRole('button', { name: /Enter the Suite/i }).waitFor({ timeout: 15_000 });
      await page.getByRole('button', { name: /Enter the Suite/i }).click();
      await page.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor({ timeout: 15_000 });

      // Server-only surfaces must be gone.
      assert.equal(await page.getByText('Apply Copilot', { exact: true }).count(), 0, 'Apply Copilot tab leaked into web mode');
      assert.equal(await page.getByText('Activity Logs', { exact: true }).count(), 0, 'Activity Logs tab leaked into web mode');

      const dump = {
        ...(await readDomSurface(page)),
        url: page.url(),
        localStorage: await page.evaluate(() => JSON.stringify(localStorage)),
        sessionStorage: await page.evaluate(() => JSON.stringify(sessionStorage)),
        cookie: await page.evaluate(() => document.cookie),
        idb: await readStores(page)
      };

      const leaks = [];
      const collect = (scan, label) => {
        if (scan.dom.includes(canary)) leaks.push(`${label} DOM`);
        for (const field of scan.formValues) {
          if (field.value.includes(canary)) {
            leaks.push(`${label} form value (${field.tag}${field.name ? ` ${field.name}` : ''})`);
          }
        }
        for (const html of scan.iframes) if (html.includes(canary)) leaks.push(`${label} iframe DOM`);
        if (scan.url.includes(canary)) leaks.push(`${label} URL`);
        if (scan.localStorage.includes(canary)) leaks.push(`${label} localStorage`);
        if (scan.sessionStorage.includes(canary)) leaks.push(`${label} sessionStorage`);
        if (scan.cookie.includes(canary)) leaks.push(`${label} cookie`);
        for (const row of scan.idb) if (row.json.includes(canary)) leaks.push(`${label} IndexedDB ${row.db}/${row.store}`);
      };
      collect(dump, 'after onboarding');
      await settleConsole();
      for (const line of consoleLines) if (line.includes(canary)) leaks.push('console');

      // Positive proof the key really travelled: without this the leak scan
      // below could pass simply because the key was never sent anywhere.
      const keyed = requests.filter((req) => req.headers['x-api-key'] === canary);
      assert.ok(keyed.length > 0, 'the canary key was never sent in an x-api-key header');
      for (const req of keyed) {
        const where = new URL(req.url);
        assert.equal(where.hostname, 'api.anthropic.com', `x-api-key sent to ${req.url}`);
        assert.equal(where.protocol, 'https:', `x-api-key sent over ${where.protocol}`);
      }

      for (const req of requests) {
        if (req.url.includes(canary)) leaks.push(`request URL ${req.method} ${req.url}`);
        if (req.postData.includes(canary)) leaks.push(`request body ${req.method} ${req.url}`);
        for (const [name, value] of Object.entries(req.headers)) {
          if (!String(value).includes(canary)) continue;
          const target = new URL(req.url);
          const allowed = name.toLowerCase() === 'x-api-key'
            && target.protocol === 'https:'
            && target.hostname === 'api.anthropic.com';
          if (!allowed) leaks.push(`header ${name} on ${req.url}`);
        }
      }
      assert.deepEqual(leaks, [], `canary leaked: ${leaks.join(', ')}`);

      // Remember -> the blob must be ciphertext only.
      await page.getByRole('button', { name: /Profile & Settings/i }).click();
      await page.getByTestId('remember-open').click();
      await page.getByTestId('passphrase-input').fill('correct horse battery');
      await page.getByTestId('passphrase-confirm').fill('correct horse battery');
      await page.getByTestId('remember-submit').click();
      await page.getByTestId('key-status').filter({ hasText: 'Saved encrypted' }).waitFor({ timeout: 20_000 });

      const savedRows = await readStores(page, 'sajas-web');
      const savedBlob = await page.evaluate(async () => {
        const db = await new Promise((resolve, reject) => {
          const req = indexedDB.open('sajas-web');
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        const rows = await new Promise((resolve, reject) => {
          const tx = db.transaction('keyVault', 'readonly');
          const req = tx.objectStore('keyVault').getAll();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        db.close();
        return rows;
      });
      assert.equal(savedBlob.length, 1, 'remember did not save exactly one encrypted blob');
      assert.equal(savedBlob[0]?.alg, 'AES-GCM', 'the saved blob is not AES-GCM ciphertext');
      assert.ok(savedBlob[0]?.ciphertext, 'the saved blob has no ciphertext');
      assert.equal(JSON.stringify(savedBlob).includes(canary), false, 'the saved blob contains the plaintext key');
      const savedFilled = savedRows.filter((row) => JSON.parse(row.json).length > 0).map((row) => `${row.db}/${row.store}`);
      assert.ok(savedFilled.includes('sajas-web/keyVault'), 'the vault scan did not see the saved key blob');
      assert.ok(savedFilled.includes('sajas-web/meta'), 'the vault scan did not see the key metadata');
      const savedLeaks = [];
      for (const row of savedRows) if (row.json.includes(canary)) savedLeaks.push(`IndexedDB ${row.db}/${row.store}`);
      assert.deepEqual(savedLeaks, [], `plaintext key in IndexedDB outside the encrypted blob: ${savedLeaks.join(', ')}`);
      const savedSurface = await readDomSurface(page);
      assert.equal(savedSurface.dom.includes(canary), false, 'the plaintext key reached the DOM after remember');
      for (const field of savedSurface.formValues) {
        assert.equal(field.value.includes(canary), false, 'the plaintext key reached a form field after remember');
      }
      for (const html of savedSurface.iframes) {
        assert.equal(html.includes(canary), false, 'the plaintext key reached an iframe after remember');
      }
      await settleConsole();
      for (const line of consoleLines) assert.equal(line.includes(canary), false, 'the plaintext key reached the console');

      // Remember -> Forget must remove the encrypted blob from IndexedDB.
      await page.getByTestId('forget-key').click();
      await page.getByTestId('forget-confirm').click();
      await page.getByTestId('key-status').filter({ hasText: 'Not loaded' }).waitFor({ timeout: 15_000 });
      const afterForget = await page.evaluate(async () => {
        const info = (await indexedDB.databases()).find((d) => d.name === 'sajas-web');
        if (!info) return [];
        const db = await new Promise((resolve, reject) => {
          const req = indexedDB.open(info.name);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        const rows = await new Promise((resolve, reject) => {
          const tx = db.transaction('keyVault', 'readonly');
          const req = tx.objectStore('keyVault').getAll();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        db.close();
        return rows;
      });
      assert.deepEqual(afterForget, [], 'the saved key blob survived Forget');
      // Settings must offer a way back to key entry once nothing is loaded.
      await page.getByTestId('add-key').waitFor({ timeout: 15_000 });

      // Panic wipe must clear every store and return to onboarding.
      await page.getByTestId('panic-wipe').click();
      await page.getByTestId('wipe-confirm-text').fill('wipe');
      await page.getByTestId('panic-confirm').click();
      await page.getByTestId('key-input').waitFor({ timeout: 20_000 });
      const afterWipe = await readStores(page);
      // The scan must still see the database (an empty scan because the DB
      // vanished would let a broken wipe look clean).
      assert.ok(
        afterWipe.some((row) => row.db === 'sajas-web' && row.store === 'keyVault'),
        'sajas-web/keyVault disappeared from the post-wipe scan'
      );
      assert.deepEqual(
        afterWipe.filter((row) => JSON.parse(row.json).length > 0).map((row) => `${row.db}/${row.store}`),
        [],
        'panic wipe left data behind'
      );

      // One network-surface check for the whole run: `requests` and `blocked`
      // accumulate across every phase, so this covers onboarding through the
      // post-wipe reload without restating the same three assertions.
      assertNetworkSurface({ requests, blocked, allowedOrigins });

      console.log(`web canary: PASS (${requests.length} requests checked)`);
    } finally {
      await browser.close();
    }
  } finally {
    await server.close();
  }
}

main().catch((err) => {
  console.error(`web canary: FAIL - ${err.message}`);
  process.exitCode = 1;
});
