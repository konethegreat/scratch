// Electron main process for SA Job Agent Suite.
// Boots the Express server as a child process, then opens a window pointing
// at either the Vite dev server (dev mode) or the built client (production).
//
// Written in CommonJS so it works without setting "type": "module" at the root.

const { app, BrowserWindow, shell, Menu } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const isDev = !app.isPackaged;
const SERVER_PORT = process.env.PORT || '5000';
const CLIENT_DEV_URL = process.env.CLIENT_DEV_URL || 'http://localhost:4173';

let serverProcess = null;
let mainWindow = null;

function projectRoot() {
  // electron/ lives one level below the project root
  return path.join(__dirname, '..');
}

function startServer() {
  if (serverProcess) return;

  // The Node child needs real paths for its cwd and ESM imports. Packaged server
  // files and runtime dependencies are unpacked beside app.asar by the builder.
  const serverRoot = app.isPackaged
    ? path.join(path.dirname(projectRoot()), 'app.asar.unpacked')
    : projectRoot();
  const serverEntry = path.join(serverRoot, 'server', 'src', 'index.js');

  // ELECTRON_RUN_AS_NODE tells the Electron binary to behave like plain Node
  // for this child — so we don't need a system Node install at runtime.
  const userData = app.getPath('userData');
  const env = {
    ...process.env,
    PORT: SERVER_PORT,
    ELECTRON_RUN_AS_NODE: '1',
    DB_PATH:              path.join(userData, 'db.json'),
    KEYS_PATH:            path.join(userData, 'keys.json'),
    BROWSER_PROFILE_PATH: path.join(userData, 'browser-profile'),
    GENERATED_DOCS_PATH:  path.join(userData, 'generated-docs'),
    SUPPORTING_DOCS_PATH: path.join(userData, 'supporting-docs')
  };

  serverProcess = spawn(process.execPath, [serverEntry], {
    env,
    cwd: serverRoot,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  serverProcess.stdout.on('data', (d) => process.stdout.write(`[server] ${d}`));
  serverProcess.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
  serverProcess.on('error', (error) => {
    console.error('[electron] could not start server:', error.message);
    serverProcess = null;
  });
  serverProcess.on('exit', (code) => {
    console.log(`[electron] server exited with code ${code}`);
    serverProcess = null;
  });
}

function stopServer() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
}

function waitForServer(timeoutMs = 15000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(`http://localhost:${SERVER_PORT}/api/health`, (res) => {
        res.resume();
        if (res.statusCode === 200) return resolve();
        retry();
      });
      req.on('error', retry);
      req.setTimeout(1000, () => req.destroy());
    };
    const retry = () => {
      if (Date.now() - start > timeoutMs) return reject(new Error('Server did not start in time'));
      setTimeout(tick, 300);
    };
    tick();
  });
}

function isUrlReachable(url, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(false);
    });
  });
}

// Render a readable error in the window instead of leaving it blank.
function showLoadError(target, reason) {
  if (!mainWindow) return;
  const html = `
    <body style="font-family:system-ui,sans-serif;background:#0b1020;color:#e6e9f5;
                 display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center">
      <div style="max-width:560px;padding:32px">
        <h2 style="margin:0 0 12px">SA-JAS couldn't load the UI</h2>
        <p style="color:#9aa3c7;line-height:1.6">${reason}</p>
        <p style="color:#9aa3c7;line-height:1.6">Tried to load:<br><code>${target}</code></p>
        <p style="margin-top:24px;color:#9aa3c7;line-height:1.6">
          For development run <b>npm run electron:dev</b> (starts Vite + Electron together).<br>
          For a standalone window run <b>npm run build:client</b> first.
        </p>
      </div>
    </body>`;
  mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'SA Job Agent Suite',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // External links open in the system browser, not inside the app window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Surface load failures instead of leaving a silent blank window.
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    // -3 is ERR_ABORTED, fired on ordinary redirects/cancels — ignore it.
    if (code === -3) return;
    console.error(`[electron] failed to load ${url}: ${desc} (${code})`);
    showLoadError(url, desc);
  });

  const indexPath = path.join(projectRoot(), 'client', 'dist', 'index.html');
  const distExists = fs.existsSync(indexPath);

  // A rejected load promise is already reported via the did-fail-load handler,
  // so swallow it here to avoid an unhandled rejection.
  try {
    if (isDev) {
      // Prefer the live dev server, but only if it's actually reachable —
      // launching Electron without Vite running used to show a blank window.
      const devUp = await isUrlReachable(CLIENT_DEV_URL);
      if (devUp) {
        await mainWindow.loadURL(CLIENT_DEV_URL);
        mainWindow.webContents.openDevTools({ mode: 'detach' });
      } else if (distExists) {
        console.warn(`[electron] dev server not reachable at ${CLIENT_DEV_URL}; loading built client from dist/`);
        await mainWindow.loadFile(indexPath);
      } else {
        showLoadError(CLIENT_DEV_URL, 'Dev server not running and no build found');
      }
    } else if (distExists) {
      await mainWindow.loadFile(indexPath);
    } else {
      showLoadError(indexPath, 'Built client not found');
    }
  } catch (err) {
    console.error('[electron] window load error:', err.message);
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  if (!isDev) Menu.setApplicationMenu(null);

  startServer();
  try {
    await waitForServer();
  } catch (err) {
    console.error('[electron] server health check failed:', err.message);
  }
  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  stopServer();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', stopServer);
