import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, ExternalLink, Loader2, Send, ShieldCheck } from 'lucide-react';
import { buildApplyPacket } from '@sajas/core/apply';
import Dialog from '../../Dialog.jsx';
import { DEMO_QUESTION } from './fixtures.js';

const API_BASE = import.meta.env.VITE_SAJAS_API_BASE || 'http://localhost:5000/api';
const SITE = 'fable-fintech.test';
const BUTTON_LABEL = 'Send application';

function reducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export default function SimulatedCopilot({ profile, jobs, answerBank = [], onJobsChanged, toasts }) {
  const job = useMemo(
    () => jobs.find((entry) => entry.company === 'Fable Fintech' && entry.tailoredCvText)
      || jobs.find((entry) => entry.tailoredCvText)
      || null,
    [jobs]
  );
  const [stage, setStage] = useState('idle');
  const [answer, setAnswer] = useState('');
  const [visible, setVisible] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const confirmRef = useRef(null);

  const packet = useMemo(() => {
    if (!job) return null;
    return buildApplyPacket({
      profile: profile || {},
      job,
      answerBank,
      supportingDocs: [
        ...(job.tailoredCvText ? [{ key: 'cv', label: 'Tailored CV', fileName: '', available: true }] : []),
        ...(job.tailoredCoverLetterText ? [{ key: 'cover-letter', label: 'Cover letter', fileName: '', available: true }] : [])
      ]
    });
  }, [profile, job, answerBank]);

  const fields = packet ? [...packet.identity, ...packet.questions] : [];

  useEffect(() => {
    if (stage !== 'form') return undefined;
    if (reducedMotion()) { setVisible(fields.length); return undefined; }
    setVisible(0);
    if (!fields.length) return undefined;
    const timer = setInterval(() => {
      setVisible((count) => {
        if (count >= fields.length) { clearInterval(timer); return count; }
        return count + 1;
      });
    }, 150);
    return () => clearInterval(timer);
  }, [stage, fields.length]);

  if (!job || !packet) {
    return (
      <section className="panel" style={{ padding: 24 }}>
        <h3 style={{ fontSize: 18, marginBottom: 8 }}>Simulated apply copilot</h3>
        <p className="muted">Tailor a fictional job first, then come back to watch the copilot fill its form.</p>
      </section>
    );
  }

  async function submit() {
    setConfirmOpen(false);
    setBusy(true);
    try {
      const response = await fetch(`${API_BASE}/demo/apply/${job.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || data.error || 'The simulated submission failed.');
      setReceipt(data.application);
      setStage('receipt');
      onJobsChanged?.();
      toasts?.success?.('Simulated application recorded. Nothing was sent to an employer.');
      window.dispatchEvent(new CustomEvent('sajas:demo-step', { detail: 'copilot' }));
    } catch (error) {
      toasts?.error?.(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" style={{ padding: 24 }} data-testid="simulated-copilot">
      <h3 style={{ fontSize: 18 }}>
        Simulated apply copilot <span className="badge badge-warning">Simulated</span>
      </h3>
      <p className="muted" style={{ fontSize: 13, marginTop: 4, marginBottom: 18 }}>
        A fictional portal inside this page. Nothing is sent to an employer and no site outside this origin is opened.
      </p>

      {stage === 'idle' && (
        <>
          <p className="tiny" style={{ marginBottom: 12 }}>
            Target: <strong>{job.title}</strong> at {job.company}
          </p>
          <button type="button" className="btn-primary" data-testid="open-simulated-portal" onClick={() => setStage('form')}>
            <ExternalLink size={14} /> Open the simulated portal
          </button>
        </>
      )}

      {stage === 'form' && (
        <div data-testid="demo-form" style={{ display: 'grid', gap: 10 }}>
          <p className="tiny">{SITE} · fictional application form</p>
          {fields.slice(0, visible).map((field) => (
            <div key={`${field.key}-${field.label}`} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>
              <span className="tiny">{field.label}</span>
              <p style={{ margin: 0 }}>{field.value}</p>
            </div>
          ))}
          {visible >= fields.length && (
            <button type="button" className="btn-primary" data-testid="demo-form-continue" onClick={() => setStage('question')} style={{ justifySelf: 'start', marginTop: 8 }}>
              Continue
            </button>
          )}
        </div>
      )}

      {stage === 'question' && (
        <div style={{ display: 'grid', gap: 10 }}>
          <label htmlFor="demo-question">{DEMO_QUESTION}</label>
          <textarea
            id="demo-question"
            data-testid="demo-question"
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            style={{ minHeight: 80, width: '100%' }}
          />
          <p className="hint">The copilot pauses here until you answer.</p>
          <button
            type="button"
            className="btn-primary"
            data-testid="demo-question-continue"
            disabled={!answer.trim()}
            onClick={() => setStage('review')}
            style={{ justifySelf: 'start' }}
          >
            Review application
          </button>
        </div>
      )}

      {stage === 'review' && (
        <div data-testid="demo-review" style={{ display: 'grid', gap: 14 }}>
          <p className="tiny">{SITE} · final review</p>
          {[...fields, { key: 'answer', label: DEMO_QUESTION, value: answer }].map((field) => (
            <div key={`${field.key}-${field.label}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>
              <span className="tiny">{field.label}</span>
              <span className="tiny" style={{ textAlign: 'right' }}>{field.value}</span>
            </div>
          ))}
          <div>
            <span className="tiny">Documents</span>
            {packet.documents.filter((doc) => doc.available).map((doc) => (
              <p key={doc.key} className="tiny" style={{ margin: '2px 0' }}>{doc.label}</p>
            ))}
          </div>
          <button type="button" className="btn-primary" data-testid="demo-review-submit" onClick={() => setConfirmOpen(true)} style={{ justifySelf: 'start' }}>
            <Send size={14} /> Submit application
          </button>
        </div>
      )}

      {stage === 'receipt' && receipt && (
        <div data-testid="demo-receipt" role="status" style={{ border: '1px solid var(--color-success)', borderRadius: 8, padding: 16 }}>
          <strong style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <CheckCircle2 size={16} color="var(--color-success)" /> Simulated receipt
          </strong>
          <p className="tiny" style={{ marginTop: 8 }}>Nothing was sent to an employer.</p>
          <ul className="tiny" style={{ margin: '8px 0 0 16px', padding: 0 }}>
            <li>{job.title} at {job.company}</li>
            <li>Site: {receipt.site}</li>
            <li>{receipt.fields.length} field(s), {receipt.documents.length} document(s)</li>
            <li>Recorded as {receipt.delivery} / {receipt.submittedBy}</li>
          </ul>
        </div>
      )}

      <Dialog
        open={confirmOpen}
        labelledBy="demo-confirm-title"
        onClose={busy ? () => {} : () => setConfirmOpen(false)}
        initialFocus={confirmRef}
      >
        <h3 id="demo-confirm-title" style={{ fontSize: 18, marginBottom: 8 }}>Confirm this simulated application</h3>
        <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
          The copilot will record one simulated submission. Nothing leaves this page.
        </p>
        <div className="tiny" style={{ display: 'grid', gap: 4, marginBottom: 16 }}>
          <span><strong>{job.title}</strong> at {job.company}</span>
          <span>Site: {SITE}</span>
          <span>Button: {BUTTON_LABEL}</span>
          <span>{fields.length + 1} field(s) filled. {packet.documents.filter((doc) => doc.available).length} document(s) attached.</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button type="button" className="btn-ghost" onClick={() => setConfirmOpen(false)} disabled={busy}>Keep reviewing</button>
          <button type="button" className="btn-primary" data-testid="demo-confirm" ref={confirmRef} onClick={submit} disabled={busy}>
            {busy ? <Loader2 size={13} className="spin" /> : <ShieldCheck size={13} />} Confirm and submit
          </button>
        </div>
      </Dialog>
    </section>
  );
}
