import { FlaskConical, X } from 'lucide-react';
import { BETA_NOTICE } from './beta.js';

export default function BetaBanner({ onDismiss, onOpenLegal }) {
  return (
    <div role="status" className="panel beta-banner" data-testid="beta-banner">
      <span className="badge badge-warning">
        <FlaskConical size={12} aria-hidden="true" /> Beta
      </span>
      <p>{BETA_NOTICE.body}</p>
      <div className="beta-banner-actions">
        {onOpenLegal && (
          <button type="button" className="btn-ghost btn-xs" onClick={onOpenLegal}>
            Terms and privacy
          </button>
        )}
        <button
          type="button"
          className="icon-button"
          aria-label="Dismiss the beta notice"
          data-testid="dismiss-beta"
          onClick={onDismiss}
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
