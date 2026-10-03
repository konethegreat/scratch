const { spawn } = require('child_process');
const path = require('path');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const electronBin = require('electron');
const proc = spawn(electronBin, ['.'], {
  stdio: 'inherit',
  env,
  cwd: path.join(__dirname, '..')
});

proc.on('close', (code) => process.exit(code ?? 0));
