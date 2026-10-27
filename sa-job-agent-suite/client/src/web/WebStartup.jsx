import React, { useEffect, useState } from 'react';
import { KeyRound, Loader2, ShieldCheck, ExternalLink } from 'lucide-react';
import { AppError, ERROR_CODES } from '@sajas/core/errors';
import ErrorCard from '../ErrorCard.jsx';
import { recordError } from '../errors.js';
import { validateAnthropicKey } from './validateKey.js';
import { MIN_PASSPHRASE } from './keyStore.js';

const CONSOLE_URL = 'https://console.anthropic.com/settings/keys';

export default function WebStartup({ runtime, onReady, forceEnter = false }) {
  const [phase, setPhase] = useState('checking'); // checking | enter | unlock | ready | blocked
  const [blockError, setBlockError] = useState(null);
  const [key, setKey] = useState('');
  const [remember, setRemember] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [unlockPass, setUnlockPass] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (await runtime.keyStore.hasSavedKey()) {
          if (alive) setPhase('unlock');
          return;
        }
        // An idle-forget without a saved blob must land on the onboarding form,
        // not silently reopen the app.
        if (forceEnter) {
          if (alive) setPhase('enter');
          return;
        }
        const meta = await runtime.vault.get('meta', 'app', {});
        if (alive) setPhase(meta.onboarded ? 'ready' : 'enter');
      } catch (err) {
        if (!alive) return;
        setBlockError(recordError(err, { where: 'open the local vault' }));
        setPhase('blocked');
      }
    })();
    return () => { alive = false; };
  }, [runtime, forceEnter]);

  useEffect(() => {
    if (phase === 'ready') onReady();
  }, [phase, onReady]);

  const finish = async () => {
    const meta = await runtime.vault.get('meta', 'app', {});
    await runtime.vault.put('meta', 'app', { ...meta, onboarded: true });
    onReady();
  };

  const useKey = async (event) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      // Check the local passphrase rules first so a typo never costs the user
      // the key they just pasted.
      if (remember) {
        if (passphrase.length < MIN_PASSPHRASE) {
          throw new AppError(ERROR_CODES.VALIDATION, `Use a passphrase of at least ${MIN_PASSPHRASE} characters.`);
        }
        if (passphrase !== confirm) {
          throw new AppError(ERROR_CODES.VALIDATION, 'The passphrases do not match.');
        }
      }
      await validateAnthropicKey(key);
      runtime.keyStore.setKey(key);
      // The plaintext must never stay in a rendered value after it is accepted.
      setKey('');
      if (remember) {
        await runtime.keyStore.remember(passphrase);
        setPassphrase('');
        setConfirm('');
      }
      await finish();
    } catch (err) {
      runtime.keyStore.clearMemory();
      setError(recordError(err, { where: 'add your key' }));
    } finally {
      setBusy(false);
    }
  };

  const unlock = async (event) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await runtime.keyStore.unlock(unlockPass);
      setUnlockPass('');
      await finish();
    } catch (err) {
      setError(recordError(err, { where: 'unlock your key' }));
    } finally {
      setBusy(false);
    }
  };

  const resetSaved = async () => {
    await runtime.keyStore.forget();
    setPhase('enter');
  };

  return (
    <div className="app-bg" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div className="glass-panel fade-in" style={{ width: '100%', maxWidth: 560, padding: 28 }} data-testid="onboarding">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <ShieldCheck size={22} color="var(--color-info)" />
          <h2 style={{ fontSize: 20 }}>SA-JAS for the web</h2>
        </div>
        <p className="muted" style={{ fontSize: 13, marginBottom: 18 }}>
          Your profile, jobs and documents stay in this browser. Your key is sent only to Anthropic.
          There are no accounts and no server-side copy.
        </p>

        {phase === 'checking' && (
          <p className="hint" data-testid="startup-checking"><Loader2 size={14} className="spin" /> Opening your local vault…</p>
        )}

        {phase === 'blocked' && (
          <>
            <ErrorCard title="This browser blocked local storage" error={blockError} />
            <button type="button" className="btn-ghost btn-sm" onClick={onReady}>Continue without saving</button>
          </>
        )}

        {phase === 'enter' && (
          <form onSubmit={useKey} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label htmlFor="web-key">Anthropic API key</label>
            <input
              id="web-key"
              data-testid="key-input"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="sk-ant-api…"
            />
            <span className="hint">
              Create a key in a Workspace with a spend limit. Admin keys are refused.{" "}
              <a href={CONSOLE_URL} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-info)' }}>
                Open the Console <ExternalLink size={11} />
              </a>
            </span>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} data-testid="remember-toggle" />
              <span>Remember this key on this device (encrypted)</span>
            </label>

            {remember && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input
                  type="password"
                  data-testid="passphrase-input"
                  placeholder="Passphrase (at least 10 characters)"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  autoComplete="new-password"
                />
                <input
                  type="password"
                  data-testid="passphrase-confirm"
                  placeholder="Confirm passphrase"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                />
                <span className="hint">If you lose this passphrase, the saved key cannot be recovered.</span>
              </div>
            )}

            {error && <ErrorCard title="Could not use that key" error={error} />}

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button type="submit" className="btn-primary" data-testid="key-submit" disabled={busy || !key.trim()}>
                {busy ? <Loader2 size={14} className="spin" /> : <KeyRound size={14} />} Check and continue
              </button>
              <button type="button" className="btn-ghost" onClick={finish} data-testid="key-skip" disabled={busy}>
                Explore without a key
              </button>
            </div>
          </form>
        )}

        {phase === 'unlock' && (
          <form onSubmit={unlock} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p className="hint">A saved key was found on this device. Enter its passphrase to unlock it.</p>
            <input
              type="password"
              data-testid="unlock-input"
              placeholder="Passphrase"
              value={unlockPass}
              onChange={(e) => setUnlockPass(e.target.value)}
              autoComplete="current-password"
            />
            {error && <ErrorCard title="Could not unlock the saved key" error={error} />}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button type="submit" className="btn-primary" data-testid="unlock-submit" disabled={busy || !unlockPass}>
                {busy ? <Loader2 size={14} className="spin" /> : <KeyRound size={14} />} Unlock
              </button>
              <button type="button" className="btn-ghost" onClick={resetSaved} data-testid="forget-saved">
                Use a different key
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
