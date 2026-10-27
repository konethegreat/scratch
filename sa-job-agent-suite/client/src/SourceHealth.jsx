import { useState, useEffect, useCallback, useRef } from 'react';
import { Activity, AlertTriangle, Loader2, Play, RotateCcw } from 'lucide-react';

/**
 * Source health board for the Hunter tab.
 *
 * Reads GET /api/hunter/sources (read-only) and renders one row per registry
 * source: status badge, the server's plain-language reason, relative last
 * success, typical vs last yield, pages/stop reason, the extraction via and a
 * pagination "unverified" tag. Actions are PATCH {enabled}/ {resetCircuit} and
 * POST /test. Demo mode passes readOnly so every status/reason row still
 * renders but no action can touch the read-only demo API.
 */

const STATUS_BADGE = {
  healthy: { cls: 'badge-success', label: 'Healthy' },
  degraded: { cls: 'badge-warning', label: 'Degraded' },
  'needs-login': { cls: 'badge-warning', label: 'Needs login' },
  broken: { cls: 'badge-error', label: 'Broken' },
  blocked: { cls: 'badge-error', label: 'Blocked' },
  disabled: { cls: 'badge', label: 'Disabled' },
  unknown: { cls: 'badge-info', label: 'Unknown' }
};

export function relativeTime(iso, now = Date.now()) {
  if (!iso) return 'never';
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return 'unknown';
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}

export default function SourceHealth({ apiBase, refreshSignal, toasts, readOnly = false }) {
  const [board, setBoard] = useState({ sources: [], testing: false });
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState('');
  const [inlineError, setInlineError] = useState('');
  // load() is kept independent of the (per-render) toasts object so its effect
  // identity stays stable; the ref still reaches the latest toast helpers.
  const toastsRef = useRef(toasts);
  toastsRef.current = toasts;
  const lastErrorRef = useRef('');

  const reportLoadError = (message) => {
    setInlineError(message);
    if (lastErrorRef.current !== message) {
      lastErrorRef.current = message;
      toastsRef.current?.error?.(message);
    }
  };

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${apiBase}/hunter/sources`, { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        reportLoadError(body.error || `Could not load source health (HTTP ${response.status}).`);
        return;
      }
      setBoard({
        sources: Array.isArray(body.sources) ? body.sources : [],
        testing: body.testing === true
      });
      setInlineError('');
      lastErrorRef.current = '';
    } catch (error) {
      reportLoadError(error.message || 'Could not load source health.');
    } finally {
      setLoaded(true);
    }
  }, [apiBase]); // eslint-disable-line react-hooks/exhaustive-deps -- reportLoadError only touches refs/setters

  // Mount and every explicit refresh (e.g. after a hunt finishes).
  useEffect(() => {
    load();
  }, [load, refreshSignal]);

  // The canary session is asynchronous: poll only while the server says it is
  // testing, and always clear the timer on unmount or when testing ends.
  useEffect(() => {
    if (!board.testing) return undefined;
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [board.testing, load]);

  const runAction = async (key, path, options) => {
    setPending(key);
    setInlineError('');
    try {
      const response = await fetch(`${apiBase}${path}`, options);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = body.error || `Request failed (HTTP ${response.status}).`;
        setInlineError(message);
        toasts?.error?.(message);
        return null;
      }
      return body;
    } catch (error) {
      const message = error.message || 'Network error.';
      setInlineError(message);
      toasts?.error?.(message);
      return null;
    } finally {
      setPending('');
    }
  };

  const patchSource = async (source, updates) => {
    const body = await runAction(`patch:${source.id}`, `/hunter/sources/${encodeURIComponent(source.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });
    if (!body) return;
    if (body.source) {
      setBoard((current) => ({
        ...current,
        sources: current.sources.map((row) => (row.id === body.source.id ? body.source : row))
      }));
    } else {
      load();
    }
  };

  const toggleEnabled = (source) => patchSource(source, { enabled: !source.enabled });
  const resetCircuit = (source) => patchSource(source, { resetCircuit: true });

  const testSources = async () => {
    const body = await runAction('test', '/hunter/sources/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    if (!body) return;
    if (body.started === false) {
      toasts?.info?.(body.message || 'No enabled sources to test.');
      return;
    }
    setBoard((current) => ({ ...current, testing: true }));
    load();
  };

  const allUnknown = board.sources.length > 0 && board.sources.every((row) => row.status === 'unknown');
  const busy = pending !== '';
  const cardStyle = {
    padding: '10px 12px',
    borderRadius: 8,
    background: 'var(--bg-surface-2)',
    border: '1px solid var(--border)'
  };

  return (
    <section style={{ marginBottom: 20 }}>
      <div className="flex-between" style={{ flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
        <div>
          <h3 style={{ fontSize: 15, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Activity size={15} /> Source health
          </h3>
          <p className="muted" style={{ fontSize: 12, marginTop: 2 }}>
            What each registry source returned last run, and what needs attention.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {board.testing && (
            <span className="tiny" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Loader2 size={11} className="spin" /> testing…
            </span>
          )}
          {!readOnly && (
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={testSources}
              disabled={busy || board.testing}
              title="Run a quick canary against every enabled source"
            >
              {board.testing ? <Loader2 size={12} className="spin" /> : <Play size={12} />}
              {board.testing ? 'Testing…' : 'Test sources'}
            </button>
          )}
        </div>
      </div>

      {inlineError && (
        <div
          role="alert"
          style={{
            display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 10, padding: '8px 10px',
            borderRadius: 8, background: 'var(--bg-surface-2)', border: '1px solid var(--color-error)',
            color: 'var(--color-error)', fontSize: 12
          }}
        >
          <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{inlineError}</span>
        </div>
      )}

      {!loaded && board.sources.length === 0 ? (
        <p className="tiny" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Loader2 size={12} className="spin" /> Loading source health…
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {board.sources.map((row) => {
            const badge = STATUS_BADGE[row.status] || STATUS_BADGE.unknown;
            const pages = Number.isFinite(row.pages) ? row.pages : 0;
            return (
              <div key={row.id} style={cardStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 13 }}>{row.name}</strong>
                    <span className={`badge ${badge.cls}`}>{badge.label}</span>
                    <span className="tiny">{row.tier} · {row.scope}</span>
                    {row.via && (
                      <span className="chip" style={{ padding: '2px 8px', fontSize: 10 }} title="How this source's items were extracted">
                        via {row.via}
                      </span>
                    )}
                    {row.pagination && row.pagination.verified === false && (
                      <span className="badge badge-warning" title="Pagination has not been verified for this source yet">
                        pagination unverified
                      </span>
                    )}
                  </div>
                  {!readOnly && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <label className="tiny" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={row.enabled !== false}
                          onChange={() => toggleEnabled(row)}
                          disabled={busy}
                          aria-label={`Enable ${row.name}`}
                        />
                        {row.enabled !== false ? 'Enabled' : 'Disabled'}
                      </label>
                      {row.circuitOpen && (
                        <button
                          type="button"
                          className="btn-secondary btn-xs"
                          onClick={() => resetCircuit(row)}
                          disabled={busy}
                          title="Close the circuit and let the hunter try this source again"
                        >
                          <RotateCcw size={11} /> Reset
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                  {row.reason || (row.status === 'healthy' ? 'no problems detected' : 'no reason reported')}
                </div>
                <div className="tiny" style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 4 }}>
                  <span title={row.lastSuccessAt || undefined}>last worked {relativeTime(row.lastSuccessAt)}</span>
                  <span>returns ~{row.typicalRaw == null ? 0 : row.typicalRaw}, last run: {row.lastRaw == null ? 'not set' : row.lastRaw}</span>
                  <span>
                    {pages} page{pages === 1 ? '' : 's'}
                    {row.stopReason ? ` · stopped: ${row.stopReason}` : ''}
                  </span>
                </div>
              </div>
            );
          })}
          {allUnknown && (
            <p className="tiny">
              {readOnly
                ? 'All sources are unknown. Run the crawler to collect health data.'
                : 'All sources are unknown. Launch the crawler or test sources to collect health data.'}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
