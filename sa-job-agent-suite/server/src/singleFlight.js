// Runs at most one task at a time. A call made while one is in flight does not
// start a second task: it resolves { busy: true } so the caller can answer 409.
// Used for work that launches a browser on the real profile, where a second
// instance would fight the profile lock.
export function createSingleFlight() {
  let running = false;
  return async function run(task) {
    if (running) return { busy: true };
    running = true;
    try {
      return { busy: false, value: await task() };
    } finally {
      running = false;
    }
  };
}
