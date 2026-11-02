import { useRef, useState } from 'react';
import { CheckCircle2, FileText, FileUp, Loader2, Sparkles } from 'lucide-react';
import { bytesToBase64, textToBytes } from './web/documents.js';
import { readDocumentFile } from './web/readDocumentFile.js';

const ACCEPT = '.pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain';

const UNREAD_LABELS = {
  name: 'full name', email: 'email', phone: 'phone', headline: 'headline', summary: 'summary',
  city: 'city or province', skills: 'skills', languages: 'languages', workHistory: 'work history',
  education: 'education', certifications: 'certifications'
};

const SCALARS = [
  ['fullName', 'Full name'], ['preferredName', 'Preferred name'], ['email', 'Email'], ['phone', 'Phone'],
  ['linkedInUrl', 'LinkedIn'], ['portfolioUrl', 'Portfolio'], ['githubUrl', 'GitHub'],
  ['city', 'City'], ['province', 'Province'], ['headline', 'Headline'],
  ['yearsExperience', 'Years of experience'], ['highestQualification', 'Highest qualification']
];

const CONTACT_KEYS = ['fullName', 'preferredName', 'email', 'phone', 'linkedInUrl', 'portfolioUrl', 'githubUrl', 'headline', 'yearsExperience', 'highestQualification'];

function suggestedChosen(proposals, profile) {
  return {
    contact: CONTACT_KEYS.some((key) => proposals[key] !== undefined && proposals[key] !== '' && proposals[key] !== null)
      || Boolean(proposals.city || proposals.province),
    summary: Boolean(String(proposals.summary || '').trim()),
    skills: (proposals.skills || []).length > 0 || (proposals.languages || []).length > 0,
    workHistory: (proposals.workHistory || []).length > 0,
    education: (proposals.education || []).length > 0,
    certifications: (proposals.certifications || []).length > 0,
    baseCv: !String(profile.baseCv || '').trim()
  };
}

export default function CvIntake({ apiBase, profile = {}, toasts, onSave }) {
  const [text, setText] = useState('');
  const [documentId, setDocumentId] = useState('');
  const [proposals, setProposals] = useState(null);
  const [unread, setUnread] = useState([]);
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState('');
  const [chosen, setChosen] = useState({});
  const [draft, setDraft] = useState({});
  const fileRef = useRef(null);

  const storeText = async (cvText, mime, data, fileName) => {
    const bytes = data ? new Uint8Array(data) : textToBytes(cvText);
    // Becoming the default is only safe when no CV is already marked default,
    // so a failed listing must stop the upload rather than demote one.
    const listRes = await fetch(`${apiBase}/documents`);
    if (!listRes.ok) throw new Error('Could not check your existing documents.');
    const list = await listRes.json().catch(() => null);
    if (!Array.isArray(list)) throw new Error('Could not check your existing documents.');
    const hasDefaultCv = list.some((doc) => doc.kind === 'cv' && doc.isDefault);
    const res = await fetch(`${apiBase}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'cv', label: 'CV uploaded for intake', fileName, mime,
        size: bytes.byteLength, dataBase64: bytesToBase64(bytes), text: cvText,
        isDefault: !hasDefaultCv
      })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Could not keep that CV.');
    setDocumentId(body.document.id);
  };

  const resetRead = () => {
    setProposals(null);
    setUnread([]);
    setSource('');
  };

  const onFile = async (file) => {
    if (!file) return;
    setBusy('read');
    try {
      const { mime, text: cvText, data } = await readDocumentFile(file);
      setText(cvText);
      await storeText(cvText, mime, data, file.name);
      resetRead();
      toasts?.success?.('CV text read on this device and saved with your documents.');
    } catch (error) {
      toasts?.error?.(error.message);
    } finally {
      setBusy('');
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const onPaste = async () => {
    const cvText = window.prompt('Paste your CV text');
    if (!cvText || cvText.trim().length < 20) return;
    setBusy('read');
    try {
      setText(cvText);
      await storeText(cvText, 'text/plain', null, 'pasted-cv.txt');
      resetRead();
    } catch (error) {
      toasts?.error?.(error.message);
    } finally {
      setBusy('');
    }
  };

  const read = async (method) => {
    if (!documentId) return;
    setBusy(method);
    try {
      const res = await fetch(`${apiBase}/profile/intake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId, ...(method === 'local' ? { source: 'local' } : {}) })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'The CV read failed.');
      setProposals(body.proposals);
      setDraft({ ...body.proposals });
      setUnread(Array.isArray(body.unread) ? body.unread : []);
      setSource(body.source || method);
      setChosen(suggestedChosen(body.proposals, profile));
      if (body.inputTruncated) toasts?.info?.('Only the first 60,000 characters were read.');
    } catch (error) {
      toasts?.error?.(error.message);
    } finally {
      setBusy('');
    }
  };

  const save = async () => {
    if (!proposals) return;
    const patch = {};
    if (chosen.contact) {
      for (const key of ['fullName', 'preferredName', 'email', 'phone', 'linkedInUrl', 'portfolioUrl', 'githubUrl', 'headline', 'yearsExperience', 'highestQualification']) {
        if (draft[key] !== undefined && draft[key] !== '') patch[key] = draft[key];
      }
      patch.address = { ...(profile.address || {}), city: draft.city || profile.address?.city || '', province: draft.province || profile.address?.province || '' };
    }
    if (chosen.summary && typeof draft.summary === 'string' && draft.summary.trim()) patch.summary = draft.summary;
    if (chosen.skills && ((draft.skills || []).length || (draft.languages || []).length)) {
      patch.skills = [...new Set([...(profile.skills || []), ...(draft.skills || [])])];
      patch.languages = [...new Set([...(profile.languages || []), ...(draft.languages || [])])];
    }
    if (chosen.workHistory && (draft.workHistory || []).length) patch.workHistory = draft.workHistory;
    if (chosen.education && (draft.education || []).length) patch.education = draft.education;
    if (chosen.certifications && (draft.certifications || []).length) patch.certifications = draft.certifications;
    if (chosen.baseCv) patch.baseCv = text;
    const saved = await onSave(patch);
    if (saved === false) return;
    toasts?.success?.('Profile updated from your CV.');
    resetRead();
  };

  const toggle = (key) => setChosen((current) => ({ ...current, [key]: !current[key] }));
  const edit = (key, value) => setDraft((current) => {
    const next = { ...current, [key]: value };
    for (const [group, fields] of Object.entries({
      contact: ['fullName', 'preferredName', 'email', 'phone', 'linkedInUrl', 'portfolioUrl', 'githubUrl', 'headline', 'yearsExperience', 'highestQualification'],
      summary: ['summary'], skills: ['skills', 'languages'], workHistory: ['workHistory'],
      education: ['education'], certifications: ['certifications']
    })) {
      if (fields.includes(key)) next[group] = true;
    }
    return next;
  });

  return (
    <section>
      <div className="flex-between" style={{ marginBottom: 8 }}>
        <div>
          <h4 style={{ fontSize: 14 }}>CV intake</h4>
          <p className="hint" style={{ marginTop: 2 }}>Upload a PDF, DOCX or text file. The text is read on this device and kept with your documents.</p>
        </div>
        <div className="flex-gap">
          <input ref={fileRef} data-testid="cv-intake-file" type="file" accept={ACCEPT} style={{ display: 'none' }} onChange={(event) => onFile(event.target.files?.[0])} />
          <button type="button" className="btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => fileRef.current?.click()}>
            {busy === 'read' ? <Loader2 size={12} className="spin" /> : <FileUp size={12} />} Upload CV
          </button>
          <button type="button" className="btn-secondary btn-sm" disabled={Boolean(busy)} onClick={onPaste}>Paste CV</button>
        </div>
      </div>

      {text && (
        <>
          <textarea readOnly value={text} data-testid="cv-intake-preview" style={{ minHeight: 160, fontSize: 12, fontFamily: 'JetBrains Mono, monospace' }} />
          <div className="flex-gap" style={{ marginTop: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn-primary btn-sm" data-testid="cv-intake-local" disabled={Boolean(busy) || !documentId} onClick={() => read('local')}>
              {busy === 'local' ? <Loader2 size={12} className="spin" /> : <FileText size={12} />} Read on this device
            </button>
            <button type="button" className="btn-secondary btn-sm" data-testid="cv-intake-ai" disabled={Boolean(busy) || !documentId} onClick={() => read('ai')}>
              {busy === 'ai' ? <Loader2 size={12} className="spin" /> : <Sparkles size={12} />} Read with AI
            </button>
            <span className="hint">{text.length.toLocaleString()} characters. The device read is free and never leaves this browser. The AI read is optional and costs one call.</span>
          </div>
        </>
      )}

      {proposals && (
        <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 12 }} data-testid="cv-intake-review">
          <h5 style={{ fontSize: 13, marginBottom: 8 }}>Review before saving</h5>
          <p className="hint" style={{ marginTop: 0 }}>
            {source === 'local'
              ? 'Read on this device. Nothing was sent anywhere. Check every field before you save.'
              : 'Read with AI. Check every field before you save.'}
          </p>
          {unread.length > 0 && (
            <p className="hint" data-testid="cv-intake-unread" style={{ color: 'var(--color-warning)' }}>
              Not found: {unread.map((key) => UNREAD_LABELS[key] || key).join(', ')}. Fill these in at Profile & CV after saving.
            </p>
          )}
          {['contact', 'summary', 'skills', 'workHistory', 'education', 'certifications', 'baseCv'].map((key) => (
            <label key={key} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <input type="checkbox" checked={Boolean(chosen[key])} onChange={() => toggle(key)} />
              {key === 'baseCv' ? 'Use this text as my base CV' : {
                contact: 'Contact details and headline',
                summary: 'Summary',
                skills: 'Skills and languages',
                workHistory: 'Work history',
                education: 'Education',
                certifications: 'Certifications'
              }[key]}
            </label>
          ))}
          {chosen.contact && (
            <div className="grid-2" style={{ gap: 8, marginBottom: 10 }}>
              {SCALARS.map(([key, label]) => (
                <div key={key}>
                  <label>{label}</label>
                  <input
                    type={key === 'yearsExperience' ? 'number' : 'text'}
                    data-testid={`cv-intake-${key}`}
                    value={draft[key] ?? ''}
                    onChange={(event) => edit(key, key === 'yearsExperience' ? (event.target.value === '' ? null : Number(event.target.value)) : event.target.value)}
                  />
                </div>
              ))}
            </div>
          )}
          {chosen.summary && (
            <div style={{ marginBottom: 10 }}>
              <label>Summary</label>
              <textarea value={draft.summary || ''} onChange={(event) => edit('summary', event.target.value)} style={{ minHeight: 80 }} />
            </div>
          )}
          <p className="hint" style={{ marginBottom: 10 }}>
            Skills found: {(draft.skills || []).join(', ') || 'none'}.
            Work history: {(draft.workHistory || []).length} role(s).
            Education: {(draft.education || []).length} qualification(s).
          </p>
          <div className="flex-gap">
            <button type="button" className="btn-primary btn-sm" data-testid="cv-intake-save" onClick={save}><CheckCircle2 size={12} /> Save to profile</button>
            <button type="button" className="btn-secondary btn-sm" onClick={() => setProposals(null)}>Cancel</button>
          </div>
        </div>
      )}
    </section>
  );
}
