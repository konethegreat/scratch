/**
 * Helpers shared by the source definitions. Pure.
 */

/**
 * Applies a source's pagination parameter to a page-1 URL.
 * Page 1 (or a single-page source, `param: null`) is returned unchanged, so the
 * first request is byte-identical to what the original scraper built.
 * For page n the parameter is replaced if present, else appended, with the value
 * `firstValue + (n - 1) * step`.
 */
export function withPageParam(url, pagination, pageNo) {
  if (!pagination || !pagination.param || !(pageNo > 1)) return url;
  const value = pagination.firstValue + (pageNo - 1) * pagination.step;
  const escaped = pagination.param.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`([?&])${escaped}=[^&#]*`);
  if (re.test(url)) return url.replace(re, `$1${pagination.param}=${value}`);
  const hash = url.indexOf('#');
  const base = hash === -1 ? url : url.slice(0, hash);
  const tail = hash === -1 ? '' : url.slice(hash);
  return `${base}${base.includes('?') ? '&' : '?'}${pagination.param}=${value}${tail}`;
}
