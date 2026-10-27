import React, { useState } from 'react';
import { AlertTriangle, Copy, ChevronDown } from 'lucide-react';
import { copyToClipboard } from './clipboard.js';
import { describeUserError, diagnosticsText } from './errors.js';

export default function ErrorCard({ error, title = 'Something went wrong', onRetry, onDismiss }) {
  const [copied, setCopied] = useState(false);
  if (!error) return null;
  const copy = async () => {
    const ok = await copyToClipboard(diagnosticsText({ ...error, at: error.at || new Date().toISOString() }));
    if (!ok) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="error-card" role="alert">
      <div className="error-card-head">
        <AlertTriangle size={18} color="var(--color-error)" />
        <div>
          <div className="error-card-title">{title}</div>
          <div className="error-card-code">
            {error.code}{error.requestId ? ` · ${error.requestId}` : ''}
          </div>
        </div>
      </div>
      <p className="error-card-message">{describeUserError(error)}</p>
      {error.details && (
        <details className="error-card-details">
          <summary><ChevronDown size={12} /> Details</summary>
          <pre>{error.details}</pre>
        </details>
      )}
      <div className="error-card-actions">
        {onRetry && error.retryable && (
          <button type="button" className="btn-secondary btn-sm" onClick={onRetry}>Retry</button>
        )}
        <button type="button" className="btn-ghost btn-sm" onClick={copy}>
          <Copy size={12} /> {copied ? 'Copied' : 'Copy diagnostics'}
        </button>
        {onDismiss && (
          <button type="button" className="btn-ghost btn-sm" onClick={onDismiss}>Dismiss</button>
        )}
      </div>
    </div>
  );
}
