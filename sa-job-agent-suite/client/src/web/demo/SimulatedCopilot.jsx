import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BadgeCheck, CalendarClock, CheckCircle2, ExternalLink, FileText, Globe, Loader2, Lock, MapPin, Send, ShieldCheck
} from 'lucide-react';
import { buildApplyPacket } from '@sajas/core/apply';
import Dialog from '../../Dialog.jsx';
import { DEMO_QUESTION } from './fixtures.js';

const API_BASE = import.meta.env.VITE_SAJAS_API_BASE || 'http://localhost:5000/api';
const BUTTON_LABEL = 'Send application';

function reducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function hostOf(job) {
  try {
    return new URL(job?.applyUrl).hostname;
  } catch {
    return 'example.test';
  }
}

function PortalChrome({ site, children }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: 'var(--surface)' }}>
      <div
        className="tiny"
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
          background: 'var(--bg-surface-2)', borderBottom: '1px solid var(--border)'
        }}
      >
        <Lock size={12} aria-hidden="true" />
        <span style={{ fontFamily: 'monospace' }}>{site}/careers/apply</span>
        <span className="badge badge-warning" style={{ marginLeft: 'auto' }}>Simulated</span>
      </div>
      {children}
      <div
        className="tiny muted"
        style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', background: 'var(--bg-surface-2)' }}
      >
        A fictional company site rendered inside this page. The real copilot opens the actual portal and pauses before every action.
      </div>
    </div>
  );
}

function PortalHeader({ job }) {
  return (
    <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--border)' }}>
      <div className="flex-between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <strong style={{ fontSize: 16 }}>{job.company}</strong>
        <nav className="tiny muted" style={{ display: 'flex', gap: 14 }}>
          <span>Jobs</span><span>Teams</span><span>Life here</span>
        </nav>
      </div>
      <p style={{ margin: '10px 0 4px', fontWeight: 600 }}>{job.title}</p>
      <div className="tiny muted" style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
          <MapPin size={12} aria-hidden="true" /> {job.location || 'South Africa'}
        </span>
        <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
          <CalendarClock size={12} aria-hidden="true" /> Posted {job.datePosted || 'recently'}
        </span>
        <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
          <FileText size={12} aria-hidden="true" /> {job.source || 'Fictional board'}
        </span>
      </div>
    </div>
  );
}

function StepBar({ current }) {
  const steps = ['Your details', 'Questions', 'Review', 'Receipt'];
  return (
    <ol className="tiny" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, listStyle: 'none', padding: '10px 18px', margin: 0, borderBottom: '1px solid var(--border)' }}>
      {steps.map((label, index) => (
        <li
          key={label}
          style={{
            padding: '2px 10px', borderRadius: 999,
            border: '1px solid var(--border)',
            background: index === current ? 'var(--color-accent-soft)' : 'transparent',
            fontWeight: index === current ? 600 : 400,
            color: index < current ? 'var(--text-muted)' : 'inherit'
          }}
        >
          {index + 1}. {label}
        </li>
      ))}
    </ol>
  );
}

function FieldRow({ label, value }) {
  return (
    <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>
      <span className="tiny muted">{label}</span>
      <p style={{ margin: '2px 0 0' }}>{value}</p>
    </div>
  );
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

  const site = useMemo(() => hostOf(job), [job]);

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

  const sections = useMemo(() => {
    if (!packet) return [];
    return [
      { key: 'identity', title: 'Your details', fields: packet.identity },
      { key: 'profile', title: 'Eligibility and availability', fields: packet.questions.filter((entry) => entry.source === 'profile') },
      { key: 'bank', title: 'More questions from this employer', fields: packet.questions.filter((entry) => entry.source === 'answer-bank') }
    ].filter((section) => section.fields.length);
  }, [packet]);

  const fields = useMemo(() => sections.flatMap((section) => section.fields), [sections]);
  const documents = packet ? packet.documents.filter((doc) => doc.available) : [];

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
    }, 90);
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

  const stageIndex = { idle: 0, form: 0, question: 1, review: 2, receipt: 3 }[stage] ?? 0;
  const answered = [...fields, { key: 'answer', label: DEMO_QUESTION, value: answer }];

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
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <span className="badge"><Globe size={12} aria-hidden="true" style={{ marginRight: 4 }} />{site}</span>
            <span className="badge">{fields.length} answers ready</span>
            <span className="badge">{documents.length} documents ready</span>
          </div>
          <p className="tiny" style={{ marginBottom: 12 }}>
            Target: <strong>{job.title}</strong> at {job.company}
          </p>
          <button type="button" className="btn-primary" data-testid="open-simulated-portal" onClick={() => setStage('form')}>
            <ExternalLink size={14} /> Open the simulated portal
          </button>
        </>
      )}

      {stage === 'form' && (
        <PortalChrome site={site}>
          <PortalHeader job={job} />
          <StepBar current={0} />
          <div data-testid="demo-form" style={{ display: 'grid', gap: 12, padding: '14px 18px' }}>
            <p className="tiny muted" style={{ margin: 0 }}>
              The copilot is filling this form from your profile and saved answers.
            </p>
            {sections.map((section) => {
              const shown = section.fields.filter((field) => fields.indexOf(field) < visible);
              if (!shown.length) return null;
              return (
                <div key={section.key} style={{ display: 'grid', gap: 8 }}>
                  <span className="tiny" style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>{section.title}</span>
                  {shown.map((field) => (
                    <FieldRow key={`${field.key}-${field.label}`} label={field.label} value={field.value} />
                  ))}
                </div>
              );
            })}
            {visible >= fields.length && (
              <button type="button" className="btn-primary" data-testid="demo-form-continue" onClick={() => setStage('question')} style={{ justifySelf: 'start', marginTop: 6 }}>
                Continue
              </button>
            )}
          </div>
        </PortalChrome>
      )}

      {stage === 'question' && (
        <PortalChrome site={site}>
          <PortalHeader job={job} />
          <StepBar current={1} />
          <div style={{ display: 'grid', gap: 10, padding: '14px 18px' }}>
            <label htmlFor="demo-question">{DEMO_QUESTION}</label>
            <textarea
              id="demo-question"
              data-testid="demo-question"
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              placeholder="One or two sentences is plenty."
              style={{ minHeight: 80, width: '100%' }}
            />
            <p className="hint" style={{ margin: 0 }}>
              The copilot pauses here until you answer. Your reply is saved with the demo application only.
            </p>
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
        </PortalChrome>
      )}

      {stage === 'review' && (
        <PortalChrome site={site}>
          <PortalHeader job={job} />
          <StepBar current={2} />
          <div data-testid="demo-review" style={{ display: 'grid', gap: 14, padding: '14px 18px' }}>
            <p className="tiny muted" style={{ margin: 0 }}>
              Check every field. Submitting records a simulated application in your tracker.
            </p>
            {sections.map((section) => (
              <div key={section.key} style={{ display: 'grid', gap: 6 }}>
                <span className="tiny" style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>{section.title}</span>
                {section.fields.map((field) => (
                  <div key={`${field.key}-${field.label}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>
                    <span className="tiny muted">{field.label}</span>
                    <span className="tiny" style={{ textAlign: 'right' }}>{field.value}</span>
                  </div>
                ))}
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>
              <span className="tiny muted">{DEMO_QUESTION}</span>
              <span className="tiny" style={{ textAlign: 'right' }}>{answer}</span>
            </div>
            <div>
              <span className="tiny muted">Documents</span>
              {documents.map((doc) => (
                <p key={doc.key} className="tiny" style={{ margin: '2px 0', display: 'flex', gap: 6, alignItems: 'center' }}>
                  <BadgeCheck size={12} aria-hidden="true" /> {doc.label} (sample, not a real file)
                </p>
              ))}
            </div>
            <button type="button" className="btn-primary" data-testid="demo-review-submit" onClick={() => setConfirmOpen(true)} style={{ justifySelf: 'start' }}>
              <Send size={14} /> Submit application
            </button>
          </div>
        </PortalChrome>
      )}

      {stage === 'receipt' && receipt && (
        <div data-testid="demo-receipt" role="status" style={{ border: '1px solid var(--color-success)', borderRadius: 10, padding: 16, display: 'grid', gap: 10 }}>
          <strong style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <CheckCircle2 size={16} color="var(--color-success)" /> Simulated receipt
          </strong>
          <p className="tiny" style={{ margin: 0 }}>Nothing was sent to an employer.</p>
          <div className="tiny" style={{ display: 'grid', gap: 4 }}>
            <span><strong>{job.title}</strong> at {job.company}</span>
            <span>Site: {receipt.site}</span>
            <span>{receipt.fields.length} field(s) filled, {receipt.documents.length} document(s) attached</span>
            <span>Recorded as {receipt.delivery} / {receipt.submittedBy}</span>
            <span>Reference: {String(receipt.id || job.id).slice(0, 8)}</span>
          </div>
          <div className="tiny muted" style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
            The tracker now shows this job as applied and the demo memory has one more application.
            No network request left this page.
          </div>
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
          <span>Site: {site}</span>
          <span>Button: {BUTTON_LABEL}</span>
          <span>{answered.length} field(s) filled. {documents.length} document(s) attached.</span>
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
