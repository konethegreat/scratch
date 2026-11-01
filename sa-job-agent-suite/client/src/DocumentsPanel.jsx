import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, FileText, Loader2, ShieldCheck, Star, Trash2, Upload } from 'lucide-react';
import { bytesToBase64, textToBytes } from './web/documents.js';
import { readDocumentFile } from './web/readDocumentFile.js';

const KINDS = [
  ['cv', 'CV'], ['cover-letter', 'Cover letter'], ['certified-id', 'Certified ID'],
  ['qualification', 'Qualification'], ['other', 'Other']
];

const ACCEPT = '.pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain';

async function responseError(res, fallback) {
  const body = await res.json().catch(() => ({}));
  return new Error(body.error || fallback);
}

export default function DocumentsPanel({ apiBase, toasts }) {
  const [documents, setDocuments] = useState([]);
  const [kind, setKind] = useState('cv');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const toastsRef = useRef(toasts);
  toastsRef.current = toasts;

  const refresh = useCallback(async () => {
    const res = await fetch(`${apiBase}/documents`);
    if (!res.ok) throw await responseError(res, 'Could not load your documents.');
    const list = await res.json().catch(() => null);
    setDocuments(Array.isArray(list) ? list : []);
  }, [apiBase]);

  useEffect(() => {
    refresh().catch((error) => toastsRef.current?.error?.(error.message));
  }, [refresh]);

  const upload = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const { mime, text, data } = await readDocumentFile(file);
      const res = await fetch(`${apiBase}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind, label: label.trim() || file.name, fileName: file.name, mime,
          size: data.byteLength, dataBase64: bytesToBase64(new Uint8Array(data)), text,
          isDefault: kind === 'cv' && !documents.some((doc) => doc.kind === 'cv' && doc.isDefault)
        })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not add that document.');
      setLabel('');
      await refresh();
      toasts?.success?.('Document saved in this browser.');
    } catch (error) {
      toasts?.error?.(error.message || 'Could not add that document.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const download = async (doc) => {
    try {
      const res = await fetch(`${apiBase}/documents/${doc.id}/file`);
      if (!res.ok) throw await responseError(res, 'Could not download that document.');
      const body = await res.json();
      const bytes = Uint8Array.from(atob(body.dataBase64), (char) => char.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: body.mime }));
      const link = document.createElement('a');
      link.href = url;
      link.download = body.fileName;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (error) {
      toasts?.error?.(error.message);
    }
  };

  const makeDefault = async (doc) => {
    try {
      const res = await fetch(`${apiBase}/documents/${doc.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isDefault: true })
      });
      if (!res.ok) throw await responseError(res, 'Could not set that default.');
      await refresh();
    } catch (error) {
      toasts?.error?.(error.message);
    }
  };

  const remove = async (doc) => {
    if (!window.confirm(`Delete ${doc.label}? This cannot be undone.`)) return;
    try {
      const res = await fetch(`${apiBase}/documents/${doc.id}`, { method: 'DELETE' });
      if (!res.ok) throw await responseError(res, 'Could not delete that document.');
      await refresh();
    } catch (error) {
      toasts?.error?.(error.message);
    }
  };

  const addPasted = async () => {
    const text = window.prompt('Paste the document text');
    if (!text || !text.trim()) return;
    setBusy(true);
    try {
      const bytes = textToBytes(text);
      const res = await fetch(`${apiBase}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind, label: label.trim() || 'Pasted document', fileName: 'pasted-document.txt',
          mime: 'text/plain', size: bytes.byteLength, dataBase64: bytesToBase64(bytes), text
        })
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not add that document.');
      setLabel('');
      await refresh();
    } catch (error) {
      toasts?.error?.(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel" style={{ padding: 20 }}>
      <h3 style={{ fontSize: 16, marginBottom: 4, display: 'flex', gap: 8, alignItems: 'center' }}>
        <FileText size={16} /> Documents
      </h3>
      <p className="hint" style={{ marginBottom: 16 }}>
        Files stay in this browser. PDF, DOCX and text, up to 8 MB each and 20 MB in total.
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <select value={kind} onChange={(event) => setKind(event.target.value)} aria-label="Document type">
          {KINDS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
        </select>
        <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Label, for example My CV" style={{ minWidth: 200 }} />
        <input ref={fileRef} data-testid="document-file" type="file" accept={ACCEPT} style={{ display: 'none' }} onChange={(event) => upload(event.target.files?.[0])} />
        <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={() => fileRef.current?.click()}>
          {busy ? <Loader2 size={13} className="spin" /> : <Upload size={13} />} Upload file
        </button>
        <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={addPasted}>Paste text</button>
      </div>

      {documents.length === 0 ? (
        <p className="muted">No documents yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {documents.map((doc) => (
            <div key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  {doc.label} {doc.isDefault && <Star size={12} color="var(--color-warning)" style={{ verticalAlign: -1 }} />}
                </div>
                <div className="tiny" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {doc.fileName} · {(doc.size / 1024).toFixed(0)} KB · {doc.kind}
                </div>
              </div>
              {!doc.isDefault && <button type="button" className="btn-ghost btn-sm" onClick={() => makeDefault(doc)}>Set default</button>}
              <button type="button" className="btn-secondary btn-sm" onClick={() => download(doc)} aria-label={`Download ${doc.label}`}><Download size={12} /></button>
              <button type="button" className="btn-danger btn-sm" onClick={() => remove(doc)} aria-label={`Delete ${doc.label}`}><Trash2 size={12} /></button>
            </div>
          ))}
        </div>
      )}

      <p className="tiny" style={{ marginTop: 14 }}>
        <ShieldCheck size={12} style={{ verticalAlign: -1 }} /> Documents are included in a backup export and are not encrypted on this device.
      </p>
    </section>
  );
}
