import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BadgeCheck, CalendarClock, CheckCircle2, ExternalLink, FileText, Globe, Loader2, Lock, MapPin, Send, ShieldCheck
} from 'lucide-react';
import { buildApplyPacketV2 } from '@sajas/core/apply';
import Dialog from '../../Dialog.jsx';
import { createCvPdf, safePdfFileName } from '../pdf/cvPdf.js';
import { base64ToBytes } from '../documents.js';
import { DEMO_QUESTION } from './persona.js';
import { portalSections, withEdits, submissionFields } from './portalModel.js';

const API_BASE = import.meta.env.VITE_SAJAS_API_BASE || 'http://localhost:5000/api';
const BUTTON_LABEL = 'Send application';
const REVEAL_MS = 55;

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

function testIdFor(key) {
  return String(key).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const SELECT_OPTIONS = {
  rightToWorkSA: ['Yes, South African citizen', 'Yes, permanent resident', 'No'],
  willingToRelocate: ['Yes, within South Africa', 'No'],
  driversLicense: ['Code B', 'Code EB', 'Code C', 'None'],
  ownVehicle: ['Yes', 'No'],
  creditCheckConsent: ['Yes', 'No']
};

function FieldControl({ field, value, onChange }) {
  const id = `demo-field-${testIdFor(field.key)}`;
  const options = SELECT_OPTIONS[field.key];
  if (options) {
    const all = value && !options.includes(value) ? [value, ...options] : options;
    return (
      <>
        <label className="tiny" htmlFor={id}>{field.label}</label>
        <select
          id={id}
          data-testid={id}
          value={value}
          onChange={(event) => onChange(field.key, event.target.value)}
        >
          {all.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </>
    );
  }
  return (
    <>
      <label className="tiny" htmlFor={id}>{field.label}</label>
      <input
        id={id}
        data-testid={id}
        value={value}
        onChange={(event) => onChange(field.key, event.target.value)}
      />
    </>
  );
}

function PortalChrome({ site, children }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: 'var(--bg-surface)' }}>
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
          <FileText size={12} aria-hidden="true" /> {job.sector || 'Fictional employer'}
        </span>
        <span className="badge">{job.salaryBand || 'Salary on request'}</span>
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

export default function SimulatedCopilot({ profile, jobs, answerBank = [], onJobsChanged, toasts }) {
  const job = useMemo(
    () => jobs.find((entry) => entry.applyDemo && entry.tailoredCvText)
      || jobs.find((entry) => entry.tailoredCvText)
      || null,
    [jobs]
  );
  const [stage, setStage] = useState('idle');
  const [packet, setPacket] = useState(null);
  const [attachments, setAttachments] = useState([]);
  const [edits, setEdits] = useState({});
  const [answer, setAnswer] = useState('');
  const [visible, setVisible] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const confirmRef = useRef(null);

  const site = useMemo(() => hostOf(job), [job]);
  const employerKeys = useMemo(
    () => new Set((Array.isArray(job?.questions) ? job.questions : []).map((question) => `bank:${question.normalized}`)),
    [job]
  );
  const sections = useMemo(() => portalSections(packet?.fields || [], employerKeys), [packet, employerKeys]);
  const section = (id) => sections.find((entry) => entry.id === id) || { fields: [] };

  useEffect(() => {
    if (stage !== 'form') return undefined;
    const total = section('identity').fields.length + section('eligibility').fields.length;
    if (reducedMotion()) { setVisible(total); return undefined; }
    setVisible(0);
    if (!total) return undefined;
    const timer = setInterval(() => {
      setVisible((count) => {
        if (count >= total) { clearInterval(timer); return count; }
        return count + 1;
      });
    }, REVEAL_MS);
    return () => clearInterval(timer);
  }, [stage, sections]);

  async function prepare() {
    if (!job || preparing) return;
    setPreparing(true);
    try {
      const listResponse = await fetch(`${API_BASE}/documents`, { cache: 'no-store' });
      const documents = listResponse.ok ? await listResponse.json() : [];
      const nextAttachments = [];
      if (job.tailoredCvText) {
        nextAttachments.push({
          key: 'tailored-cv', kind: 'tailored-cv', label: 'Tailored CV',
          fileName: safePdfFileName(`${job.title}-cv`), mime: 'application/pdf',
          bytes: await createCvPdf({ text: job.tailoredCvText, title: `${job.title} CV` })
        });
      }
      if (job.tailoredCoverLetterText) {
        nextAttachments.push({
          key: 'tailored-letter', kind: 'document', label: 'Tailored cover letter',
          fileName: safePdfFileName(`${job.title}-cover-letter`), mime: 'application/pdf',
          bytes: await createCvPdf({ text: job.tailoredCoverLetterText, title: `${job.title} cover letter` })
        });
      }
      for (const document of Array.isArray(documents) ? documents : []) {
        const fileResponse = await fetch(`${API_BASE}/documents/${document.id}/file`, { cache: 'no-store' });
        if (!fileResponse.ok) throw new Error(`Could not read the sample document ${document.label}.`);
        const body = await fileResponse.json();
        nextAttachments.push({
          key: document.id, kind: 'document', label: document.label,
          fileName: body.fileName, mime: body.mime, bytes: base64ToBytes(body.dataBase64)
        });
      }
      const jobBank = [
        ...answerBank,
        ...(Array.isArray(job.questions) ? job.questions.map((question, index) => ({
          id: `demo-job-question-${index}`, ...question
        })) : [])
      ];
      const nextPacket = buildApplyPacketV2({
        profile: profile || {},
        job,
        answerBank: jobBank,
        attachments: nextAttachments,
        documents: nextAttachments.map((attachment) => ({
          key: attachment.key, label: attachment.label,
          fileName: attachment.fileName, available: true
        }))
      });
      setPacket(nextPacket);
      setAttachments(nextAttachments);
      setEdits(Object.fromEntries(nextPacket.fields.map((field) => [field.key, field.value])));
      setStage('form');
    } catch (error) {
      toasts?.error?.(error.message || 'The simulated portal could not be prepared.');
    } finally {
      setPreparing(false);
    }
  }

  const edited = useMemo(
    () => withEdits(packet?.fields || [], edits),
    [packet, edits]
  );

  async function submit() {
    if (!packet) return;
    setConfirmOpen(false);
    setBusy(true);
    try {
      const response = await fetch(`${API_BASE}/demo/apply/${job.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: submissionFields(edited),
          answer,
          documents: attachments.map(({ key, label, fileName }) => ({ key, label, fileName }))
        })
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

  if (!job) {
    return (
      <section className="panel" style={{ padding: 24 }}>
        <h3 style={{ fontSize: 18, marginBottom: 8 }}>Simulated apply copilot</h3>
        <p className="muted">Tailor a fictional job first, then come back to watch the copilot fill its portal.</p>
      </section>
    );
  }

  const stageIndex = { idle: 0, form: 0, questions: 1, review: 2, receipt: 3 }[stage] ?? 0;
  const details = section('identity').fields;
  const eligibility = section('eligibility').fields;
  const employerQuestions = section('employer').fields;
  const visibleFields = [...details, ...eligibility].slice(0, visible);
  const readyForContinue = visible >= details.length + eligibility.length;
  const change = (key, value) => setEdits((current) => ({ ...current, [key]: value }));

  return (
    <section className="panel" style={{ padding: 24 }} data-testid="simulated-copilot">
      <h3 style={{ fontSize: 18 }}>
        Simulated apply copilot <span className="badge badge-warning">Simulated</span>
      </h3>
      <p className="muted" style={{ fontSize: 13, marginTop: 4, marginBottom: 18 }}>
        A fictional portal inside this page, filled from the demo persona. Nothing is sent to an employer and no site outside this origin is opened.
      </p>

      {stage === 'idle' && (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <span className="badge"><Globe size={12} aria-hidden="true" style={{ marginRight: 4 }} />{site}</span>
            {packet && <span className="badge">{packet.fields.length} answers ready</span>}
            {attachments.length > 0 && <span className="badge">{attachments.length} documents ready</span>}
          </div>
          <p className="tiny" style={{ marginBottom: 12 }}>
            Target: <strong>{job.title}</strong> at {job.company} <span className="muted">({job.salaryBand})</span>
          </p>
          <button type="button" className="btn-primary" data-testid="open-simulated-portal" disabled={preparing} onClick={prepare}>
            {preparing ? <Loader2 size={14} className="spin" /> : <ExternalLink size={14} />}
            {preparing ? ' Preparing the packet...' : ' Open the simulated portal'}
          </button>
        </>
      )}

      {stage === 'form' && packet && (
        <PortalChrome site={site}>
          <PortalHeader job={job} />
          <StepBar current={0} />
          <div data-testid="demo-form" style={{ display: 'grid', gap: 12, padding: '14px 18px' }}>
            <p className="tiny muted" style={{ margin: 0 }}>
              The copilot filled these controls from your profile. Edit anything that is wrong before you continue.
            </p>
            {details.length > 0 && (
              <div style={{ display: 'grid', gap: 8 }}>
                <span className="tiny" style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>Your details</span>
                {visibleFields.filter((field) => details.includes(field)).map((field) => (
                  <FieldControl key={field.key} field={field} value={field.value} onChange={change} />
                ))}
              </div>
            )}
            {eligibility.length > 0 && (
              <div style={{ display: 'grid', gap: 8 }}>
                <span className="tiny" style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>Eligibility and availability</span>
                {visibleFields.filter((field) => eligibility.includes(field)).map((field) => (
                  <FieldControl key={field.key} field={field} value={field.value} onChange={change} />
                ))}
              </div>
            )}
            {readyForContinue && (
              <button type="button" className="btn-primary" data-testid="demo-form-continue" onClick={() => setStage('questions')} style={{ justifySelf: 'start', marginTop: 6 }}>
                Continue
              </button>
            )}
          </div>
        </PortalChrome>
      )}

      {stage === 'questions' && packet && (
        <PortalChrome site={site}>
          <PortalHeader job={job} />
          <StepBar current={1} />
          <div style={{ display: 'grid', gap: 12, padding: '14px 18px' }}>
            {employerQuestions.length > 0 && (
              <div style={{ display: 'grid', gap: 8 }}>
                <span className="tiny" style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>This employer's questions</span>
                {employerQuestions.map((field) => (
                  <FieldControl key={field.key} field={field} value={field.value} onChange={change} />
                ))}
              </div>
            )}
            <label className="tiny" htmlFor="demo-question">{DEMO_QUESTION}</label>
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

      {stage === 'review' && packet && (
        <PortalChrome site={site}>
          <PortalHeader job={job} />
          <StepBar current={2} />
          <div data-testid="demo-review" style={{ display: 'grid', gap: 14, padding: '14px 18px' }}>
            <p className="tiny muted" style={{ margin: 0 }}>
              Check every field. Submitting records a simulated application in your tracker.
            </p>
            {sections.map((entry) => (
              <div key={entry.id} style={{ display: 'grid', gap: 6 }}>
                <span className="tiny" style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>{entry.title}</span>
                {entry.fields.map((field) => {
                  const value = edits[field.key] ?? field.value;
                  return (
                    <div key={field.key} data-testid={`demo-review-row-${testIdFor(field.key)}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>
                      <span className="tiny muted">{field.label}</span>
                      <span className="tiny" style={{ textAlign: 'right' }}>{value}</span>
                    </div>
                  );
                })}
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>
              <span className="tiny muted">{DEMO_QUESTION}</span>
              <span className="tiny" style={{ textAlign: 'right' }}>{answer}</span>
            </div>
            <div>
              <span className="tiny muted">Documents</span>
              {attachments.map((attachment) => (
                <p key={attachment.key} className="tiny" style={{ margin: '2px 0', display: 'flex', gap: 6, alignItems: 'center' }}>
                  <BadgeCheck size={12} aria-hidden="true" /> {attachment.label} ({attachment.fileName})
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
          <span>{edited.filter((field) => field.value).length} field(s) filled. {attachments.length} document(s) attached.</span>
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
