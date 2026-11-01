import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Circle, Copy, Download, ExternalLink, Printer, Send, ShieldCheck } from 'lucide-react';
import { buildApplyPacket, buildApplyPacketV2 } from '@sajas/core/apply';
import { copyToClipboard } from './clipboard.js';
import { printDocument } from './print.js';
import { createCvPdf, safePdfFileName } from './web/pdf/cvPdf.js';
import { createExtensionBridge } from './web/extensionBridge.js';
import { downloadBytes } from './web/download.js';

const APPLY_DOCUMENT_KINDS = ['cv', 'certified-id', 'qualification', 'cover-letter'];

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

export default function ApplyPacket({ profile, jobs, answerBank = [], onMarkApplied, busyJobId = null, demo = false, onOpenPortal = null, apiBase = '', toasts = null }) {
  const ready = useMemo(() => jobs.filter((job) => job.tailoredCvText), [jobs]);
  const [pickedId, setPickedId] = useState('');
  const [documents, setDocuments] = useState([]);
  const [chosenDocs, setChosenDocs] = useState(() => new Set());
  const [bridgeReady, setBridgeReady] = useState(false);
  const [bridgeChecked, setBridgeChecked] = useState(false);
  const [sending, setSending] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [baseBusy, setBaseBusy] = useState(false);
  const bridgeRef = useRef(null);
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

  useEffect(() => {
    if (demo || !apiBase) return undefined;
    let live = true;
    fetch(`${apiBase}/documents`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : []))
      .then((list) => {
        if (!live) return;
        const usable = Array.isArray(list) ? list.filter((doc) => APPLY_DOCUMENT_KINDS.includes(doc.kind)) : [];
        setDocuments(usable);
        setChosenDocs(new Set(usable.filter((doc) => doc.kind === 'cv' && doc.isDefault).map((doc) => doc.id)));
      })
      .catch(() => {});
    const bridge = createExtensionBridge();
    bridgeRef.current = bridge;
    bridge.probe().then((isReady) => {
      if (!live) return;
      setBridgeReady(isReady);
      setBridgeChecked(true);
    });
    return () => {
      live = false;
      bridge.dispose();
      bridgeRef.current = null;
    };
  }, [apiBase, demo]);

  const tailoredPdf = useCallback(() => {
    if (!job?.tailoredCvText) return null;
    return createCvPdf({ text: job.tailoredCvText, title: `${job.title} CV` });
  }, [job]);

  const downloadTailored = async () => {
    if (!job) return;
    setPdfBusy(true);
    try {
      const bytes = await tailoredPdf();
      if (bytes) downloadBytes(bytes, safePdfFileName(`${job.title}-cv`));
    } catch (error) {
      toasts?.error?.(error.message);
    } finally {
      setPdfBusy(false);
    }
  };

  const toggleDoc = (id) => {
    setChosenDocs((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const sendToExtension = async () => {
    if (!bridgeRef.current) return;
    if (!bridgeReady) {
      toasts?.error?.('The extension is not installed yet, or it is still starting. Check that it is installed and enabled, then reload this page.');
      return;
    }
    if (!job) return;
    setSending(true);
    try {
      const pdf = await tailoredPdf();
      const attachments = [];
      if (pdf) attachments.push({
        key: 'tailored-cv', kind: 'tailored-cv', label: 'Tailored CV',
        fileName: safePdfFileName(`${job.title}-cv`), mime: 'application/pdf', bytes: pdf
      });
      for (const doc of documents.filter((entry) => chosenDocs.has(entry.id))) {
        const res = await fetch(`${apiBase}/documents/${doc.id}/file`, { cache: 'no-store' });
        if (!res.ok) throw new Error('Could not read one of your documents.');
        const body = await res.json();
        const binary = atob(body.dataBase64);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        attachments.push({
          key: doc.id, kind: 'document', label: doc.label, fileName: body.fileName,
          mime: body.mime, bytes
        });
      }
      const v2 = buildApplyPacketV2({
        profile: profile || {}, job, answerBank, attachments,
        documents: [
          ...(pdf ? [{ key: 'tailored-cv', label: 'Tailored CV', fileName: safePdfFileName(`${job.title}-cv`), available: true }] : []),
          ...documents.map((doc) => ({ key: doc.id, label: doc.label, fileName: doc.fileName, available: chosenDocs.has(doc.id) }))
        ]
      });
      const result = await bridgeRef.current.send(v2);
      if (result.ok) toasts?.success?.('Packet sent to the extension. It will not submit until you confirm on the job page.');
      else toasts?.error?.(result.message);
    } catch (error) {
      toasts?.error?.(error.message);
    } finally {
      setSending(false);
    }
  };

  const baseCv = documents.find((doc) => doc.kind === 'cv' && doc.isDefault) || documents.find((doc) => doc.kind === 'cv') || null;

  const downloadBaseCv = async () => {
    if (!baseCv) return;
    setBaseBusy(true);
    try {
      const res = await fetch(`${apiBase}/documents/${baseCv.id}/file`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Could not read your stored CV.');
      const body = await res.json();
      const binary = atob(body.dataBase64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      downloadBytes(bytes, baseCv.fileName, { type: body.mime });
    } catch (error) {
      toasts?.error?.(error.message);
    } finally {
      setBaseBusy(false);
    }
  };

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
        {demo
          ? "The web app cannot type into another site's form. Copy each answer, paste it on the job site, and press Mark applied when the site confirms your submission."
          : "Copy each answer, or send the packet to the installed extension to fill the job site's form. You confirm the submission on the job site, then press Mark applied."}
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
          {!demo && (
            <div style={{ marginTop: 12 }}>
              <p className="tiny" style={{ margin: '4px 0' }}>
                {baseCv ? `Base CV: ${baseCv.fileName}` : 'No CV is stored yet. Add one in Profile & Settings > Documents.'}
              </p>
              <div data-testid="apply-documents" style={{ display: 'grid', gap: 4, margin: '8px 0' }}>
                <label className="tiny" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="checkbox" checked disabled /> Tailored CV (PDF, generated from this job)
                </label>
                {documents.map((doc) => (
                  <label key={doc.id} className="tiny" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input type="checkbox" checked={chosenDocs.has(doc.id)} onChange={() => toggleDoc(doc.id)} />
                    {doc.label} ({doc.kind})
                  </label>
                ))}
              </div>
              <div className="flex-gap" style={{ marginTop: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  data-testid="download-tailored-pdf"
                  disabled={pdfBusy}
                  onClick={downloadTailored}
                >
                  <Download size={13} /> {pdfBusy ? 'Making the PDF...' : 'Download tailored CV PDF'}
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  data-testid="download-base-cv"
                  disabled={baseBusy || !baseCv}
                  onClick={downloadBaseCv}
                >
                  <Download size={13} /> {baseBusy ? 'Reading the file...' : 'Download base CV'}
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  data-testid="send-to-extension"
                  disabled={sending}
                  onClick={sendToExtension}
                >
                  <Send size={13} /> {sending ? 'Sending...' : 'Send to extension'}
                </button>
              </div>
              {bridgeChecked && !bridgeReady && (
                <p className="tiny" style={{ marginTop: 6 }}>
                  The extension is not installed yet. Install it from the project repository, then reload this page.
                </p>
              )}
            </div>
          )}
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
          {demo && onOpenPortal ? (
            <button type="button" className="btn-primary" data-testid="open-simulated-portal" onClick={onOpenPortal}>
              <ExternalLink size={15} /> Open the simulated portal
            </button>
          ) : job.applyUrl ? (
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
