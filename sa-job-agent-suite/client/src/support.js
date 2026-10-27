// The public support details and the diagnostics-only report link. The report
// deliberately omits error details and every user document so a bug report can
// never carry a key, profile, job, or CV text.
import { IS_WEB } from './web/env.js';

export const SUPPORT = Object.freeze({
  name: 'Kone Tshivhinda',
  email: 'erictshivhinda@gmail.com',
  phone: '+27 81 302 5435',
  phoneHref: 'tel:+27813025435',
  linkedin: 'https://www.linkedin.com/in/kone-tshivhinda-32a760233',
  github: 'https://github.com/konethegreat',
  location: 'Johannesburg, South Africa'
});

export const FAQ = Object.freeze([
  {
    q: 'Where is my API key stored?',
    a: 'The key lives in this tab while it is open. If you choose the encrypted option, it is saved on this device behind your passphrase. It is sent only to Anthropic, never to this site.'
  },
  {
    q: 'Where is my data stored?',
    a: 'Your profile, jobs, documents, and usage history stay in this browser. There are no accounts and no server copy. Use Backup to keep your own copy.'
  },
  {
    q: 'What does tailoring cost?',
    a: 'Anthropic bills the account behind your own key. The Usage panel shows an estimate, and the daily cap stops new runs when today reaches it.'
  },
  {
    q: 'Does SA-JAS submit applications for me?',
    a: 'No. It prepares the documents and can open the application page. You review and submit.'
  },
  {
    q: 'Why did my key stop working?',
    a: 'Check that it is a standard API key (not an admin key), that the Anthropic account has credit, and that the daily cap has not been reached.'
  }
]);

function environment() {
  const location = typeof globalThis.location !== 'undefined' ? globalThis.location : null;
  const nav = typeof globalThis.navigator !== 'undefined' ? globalThis.navigator : null;
  return [
    `surface: ${IS_WEB ? 'web' : 'desktop'}`,
    `page: ${location?.pathname || 'unknown'}`,
    `browser: ${nav?.userAgent || 'unknown'}`
  ].join('\n');
}

export function supportMailto(info = null) {
  const subject = info?.code ? `SA-JAS support: ${info.code}` : 'SA-JAS support request';
  const lines = info ? [
    'SA-JAS diagnostics',
    `code: ${info.code || 'UNKNOWN'}`,
    `message: ${info.message || ''}`,
    `hint: ${info.hint || ''}`,
    `requestId: ${info.requestId || 'unknown'}`,
    `at: ${info.at || new Date().toISOString()}`,
    `where: ${info.where || 'unknown'}`
  ] : ['SA-JAS support request'];
  const body = [...lines, '', environment(), '', 'What happened:', ''].join('\n');
  return `mailto:${SUPPORT.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
