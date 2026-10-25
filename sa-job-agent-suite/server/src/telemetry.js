// Task attribution: a "task" is one run of an agent (hunt, tailor, apply, ...).
// Every AI call made inside withTask() is attributed to it in the usage ledger.
import { randomUUID } from 'node:crypto';
import { runInTask } from './db/taskContext.js';
import { recordTaskRun } from './db/helper.js';

export async function withTask(type, fn) {
  const store = { id: randomUUID(), type };
  let ok = true;
  try {
    return await runInTask(store, fn);
  } catch (err) {
    ok = false;
    throw err;
  } finally {
    recordTaskRun(type, ok);
  }
}
