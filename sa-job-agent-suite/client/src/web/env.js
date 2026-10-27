// True only in the hosted web build (`vite build --mode web`). Vite replaces the
// identifier at build time; Node (unit tests) sees it as undefined.
export const IS_WEB = typeof __SAJAS_WEB__ !== 'undefined' ? __SAJAS_WEB__ : false;
