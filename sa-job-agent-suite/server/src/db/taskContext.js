// Ambient "which task is this AI call part of" context. Deliberately has NO
// imports from helper.js so the usage ledger can read it without a cycle.
import { AsyncLocalStorage } from 'node:async_hooks';

const als = new AsyncLocalStorage();

/** Run `fn` with `store` ({id, type}) as the active task for everything it awaits. */
export function runInTask(store, fn) {
  return als.run(store, fn);
}

/** The active task ({id, type}) or null when called outside any task. */
export function currentTask() {
  return als.getStore() || null;
}
