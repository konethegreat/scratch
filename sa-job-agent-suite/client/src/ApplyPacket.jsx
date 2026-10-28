import { useMemo, useState } from 'react';
import { CheckCircle2, Circle, Copy, ExternalLink, Printer, ShieldCheck } from 'lucide-react';
import { buildApplyPacket } from '@sajas/core/apply';
import { copyToClipboard } from './clipboard.js';
import { printDocument } from './print.js';

function CopyButton({ text }) {
  const [state, setState] = useState('idle');
  return (
    <button
      type="button"
      className="btn-ghost btn-sm"
      onClick={async () => {
        const ok = await copyToClipboard(text);
        setState(ok ? 'copied' : 'failed');
        setTimeout(() => setState('idle'), 1600);
      }}
    >
      {state === 'copied' ? <CheckCircle2 size={13} /> : <Copy size={13} />}
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Select and copy' : 'Copy'}
    </button>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p className="tiny" style={{ marginBottom: 2 }}>{label}</p>
        <p style={{ margin: 0, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{value}</p>
      </div>
      <CopyButton text={value} />
    </div>
  );
}

export default function ApplyPacket({ profile, jobs, answerBank = [], onMarkApplied, busyJobId = null }) {
  const ready = useMemo(() => jobs.filter((job) => job.tailoredCvText), [jobs]);
  const [pickedId, setPickedId] = useState('');
  const job = ready.find((entry) => entry.id === pickedId) || ready[0] || null;
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

  if (!ready.length) {
    return (
      <section className="panel" style={{ padding: 24 }}>
        <h3 style={{ fontSize: 18, marginBottom: 8 }}>Apply with a packet</h3>
        <p className="muted">Nothing is ready to apply to yet. Tailor a CV first, then come back here for the copy sheet.</p>
      </section>
    );
  }

  return (
    <section className="panel" style={{ padding: 24 }}>
      <h3 style={{ fontSize: 18, marginBottom: 4 }}>Apply with a packet</h3>
      <p className="muted" style={{ marginBottom: 16 }}>
        The web app cannot type into another site's form. Copy each answer, paste it on the job site, and press Mark applied when the site confirms your submission.
      </p>

      <label className="tiny" htmlFor="apply-job" style={{ display: 'block', marginBottom: 6 }}>Job</label>
      <select id="apply-job" value={job.id} onChange={(event) => setPickedId(event.target.value)} style={{ maxWidth: 420, marginBottom: 20 }}>
        {ready.map((entry) => <option key={entry.id} value={entry.id}>{entry.title} at {entry.company}</option>)}
      </select>

      {packet.warnings.length > 0 && (
        <div role="status" style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginBottom: 20 }}>
          {packet.warnings.map((warning) => <p key={warning} className="tiny" style={{ margin: '2px 0' }}>{warning}</p>)}
        </div>
      )}

      <div style={{ display: 'grid', gap: 20 }}>
        <div>
          <h4 style={{ fontSize: 15, marginBottom: 6 }}>Your details</h4>
          {packet.identity.length
            ? packet.identity.map((entry) => <Row key={entry.key} label={entry.label} value={entry.value} />)
            : <p className="muted">Add your name and contact details in Settings.</p>}
        </div>

        <div>
          <h4 style={{ fontSize: 15, marginBottom: 6 }}>Application questions</h4>
          {packet.questions.length
            ? packet.questions.map((entry) => (
                <Row
                  key={entry.key}
                  label={`${entry.label} (${entry.source === 'answer-bank' ? 'saved answer' : 'from your profile'})`}
                  value={entry.value}
                />
              ))
            : <p className="muted">No saved answers yet. The job site will ask in its own words.</p>}
        </div>

        <div>
          <h4 style={{ fontSize: 15, marginBottom: 6 }}>Documents</h4>
          {packet.documents.map((doc) => (
            <p key={doc.key} className="tiny" style={{ margin: '4px 0' }}>
              {doc.available ? 'Ready: ' : 'Missing: '}{doc.label}{doc.fileName ? ` (${doc.fileName})` : ''}
            </p>
          ))}
          <div className="flex-gap" style={{ marginTop: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn-secondary btn-sm" onClick={() => printDocument({ title: `${job.title} CV`, text: job.tailoredCvText })}>
              <Printer size={13} /> Print CV
            </button>
            {job.tailoredCoverLetterText && (
              <button type="button" className="btn-secondary btn-sm" onClick={() => printDocument({ title: `${job.title} cover letter`, text: job.tailoredCoverLetterText })}>
                <Printer size={13} /> Print cover letter
              </button>
            )}
          </div>
        </div>

        <div>
          <h4 style={{ fontSize: 15, marginBottom: 6 }}>Before you apply</h4>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
            {packet.checklist.map((item) => (
              <li key={item.key} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                {item.done ? <CheckCircle2 size={15} color="var(--color-success)" /> : <Circle size={15} color="var(--text-muted)" />}
                <span className="tiny">{item.label}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex-gap" style={{ flexWrap: 'wrap' }}>
          {job.applyUrl ? (
            <a className="btn-primary" href={job.applyUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={15} /> Open the job site
            </a>
          ) : (
            <span className="tiny">Add the application link in the tracker first.</span>
          )}
          <button
            type="button"
            className="btn-secondary"
            disabled={job.status === 'applied' || busyJobId === job.id}
            onClick={() => onMarkApplied(job.id)}
          >
            <ShieldCheck size={15} /> {job.status === 'applied' ? 'Marked applied' : 'Mark applied'}
          </button>
        </div>
      </div>
    </section>
  );
}
