import React, { useCallback, useEffect, useState } from 'react';
import { KeyRound, Loader2, ShieldOff, ShieldCheck, ExternalLink } from 'lucide-react';
import { AppError, ERROR_CODES } from '@sajas/core/errors';
import ErrorCard from '../ErrorCard.jsx';
import { recordError } from '../errors.js';
import { IDLE_OPTIONS, MIN_PASSPHRASE } from './keyStore.js';

const CONSOLE_URL = 'https://console.anthropic.com/settings/keys';

export default function WebKeyPanel({ runtime, refreshSignal = 0, onChanged, onAddKey }) {
  const [status, setStatus] = useState({ loaded: false, saved: false });
  const [idle, setIdle] = useState(30);
  const [rememberOpen, setRememberOpen] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [step, setStep] = useState(null); // null | 'forget' | 'wipe'
  const [wipeText, setWipeText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setStatus({ loaded: runtime.keyStore.hasKey(), saved: await runtime.keyStore.hasSavedKey() });
    setIdle(runtime.keyStore.getIdleMinutes());
  }, [runtime]);

  useEffect(() => {
    refresh().catch((err) => setError(recordError(err, { where: 'load key status' })));
  }, [refresh, refreshSignal]);

  const changeIdle = async (value) => {
    try {
      await runtime.keyStore.saveIdleMinutes(Number(value));
      setIdle(Number(value));
      onChanged?.();
    } catch (err) {
      setError(recordError(err, { where: 'change idle timeout' }));
    }
  };

  const remember = async (event) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (passphrase.length < MIN_PASSPHRASE) {
        throw new AppError(ERROR_CODES.VALIDATION, `Use a passphrase of at least ${MIN_PASSPHRASE} characters.`);
      }
      if (passphrase !== confirm) {
        throw new AppError(ERROR_CODES.VALIDATION, 'The passphrases do not match.');
      }
      await runtime.keyStore.remember(passphrase);
      setPassphrase('');
      setConfirm('');
      setRememberOpen(false);
      await refresh();
      onChanged?.();
    } catch (err) {
      setError(recordError(err, { where: 'remember the key' }));
    } finally {
      setBusy(false);
    }
  };

  const forget = async () => {
    setBusy(true);
    try {
      await runtime.keyStore.forget();
      setStep(null);
      await refresh();
      onChanged?.();
    } catch (err) {
      setError(recordError(err, { where: 'forget the key' }));
    } finally {
      setBusy(false);
    }
  };

  const wipe = async () => {
    setBusy(true);
    try {
      await runtime.keyStore.panicWipe();
      window.location.reload();
    } catch (err) {
      setError(recordError(err, { where: 'panic wipe' }));
      setBusy(false);
    }
  };

  const description = status.loaded
    ? status.saved
      ? 'Loaded in this tab and saved encrypted on this device.'
      : 'Loaded in this tab only. Forget it when you are done.'
    : 'No key loaded. AI features stay off until you add one.';

  return (
    <div style={{ marginTop: 18, padding: 14, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-surface-2)' }} data-testid="key-panel">
      <div className="flex-between" style={{ gap: 10, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
          <ShieldCheck size={15} /> Key security
        </span>
        <span className={`badge ${status.loaded ? 'badge-success' : 'badge-error'}`} data-testid="key-status">
          {status.loaded ? (status.saved ? 'Saved encrypted' : 'In this tab') : 'Not loaded'}
        </span>
      </div>
      <p className="hint" style={{ marginTop: 6 }}>{description}</p>

      <div className="grid-2" style={{ marginTop: 10 }}>
        <div>
          <label>Forget the key after</label>
          <select value={idle} onChange={(e) => changeIdle(e.target.value)} data-testid="idle-select">
            {IDLE_OPTIONS.map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes idle</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
          {!status.loaded && onAddKey && (
            <button type="button" className="btn-primary btn-sm" onClick={onAddKey} data-testid="add-key">
              <KeyRound size={12} /> Add a key
            </button>
          )}
          {status.loaded && !status.saved && (
            <button type="button" className="btn-secondary btn-sm" onClick={() => setRememberOpen((v) => !v)} data-testid="remember-open">
              <KeyRound size={12} /> Remember encrypted
            </button>
          )}
          <button type="button" className="btn-danger btn-sm" onClick={() => setStep('forget')} disabled={!status.loaded && !status.saved} data-testid="forget-key">
            <ShieldOff size={12} /> Forget key
          </button>
        </div>
      </div>

      {rememberOpen && (
        <form onSubmit={remember} style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
          <input type="password" placeholder="Passphrase" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} data-testid="passphrase-input" autoComplete="new-password" />
          <input type="password" placeholder="Confirm passphrase" value={confirm} onChange={(e) => setConfirm(e.target.value)} data-testid="passphrase-confirm" autoComplete="new-password" />
          <span className="hint">Losing the passphrase makes the saved key unrecoverable. The key is still in this tab until you forget it.</span>
          <button type="submit" className="btn-primary btn-sm" disabled={busy} data-testid="remember-submit">
            {busy ? <Loader2 size={12} className="spin" /> : null} Save encrypted
          </button>
        </form>
      )}

      {step === 'forget' && (
        <div style={{ marginTop: 12, padding: 12, border: '1px solid var(--border)', borderRadius: 8 }}>
          <p style={{ fontSize: 12.5 }}>Forget the key now? Saved data stays unless you panic-wipe.</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn-danger btn-sm" onClick={forget} disabled={busy} data-testid="forget-confirm">Forget key</button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setStep(null)}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
        <p className="hint" style={{ marginBottom: 8 }}>
          Panic wipe deletes the key, every saved job, your profile and the dossier from this browser. It cannot be undone.
        </p>
        {step === 'wipe' ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input value={wipeText} onChange={(e) => setWipeText(e.target.value)} placeholder='Type "wipe" to confirm' data-testid="wipe-confirm-text" />
            <button type="button" className="btn-danger btn-sm" disabled={busy || wipeText.trim().toLowerCase() !== 'wipe'} onClick={wipe} data-testid="panic-confirm">
              Wipe everything
            </button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => { setStep(null); setWipeText(''); }}>Cancel</button>
          </div>
        ) : (
          <button type="button" className="btn-danger btn-sm" onClick={() => setStep('wipe')} data-testid="panic-wipe">Panic wipe…</button>
        )}
      </div>

      <p className="hint" style={{ marginTop: 12 }}>
        <a href={CONSOLE_URL} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-info)' }}>
          Revoke this key in the Anthropic Console <ExternalLink size={11} />
        </a>
      </p>

      {error && <ErrorCard title="Key settings failed" error={error} onDismiss={() => setError(null)} />}
    </div>
  );
}
