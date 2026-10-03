import { useState, useEffect, useCallback } from 'react';
import { Trash2, Save, Sparkles, Inbox } from 'lucide-react';

/**
 * Smart application-answers panel for Settings.
 *
 * Three parts:
 *   1) A structured questionnaire of the questions that recur on SA job sites.
 *      These are mapped DETERMINISTICALLY by Agent 3 (no AI guessing). ID/passport
 *      number is deliberately NOT collected — paste it per-application.
 *   2) The learn-as-you-go answer bank (questions Agent 3 has learned).
 *   3) Pending questions Agent 3 captured but couldn't answer — answer once here
 *      and they're remembered for every future application.
 */

const SELECT = (opts) => ['', ...opts];

const FIELDS = [
  { key: 'rightToWorkSA',        label: 'Right to work in SA',        type: 'select', options: SELECT(['Yes', 'No']) },
  { key: 'nationality',          label: 'Nationality',                type: 'text',   placeholder: 'e.g. South African' },
  { key: 'eeRace',               label: 'Race / population group (EE)', type: 'select', options: SELECT(['African', 'Coloured', 'Indian', 'White', 'Other', 'Prefer not to say']), sensitive: true },
  { key: 'gender',               label: 'Gender',                     type: 'select', options: SELECT(['Male', 'Female', 'Other', 'Prefer not to say']), sensitive: true },
  { key: 'disability',           label: 'Disability',                 type: 'select', options: SELECT(['No', 'Yes', 'Prefer not to say']), sensitive: true },
  { key: 'noticePeriod',         label: 'Notice period',              type: 'text',   placeholder: 'e.g. 30 days / Immediate' },
  { key: 'currentSalary',        label: 'Current salary',             type: 'text',   placeholder: 'e.g. R45 000 p/m', sensitive: true },
  { key: 'expectedSalary',       label: 'Expected salary',            type: 'text',   placeholder: 'e.g. R650 000 p/a (neg.)', sensitive: true },
  { key: 'willingToRelocate',    label: 'Willing to relocate',        type: 'select', options: SELECT(['Yes', 'No']) },
  { key: 'driversLicense',       label: "Driver's licence",           type: 'select', options: SELECT(['None', 'Code A', 'Code B', 'Code C', 'Code EB', 'Other']) },
  { key: 'ownVehicle',           label: 'Own vehicle',                type: 'select', options: SELECT(['Yes', 'No']) },
  { key: 'highestQualification', label: 'Highest qualification',      type: 'text',   placeholder: 'e.g. BSc Computer Science' },
  { key: 'yearsExperience',      label: 'Years of experience',        type: 'text',   placeholder: 'e.g. 5' },
  { key: 'criminalRecord',       label: 'Criminal record',            type: 'select', options: SELECT(['No', 'Yes']), sensitive: true },
  { key: 'creditCheckConsent',   label: 'Consent to credit check',    type: 'select', options: SELECT(['Yes', 'No']) },
  { key: 'languages',            label: 'Languages',                  type: 'text',   placeholder: 'e.g. English, isiZulu, Afrikaans' },
  { key: 'availabilityDate',     label: 'Available from',             type: 'text',   placeholder: 'e.g. Immediate / 2026-07-01' },
];

export default function ApplicationAnswers({ appProfile = {}, onChangeField, notes = '', onChangeNotes, apiBase, toasts, refreshSignal }) {
  const [bank, setBank] = useState([]);
  const [pending, setPending] = useState([]);
  const [drafts, setDrafts] = useState({}); // pendingId -> answer text

  const refresh = useCallback(async () => {
    try {
      const [b, p] = await Promise.all([
        fetch(`${apiBase}/application/bank`).then((r) => r.json()),
        fetch(`${apiBase}/application/pending`).then((r) => r.json()),
      ]);
      setBank(Array.isArray(b) ? b : []);
      setPending(Array.isArray(p) ? p : []);
    } catch {
      /* server may be booting */
    }
  }, [apiBase]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh, refreshSignal]);

  const resolvePending = async (q) => {
    const answer = (drafts[q.id] || '').trim();
    if (!answer) return;
    try {
      const res = await fetch(`${apiBase}/application/pending/${q.id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer }),
      });
      if (res.ok) {
        toasts?.success?.('Saved to your answer bank — it will auto-fill next time.');
        setDrafts((d) => { const n = { ...d }; delete n[q.id]; return n; });
        refresh();
      } else {
        toasts?.error?.('Could not save that answer.');
      }
    } catch (e) {
      toasts?.error?.(e.message || 'Network error.');
    }
  };

  const dismissPending = async (id) => {
    try {
      await fetch(`${apiBase}/application/pending/${id}`, { method: 'DELETE' });
      refresh();
    } catch { /* ignore */ }
  };

  const deleteBankEntry = async (id) => {
    try {
      await fetch(`${apiBase}/application/bank/${id}`, { method: 'DELETE' });
      refresh();
    } catch { /* ignore */ }
  };

  const labelStyle = { display: 'block', fontSize: 11, color: 'var(--color-muted)', marginBottom: 4 };
  const cardStyle = { background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: 8, padding: 12 };

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <div className="flex-between" style={{ marginBottom: 4 }}>
          <h4 style={{ fontSize: 14 }}>Standard application answers</h4>
          <Sparkles size={14} color="var(--color-accent, #fbbf24)" />
        </div>
        <p className="hint" style={{ marginTop: 0 }}>
          Answer the questions SA job sites ask most. The Apply Copilot fills these exactly as you
          set them — demographics and salary are never guessed. Everything is optional and stored
          locally only. Your ID/passport number is intentionally not saved here — paste it per application.
        </p>
      </div>

      {/* Structured questionnaire */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 12 }}>
        {FIELDS.map((f) => (
          <div key={f.key}>
            <label style={labelStyle}>
              {f.label}{f.sensitive ? <span style={{ color: 'var(--color-muted)' }}> · optional</span> : null}
            </label>
            {f.type === 'select' ? (
              <select
                value={appProfile[f.key] || ''}
                onChange={(e) => onChangeField(f.key, e.target.value)}
                style={{ width: '100%', fontSize: 12 }}
              >
                {f.options.map((o) => (
                  <option key={o} value={o}>{o === '' ? '— select —' : o}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={appProfile[f.key] || ''}
                placeholder={f.placeholder || ''}
                onChange={(e) => onChangeField(f.key, e.target.value)}
                style={{ width: '100%', fontSize: 12 }}
              />
            )}
          </div>
        ))}
      </div>

      {/* Free-form catch-all */}
      <div>
        <label style={labelStyle}>Anything else (free text)</label>
        <textarea
          placeholder={'Any other standard answers, e.g.\nReason for leaving: Seeking growth\nReference contactable: Yes'}
          value={notes || ''}
          onChange={(e) => onChangeNotes(e.target.value)}
          style={{ minHeight: 90, fontSize: 12, fontFamily: 'JetBrains Mono, monospace', resize: 'vertical', width: '100%' }}
        />
        <span className="hint">The AI uses this as extra context for free-text screening questions.</span>
      </div>

      {/* Pending questions captured by Agent 3 */}
      {pending.length > 0 && (
        <div style={{ ...cardStyle, borderColor: 'rgba(251,191,36,0.4)', background: 'rgba(251,191,36,0.06)' }}>
          <div className="flex-between" style={{ marginBottom: 8 }}>
            <strong style={{ fontSize: 13, color: 'var(--color-accent, #fbbf24)' }}>
              <Inbox size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
              Questions to answer ({pending.length})
            </strong>
          </div>
          <p className="hint" style={{ marginTop: 0, marginBottom: 10 }}>
            The Apply Copilot hit these and couldn't answer them. Answer once and they'll auto-fill on every future application.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {pending.map((q) => (
              <div key={q.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--color-text, #e2e8f0)' }}>{q.question}</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    type="text"
                    placeholder="Your answer…"
                    value={drafts[q.id] || ''}
                    onChange={(e) => setDrafts((d) => ({ ...d, [q.id]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === 'Enter') resolvePending(q); }}
                    style={{ flex: 1, fontSize: 12 }}
                  />
                  <button type="button" className="btn-primary btn-sm" onClick={() => resolvePending(q)}>
                    <Save size={12} /> Save
                  </button>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => dismissPending(q.id)}>
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Learned answer bank */}
      {bank.length > 0 && (
        <div style={cardStyle}>
          <strong style={{ fontSize: 13 }}>Saved answers ({bank.length})</strong>
          <p className="hint" style={{ marginTop: 2, marginBottom: 10 }}>
            Learned from past applications. Reused automatically when a matching question appears.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {bank.map((b) => (
              <div key={b.id} className="flex-between" style={{ gap: 8, alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: 'var(--color-text, #e2e8f0)' }}>{b.question}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-muted)' }}>{b.answer}</div>
                </div>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  title="Delete saved answer"
                  onClick={() => deleteBankEntry(b.id)}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
