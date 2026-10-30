// Trust-surface gate. Fails when the built site is missing its security
// contact file, when the contact or expiry is wrong, or when the legal and
// licence documents the app points at are absent.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'client/dist');
const repository = path.resolve(root, '..');

async function main() {
  const security = await fs
    .readFile(path.join(dist, '.well-known/security.txt'), 'utf8')
    .catch(() => {
      throw new Error('client/dist/.well-known/security.txt is missing. Run npm run build:web first.');
    });

  const field = (name) => security.match(new RegExp(`^${name}:\\s*(.+)$`, 'm'))?.[1]?.trim();
  assert.match(field('Contact') || '', /^mailto:.+@.+$/, 'security.txt has no mailto Contact');
  assert.ok(security.includes('Preferred-Languages: en'), 'security.txt has no Preferred-Languages');
  assert.ok(field('Canonical')?.startsWith('https://'), 'security.txt has no https Canonical URL');
  const expires = field('Expires');
  assert.ok(expires, 'security.txt has no Expires field');
  assert.ok(Date.parse(expires) > Date.now(), `security.txt expired on ${expires}`);
  assert.ok(Date.parse(expires) < Date.parse('2030-01-01T00:00:00.000Z'), 'security.txt expiry is more than a few years out');
  const policy = field('Policy');
  assert.ok(policy?.startsWith('https://'), 'security.txt has no https Policy URL');
  assert.equal(/[^\x20-\x7E\n\r]/.test(security), false, 'security.txt must stay ASCII');

  for (const relative of ['LICENSE', 'TRADEMARK.md', 'SECURITY.md', 'POLICY.md', 'THREAT-MODEL.md', 'OPERATIONS.md']) {
    const file = path.join(repository, relative);
    await fs.access(file).catch(() => {
      throw new Error(`${relative} is missing from the repository root`);
    });
  }

  const licence = await fs.readFile(path.join(repository, 'LICENSE'), 'utf8');
  assert.match(licence, /MIT License/, 'LICENSE is not the MIT licence');
  assert.match(licence, /Copyright \(c\) \d{4}/, 'LICENSE has no copyright line');

  const trademark = await fs.readFile(path.join(repository, 'TRADEMARK.md'), 'utf8');
  assert.match(trademark, /MIT licence/, 'TRADEMARK.md does not separate the code licence from the marks');
  assert.match(trademark, /\[LICENSE\]\(LICENSE\)/, 'TRADEMARK.md does not link the licence');
  assert.match(trademark, /erictshivhinda@gmail\.com/, 'TRADEMARK.md has no contact address');

  const html = await fs.readFile(path.join(dist, 'index.html'), 'utf8');
  const source = /<script[^>]+type="module"[^>]*src="([^"]+)"/.exec(html)?.[1];
  assert.ok(source, 'index.html has no module script');
  const entryText = await fs.readFile(path.resolve(dist, source.replace(/^\.?\//, '')), 'utf8');
  for (const marker of ['Information Regulator', 'TRADEMARK.md', 'AI disclaimer', 'Terms of use']) {
    assert.ok(entryText.includes(marker), `the built app does not ship the ${marker} notice`);
  }

  console.log('check-trust: PASS (security.txt, licence and legal notices)');
}

main().catch((error) => {
  console.error(`check-trust: FAIL - ${error.message}`);
  process.exitCode = 1;
});
