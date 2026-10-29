import { LogOut } from 'lucide-react';

export default function DemoBanner({ onExit, persistent = true, busy = false }) {
  return (
    <div
      role="status"
      data-testid="demo-banner"
      className="panel"
      style={{
        padding: '12px 16px', marginBottom: 20, borderColor: 'var(--color-warning)',
        background: 'var(--bg-surface-2)', display: 'flex', gap: 12,
        alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap'
      }}
    >
      <div>
        <strong>Demo mode. Everything here is simulated.</strong>
        {!persistent && (
          <p className="tiny" style={{ margin: '4px 0 0' }}>
            This browser blocked session storage, so progress resets when you refresh.
          </p>
        )}
      </div>
      <button type="button" className="btn-secondary btn-sm" data-testid="exit-demo" onClick={onExit} disabled={busy}>
        <LogOut size={13} /> Exit demo
      </button>
    </div>
  );
}
