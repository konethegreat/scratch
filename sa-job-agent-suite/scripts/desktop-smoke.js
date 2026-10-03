// Exercise the real Electron entry point with disposable data and a hidden window.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

async function main() {
  const port = await new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      const selected = listener.address().port;
      listener.close(() => resolve(selected));
    });
  });
  const temporaryRoot = path.resolve(os.tmpdir());
  const data = fs.mkdtempSync(path.join(temporaryRoot, 'sajas-desktop-smoke-'));
  const env = {
    ...process.env,
    PORT: String(port), HOST: '127.0.0.1', CLIENT_DEV_URL: 'http://127.0.0.1:0',
    SAJAS_SMOKE_DATA: data,
    SAJAS_SMOKE_ROOT: path.resolve(process.argv[2] || path.join(__dirname, '..')),
    SAJAS_SMOKE_PACKAGED: process.argv[2] ? '1' : '',
    GEMINI_API_KEY: '', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', OPENROUTER_API_KEY: ''
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [path.join(__dirname, 'desktop-smoke-app')], {
    cwd: path.join(__dirname, '..'), env, stdio: 'inherit', windowsHide: true
  });
  const timeout = setTimeout(() => child.kill(), 45000);
  try {
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (status) => resolve(status));
    });
    if (code !== 0) throw new Error(`Desktop smoke failed (exit ${code})`);
  } finally {
    clearTimeout(timeout);
    // Only remove the exact directory created above, inside the OS temp folder.
    const relative = path.relative(temporaryRoot, path.resolve(data));
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
      fs.rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
    }
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
