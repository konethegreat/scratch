// Pessimistic preflight for model inputs. The API rejects an oversized request
// only after the user has waited, so estimate locally first. Three characters
// per token deliberately overestimates, matching the eval harness. The 100k
// ceiling leaves room for the output budget and tool turns inside the context
// window, so a request that passes cannot be pushed over by the response.
export const CHARS_PER_TOKEN = 3;
export const MAX_INPUT_TOKENS = 100_000;

export function estimateTokens(value) {
  return Math.ceil(String(value ?? '').length / CHARS_PER_TOKEN);
}

/**
 * Estimates the input size of one request built from several text parts.
 * `overBudget` means the request should not be sent without shortening it.
 */
export function inputBudget(parts, { maxTokens = MAX_INPUT_TOKENS } = {}) {
  const list = Array.isArray(parts) ? parts : [parts];
  const estimatedTokens = list.reduce((total, part) => total + estimateTokens(part), 0);
  return {
    estimatedTokens,
    maxTokens,
    maxChars: maxTokens * CHARS_PER_TOKEN,
    overBudget: estimatedTokens > maxTokens
  };
}
