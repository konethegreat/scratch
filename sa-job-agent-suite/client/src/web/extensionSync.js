// Drains the extension's result queue into the tracker. A result is dropped
// only when the job is gone or the app recorded it; anything else stays queued.
export async function syncExtensionResults({ bridge, record }) {
  const outcome = { synced: 0, dropped: 0, left: 0 };
  let results = [];
  try {
    results = await bridge.pullResults();
  } catch {
    return outcome;
  }
  const acked = [];
  for (const result of Array.isArray(results) ? results : []) {
    if (!result?.id) { outcome.left += 1; continue; }
    let state;
    try {
      state = await record(result);
    } catch {
      state = 'failed';
    }
    if (state === 'synced') { outcome.synced += 1; acked.push(result.id); }
    else if (state === 'gone') { outcome.dropped += 1; acked.push(result.id); }
    else outcome.left += 1;
  }
  if (acked.length) {
    try {
      await bridge.ackResults(acked);
    } catch {
      // The worker may have gone to sleep; the next open retries the same ids.
    }
  }
  return outcome;
}
