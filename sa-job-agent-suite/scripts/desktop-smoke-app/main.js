const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const electron = require('electron');
const { app, session } = electron;

app.setPath('userData', process.env.SAJAS_SMOKE_DATA);
if (process.env.SAJAS_SMOKE_PACKAGED === '1') {
  Object.defineProperty(app, 'isPackaged', { value: true });
}

let finished = false;
function finish(error) {
  if (finished) return;
  finished = true;
  if (error) console.error(error.stack);
  else console.log('Desktop smoke passed: rendered client, isolated preload, healthy API and empty credentials.');
  // Quit normally first so the application's before-quit handler stops its server.
  app.once('will-quit', (event) => { event.preventDefault(); app.exit(error ? 1 : 0); });
  app.quit();
}
setTimeout(() => finish(new Error('Desktop startup timed out')), 30000).unref();
process.on('uncaughtException', finish);
process.on('unhandledRejection', finish);

class HiddenWindow extends electron.BrowserWindow {
  constructor(options) {
    super({ ...options, show: false });
    this.webContents.once('did-finish-load', async () => {
      try {
        assert.equal(this.isVisible(), false);
        const preferences = this.webContents.getLastWebPreferences();
        assert.equal(preferences.contextIsolation, true);
        assert.equal(preferences.nodeIntegration, false);
        // Wait for React's first render rather than accepting an empty HTML shell.
        const renderer = await this.webContents.executeJavaScript(`new Promise((resolve, reject) => {
          let tries = 0;
          const check = () => {
            const text = document.getElementById('root')?.textContent || '';
            if (text.length > 20) return resolve({ text, title: document.title,
              bridge: window.saJas?.isElectron === true, nodeExposed: typeof window.require !== 'undefined' });
            if (++tries > 100) return reject(new Error('Client did not render'));
            setTimeout(check, 50);
          };
          check();
        })`);
        assert.match(renderer.title, /SA-JAS/);
        assert.equal(renderer.bridge, true);
        assert.equal(renderer.nodeExposed, false);
        const api = `http://127.0.0.1:${process.env.PORT}/api`;
        const health = await fetch(`${api}/health`);
        assert.equal(health.status, 200);
        assert.equal((await health.json()).status, 'ok');
        const profile = await (await fetch(`${api}/profile`)).json();
        for (const provider of ['Gemini', 'Anthropic', 'OpenRouter']) {
          assert.equal(profile[`has${provider}Key`], false);
        }
        finish();
      } catch (error) { finish(error); }
    });
  }
}

app.whenReady().then(() => {
  // The smoke test may load only local files and this test's loopback API.
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url);
    const local = url.protocol === 'file:' || ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    callback({ cancel: !local });
  });
});
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return { ...electron, BrowserWindow: HiddenWindow };
  return originalLoad.call(this, request, parent, isMain);
};
require(path.join(process.env.SAJAS_SMOKE_ROOT, 'electron', 'main.js'));
