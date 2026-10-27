import React, { useEffect, useState } from 'react';
import { Copy, Trash2 } from 'lucide-react';
import {
  clearRecentErrors,
  diagnosticsText,
  getRecentErrors,
  subscribeErrors
} from './errors.js';

export default function RecentErrors() {
  const [entries, setEntries] = useState(() => getRecentErrors());
  useEffect(() => subscribeErrors(setEntries), []);
  const copy = (entry) => {
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(diagnosticsText(entry));
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
        {entries.map((entry, index) => (
          <div key={`${entry.at}-${index}`} className="error-row">
            <div className="flex-between" style={{ gap: 8, flexWrap: 'wrap' }}>
              <span className="badge badge-error">{entry.code}</span>
              <span className="tiny muted">
                {entry.at}{entry.where ? ` · ${entry.where}` : ''}
              </span>
            </div>
            <p style={{ margin: '6px 0 0', fontSize: 12 }}>{entry.message}</p>
            {entry.hint && <p className="hint">{entry.hint}</p>}
            <button type="button" className="btn-ghost btn-xs" onClick={() => copy(entry)}>
              <Copy size={11} /> Copy diagnostics
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
