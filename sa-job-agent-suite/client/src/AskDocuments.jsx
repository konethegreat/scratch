import { useState, useEffect, useCallback } from 'react';
import { Search, Sparkles, ShieldCheck, Copy, AlertTriangle, CheckCircle2, Loader2, Settings, FileSearch } from 'lucide-react';

const card = { background: 'var(--bg-surface-2)', border: '1px solid var(--border)', borderRadius: 10, padding: 16 };
const label = { display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 };

async function responseError(response) {
  const body = await response.json().catch(() => ({}));
  const error = new Error(body.error || body.message || 'That request could not be completed.');
  error.body = body;
  return error;
}

function CitationList({ citations }) {
  if (!citations?.length) return null;
  return (
    <div data-testid="ask-citations" style={{ marginTop: 12 }}>
      <strong style={{ fontSize: 12 }}>Sources</strong>
      <ul style={{ margin: '6px 0 0 18px', padding: 0, fontSize: 12, color: 'var(--text-muted)' }}>
        {citations.map((citation) => (
          <li key={citation.tag}>
            {citation.docTitle}, {citation.section}, passage {citation.index + 1}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RefusalCard({ result, onOpenProfile }) {
  return (
    <div data-testid="ask-refusal" style={{ ...card, marginTop: 14, borderColor: 'var(--color-warning)' }}>
      <strong style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
        <AlertTriangle size={14} color="var(--color-warning)" /> No grounded answer
      </strong>
      <p style={{ fontSize: 13, marginTop: 8 }}>{result.answer}</p>
      <p className="hint">{result.searched}</p>
      {result.missing?.length > 0 && (
        <p className="hint">Nothing saved yet for: {result.missing.join(', ')}.</p>
      )}
      <button type="button" className="btn-secondary btn-sm" onClick={onOpenProfile} style={{ marginTop: 8 }}>
        <Settings size={12} /> Open Profile &amp; Settings
      </button>
    </div>
  );
}

export default function AskDocuments({ apiBase, toasts, refreshSignal, seed, onOpenProfile, onError }) {
  const [status, setStatus] = useState(null);
  const [question, setQuestion] = useState('');
  const [purpose, setPurpose] = useState('general');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [jobs, setJobs] = useState([]);
  const [jobId, setJobId] = useState('');
  const [documentKind, setDocumentKind] = useState('cv');
  const [checkBusy, setCheckBusy] = useState(false);
  const [checkResult, setCheckResult] = useState(null);
  const [checkError, setCheckError] = useState('');

  const refreshStatus = useCallback(async () => {
    try {
      const response = await fetch(`${apiBase}/rag/status`);
      if (response.ok) setStatus(await response.json());
    } catch {
      /* the server may be booting */
    }
  }, [apiBase]);

  const refreshJobs = useCallback(async () => {
    try {
      const response = await fetch(`${apiBase}/jobs`);
      if (!response.ok) return;
      const list = await response.json();
      const withDocuments = (Array.isArray(list) ? list : [])
        .filter((job) => job.tailoredCvText || job.tailoredCoverLetterText);
      setJobs(withDocuments);
      setJobId((current) => (withDocuments.some((job) => job.id === current) ? current : (withDocuments[0]?.id || '')));
    } catch {
      /* ignore */
    }
  }, [apiBase]);

  useEffect(() => {
    refreshStatus();
    refreshJobs();
  }, [refreshStatus, refreshJobs, refreshSignal]);

  useEffect(() => {
    if (!seed?.question) return;
    setQuestion(seed.question);
    setPurpose(seed.purpose || 'application-answer');
    setResult(null);
    setError('');
  }, [seed?.at]);

  const selectedJob = jobs.find((job) => job.id === jobId) || null;
  const documentOptions = selectedJob ? [
    selectedJob.tailoredCvText ? { value: 'cv', label: 'Tailored CV' } : null,
    selectedJob.tailoredCoverLetterText ? { value: 'cover-letter', label: 'Cover letter' } : null
  ].filter(Boolean) : [];

  useEffect(() => {
    if (!documentOptions.some((option) => option.value === documentKind)) {
      setDocumentKind(documentOptions[0]?.value || 'cv');
    }
  }, [jobId, jobs]);

  const fail = (err, where) => {
    const message = err?.message || 'That request could not be completed.';
    if (where === 'ask') setError(message);
    else setCheckError(message);
    if (onError) onError(err?.body || err, where);
    else toasts?.error?.(message);
  };

  const ask = async () => {
    const clean = question.trim();
    if (!clean) {
      toasts?.error?.('Type a question first.');
      return;
    }
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const response = await fetch(`${apiBase}/rag/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: clean, purpose })
      });
      if (!response.ok) throw await responseError(response);
      setResult(await response.json());
      refreshStatus();
    } catch (err) {
      fail(err, 'ask');
    } finally {
      setBusy(false);
    }
  };

  const check = async () => {
    if (!jobId) {
      toasts?.error?.('Choose a tailored job first.');
      return;
    }
    setCheckBusy(true);
    setCheckError('');
    setCheckResult(null);
    try {
      const response = await fetch(`${apiBase}/rag/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, documentKind })
      });
      if (!response.ok) throw await responseError(response);
      setCheckResult(await response.json());
      refreshStatus();
    } catch (err) {
      fail(err, 'check');
    } finally {
      setCheckBusy(false);
    }
  };

  const copyAnswer = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      toasts?.success?.('Answer copied.');
    } catch {
      toasts?.error?.('Could not copy. Select the answer and copy it manually.');
    }
  };

  const statusLine = status
    ? (status.documents > 0
      ? `${status.documents} document${status.documents === 1 ? '' : 's'} and ${status.chunks} passage${status.chunks === 1 ? '' : 's'} ready.`
      : 'No documents yet. Add your base CV in Profile & Settings.')
    : 'Checking your saved documents...';

  return (
    <div className="panel fade-in" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <h3 style={{ fontSize: 18 }}><FileSearch size={18} style={{ verticalAlign: -3, marginRight: 6 }} />Ask your documents</h3>
        <p className="muted" style={{ fontSize: 12, marginTop: 2 }}>
          Ask a question about your own CV, letters, saved answers and notes. Answers use only your retrieved passages, cite each one, and refuse when the passages do not support an answer.
        </p>
        <p className="hint" data-testid="ask-status" style={{ marginTop: 6 }}>{statusLine}</p>
        {status?.structuredOutputs === false && (
          <p className="hint" style={{ color: 'var(--color-warning)' }}>
            Structured outputs is off, so asking is paused. Turn it on in AI &amp; Cost.
          </p>
        )}
      </div>

      <section style={card}>
        <strong style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Sparkles size={14} color="var(--color-accent)" /> Ask
        </strong>
        <label style={{ ...label, marginTop: 10 }} htmlFor="ask-question">Question</label>
        <textarea
          id="ask-question"
          data-testid="ask-question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="e.g. What achievements should I lead with for a platform engineering role?"
          style={{ width: '100%', minHeight: 84, fontSize: 13, resize: 'vertical' }}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <select data-testid="ask-purpose" value={purpose} onChange={(event) => setPurpose(event.target.value)} style={{ fontSize: 12 }}>
            <option value="general">General question</option>
            <option value="application-answer">Application answer</option>
          </select>
          <button type="button" className="btn-primary" data-testid="ask-submit" onClick={ask} disabled={busy}>
            {busy ? <Loader2 size={13} className="spin" /> : <Search size={13} />} {busy ? 'Searching...' : 'Ask'}
          </button>
        </div>

        {error && <p role="alert" style={{ color: 'var(--color-error)', fontSize: 12, marginTop: 10 }}>{error}</p>}

        {result && result.refused && <RefusalCard result={result} onOpenProfile={onOpenProfile} />}

        {result && result.supported && (
          <div data-testid="ask-answer" style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
            <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.6 }}>{result.answer}</div>
            <CitationList citations={result.citations} />
            <button type="button" className="btn-secondary btn-sm" style={{ marginTop: 12 }} onClick={() => copyAnswer(result.answer)}>
              <Copy size={12} /> Copy answer
            </button>
          </div>
        )}
      </section>

      <section style={card}>
        <strong style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
          <ShieldCheck size={14} color="var(--color-success)" /> Check a tailored document
        </strong>
        <p className="hint" style={{ marginTop: 4 }}>
          Compare a saved tailored CV or cover letter with your source documents. Claims the sources do not support are listed, never approved.
        </p>

        {jobs.length === 0 ? (
          <p className="hint">Tailor a CV first, then come back to check it.</p>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <select data-testid="ask-check-job" value={jobId} onChange={(event) => setJobId(event.target.value)} style={{ fontSize: 12, minWidth: 220 }}>
                {jobs.map((job) => (
                  <option key={job.id} value={job.id}>{job.title} at {job.company}</option>
                ))}
              </select>
              <select data-testid="ask-check-document" value={documentKind} onChange={(event) => setDocumentKind(event.target.value)} style={{ fontSize: 12 }}>
                {documentOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <button type="button" className="btn-secondary" data-testid="ask-check-submit" onClick={check} disabled={checkBusy}>
                {checkBusy ? <Loader2 size={13} className="spin" /> : <ShieldCheck size={13} />} {checkBusy ? 'Checking...' : 'Check document'}
              </button>
            </div>

            {checkError && <p role="alert" style={{ color: 'var(--color-error)', fontSize: 12, marginTop: 10 }}>{checkError}</p>}

            {checkResult && (
              <div data-testid="ask-check-result" style={{
                marginTop: 14,
                borderTop: '1px solid var(--border)',
                paddingTop: 14,
                borderColor: checkResult.supported ? 'var(--color-success)' : 'var(--color-warning)'
              }}>
                {checkResult.refused ? (
                  <RefusalCard result={checkResult} onOpenProfile={onOpenProfile} />
                ) : checkResult.supported ? (
                  <p style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <CheckCircle2 size={14} color="var(--color-success)" /> Every checkable claim is supported by your saved documents.
                  </p>
                ) : (
                  <>
                    <strong style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <AlertTriangle size={14} color="var(--color-warning)" /> Claims not supported by your documents
                    </strong>
                    <ul style={{ margin: '8px 0 0 18px', padding: 0, fontSize: 12 }}>
                      {checkResult.unsupportedClaims.map((claim, index) => <li key={index}>{claim}</li>)}
                    </ul>
                  </>
                )}
                <CitationList citations={checkResult.citations} />
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
