import { useState, useEffect, useCallback } from 'react';
import {
  Clock, Play, Trash2, Plus, RefreshCw, Zap, ShieldCheck, Power, Pencil, X, Send
} from 'lucide-react';

/**
 * Routines tab (T1) — unattended, recurring runs.
 *
 * A routine runs the Job Hunter on a schedule and can optionally auto-tailor the
 * top matches, so the user wakes up to application-ready packages. Routines
 * NEVER submit applications — they only find and prepare. The human always
 * reviews and applies (Apply Copilot stays a manual, supervised step).
 *
 * Every paid token of work is opt-in: "Find only" routines cost the least;
 * "Find & tailor" adds N tailoring calls per run (N is user-set and capped).
 */

const FREQ_LABEL = {
  daily: 'Every day',
  weekdays: 'Weekdays (Mon–Fri)',
  every_n_hours: 'Every few hours'
};

function emptyForm() {
  return {
    name: 'Morning job hunt',
    type: 'hunt_and_tailor',
    frequency: 'daily',
    timeOfDay: '07:00',
    everyHours: 6,
    autoTailorCount: 3,
    enabled: true,
    catchUp: true
  };
}

function scheduleSummary(r) {
  const s = r.schedule || {};
  if (s.frequency === 'every_n_hours') return `Every ${s.everyHours || 6}h`;
  const base = s.frequency === 'weekdays' ? 'Weekdays' : 'Daily';
  return `${base} at ${s.timeOfDay || '07:00'}`;
}

function fmt(ts) {
  if (!ts) return 'never';
  try { return new Date(ts).toLocaleString(); } catch { return ts; }
}

export default function Routines({ apiBase, toasts, jobs = [], onReview, refreshSignal }) {
  const [routines, setRoutines] = useState([]);
  const [form, setForm] = useState(emptyForm());
  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await fetch(`${apiBase}/routines`).then((r) => r.json());
      setRoutines(Array.isArray(data) ? data : []);
    } catch { /* server may be booting */ }
  }, [apiBase]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh, refreshSignal]);

  const openCreate = () => { setForm(emptyForm()); setEditingId(null); setShowForm(true); };
  const openEdit = (r) => {
    setForm({
      name: r.name,
      type: r.type,
      frequency: r.schedule?.frequency || 'daily',
      timeOfDay: r.schedule?.timeOfDay || '07:00',
      everyHours: r.schedule?.everyHours || 6,
      autoTailorCount: r.autoTailorCount ?? 3,
      enabled: r.enabled,
      catchUp: r.catchUp ?? true
    });
    setEditingId(r.id);
    setShowForm(true);
  };

  const buildPayload = () => ({
    name: form.name,
    type: form.type,
    enabled: form.enabled,
    catchUp: form.catchUp,
    autoTailorCount: Number(form.autoTailorCount) || 0,
    schedule: {
      frequency: form.frequency,
      timeOfDay: form.timeOfDay,
      everyHours: Number(form.everyHours) || 6
    }
  });

  const save = async () => {
    if (!form.name.trim()) { toasts?.error?.('Give your routine a name.'); return; }
    const url = editingId ? `${apiBase}/routines/${editingId}` : `${apiBase}/routines`;
    const method = editingId ? 'PATCH' : 'POST';
    try {
      const res = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildPayload())
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok) {
        toasts?.success?.(editingId ? 'Routine updated.' : 'Routine created.');
        setShowForm(false); setEditingId(null); refresh();
      } else {
        toasts?.error?.(j.error || 'Could not save routine.');
      }
    } catch (e) { toasts?.error?.(e.message || 'Network error.'); }
  };

  const toggleEnabled = async (r) => {
    try {
      await fetch(`${apiBase}/routines/${r.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !r.enabled })
      });
      refresh();
    } catch (e) { toasts?.error?.(e.message || 'Network error.'); }
  };

  const runNow = async (r) => {
    try {
      const res = await fetch(`${apiBase}/routines/${r.id}/run`, { method: 'POST' });
      const j = await res.json().catch(() => ({}));
      if (res.ok) toasts?.info?.(`"${r.name}" started. Watch the Activity Console for progress.`, 'Routine running');
      else toasts?.error?.(j.error || 'Could not start the routine.');
      refresh();
    } catch (e) { toasts?.error?.(e.message || 'Network error.'); }
  };

  const remove = async (r) => {
    try {
      await fetch(`${apiBase}/routines/${r.id}`, { method: 'DELETE' });
      toasts?.success?.('Routine deleted.');
      refresh();
    } catch (e) { toasts?.error?.(e.message || 'Network error.'); }
  };

  const STATUS_COLOR = { ok: '#34d399', running: '#fbbf24', error: '#f87171', skipped: '#94a3b8', idle: '#94a3b8' };

  // "Ready to apply" tray: tailored jobs queued by a routine.
  const ready = (jobs || []).filter((j) => j.status === 'tailored' && j.queuedByRoutine);

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Safety / what-this-does banner */}
      <div className="glass-panel" style={{ padding: 16, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <ShieldCheck size={20} color="var(--color-success, #34d399)" style={{ flexShrink: 0, marginTop: 2 }} />
        <div>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Routines find and prepare — they never apply for you.</div>
          <p className="muted" style={{ fontSize: 13, margin: 0, lineHeight: 1.6 }}>
            A routine runs the Job Hunter on your schedule and can auto-tailor the top matches, so you wake up to
            ready-to-send packages. It will <strong>never open the Apply Copilot or submit an application</strong> —
            you always review and click apply yourself. Runs happen only while the app is open; a missed daily run
            catches up the next time you open it.
          </p>
        </div>
      </div>

      {/* Header + new button */}
      <div className="flex-between" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h3 style={{ fontSize: 18 }}>Your routines</h3>
          <p className="muted" style={{ fontSize: 12 }}>Scheduled, unattended hunts. Toggle features per routine to control API cost.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-secondary btn-xs" onClick={refresh}><RefreshCw size={12} /> Refresh</button>
          <button className="btn-primary btn-xs" onClick={openCreate}><Plus size={12} /> New routine</button>
        </div>
      </div>

      {/* Create / edit form */}
      {showForm && (
        <div className="glass-panel" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="flex-between">
            <h4 style={{ fontSize: 15 }}>{editingId ? 'Edit routine' : 'New routine'}</h4>
            <button className="btn-ghost btn-xs" onClick={() => { setShowForm(false); setEditingId(null); }}><X size={14} /></button>
          </div>

          <div>
            <label>Name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Morning job hunt" />
          </div>

          <div className="grid-2">
            <div>
              <label>What it does</label>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                <option value="hunt">Find jobs only (cheapest)</option>
                <option value="hunt_and_tailor">Find &amp; tailor top matches</option>
                <option value="dream">Reflect &amp; learn (Dreaming)</option>
              </select>
              <span className="hint">
                {form.type === 'hunt' && 'Just discovers and saves new jobs. No tailoring cost.'}
                {form.type === 'hunt_and_tailor' && 'Discovers jobs, then writes a tailored CV + cover letter for the top matches.'}
                {form.type === 'dream' && 'No hunting. Reviews your past application outcomes and curates your Candidate Memory — strengthens what wins interviews, drops noise. One small AI call. Best run nightly.'}
              </span>
            </div>
            <div>
              <label>Schedule</label>
              <select value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })}>
                <option value="daily">Every day</option>
                <option value="weekdays">Weekdays only (Mon–Fri)</option>
                <option value="every_n_hours">Every few hours</option>
              </select>
            </div>
          </div>

          <div className="grid-2">
            {form.frequency === 'every_n_hours' ? (
              <div>
                <label>Run every (hours)</label>
                <input type="number" min="1" max="24" value={form.everyHours}
                  onChange={(e) => setForm({ ...form, everyHours: e.target.value })} />
                <span className="hint">Minimum 1 hour. More frequent = more API spend.</span>
              </div>
            ) : (
              <div>
                <label>Time of day</label>
                <input type="time" value={form.timeOfDay}
                  onChange={(e) => setForm({ ...form, timeOfDay: e.target.value })} />
                <span className="hint">Local time. Catches up on open if missed.</span>
              </div>
            )}

            {form.type === 'hunt_and_tailor' && (
              <div>
                <label>How many top matches to tailor</label>
                <input type="number" min="0" max="10" value={form.autoTailorCount}
                  onChange={(e) => setForm({ ...form, autoTailorCount: e.target.value })} />
                <span className="hint">Each one is a separate AI call. 0–10. Keep it low to control cost.</span>
              </div>
            )}
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', margin: 0 }}>
            <input type="checkbox" checked={form.catchUp} style={{ width: 16, height: 16 }}
              onChange={(e) => setForm({ ...form, catchUp: e.target.checked })} />
            <span>Catch up on missed runs when I reopen the app</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', margin: 0 }}>
            <input type="checkbox" checked={form.enabled} style={{ width: 16, height: 16 }}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
            <span>Enabled</span>
          </label>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button className="btn-ghost" onClick={() => { setShowForm(false); setEditingId(null); }}>Cancel</button>
            <button className="btn-primary" onClick={save}><Clock size={14} /> {editingId ? 'Save changes' : 'Create routine'}</button>
          </div>
        </div>
      )}

      {/* Routine list */}
      {routines.length === 0 && !showForm && (
        <div className="glass-panel" style={{ padding: 32, textAlign: 'center' }}>
          <Clock size={28} className="muted" style={{ opacity: 0.6 }} />
          <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>No routines yet. Create one to let SA-JAS hunt while you sleep.</p>
        </div>
      )}

      {routines.map((r) => (
        <div key={r.id} className="glass-panel" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10, opacity: r.enabled ? 1 : 0.6 }}>
          <div className="flex-between" style={{ flexWrap: 'wrap', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Zap size={16} color="var(--color-accent, #818cf8)" />
              <div>
                <div style={{ fontWeight: 700 }}>{r.name}</div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {scheduleSummary(r)} · {r.type === 'hunt_and_tailor' ? `Find & tailor ${r.autoTailorCount}` : r.type === 'dream' ? 'Reflect & learn' : 'Find only'}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span className="badge" style={{ background: 'transparent', border: `1px solid ${STATUS_COLOR[r.lastStatus] || '#94a3b8'}`, color: STATUS_COLOR[r.lastStatus] || '#94a3b8' }}>
                {r.lastStatus === 'running' ? 'Running…' : (r.lastStatus || 'idle')}
              </span>
              <button className="btn-ghost btn-xs" title={r.enabled ? 'Disable' : 'Enable'} onClick={() => toggleEnabled(r)}>
                <Power size={13} color={r.enabled ? 'var(--color-success, #34d399)' : '#94a3b8'} />
              </button>
              <button className="btn-ghost btn-xs" title="Edit" onClick={() => openEdit(r)}><Pencil size={13} /></button>
              <button className="btn-ghost btn-xs" title="Delete" onClick={() => remove(r)}><Trash2 size={13} /></button>
            </div>
          </div>

          <div className="flex-between" style={{ flexWrap: 'wrap', gap: 10, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
            <div className="muted" style={{ fontSize: 12 }}>
              Last run: {fmt(r.lastRun)}
              {r.lastResult && (r.lastStatus === 'ok' || r.lastStatus === 'error') && (
                r.type === 'dream'
                  ? <>{r.lastResult.note ? ` · ${r.lastResult.note}` : ''}{r.lastResult.error ? ` · ${r.lastResult.error}` : ''}</>
                  : <> · saved {r.lastResult.totalSaved ?? 0}, tailored {r.lastResult.tailored ?? 0}
                      {r.lastResult.note ? ` · ${r.lastResult.note}` : ''}
                      {r.lastResult.error ? ` · ${r.lastResult.error}` : ''}
                    </>
              )}
            </div>
            <button className="btn-secondary btn-xs" onClick={() => runNow(r)} disabled={r.lastStatus === 'running'}>
              <Play size={12} /> Run now
            </button>
          </div>
        </div>
      ))}

      {/* Ready-to-apply tray */}
      {ready.length > 0 && (
        <div className="glass-panel" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <h4 style={{ fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Send size={15} /> Ready to apply ({ready.length})
            </h4>
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>
              Prepared by your routines. Review each, then apply yourself with the Copilot.
            </p>
          </div>
          {ready.map((j) => (
            <div key={j.id} className="flex-between" style={{ borderTop: '1px solid var(--border)', paddingTop: 10, flexWrap: 'wrap', gap: 8 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{j.title}</div>
                <div className="muted" style={{ fontSize: 12 }}>{j.company}{j.location ? ` · ${j.location}` : ''} · via {j.routineName || 'routine'}</div>
              </div>
              {onReview && (
                <button className="btn-primary btn-xs" onClick={() => onReview(j)}>Review &amp; apply</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
