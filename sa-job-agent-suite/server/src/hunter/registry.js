import pnet from './sources/pnet.js';

/**
 * The hunter's scraper sources, in run order. Order matters: `addJob` keeps the
 * FIRST version of a duplicate job, so the major boards run first and win the
 * slot over obscure ones (same order as the original `scraperSources`).
 *
 * @typedef {object} HunterSource
 * @property {string} id                         stable machine id (lower-case)
 * @property {string} name                       display name; this is `job.source`, never change it
 * @property {'major'|'secondary'} tier
 * @property {'perLocation'|'oncePerKeyword'|'noLocation'} scope
 * @property {string} origin                     https origin, used to absolutise relative hrefs
 * @property {boolean} [skipJsonLd]
 * @property {boolean} [needsLogin]
 * @property {boolean} [linkless]                true when the source never exposes a direct apply link
 * @property {'strict'|'soft'|'none'} saCheck
 * @property {number} waitIdleMs                 networkidle wait the scraper used
 * @property {{ param: string|null, firstValue: number, step: number, verified: false }} pagination
 * @property {{ keyword: string, location: string|null, minItems: number }} canary
 * @property {(query: { keyword: string, location: string|null }, pageNo: number) => string} buildUrl
 * @property {(arg: { location: string|null, origin: string }) => object[]} extractInPage  self-contained, runs in the page
 */

/** @type {HunterSource[]} */
export const SOURCES = [pnet];

export function getSource(id) {
  return SOURCES.find((s) => s.id === id);
}
