// Typed errors thrown by callClaude. Messages are user-facing and never contain keys.

export class ClaudeAuthError extends Error {
  constructor(message = 'Anthropic rejected the API key. Check it in Settings.', status) {
    super(message);
    this.name = 'ClaudeAuthError';
    if (status != null) this.status = status;
  }
}

export class ClaudeRefusalError extends Error {
  constructor(message = 'Claude declined this request.', details) {
    super(message);
    this.name = 'ClaudeRefusalError';
    if (details !== undefined) this.details = details;
  }
}

/** The supplied key is malformed or the wrong kind (rejected before any request). */
export class ClaudeKeyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ClaudeKeyError';
  }
}
