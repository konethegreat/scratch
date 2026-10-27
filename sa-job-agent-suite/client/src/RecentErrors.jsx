import React, { useEffect, useRef, useState } from 'react';
import { Copy, Trash2 } from 'lucide-react';
import { copyToClipboard } from './clipboard.js';
import {
  clearRecentErrors,
  diagnosticsText,
  getRecentErrors,
  subscribeErrors
} from './errors.js';

export default function RecentErrors() {
  const [entries, setEntries] = useState(() => getRecentErrors());
  const [copiedKey, setCopiedKey] = useState(null);
  const copyTimer = useRef(null);
  useEffect(() => subscribeErrors(setEntries), []);
  useEffect(() => () => clearTimeout(copyTimer.current), []);
  const copy = async (key, entry) => {
    const ok = await copyToClipboard(diagnosticsText(entry));
    if (!ok) return;
    clearTimeout(copyTimer.current);
    setCopiedKey(key);
    copyTimer.current = setTimeout(() => setCopiedKey(null), 2000);
  };
  return (
    <div>
      <div className="flex-between" style={{ marginBottom: 10 }}>
        <div>
          <h4 style={{ fontSize: 14 }}>Recent errors ({entries.length})</h4>
          <p className="hint">Memory-only. Cleared when the app reloads.</p>
        </div>
        {entries.length > 0 && (
          <button type="button" className="btn-ghost btn-sm" onClick={clearRecentErrors}>
            <Trash2 size={12} /> Clear
          </button>
        )}
      </div>
      {entries.length === 0 && <p className="hint">No errors this session.</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {entries.map((entry, index) => {
          const key = `${entry.at}-${index}`;
          return (
            <div key={key} className="error-row">
              <div className="flex-between" style={{ gap: 8, flexWrap: 'wrap' }}>
                <span className="badge badge-error">{entry.code}</span>
                <span className="tiny muted">
                  {entry.at}{entry.where ? ` · ${entry.where}` : ''}{entry.count > 1 ? ` ×${entry.count}` : ''}
                </span>
              </div>
              <p style={{ margin: '6px 0 0', fontSize: 12 }}>{entry.message}</p>
              {entry.hint && <p className="hint">{entry.hint}</p>}
              <button type="button" className="btn-ghost btn-xs" onClick={() => copy(key, entry)}>
                <Copy size={11} /> {copiedKey === key ? 'Copied' : 'Copy diagnostics'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
