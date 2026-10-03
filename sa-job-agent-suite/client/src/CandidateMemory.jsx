import { useState, useEffect, useCallback } from 'react';
import { Brain, Trash2, Plus, Building2, ClipboardList, Sparkles, RefreshCw, Moon, Loader2 } from 'lucide-react';

/**
 * Candidate Memory (evolving dossier) tab.
 *
 * Reads /api/memory and renders three growing sections:
 *   1) Insights — durable facts the suite has learned about the candidate
 *      (from AI reflection after each application, or added manually here).
 *   2) Employers — per-company notes + how many times applied.
 *   3) Applications — an outcome log. Marking interview/offer is the signal the
 *      dossier uses to learn which phrasings win.
 *
 * All three agents read a compact digest of this when tailoring CVs and filling
 * forms, so the suite gets more "you" with every application.
 */

const CATEGORIES = ['preference', 'strength', 'achievement', 'style', 'constraint', 'other'];
const OUTCOMES = ['applied', 'interview', 'offer', 'rejected', 'no_response'];
const OUTCOME_LABEL = {
  applied: 'Applied', interview: 'Interview', offer: 'Offer', rejected: 'Rejected', no_response: 'No response'
};
const CAT_COLOR = {
  preference: '#60a5fa', strength: '#34d399', achievement: '#fbbf24',
  style: '#c084fc', constraint: '#f87171', other: '#94a3b8'
};

export default function CandidateMemory({ apiBase, toasts, refreshSignal }) {
  const [mem, setMem] = useState({ insights: [], employers: [], applications: [], lastDream: null });
  const [newInsight, setNewInsight] = useState('');
  const [newCat, setNewCat] = useState('strength');
  const [dreaming, setDreaming] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const m = await fetch(`${apiBase}/memory`).then((r) => r.json());
      setMem({
        version: m.version,
        updatedAt: m.updatedAt,
        insights: Array.isArray(m.insights) ? m.insights : [],
        employers: Array.isArray(m.employers) ? m.employers : [],
        applications: Array.isArray(m.applications) ? m.applications : [],
        lastDream: m.lastDream || null
      });
    } catch {
      /* server may be booting */
    }
  }, [apiBase]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 6000);
    return () => clearInterval(t);
  }, [refresh, refreshSignal]);

  const addInsight = async () => {
    const text = newInsight.trim();
    if (!text) return;
    try {
      const res = await fetch(`${apiBase}/memory/insight`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, category: newCat })
      });
      if (res.ok) {
        setNewInsight('');
        toasts?.success?.('Insight added to your dossier.');
        refresh();
      } else {
        const j = await res.json().catch(() => ({}));
        toasts?.error?.(j.error || 'Could not add that insight.');
      }
    } catch (e) {
      toasts?.error?.(e.message || 'Network error.');
    }
  };

  const deleteInsight = async (id) => {
    try {
      await fetch(`${apiBase}/memory/insight/${id}`, { method: 'DELETE' });
      refresh();
    } catch { /* ignore */ }
  };

  const setOutcome = async (jobId, outcome) => {
    try {
      const res = await fetch(`${apiBase}/memory/application/${jobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outcome })
      });
      if (res.ok) {
        toasts?.success?.('Outcome updated — the suite learns from this.');
        refresh();
      }
    } catch { /* ignore */ }
  };

  const dreamNow = async () => {
    setDreaming(true);
    try {
      const res = await fetch(`${apiBase}/memory/dream`, { method: 'POST' });
      const j = await res.json().catch(() => ({}));
      if (res.ok) {
        const r = j.result || {};
        toasts?.success?.(`Reflection done — reinforced ${r.reinforced || 0}, pruned ${r.pruned || 0}, added ${r.added || 0}.`);
        refresh();
      } else {
        toasts?.error?.(j.error || 'Could not run reflection.');
      }
    } catch (e) {
      toasts?.error?.(e.message || 'Network error.');
    } finally {
      setDreaming(false);
    }
  };

  const clearAll = async () => {
    if (!window.confirm('Wipe the entire candidate dossier? This cannot be undone.')) return;
    try {
      await fetch(`${apiBase}/memory`, { method: 'DELETE' });
      toasts?.success?.('Dossier cleared.');
      refresh();
    } catch { /* ignore */ }
  };

  const cardStyle = { background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: 10, padding: 16 };
  const { insights, employers, applications } = mem;
  const isEmpty = !insights.length && !employers.length && !applications.length;

  return (
    <div className="glass-panel fade-in" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="flex-between" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h3 style={{ fontSize: 18 }}><Brain size={18} style={{ verticalAlign: -3, marginRight: 6 }} />Candidate Memory</h3>
          <p className="muted" style={{ fontSize: 12, marginTop: 2 }}>
            A dossier that grows with every application. All three agents read it to make your CVs, cover letters and form answers more &quot;you&quot; over time.
          </p>
          {mem.lastDream?.at && (
            <p className="hint" style={{ fontSize: 11, marginTop: 4 }}>
              <Moon size={11} style={{ verticalAlign: -1, marginRight: 4 }} />
              Last reflected {new Date(mem.lastDream.at).toLocaleString()} — reinforced {mem.lastDream.reinforced || 0}, pruned {mem.lastDream.pruned || 0}, added {mem.lastDream.added || 0}.
            </p>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-secondary" onClick={dreamNow} disabled={dreaming} title="Review your application outcomes and curate this dossier (one AI call)">
            {dreaming ? <Loader2 size={13} className="spin" /> : <Moon size={13} />} {dreaming ? 'Reflecting…' : 'Reflect now'}
          </button>
          <button className="btn-secondary" onClick={refresh}><RefreshCw size={13} /> Refresh</button>
          {!isEmpty && <button className="btn-danger" onClick={clearAll}><Trash2 size={13} /> Clear all</button>}
        </div>
      </div>

      {isEmpty && (
        <div style={{ ...cardStyle, textAlign: 'center', padding: 32 }}>
          <Sparkles size={22} color="var(--color-accent, #fbbf24)" />
          <p style={{ fontSize: 13, marginTop: 8 }}>Your dossier is empty.</p>
          <p className="hint" style={{ marginTop: 2 }}>
            It fills automatically as you apply (when AI reflection is on), or add an insight below to seed it.
          </p>
        </div>
      )}

      {/* Insights */}
      <section style={cardStyle}>
        <strong style={{ fontSize: 13 }}><Sparkles size={13} style={{ verticalAlign: -2, marginRight: 4 }} />Insights ({insights.length})</strong>
        <p className="hint" style={{ marginTop: 2, marginBottom: 12 }}>
          Durable, reusable facts about you. Learned from your applications or added by hand.
        </p>

        <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
          <select value={newCat} onChange={(e) => setNewCat(e.target.value)} style={{ fontSize: 12 }}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input
            type="text"
            placeholder="e.g. Prefers remote-first roles; strong in distributed systems"
            value={newInsight}
            onChange={(e) => setNewInsight(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addInsight(); }}
            style={{ flex: 1, minWidth: 220, fontSize: 12 }}
          />
          <button type="button" className="btn-primary btn-sm" onClick={addInsight}><Plus size={12} /> Add</button>
        </div>

        {insights.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {insights.slice().reverse().map((i) => (
              <div key={i.id} className="flex-between" style={{ gap: 8, alignItems: 'flex-start' }}>
                <div style={{ flex: 1, fontSize: 12 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5,
                    color: CAT_COLOR[i.category] || CAT_COLOR.other, marginRight: 8
                  }}>{i.category}</span>
                  <span style={{ color: 'var(--color-text, #e2e8f0)' }}>{i.text}</span>
                  {i.source === 'reflection' && <span className="hint" style={{ marginLeft: 6 }}>· auto-learned</span>}
                </div>
                <button type="button" className="btn-secondary btn-sm" title="Delete insight" onClick={() => deleteInsight(i.id)}>
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Employers */}
      {employers.length > 0 && (
        <section style={cardStyle}>
          <strong style={{ fontSize: 13 }}><Building2 size={13} style={{ verticalAlign: -2, marginRight: 4 }} />Employers ({employers.length})</strong>
          <p className="hint" style={{ marginTop: 2, marginBottom: 12 }}>
            Notes per company, surfaced when you next tailor or apply there.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {employers.slice().reverse().map((e) => (
              <div key={e.id}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text, #e2e8f0)' }}>
                  {e.company} <span className="hint">· {e.applications || 0} application{(e.applications || 0) === 1 ? '' : 's'}</span>
                </div>
                {(e.notes || []).map((n, idx) => (
                  <div key={idx} className="hint" style={{ marginLeft: 8 }}>– {n}</div>
                ))}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Applications */}
      {applications.length > 0 && (
        <section style={cardStyle}>
          <strong style={{ fontSize: 13 }}><ClipboardList size={13} style={{ verticalAlign: -2, marginRight: 4 }} />Application history ({applications.length})</strong>
          <p className="hint" style={{ marginTop: 2, marginBottom: 12 }}>
            Mark how each went. Interviews and offers tell the suite which of your answers and phrasings actually win.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {applications.slice().reverse().map((a) => (
              <div key={a.id} className="flex-between" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div style={{ fontSize: 12, color: 'var(--color-text, #e2e8f0)' }}>
                    {a.title || 'Role'}{a.company ? ` @ ${a.company}` : ''}
                  </div>
                  <div className="hint">
                    {a.appliedAt ? new Date(a.appliedAt).toLocaleDateString() : ''}
                    {a.transcript?.length ? ` · ${a.transcript.length} answer${a.transcript.length === 1 ? '' : 's'} captured` : ''}
                  </div>
                </div>
                <select
                  value={a.outcome || 'applied'}
                  onChange={(e) => setOutcome(a.jobId || a.id, e.target.value)}
                  style={{ fontSize: 12 }}
                >
                  {OUTCOMES.map((o) => <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>)}
                </select>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
