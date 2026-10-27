import React, { useRef, useState } from 'react';
import { AlertTriangle, Download, Loader2, Upload } from 'lucide-react';
import { AppError, ERROR_CODES } from '@sajas/core/errors';
import { recordError } from './errors.js';

const FORBIDDEN_FIELDS = Object.freeze(['anthropicApiKey', 'keyVault']);

function countOf(map) {
  return map && typeof map === 'object' ? Object.keys(map).length : 0;
}

/**
 * The vault excludes keyVault from exportAll, but the download is the one place
 * a mistake becomes a file on disk. Walk the payload and refuse any key-shaped
 * field before the blob is created.
 */
function assertNoKeyMaterial(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 6) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_FIELDS.includes(key)) {
      throw new AppError(ERROR_CODES.VALIDATION, 'That backup contains key material, so it was not downloaded.');
    }
    assertNoKeyMaterial(child, depth + 1);
  }
}

export default function SettingsBackup({ vault, toasts, onImported }) {
  const inputRef = useRef(null);
  const [pending, setPending] = useState(null);
  const [summary, setSummary] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function exportAll() {
    setBusy(true);
    setError(null);
    try {
      const payload = await vault.exportAll();
      assertNoKeyMaterial(payload);
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `sajas-backup-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      toasts.success('Backup downloaded. It contains no API key.');
    } catch (issue) {
      setError(recordError(issue, { where: 'export backup' }));
    } finally {
      setBusy(false);
    }
  }

  async function pickFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    setPending(null);
    setConfirmText('');
    try {
      const payload = JSON.parse(await file.text());
      const rows = payload?.data || {};
      setSummary([
        payload?.exportedAt ? `Exported ${new Date(payload.exportedAt).toLocaleString()}.` : 'No export date.',
        `${countOf(rows.profile)} profile, ${countOf(rows.jobs)} jobs, ${countOf(rows.memory)} memory, ${countOf(rows.answers)} answers, ${countOf(rows.usage)} usage records.`
      ].join(' '));
      setPending(payload);
    } catch (issue) {
      setError(recordError(issue, { where: 'read backup' }));
    } finally {
      event.target.value = '';
    }
  }

  async function importAll() {
    if (!pending || confirmText.trim().toLowerCase() !== 'import') return;
    setBusy(true);
    setError(null);
    try {
      await vault.importAll(pending);
      setPending(null);
      setConfirmText('');
      setSummary('');
      toasts.success('Backup restored.');
      onImported?.();
    } catch (issue) {
      setError(recordError(issue, { where: 'import backup' }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h3 style={{ fontSize: 16 }}>Backup and restore</h3>
      <p className="tiny" style={{ marginTop: 4 }}>
        Your data lives only in this browser. Export a JSON backup before clearing site data or moving to another device.
        The file never contains your API key.
      </p>

      {error && (
        <div className="error-card" role="alert" style={{ marginTop: 12 }}>
          <div className="error-card-head">
            <AlertTriangle size={18} color="var(--color-error)" />
            <div>
              <div className="error-card-title">{error.message}</div>
              <div className="error-card-code">{error.code}</div>
            </div>
          </div>
          {error.hint && <p className="error-card-message">{error.hint}</p>}
        </div>
      )}

      <div className="flex-gap" style={{ marginTop: 16, flexWrap: 'wrap' }}>
        <button className="btn-primary" onClick={exportAll} disabled={busy} data-testid="export-backup">
          {busy ? <Loader2 size={14} className="spin" /> : <Download size={14} />} Export backup
        </button>
        <button className="btn-secondary" onClick={() => inputRef.current?.click()} disabled={busy} data-testid="import-backup">
          <Upload size={14} /> Choose backup file
        </button>
        <input ref={inputRef} type="file" accept="application/json,.json" hidden onChange={pickFile} data-testid="import-file" />
      </div>

      {pending && (
        <div style={{ marginTop: 18, padding: 14, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-surface-2)' }}>
          <p style={{ fontSize: 13 }}>{summary}</p>
          <p className="tiny" style={{ marginTop: 8, color: 'var(--color-warning)' }}>
            Restoring replaces every profile, job, note, and answer currently in this browser. Export first if you are unsure.
          </p>
          <label style={{ marginTop: 12 }}>Type import to confirm</label>
          <input value={confirmText} onChange={(event) => setConfirmText(event.target.value)} placeholder="import" data-testid="import-confirm-text" />
          <div className="flex-gap" style={{ marginTop: 10 }}>
            <button className="btn-danger" onClick={importAll} disabled={busy || confirmText.trim().toLowerCase() !== 'import'} data-testid="import-confirm">
              {busy ? <Loader2 size={14} className="spin" /> : null} Replace this browser's data
            </button>
            <button className="btn-ghost" onClick={() => { setPending(null); setSummary(''); setConfirmText(''); }}>Cancel</button>
          </div>
        </div>
      )}
    </section>
  );
}
