// Web links accept a full http(s) URL or a bare host such as
// "linkedin.com/in/me", which is how people usually paste them. Anything that
// is not a web address becomes no link, never a javascript: or data: target.
import { httpUrl } from '@sajas/core/feeds';

const BARE_HOST = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:[/?#]|$)/i;

export function webLink(value) {
  if (typeof value !== 'string') return '';
  const direct = httpUrl(value);
  if (direct) return direct;
  const raw = value.trim();
  if (!raw || raw.includes(':') || /\s/.test(raw)) return '';
  if (!BARE_HOST.test(raw)) return '';
  return httpUrl(`https://${raw}`);
}
