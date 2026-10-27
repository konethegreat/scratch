// Offline design gate. It fails on a missing token, a contrast pair below AA,
// a forbidden visual pattern, a stale boot script, or a wrong script order in
// the built entry document. No network and no browser.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const client = path.join(root, 'client');

const TOKENS = {
  '--bg-app': ['#f6f6f3', '#0b0d12'],
  '--bg-app-2': ['#ffffff', '#11141b'],
  '--bg-surface': ['#ffffff', '#141821'],
  '--bg-surface-2': ['#f0f0ec', '#1a1f2a'],
  '--bg-input': ['#ffffff', '#10131a'],
  '--bg-sidebar': ['#ffffff', '#0e1117'],
  '--bg-topbar': ['#ffffff', '#0e1117'],
  '--bg-code': ['#f0f0ec', '#0f131b'],
  '--color-accent': ['#4f46e5', '#a5b4fc'],
  '--color-accent-hover': ['#4338ca', '#c7d2fe'],
  '--color-accent-soft': ['#eef0ff', '#1d2340'],
  '--color-on-accent': ['#ffffff', '#0b0d12'],
  '--color-success': ['#047857', '#34d399'],
  '--color-info': ['#0369a1', '#38bdf8'],
  '--color-warning': ['#b45309', '#fbbf24'],
  '--color-error': ['#b91c1c', '#fb7185'],
  '--text-primary': ['#16181d', '#f3f4f6'],
  '--text-secondary': ['#3f4552', '#c3c8d2'],
  '--text-muted': ['#5f6673', '#929aab'],
  '--border': ['#e4e4de', '#232936'],
  '--border-strong': ['#c9c9c2', '#333b4c'],
  '--overlay': ['rgba(16, 18, 24, 0.35)', 'rgba(0, 0, 0, 0.60)']
};

const PAIRS = [
  ['light', '--text-primary', '--bg-app'],
  ['light', '--text-secondary', '--bg-app'],
  ['light', '--text-muted', '--bg-app'],
  ['light', '--color-accent', '--bg-surface'],
  ['light', '--color-success', '--bg-surface'],
  ['light', '--color-info', '--bg-surface'],
  ['light', '--color-warning', '--bg-surface'],
  ['light', '--color-error', '--bg-surface'],
  ['dark', '--text-primary', '--bg-app'],
  ['dark', '--text-secondary', '--bg-app'],
  ['dark', '--text-muted', '--bg-app'],
  ['dark', '--color-accent', '--bg-surface'],
  ['dark', '--color-on-accent', '--color-accent'],
  ['dark', '--color-success', '--bg-surface'],
  ['dark', '--color-info', '--bg-surface'],
  ['dark', '--color-warning', '--bg-surface'],
  ['dark', '--color-error', '--bg-surface']
];

function readBlock(css, selector) {
  const index = css.indexOf(selector);
  assert.notEqual(index, -1, `styles are missing the ${selector} block`);
  const start = css.indexOf('{', index);
  const end = css.indexOf('}', start);
  assert.ok(start !== -1 && end !== -1, `styles have a malformed ${selector} block`);
  return css.slice(start + 1, end);
}

function declarations(text) {
  const map = new Map();
  for (const match of text.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    map.set(match[1].trim(), match[2].trim());
  }
  return map;
}

function rgb(hex) {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  return [0, 2, 4].map((index) => parseInt(full.slice(index, index + 2), 16) / 255);
}

function channel(value) {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const [r, g, b] = rgb(hex).map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

async function walk(dir, files = []) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, files);
    else if (entry.name.endsWith('.css')) files.push(full);
  }
  return files;
}

async function main() {
  const cssPath = path.join(client, 'src/index.css');
  const css = await fs.readFile(cssPath, 'utf8');
  const light = declarations(readBlock(css, ':root'));
  const dark = declarations(readBlock(css, "[data-theme='dark']"));

  for (const [name, values] of Object.entries(TOKENS)) {
    assert.equal(light.get(name), values[0], `${name} is missing or wrong in the light theme`);
    assert.equal(dark.get(name), values[1], `${name} is missing or wrong in the dark theme`);
  }

  const themes = { light, dark };
  for (const [theme, foreground, background] of PAIRS) {
    const values = themes[theme];
    const ratio = contrast(values.get(foreground), values.get(background));
    assert.ok(
      ratio >= 4.5,
      `${theme} ${foreground} on ${background} is ${ratio.toFixed(2)}:1, below 4.5:1`
    );
  }

  for (const file of await walk(path.join(client, 'src'))) {
    const text = await fs.readFile(file, 'utf8');
    assert.equal(
      /gradient-text|aurora|backdrop-filter|glass-panel|fonts\.googleapis\.com|fonts\.gstatic\.com/.test(text),
      false,
      `${path.relative(root, file)} still contains a forbidden visual pattern`
    );
  }

  const html = await fs.readFile(path.join(client, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script\b([^>]*)>/gi)].map((match) => match[1]);
  assert.equal(scripts.length, 2, `index.html must load exactly two scripts, found ${scripts.length}`);
  assert.equal(scripts.some((attrs) => !/\bsrc=/.test(attrs)), false, 'index.html contains an inline script');
  const sources = scripts.map((attrs) => /\bsrc="([^"]+)"/.exec(attrs)?.[1] || '');
  assert.equal(sources[0], './theme-boot.js', 'the theme boot script must load first');
  assert.equal(sources[1], '/src/main.jsx', 'the module entry must load second');
  for (const source of sources) {
    assert.equal(/^(?:https?:)?\/\//.test(source), false, `index.html loads a third-party script: ${source}`);
  }

  const boot = await fs.readFile(path.join(client, 'public/theme-boot.js'), 'utf8');
  const theme = await fs.readFile(path.join(client, 'src/theme.js'), 'utf8');
  assert.ok(boot.length < 1024, 'theme-boot.js must stay under 1 KB');
  assert.match(boot, /sajas-theme/, 'theme-boot.js does not use the shared storage key');
  assert.match(theme, /THEME_KEY = 'sajas-theme'/, 'theme.js does not use the shared storage key');
  for (const choice of ['system', 'light', 'dark']) {
    assert.ok(boot.includes(`'${choice}'`), `theme-boot.js does not handle ${choice}`);
    assert.ok(theme.includes(`'${choice}'`), `theme.js does not handle ${choice}`);
  }
  for (const colour of ['#f6f6f3', '#0b0d12']) {
    assert.ok(boot.includes(colour), `theme-boot.js is missing ${colour}`);
    assert.ok(theme.includes(colour), `theme.js is missing ${colour}`);
  }

  console.log('check-ui: PASS');
}

main().catch((error) => {
  console.error(`check-ui: FAIL - ${error.message}`);
  process.exitCode = 1;
});
