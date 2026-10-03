#!/usr/bin/env node
/**
 * check-secrets.mjs - a small, dependency-free key-commit guard.
 *
 * It fails (exit code 1) when a change would put any of these into git:
 *   - something shaped like an API key, token or private key
 *   - a key-store or credential file by name (keys.json, .env, *.pem, ...)
 *   - one of the app's local-data files (db.json, browser-profile/, ...)
 *
 * No network, no external service, no npm install. Needs Node 18+ and git.
 *
 *   node tools/check-secrets.mjs --staged         what is about to be committed (pre-commit hook)
 *   node tools/check-secrets.mjs --all            every tracked file in the checkout
 *   node tools/check-secrets.mjs --range A..B     every line ADDED by the commits in A..B,
 *                                                 even if a later commit removed it again
 *   node tools/check-secrets.mjs --files a b ...  explicit files
 *
 * Enable it as a local pre-commit hook (once per clone):
 *   git config core.hooksPath .githooks
 *
 * Findings never print the secret itself, only the rule, the location and a
 * masked preview. To allow a deliberate match, put `check-secrets:allow` on
 * the same line. If a real key was committed, even briefly, revoke it at the
 * provider first: deleting it from git does not make it safe again.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const ALLOW_MARKER = 'check-secrets:allow';
const MAX_SCAN_BYTES = 5 * 1024 * 1024;

// Ordered: when two rules match the same characters, the first one wins, so a
// single secret is reported once.
export const CONTENT_RULES = [
  { id: 'anthropic-key',   what: 'Anthropic API key',  re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { id: 'openrouter-key',  what: 'OpenRouter API key', re: /\bsk-or-[A-Za-z0-9_-]{20,}/g },
  { id: 'openai-key',      what: 'OpenAI-style API key', re: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}/g },
  { id: 'google-api-key',  what: 'Google API key',     re: /\bAIza[0-9A-Za-z_-]{20,}/g },
  { id: 'github-token',    what: 'GitHub token',       re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/g },
  { id: 'aws-access-key',  what: 'AWS access key id',  re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { id: 'slack-token',     what: 'Slack token',        re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { id: 'stripe-live-key', what: 'Stripe live key',    re: /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}/g },
  { id: 'jwt',             what: 'JSON Web Token',     re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  { id: 'private-key',     what: 'private key block',  re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/g },
  // The shape of the app's own keys.json, whatever the provider's key looks like.
  { id: 'key-store-field', what: 'API key value in a key-store JSON field',
    re: /"(?:anthropic|gemini|openRouter|openai)ApiKey"\s*:\s*"(?!your_|YOUR_)[^"\s]{8,}"/g }
];

const norm = (p) => String(p).replace(/\\/g, '/');
const base = (p) => norm(p).split('/').pop();
const SAFE_ENV_TEMPLATE = /^\.env\.(?:example|sample|template|dist)$/i;

export const PATH_RULES = [
  { id: 'key-store-file', what: 'key store file (holds provider API keys)',
    test: (p) => /^(?:keys\.json|keys\..+\.json|.+\.keys\.json|keys\.json\..+)$/i.test(base(p)) },
  { id: 'env-file', what: 'environment file (commit a .env.example template instead)',
    test: (p) => /^\.env(?:\..+)?$/i.test(base(p)) && !SAFE_ENV_TEMPLATE.test(base(p)) },
  { id: 'private-key-file', what: 'private key or certificate bundle',
    test: (p) => /\.(?:pem|key|p12|pfx)$/i.test(base(p)) },
  { id: 'local-data-file', what: 'local user data (profile, CV text, jobs)',
    test: (p) => /^db(?:\.backup)?\.json$/i.test(base(p)) },
  { id: 'local-data-dir', what: 'local user data (browser login state, generated or supporting documents)',
    test: (p) => /(?:^|\/)(?:browser-profile|generated-docs|supporting-docs)\//i.test(norm(p)) }
];

/** Shows just enough to find the match without reproducing the secret. */
export function mask(s) {
  return `${s.slice(0, 7)}... (${s.length} chars)`;
}

/** Content findings for one line of text. Never returns the secret itself. */
export function scanLine(line) {
  if (line.includes(ALLOW_MARKER)) return [];
  const hits = [];
  const claimed = [];
  for (const rule of CONTENT_RULES) {
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(line)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (claimed.some(([s, e]) => start < e && end > s)) continue;
      claimed.push([start, end]);
      hits.push({ rule: rule.id, what: rule.what, preview: mask(m[0]) });
    }
  }
  return hits;
}

/** Content findings for a whole text, with 1-based line numbers. */
export function scanText(text, path = '<text>') {
  const out = [];
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    for (const hit of scanLine(lines[i])) out.push({ ...hit, path, line: i + 1 });
  }
  return out;
}

/** File-name findings for a repository-relative path. */
export function pathFindings(path) {
  return PATH_RULES.filter((r) => r.test(path)).map((r) => ({ rule: r.id, what: r.what, path: norm(path), line: 0 }));
}

function looksBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

function scanBuffer(buf, path) {
  if (buf.length > MAX_SCAN_BYTES || looksBinary(buf)) return [];
  return scanText(buf.toString('utf8'), path);
}

function git(args) {
  const r = spawnSync('git', args, { encoding: 'buffer', maxBuffer: 512 * 1024 * 1024 });
  if (r.error) throw new Error(`could not run git: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr.toString('utf8').trim()}`);
  return r.stdout;
}

const nulList = (buf) => buf.toString('utf8').split('\0').filter(Boolean);

function scanStaged() {
  const findings = [];
  const paths = nulList(git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']));
  for (const p of paths) {
    findings.push(...pathFindings(p));
    try {
      findings.push(...scanBuffer(git(['show', `:${p}`]), norm(p)));
    } catch { /* unreadable index entry (for example a submodule): path rules above still applied */ }
  }
  return { findings, scanned: paths.length };
}

function scanFiles(paths) {
  const findings = [];
  let scanned = 0;
  for (const p of paths) {
    findings.push(...pathFindings(p));
    let buf;
    try { buf = readFileSync(p); } catch { continue; }
    scanned++;
    findings.push(...scanBuffer(buf, norm(p)));
  }
  return { findings, scanned };
}

function scanAllTracked() {
  return scanFiles(nulList(git(['ls-files', '-z'])));
}

/** Every line added by any commit in the range, so a key that was added and later removed is still caught. */
function scanRange(range) {
  const patch = git(['-c', 'core.quotepath=off', 'log', '--no-merges', '--no-color', '--no-ext-diff',
    '-p', '-U0', '--diff-filter=ACMR', '--format=@@@COMMIT %H', range]).toString('utf8');
  const findings = [];
  let commit = '';
  let file = null;
  let lineNo = 0;
  let commits = 0;
  const seenPaths = new Set();
  for (const raw of patch.split('\n')) {
    const row = raw.replace(/\r$/, '');
    if (row.startsWith('@@@COMMIT ')) { commit = row.slice(10, 20); file = null; commits++; continue; }
    if (row.startsWith('+++ ')) {
      const target = row.slice(4).replace(/\t.*$/, '');
      file = target === '/dev/null' ? null : target.replace(/^b\//, '');
      if (file) {
        const key = `${commit}:${file}`;
        if (!seenPaths.has(key)) {
          seenPaths.add(key);
          for (const f of pathFindings(file)) findings.push({ ...f, commit });
        }
      }
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(row);
    if (hunk) { lineNo = parseInt(hunk[1], 10); continue; }
    if (file && row.startsWith('+') && !row.startsWith('+++')) {
      for (const hit of scanLine(row.slice(1))) findings.push({ ...hit, path: norm(file), line: lineNo, commit });
      lineNo++;
    }
  }
  return { findings, scanned: commits };
}

function report(findings, label) {
  const out = [];
  out.push(`check-secrets: ${findings.length} problem(s) found ${label}.`);
  out.push('');
  for (const f of findings) {
    const where = f.line ? `${f.path}:${f.line}` : f.path;
    const at = f.commit ? ` [commit ${f.commit}]` : '';
    const detail = f.preview ? `${f.what}: ${f.preview}` : f.what;
    out.push(`  ${where}${at}`);
    out.push(`      ${f.rule} - ${detail}`);
  }
  out.push('');
  out.push(`If a match is deliberate, put "${ALLOW_MARKER}" on that line.`);
  out.push('If a real key was committed, even briefly, revoke it at the provider first;');
  out.push('removing it from git does not make it safe again.');
  return out.join('\n');
}

const USAGE = `usage: node tools/check-secrets.mjs [--staged | --all | --range A..B | --files <paths...>]
  --staged   (default) what is about to be committed, read from the index
  --all      every tracked file in the current checkout
  --range    every line added by commits in A..B, even if later removed
  --files    explicit files`;

export function main(argv = process.argv.slice(2)) {
  let mode = '--staged';
  let arg = null;
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { console.log(USAGE); return 0; }
    if (a === '--staged' || a === '--all') mode = a;
    else if (a === '--range') { mode = a; arg = argv[++i]; }
    else if (a.startsWith('--range=')) { mode = '--range'; arg = a.slice(8); }
    else if (a === '--files') { mode = a; }
    else rest.push(a);
  }
  if (mode !== '--files' && rest.length) { console.error(USAGE); return 2; }
  if (mode === '--range' && !arg) { console.error(USAGE); return 2; }

  let result;
  let label;
  try {
    if (mode === '--staged') { result = scanStaged(); label = 'in the staged changes'; }
    else if (mode === '--all') { result = scanAllTracked(); label = 'in tracked files'; }
    else if (mode === '--range') { result = scanRange(arg); label = `in commits ${arg}`; }
    else { result = scanFiles(rest); label = 'in the given files'; }
  } catch (err) {
    console.error(`check-secrets: ${err.message}`);
    return 2;
  }

  if (result.findings.length) {
    console.error(report(result.findings, label));
    return 1;
  }
  console.log(`check-secrets: clean (${result.scanned} ${mode === '--range' ? 'commit(s)' : 'file(s)'} checked).`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}