// Test helpers, exported at '@sajas/core/testing' (NOT part of the main barrel).

/**
 * A fake Anthropic client for unit tests (no network, no SDK import).
 * `messages.stream(params)` and `beta.messages.stream(params)` each return
 * `{ finalMessage }` resolving to the next queued response and record `params`
 * in `calls` (beta calls are recorded with `beta: true`). A queued entry of
 * the form `{ __throw: err }` makes `finalMessage()` reject with `err`.
 * When the queue is exhausted the last entry repeats.
 */
export function fakeClient(responses = []) {
  const calls = [];
  let i = 0;
  const next = () => {
    if (!responses.length) throw new Error('fakeClient: no responses queued');
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return r;
  };
  const make = (extra) => (params) => {
    // Deep snapshot: record what was sent at this moment, not a live reference
    // the caller may mutate later (e.g. the growing conversation array).
    calls.push({ ...structuredClone(params), ...extra });
    return {
      finalMessage: async () => {
        const r = next();
        if (r && r.__throw) throw r.__throw;
        return r;
      }
    };
  };
  const client = {
    messages: { stream: make({}) },
    beta: { messages: { stream: make({ beta: true }) } }
  };
  return { client, calls };
}
