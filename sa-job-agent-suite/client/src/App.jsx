import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Briefcase,
  Wand2,
  Send,
  Settings,
  Terminal,
  Search,
  Sparkles,
  RefreshCw,
  CheckCircle,
  CheckCircle2,
  Trash2,
  MapPin,
  ChevronRight,
  Database,
  Info,
  X,
  AlertTriangle,
  Plus,
  Upload,
  Download,
  Copy,
  Eye,
  EyeOff,
  ExternalLink,
  Loader2,
  KeyRound,
  FileText,
  Filter,
  Brain,
  Home,
  Clock,
  Network,
  ShieldCheck
} from 'lucide-react';
import ApplicationAnswers from './ApplicationAnswers.jsx';
import CandidateMemory from './CandidateMemory.jsx';
import Routines from './Routines.jsx';
import Landing from './Landing.jsx';
import SocialLinks, { SAFlag } from './SocialLinks.jsx';

const API_BASE = 'http://localhost:5000/api';

/* ---------------------------------------------------------------- */
/* Toast system                                                     */
/* ---------------------------------------------------------------- */
function useToasts() {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const push = useCallback((toast) => {
    const id = ++idRef.current;
    setToasts((t) => [...t, { id, ...toast }]);
    setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, toast.duration || 4500);
  }, []);

  const remove = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  return {
    toasts,
    success: (msg, title = 'Success') => push({ type: 'success', title, msg }),
    error:   (msg, title = 'Error')   => push({ type: 'error',   title, msg }),
    info:    (msg, title = 'Info')    => push({ type: 'info',    title, msg }),
    remove
  };
}

function ToastStack({ toasts, onClose }) {
  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.type}`}>
          <span className="toast-icon">
            {t.type === 'success' && <CheckCircle2 size={16} color="var(--color-success)" />}
            {t.type === 'error'   && <AlertTriangle size={16} color="var(--color-error)" />}
            {t.type === 'info'    && <Info size={16} color="var(--color-info)" />}
          </span>
          <div className="toast-body">
            <div className="toast-title">{t.title}</div>
            <div className="toast-msg">{t.msg}</div>
          </div>
          <button className="toast-close" onClick={() => onClose(t.id)}><X size={14} /></button>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Confirm modal                                                    */
/* ---------------------------------------------------------------- */
function ConfirmModal({ open, title, message, confirmLabel = 'Confirm', danger = false, onConfirm, onCancel }) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-card fade-in" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ fontSize: '18px', marginBottom: '8px' }}>{title}</h3>
        <p className="muted" style={{ fontSize: '13px', marginBottom: '20px' }}>{message}</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button className={danger ? 'btn-danger' : 'btn-primary'} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Manual job add modal                                             */
/* ---------------------------------------------------------------- */
function AddJobModal({ open, onClose, onSubmit }) {
  const [form, setForm] = useState({ title: '', company: '', location: '', applyUrl: '', description: '' });
  if (!open) return null;
  const submit = (e) => {
    e.preventDefault();
    if (!form.title || !form.company) return;
    onSubmit(form);
    setForm({ title: '', company: '', location: '', applyUrl: '', description: '' });
  };
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card fade-in" style={{ maxWidth: 540 }} onClick={(e) => e.stopPropagation()}>
        <div className="flex-between" style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: '18px' }}>Add a job manually</h3>
          <button className="btn-ghost btn-xs" onClick={onClose}><X size={14} /></button>
        </div>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label>Job title *</label>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          </div>
          <div className="grid-2">
            <div>
              <label>Company *</label>
              <input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} required />
            </div>
            <div>
              <label>Location</label>
              <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="e.g. Cape Town" />
            </div>
          </div>
          <div>
            <label>Apply URL</label>
            <input value={form.applyUrl} onChange={(e) => setForm({ ...form, applyUrl: e.target.value })} placeholder="https://..." />
          </div>
          <div>
            <label>Description / requirements</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              style={{ minHeight: 140, fontSize: 12 }}
              placeholder="Paste the job description so the tailor agent has context to work with."
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary"><Plus size={14} /> Add job</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Sidebar link                                                     */
/* ---------------------------------------------------------------- */
function SidebarLink({ active, onClick, icon, children }) {
  return (
    <button className={`sidebar-link ${active ? 'active' : ''}`} onClick={onClick}>
      {icon} <span>{children}</span>
    </button>
  );
}

/* ---------------------------------------------------------------- */
/* Status badge                                                     */
/* ---------------------------------------------------------------- */
function StatusBadge({ status }) {
  const map = {
    found:    { cls: 'badge',          label: 'Discovered' },
    tailoring:{ cls: 'badge-warning',  label: 'Tailoring...' },
    tailored: { cls: 'badge-accent',   label: 'Tailored' },
    applied:  { cls: 'badge-success',  label: 'Applied' }
  };
  const { cls, label } = map[status] || { cls: 'badge', label: status || 'Unknown' };
  return <span className={`badge ${cls}`}>{label}</span>;
}

/**
 * Link-quality badge driven by job.linkStatus, set by Agent 1's link validator.
 * 'live' → verified working posting; 'unverified' → couldn't confirm (anti-bot /
 * timeout), shown as a caution; 'dead' → re-check found the posting gone (kept,
 * not removed). Anything else (older jobs with no check / linkless leads) renders
 * nothing, so the UI stays clean for pre-existing data.
 */
function LinkBadge({ status }) {
  if (status === 'live') {
    return (
      <span className="badge badge-success" title="Link verified live before saving" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        <ShieldCheck size={11} /> Verified
      </span>
    );
  }
  if (status === 'unverified') {
    return (
      <span className="badge badge-warning" title="Couldn't confirm this link (site blocked the check or timed out) — open with care" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        <AlertTriangle size={11} /> Unverified
      </span>
    );
  }
  if (status === 'dead') {
    return (
      <span className="badge badge-error" title="A re-check found this posting is gone (expired/removed). Kept so you can decide — but the link likely won't work." style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        <AlertTriangle size={11} /> Expired
      </span>
    );
  }
  return null;
}

/* ---------------------------------------------------------------- */
/* Main App                                                         */
/* ---------------------------------------------------------------- */
export default function App() {
  const toasts = useToasts();
  const [activeTab, setActiveTab] = useState('landing');

  const [profile, setProfile] = useState({
    aiProvider: 'gemini',
    selectedModel: '',
    geminiApiKey: '',
    anthropicApiKey: '',
    openRouterApiKey: '',
    hasGeminiKey: false,
    hasAnthropicKey: false,
    hasOpenRouterKey: false,
    fullName: '',
    email: '',
    phone: '',
    linkedInUrl: '',
    portfolioUrl: '',
    keywords: '',
    locations: '',
    maxKeywords: 3,
    maxLocations: 2,
    useAiSearch: true,
    useAiPlanner: true,
    useVision: false,
    useComputerUse: false,
    computerUseModel: '',
    computerUseMaxSteps: 12,
    tailorConcurrency: 3,
    useResearchFanout: false,
    useStructuredOutputs: true,
    usePromptCaching: true,
    useMemoryReflection: true,
    useDreaming: true,
    aiSearchModel: '',
    searchDepth: 'standard',
    performanceMode: 'balanced',
    performanceModeActual: 'balanced',
    dailyBudgetUSD: 0,
    applicationDefaultsText: '',
    applicationProfile: {},
    baseCv: ''
  });

  // Settings is split into sub-tabs (AI & Cost / Profile & CV / Job Search /
  // Application Answers / Documents & Data) so it no longer renders as one
  // endless scroll.
  const [settingsTab, setSettingsTab] = useState('ai');

  const [jobs, setJobs] = useState([]);
  const [logs, setLogs] = useState([]);
  const [hunterRunning, setHunterRunning] = useState(false);
  const [hunterResult, setHunterResult] = useState(null); // lastResult: {totalFound,totalSaved,perSource,stopped}

  const [tailoringJobId, setTailoringJobId] = useState(null);
  const [copilotJobId, setCopilotJobId] = useState(null);

  const [selectedJob, setSelectedJob] = useState(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isBrowserSetupOpen, setIsBrowserSetupOpen] = useState(false);
  const [loginStatuses, setLoginStatuses] = useState(null); // null = never checked
  const [isCheckingLogins, setIsCheckingLogins] = useState(false);

  // Search/filter on the job list
  const [jobQuery, setJobQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  // Modal state
  const [confirm, setConfirm] = useState({ open: false });
  const [addJobOpen, setAddJobOpen] = useState(false);

  // API-key reveal state — when toggled, the user is "replacing" the saved key
  const [revealKey, setRevealKey] = useState({ gemini: false, anthropic: false, openrouter: false });

  // Supporting documents (ID, matric, degree, academic record) + a counter the
  // Refresh button bumps to force the self-polling child tabs to refetch now.
  const [documents, setDocuments] = useState([]);
  const [uploadingDoc, setUploadingDoc] = useState(null);   // docType currently uploading
  const [refreshTick, setRefreshTick] = useState(0);

  const terminalEndRef = useRef(null);
  // Whether the agent terminal should keep auto-scrolling to its newest line.
  // Cleared when the user scrolls the terminal up to read older output.
  const stickTerminalRef = useRef(true);
  const cvFileInputRef = useRef(null);
  const docInputRefs = useRef({});   // docType -> hidden <input type=file>

  /* -------------------- Fetchers -------------------- */
  const fetchProfile = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/profile`, { cache: 'no-store' });
      const data = await res.json();
      // Don't overwrite local key-edit drafts when polling
      setProfile((p) => ({
        ...p,
        ...data,
        geminiApiKey: revealKey.gemini ? p.geminiApiKey : '',
        anthropicApiKey: revealKey.anthropic ? p.anthropicApiKey : '',
        openRouterApiKey: revealKey.openrouter ? p.openRouterApiKey : ''
      }));
    } catch (err) {
      console.error('Error fetching profile:', err);
    }
  }, [revealKey]);

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/jobs`, { cache: 'no-store' });
      const data = await res.json();
      setJobs(data);
    } catch (err) {
      console.error('Error fetching jobs:', err);
    }
  }, []);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/logs`, { cache: 'no-store' });
      const data = await res.json();
      setLogs(data);
    } catch (err) {
      console.error('Error fetching logs:', err);
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/status`, { cache: 'no-store' });
      const data = await res.json();
      setHunterRunning(Boolean(data?.hunter?.isRunning));
      setHunterResult(data?.hunter?.lastResult || null);
    } catch (err) {
      // ignore — server may be booting
    }
  }, []);

  // Supporting documents (ID, matric, degree, academic record).
  const fetchDocuments = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/documents`, { cache: 'no-store' });
      const data = await res.json();
      setDocuments(Array.isArray(data) ? data : []);
    } catch (err) {
      // ignore — server may be booting
    }
  }, []);

  // One button to pull EVERYTHING fresh (incl. profile + child tabs), and bump a
  // signal the self-polling child tabs watch so they refetch immediately too.
  const refreshAll = useCallback(() => {
    fetchProfile();
    fetchJobs();
    fetchLogs();
    fetchStatus();
    fetchDocuments();
    setRefreshTick((t) => t + 1);
  }, [fetchProfile, fetchJobs, fetchLogs, fetchStatus, fetchDocuments]);

  // Initial load
  useEffect(() => {
    fetchProfile();
    fetchJobs();
    fetchLogs();
    fetchStatus();
    fetchDocuments();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Live polling for active state
  useEffect(() => {
    const interval = setInterval(() => {
      fetchLogs();
      fetchJobs();
      fetchStatus();
    }, 3000);
    return () => clearInterval(interval);
  }, [fetchLogs, fetchJobs, fetchStatus]);

  // Keep the terminal pinned to its newest line — but scroll ONLY the terminal's
  // own box, never the page. The old `scrollIntoView` scrolled every scrollable
  // ancestor (including the window), so each 3s log poll yanked the whole
  // dashboard back down whenever you tried to scroll up. We set the container's
  // own scrollTop instead, and only when the user is still parked at the bottom
  // (stickTerminalRef) so polling never fights someone reading older output.
  useEffect(() => {
    const container = terminalEndRef.current?.parentElement;
    if (!container || !stickTerminalRef.current) return;
    container.scrollTop = container.scrollHeight;
  }, [logs]);

  // Track whether the terminal is parked at the bottom. Once the user scrolls up
  // we stop auto-pinning; when they scroll back to the bottom it resumes.
  const handleTerminalScroll = (e) => {
    const el = e.currentTarget;
    stickTerminalRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  /* -------------------- Actions -------------------- */
  const handleSaveProfile = async (e) => {
    e?.preventDefault?.();
    setIsSavingProfile(true);
    try {
      // Send the key when: no key is saved yet (new entry), or the user clicked Replace
      // Blank it out only when a key is already saved and the user left it masked
      const payload = {
        ...profile,
        geminiApiKey:     (!profile.hasGeminiKey    || revealKey.gemini)     ? profile.geminiApiKey     : '',
        anthropicApiKey:  (!profile.hasAnthropicKey  || revealKey.anthropic)  ? profile.anthropicApiKey  : '',
        openRouterApiKey: (!profile.hasOpenRouterKey || revealKey.openrouter) ? profile.openRouterApiKey : ''
      };
      const res = await fetch(`${API_BASE}/profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        toasts.success('Profile and search parameters updated.');
        setRevealKey({ gemini: false, anthropic: false, openrouter: false });
        await fetchProfile();
      } else {
        toasts.error(data.error || 'Could not save profile.');
      }
    } catch (err) {
      toasts.error(err.message || 'Network error while saving profile.');
    } finally {
      setIsSavingProfile(false);
    }
  };

  const triggerJobHunter = async () => {
    setHunterRunning(true);
    try {
      const res = await fetch(`${API_BASE}/jobs/hunter`, { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        toasts.info('Job hunter is scraping in the background. Check the Logs tab for live updates.', 'Hunter started');
        setActiveTab('logs');
      } else {
        toasts.error(data.error || 'Could not start the hunter.');
        setHunterRunning(false);
      }
    } catch (err) {
      toasts.error(err.message || 'Network error.');
      setHunterRunning(false);
    }
  };

  const stopJobHunter = async () => {
    try {
      const res = await fetch(`${API_BASE}/jobs/hunter/stop`, { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        toasts.info('Stop requested. The hunter will wind down after the current source.', 'Stopping hunter');
      } else {
        toasts.error(data.error || 'Could not stop the hunter.');
      }
    } catch (err) {
      toasts.error(err.message || 'Network error.');
    }
  };

  // Re-check the links of jobs already saved (postings go dead over time). Runs
  // server-side in the background; the job poll picks up updated badges. Never deletes.
  const [revalidating, setRevalidating] = useState(false);
  const revalidateLinks = async () => {
    setRevalidating(true);
    try {
      const res = await fetch(`${API_BASE}/jobs/revalidate`, { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        toasts.info('Re-checking saved job links in the background. Badges update as it finishes.', 'Re-checking links');
      } else {
        toasts.error(data.error || 'Could not start the link re-check.');
      }
    } catch (err) {
      toasts.error(err.message || 'Network error.');
    } finally {
      // It's fire-and-forget server-side; release the button shortly so the user can re-run.
      setTimeout(() => setRevalidating(false), 4000);
    }
  };

  const triggerTailor = async (jobId) => {
    setTailoringJobId(jobId);
    try {
      const res = await fetch(`${API_BASE}/jobs/${jobId}/tailor`, { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        toasts.info('Tailoring started. Watch the job status update when complete.', 'Tailor started');
        await fetchJobs();
      } else {
        toasts.error(data.error || 'Tailoring failed. Check the logs for details.');
      }
    } catch (err) {
      toasts.error(err.message || 'Network error while tailoring.');
    } finally {
      setTailoringJobId(null);
    }
  };

  // T4: tailor every 'found' job concurrently (server bounds it by tailorConcurrency).
  const triggerBatchTailor = async () => {
    try {
      const res = await fetch(`${API_BASE}/jobs/tailor-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toasts.info(`Tailoring ${data.queued} job(s) in parallel. Watch statuses update.`, 'Batch tailor started');
        await fetchJobs();
      } else {
        toasts.error(data.error || 'Batch tailoring failed. Check the logs.');
      }
    } catch (err) {
      toasts.error(err.message || 'Network error while batch tailoring.');
    }
  };

  const triggerApplyCopilot = async (jobId) => {
    setCopilotJobId(jobId);
    try {
      const res = await fetch(`${API_BASE}/jobs/${jobId}/apply`, { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        toasts.info('Apply Copilot opened a browser on the server host. Switch to it to review and submit.', 'Copilot launched');
        setActiveTab('logs');
      } else {
        toasts.error(data.error || 'Could not launch copilot.');
      }
    } catch (err) {
      toasts.error(err.message || 'Network error.');
    } finally {
      setTimeout(() => setCopilotJobId(null), 1500);
    }
  };

  const markApplied = async (jobId) => {
    try {
      const res = await fetch(`${API_BASE}/jobs/${jobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'applied' })
      });
      if (res.ok) {
        toasts.success('Marked as applied.');
        fetchJobs();
        if (selectedJob && selectedJob.id === jobId) {
          setSelectedJob({ ...selectedJob, status: 'applied' });
        }
      }
    } catch (err) {
      toasts.error(err.message || 'Could not update job.');
    }
  };

  const handleDeleteJob = (jobId, title) => {
    setConfirm({
      open: true,
      title: 'Dismiss this job?',
      message: `"${title}" will be removed from your list. You can always re-run the hunter to find it again.`,
      confirmLabel: 'Dismiss',
      danger: true,
      onConfirm: async () => {
        setConfirm({ open: false });
        try {
          await fetch(`${API_BASE}/jobs/${jobId}`, { method: 'DELETE' });
          fetchJobs();
          if (selectedJob && selectedJob.id === jobId) setSelectedJob(null);
          toasts.success('Job dismissed.');
        } catch (err) {
          toasts.error(err.message || 'Could not delete job.');
        }
      }
    });
  };

  const handleAddJob = async (form) => {
    try {
      const res = await fetch(`${API_BASE}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      const data = await res.json();
      if (res.ok) {
        toasts.success(`Added "${form.title}" to your job list.`);
        setAddJobOpen(false);
        fetchJobs();
      } else {
        toasts.error(data.error || 'Could not add job.');
      }
    } catch (err) {
      toasts.error(err.message || 'Network error.');
    }
  };

  const handleClearAllJobs = () => {
    if (jobs.length === 0) return toasts.info('No jobs to clear.');
    setConfirm({
      open: true,
      title: 'Clear all jobs?',
      message: `All ${jobs.length} job${jobs.length !== 1 ? 's' : ''} will be permanently removed. You can re-run the hunter to find them again.`,
      confirmLabel: 'Clear all',
      danger: true,
      onConfirm: async () => {
        setConfirm({ open: false });
        try {
          await fetch(`${API_BASE}/jobs`, { method: 'DELETE' });
          setSelectedJob(null);
          fetchJobs();
          toasts.success('All jobs cleared.');
        } catch (err) {
          toasts.error(err.message || 'Could not clear jobs.');
        }
      }
    });
  };

  const clearSystemLogs = async () => {
    try {
      await fetch(`${API_BASE}/logs/clear`, { method: 'POST' });
      fetchLogs();
      toasts.info('Cleared log history.');
    } catch (err) {
      toasts.error(err.message || 'Could not clear logs.');
    }
  };

  const setupBrowserLogins = async () => {
    setIsBrowserSetupOpen(true);
    try {
      const res = await fetch(`${API_BASE}/browser/setup`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        toasts.info('Browser opened with LinkedIn and Indeed sign-in pages. Log in, then close the window — your sessions will be saved for all future scraping runs.', 'Login browser open');
        setActiveTab('logs');
      } else {
        toasts.error(data.error || 'Could not open browser.');
        setIsBrowserSetupOpen(false);
      }
    } catch (err) {
      toasts.error(err.message || 'Network error.');
      setIsBrowserSetupOpen(false);
    }
    // The browser stays open on the user's desktop; reset state after a delay
    setTimeout(() => setIsBrowserSetupOpen(false), 8000);
  };

  const fetchLoginStatuses = async () => {
    setIsCheckingLogins(true);
    try {
      const res = await fetch(`${API_BASE}/browser/login-status`);
      const data = await res.json();
      if (data.success) {
        setLoginStatuses(data.statuses);
      } else {
        toasts.error(data.error || 'Could not check login statuses.');
      }
    } catch (err) {
      toasts.error(err.message || 'Network error while checking logins.');
    } finally {
      setIsCheckingLogins(false);
    }
  };

  const clearApiKey = async (provider) => {
    try {
      await fetch(`${API_BASE}/profile/key/${provider}`, { method: 'DELETE' });
      toasts.info(`${provider} API key cleared.`);
      fetchProfile();
    } catch (err) {
      toasts.error(err.message || 'Could not clear key.');
    }
  };

  const copyText = (text, label = 'Copied to clipboard.') => {
    if (!text) return toasts.error('Nothing to copy yet.');
    navigator.clipboard.writeText(text);
    toasts.success(label);
  };

  const downloadText = (text, filename) => {
    if (!text) return toasts.error('Nothing to download yet.');
    const blob = new Blob([text], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  const handleCvFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setProfile((p) => ({ ...p, baseCv: ev.target.result }));
      toasts.info(`Loaded ${file.name}. Click Save to persist.`);
    };
    reader.readAsText(file);
  };

  /* -------------------- Supporting documents -------------------- */
  const handleDocUpload = async (docType, e) => {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = '';        // allow re-selecting the same file later
    if (!file) return;
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
      return toasts.error('Please upload a PDF file. Other formats are not accepted.');
    }
    setUploadingDoc(docType);
    try {
      const dataBase64 = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);   // data: URL — server strips the prefix
        r.onerror = () => reject(new Error('Could not read the file.'));
        r.readAsDataURL(file);
      });
      const res = await fetch(`${API_BASE}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docType, fileName: file.name, dataBase64 })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toasts.success(`${file.name} saved. Agent 3 will attach it to matching fields.`);
        fetchDocuments();
      } else {
        toasts.error(data.error || 'Could not save that document.');
      }
    } catch (err) {
      toasts.error(err.message || 'Network error while uploading.');
    } finally {
      setUploadingDoc(null);
    }
  };

  const handleDocDelete = (docType, label) => {
    setConfirm({
      open: true,
      title: `Remove ${label}?`,
      message: 'This deletes the stored PDF. You can upload it again any time.',
      confirmLabel: 'Remove',
      danger: true,
      onConfirm: async () => {
        try {
          await fetch(`${API_BASE}/documents/${docType}`, { method: 'DELETE' });
          fetchDocuments();
          toasts.info(`${label} removed.`);
        } catch (err) {
          toasts.error(err.message || 'Could not remove the document.');
        }
        setConfirm({ open: false });
      }
    });
  };

  /* -------------------- Danger zone: clear data -------------------- */
  const clearData = (what) => {
    const targets = {
      jobs:    { label: 'all jobs', url: `${API_BASE}/jobs`, after: fetchJobs },
      answers: { label: 'all saved answers', url: `${API_BASE}/application/bank`, after: () => setRefreshTick((t) => t + 1) },
      pending: { label: 'all pending questions', url: `${API_BASE}/application/pending`, after: () => setRefreshTick((t) => t + 1) },
      memory:  { label: 'the entire candidate memory', url: `${API_BASE}/memory`, after: () => setRefreshTick((t) => t + 1) }
    };
    const t = targets[what];
    if (!t) return;
    setConfirm({
      open: true,
      title: `Clear ${t.label}?`,
      message: 'This permanently deletes the data and cannot be undone.',
      confirmLabel: 'Clear',
      danger: true,
      onConfirm: async () => {
        try {
          await fetch(t.url, { method: 'DELETE' });
          t.after?.();
          toasts.info(`Cleared ${t.label}.`);
        } catch (err) {
          toasts.error(err.message || 'Could not clear that data.');
        }
        setConfirm({ open: false });
      }
    });
  };

  const clearEverything = () => {
    setConfirm({
      open: true,
      title: 'Clear ALL data?',
      message: 'Deletes every job, saved answer, pending question and all candidate memory. Your profile, keys and uploaded documents are kept. This cannot be undone.',
      confirmLabel: 'Clear everything',
      danger: true,
      onConfirm: async () => {
        try {
          await Promise.all([
            fetch(`${API_BASE}/jobs`, { method: 'DELETE' }),
            fetch(`${API_BASE}/application/bank`, { method: 'DELETE' }),
            fetch(`${API_BASE}/application/pending`, { method: 'DELETE' }),
            fetch(`${API_BASE}/memory`, { method: 'DELETE' })
          ]);
          fetchJobs();
          setRefreshTick((t) => t + 1);
          toasts.success('All data cleared.');
        } catch (err) {
          toasts.error(err.message || 'Could not clear all data.');
        }
        setConfirm({ open: false });
      }
    });
  };

  /* -------------------- Performance presets, budget & backup -------------------- */
  // One click flips every cost-relevant toggle server-side (Token Saver /
  // Balanced / Maximum). Provider choice, keys, CV and answers are untouched.
  const [applyingPreset, setApplyingPreset] = useState(null);
  const applyPreset = async (mode) => {
    setApplyingPreset(mode);
    try {
      const res = await fetch(`${API_BASE}/profile/preset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const labels = { saver: 'Token Saver', balanced: 'Balanced', max: 'Maximum' };
        toasts.success(`${labels[mode] || mode} mode applied — every cost toggle updated.`, 'Performance mode');
        await fetchProfile();
        setRefreshTick((t) => t + 1);
      } else {
        toasts.error(data.error || 'Could not apply that mode.');
      }
    } catch (err) {
      toasts.error(err.message || 'Network error while applying the mode.');
    } finally {
      setApplyingPreset(null);
    }
  };

  // Restore the automatic snapshot taken before the last Danger-Zone clear.
  const restoreBackup = () => {
    setConfirm({
      open: true,
      title: 'Restore last backup?',
      message: 'Puts your data back the way it was just before the most recent bulk clear (jobs, answers, pending questions, memory). Anything added since that clear will be lost.',
      confirmLabel: 'Restore',
      onConfirm: async () => {
        setConfirm({ open: false });
        try {
          const res = await fetch(`${API_BASE}/backup/restore`, { method: 'POST' });
          const data = await res.json();
          if (res.ok && data.success) {
            toasts.success(`Restored backup from ${data.backedUpAt ? new Date(data.backedUpAt).toLocaleString() : 'earlier'}.`);
            refreshAll();
          } else {
            toasts.error(data.error || 'No backup available to restore.');
          }
        } catch (err) {
          toasts.error(err.message || 'Could not restore the backup.');
        }
      }
    });
  };

  const clearUsageHistory = () => {
    setConfirm({
      open: true,
      title: 'Clear AI usage history?',
      message: 'Resets the token/cost tallies (including today, so the budget cap starts fresh). This does not affect jobs or any other data.',
      confirmLabel: 'Clear usage',
      danger: true,
      onConfirm: async () => {
        setConfirm({ open: false });
        try {
          await fetch(`${API_BASE}/usage`, { method: 'DELETE' });
          setRefreshTick((t) => t + 1);
          toasts.info('AI usage history cleared.');
        } catch (err) {
          toasts.error(err.message || 'Could not clear usage.');
        }
      }
    });
  };

  /* -------------------- Derived metrics -------------------- */
  const totalJobs = jobs.length;
  const tailoredJobs = jobs.filter((j) => j.status === 'tailored' || j.status === 'applied').length;
  const appliedJobs = jobs.filter((j) => j.status === 'applied').length;

  // Setup readiness — drives the dashboard checklist so the user can always see
  // what's still needed instead of running the hunter and getting a silent zero.
  const keywordCount = (profile.keywords || '').split(',').map((s) => s.trim()).filter(Boolean).length;
  const locationCount = (profile.locations || '').split(',').map((s) => s.trim()).filter(Boolean).length;
  const aiSearchOn = profile.useAiSearch !== false;
  const setupChecks = [
    {
      key: 'tailorKey',
      ok: Boolean(profile.hasGeminiKey || profile.hasAnthropicKey || profile.hasOpenRouterKey),
      label: 'AI provider key (for CV tailoring)',
      hint: 'Add a Gemini, Anthropic or OpenRouter key in Settings.'
    },
    {
      key: 'aiSearchKey',
      ok: !aiSearchOn || Boolean(profile.hasAnthropicKey),
      label: 'Anthropic key (for AI job search)',
      hint: 'AI search is on but needs an Anthropic key — add one, or turn AI search off in Settings.',
      warn: true // not fatal: scrapers still run
    },
    { key: 'cv',        ok: (profile.baseCv || '').trim().length >= 50, label: 'Base CV pasted',  hint: 'Paste your full CV in Settings so Agent 2 can tailor it.' },
    { key: 'keywords',  ok: keywordCount > 0,  label: 'Search keywords set',  hint: 'Add comma-separated job titles/keywords in Settings.' },
    { key: 'locations', ok: locationCount > 0, label: 'Locations set',        hint: 'Add comma-separated SA locations in Settings.' }
  ];
  const setupBlockers = setupChecks.filter((c) => !c.ok && !c.warn);
  const setupWarnings = setupChecks.filter((c) => !c.ok && c.warn);
  const setupComplete = setupBlockers.length === 0;

  const filteredJobs = useMemo(() => {
    const q = jobQuery.trim().toLowerCase();
    return jobs.filter((j) => {
      if (statusFilter !== 'all' && j.status !== statusFilter) return false;
      if (!q) return true;
      return (
        j.title?.toLowerCase().includes(q) ||
        j.company?.toLowerCase().includes(q) ||
        j.location?.toLowerCase().includes(q) ||
        j.source?.toLowerCase().includes(q)
      );
    });
  }, [jobs, jobQuery, statusFilter]);

  const headerTitles = {
    dashboard: { title: 'Dashboard',           subtitle: 'Monitor your automated South African job hunt at a glance.' },
    hunter:    { title: 'Job Hunter',          subtitle: 'AI web search (Claude) first, then 12 SA scrapers — major boards first: LinkedIn, Indeed SA, PNet, CareerJunction, then Google Jobs, Adzuna SA, Executive/Job Placements, National Government, JobMail, Jobs.co.za, Gumtree SA.' },
    tailor:    { title: 'Document Tailor',     subtitle: 'Use AI to tailor your CV and write a cover letter for each role.' },
    copilot:   { title: 'Apply Copilot',       subtitle: 'Launch a guided browser session with autofill and one-click paste.' },
    referrals: { title: 'Direct Outreach',     subtitle: 'After you apply, reach a real engineer at the company. Finds a senior contact and drafts a peer-to-peer message — you review and send.' },
    routines:  { title: 'Routines',            subtitle: 'Schedule unattended hunts that find — and optionally tailor — jobs while you sleep. They never apply for you.' },
    memory:    { title: 'Candidate Memory',    subtitle: 'Your evolving dossier — learned insights, employer notes and what wins. Read by all three agents.' },
    logs:      { title: 'Activity Console',    subtitle: 'Real-time, colour-coded logs from each running agent.' },
    profile:   { title: 'Profile & Settings',  subtitle: 'AI provider, search criteria, personal info and base CV.' }
  };

  const showRunHunterButton = ['dashboard', 'hunter'].includes(activeTab);

  /* ----------------------------------------------------------------- */
  /* Render                                                            */
  /* ----------------------------------------------------------------- */
  // Immersive personal landing page — the entry screen (no sidebar chrome).
  if (activeTab === 'landing') {
    return (
      <>
        <ToastStack toasts={toasts.toasts} onClose={toasts.remove} />
        <Landing onEnter={() => setActiveTab('dashboard')} />
      </>
    );
  }

  return (
    <div className="app-shell" style={{ display: 'flex', minHeight: '100vh' }}>

      <ToastStack toasts={toasts.toasts} onClose={toasts.remove} />
      <ConfirmModal
        open={confirm.open}
        title={confirm.title}
        message={confirm.message}
        confirmLabel={confirm.confirmLabel}
        danger={confirm.danger}
        onConfirm={confirm.onConfirm}
        onCancel={() => setConfirm({ open: false })}
      />
      <AddJobModal open={addJobOpen} onClose={() => setAddJobOpen(false)} onSubmit={handleAddJob} />

      {/* Sidebar */}
      <aside
        className="glass-panel app-sidebar"
        style={{
          width: 260, padding: 20, display: 'flex', flexDirection: 'column',
          borderTopRightRadius: 0, borderBottomRightRadius: 0,
          borderTop: 'none', borderLeft: 'none', borderBottom: 'none',
          background: '#0F172A', border: 'none', borderRadius: 0,
        boxShadow: '1px 0 0 0 #1E293B', position: 'sticky', top: 0, alignSelf: 'flex-start',
          height: '100vh'
        }}
      >
        <button
          onClick={() => setActiveTab('landing')}
          title="Back to home"
          style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}
        >
          <SAFlag size={28} />
          <div>
            <h2 className="gradient-text" style={{ fontSize: 18, fontWeight: 850, letterSpacing: '0.05em' }}>SA-JAS</h2>
            <p style={{ fontSize: 10, color: 'var(--text-secondary)' }}>JOB AGENT SUITE</p>
          </div>
        </button>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
          <SidebarLink active={activeTab === 'landing'}   onClick={() => setActiveTab('landing')}   icon={<Home size={16} />}>Home / About</SidebarLink>
          <SidebarLink active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} icon={<Briefcase size={16} />}>Dashboard</SidebarLink>
          <SidebarLink active={activeTab === 'hunter'}    onClick={() => setActiveTab('hunter')}    icon={<Search size={16} />}>Job Hunter</SidebarLink>
          <SidebarLink active={activeTab === 'tailor'}    onClick={() => setActiveTab('tailor')}    icon={<Wand2 size={16} />}>Document Tailor</SidebarLink>
          <SidebarLink active={activeTab === 'copilot'}   onClick={() => setActiveTab('copilot')}   icon={<Send size={16} />}>Apply Copilot</SidebarLink>
          <SidebarLink active={activeTab === 'referrals'} onClick={() => setActiveTab('referrals')} icon={<Network size={16} />}>Direct Outreach</SidebarLink>
          <SidebarLink active={activeTab === 'routines'}  onClick={() => setActiveTab('routines')}  icon={<Clock size={16} />}>Routines</SidebarLink>
          <SidebarLink active={activeTab === 'memory'}    onClick={() => setActiveTab('memory')}    icon={<Brain size={16} />}>Candidate Memory</SidebarLink>
          <SidebarLink active={activeTab === 'logs'}      onClick={() => setActiveTab('logs')}      icon={<Terminal size={16} />}>Activity Logs</SidebarLink>
        </nav>

        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 12, marginTop: 'auto' }}>
          <SidebarLink active={activeTab === 'profile'} onClick={() => setActiveTab('profile')} icon={<Settings size={16} />}>Profile &amp; Settings</SidebarLink>
          <div className="tiny" style={{ marginTop: 12, textAlign: 'center' }}>
            <span style={{ color: hunterRunning ? 'var(--color-accent)' : 'var(--text-muted)' }}>
              {hunterRunning ? '● Hunter active' : '○ Hunter idle'}
            </span>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="app-main" style={{ flex: 1, padding: 40, overflowY: 'auto', maxHeight: '100vh', display: 'flex', flexDirection: 'column' }}>

        {/* Persistent top bar with creator links */}
        <div className="app-topbar">
          <button className="brand-chip" onClick={() => setActiveTab('landing')} title="Back to home">
            <SAFlag size={20} />
            <span className="brand-name gradient-text">SA-JAS</span>
            <span className="tiny" style={{ marginLeft: 4 }}>by Kone Tshivhinda</span>
          </button>
          <SocialLinks size="sm" />
        </div>

        {/* Header */}
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28, flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 850 }}>
              {headerTitles[activeTab]?.title}
            </h1>
            <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>{headerTitles[activeTab]?.subtitle}</p>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn-secondary" onClick={refreshAll}>
              <RefreshCw size={14} /> Refresh
            </button>
            {showRunHunterButton && (
              hunterRunning ? (
                <button className="btn-danger" onClick={stopJobHunter} title="Stop after the current source">
                  <Loader2 size={14} className="spin" /> Stop
                </button>
              ) : (
                <button className="btn-primary" onClick={triggerJobHunter}>
                  <Sparkles size={14} /> Run Hunter
                </button>
              )
            )}
          </div>
        </header>

        {/* ============================== DASHBOARD ============================== */}
        {activeTab === 'dashboard' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }} className="fade-in">

            {/* Setup checklist — shows what's still needed before the hunter can work */}
            <SetupChecklist
              checks={setupChecks}
              complete={setupComplete}
              warnings={setupWarnings}
              onFix={() => setActiveTab('profile')}
            />

            {/* Last-run summary — surfaces why a run found what it found */}
            <RunSummary
              result={hunterResult}
              running={hunterRunning}
              aiSearchOn={aiSearchOn}
              hasAnthropicKey={Boolean(profile.hasAnthropicKey)}
              onConfig={() => setActiveTab('profile')}
            />

            {/* KPI cards */}
            <div className="grid-3">
              <KpiCard color="info"    icon={<Briefcase size={26} />}    value={totalJobs}    label="Discovered" />
              <KpiCard color="accent"  icon={<Wand2 size={26} />}        value={tailoredJobs} label="Tailored" />
              <KpiCard color="success" icon={<CheckCircle size={26} />}  value={appliedJobs}  label="Applied" />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 20 }} className="dashboard-row">
              {/* Top matches */}
              <div className="glass-panel" style={{ padding: 22 }}>
                <div className="flex-between" style={{ marginBottom: 14 }}>
                  <h3 style={{ fontSize: 16 }}>Top opportunities</h3>
                  <button className="btn-ghost btn-xs" onClick={() => setActiveTab('hunter')}>
                    View all <ChevronRight size={12} />
                  </button>
                </div>

                {jobs.length === 0 ? (
                  <EmptyState
                    icon={<Search size={28} />}
                    title="No jobs yet"
                    body="Configure your keywords in Profile &amp; Settings, then click Run Hunter."
                  />
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {jobs.slice(0, 5).map((job) => (
                      <div
                        key={job.id}
                        className="glass-panel glass-card-interactive"
                        style={{ padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                        onClick={() => { setSelectedJob(job); setActiveTab('tailor'); }}
                      >
                        <div style={{ overflow: 'hidden' }}>
                          <h4 style={{ fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{job.title}</h4>
                          <p className="tiny" style={{ marginTop: 2 }}>{job.company} • {job.location}</p>
                        </div>
                        <div className="flex-gap">
                          <span className={`badge ${job.matchScore >= 80 ? 'badge-success' : 'badge-accent'}`}>{job.matchScore}%</span>
                          <LinkBadge status={job.linkStatus} />
                          <StatusBadge status={job.status} />
                          <ChevronRight size={16} color="var(--text-muted)" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Terminal */}
              <div className="glass-panel" style={{ padding: 22, display: 'flex', flexDirection: 'column' }}>
                <div className="flex-between" style={{ marginBottom: 12 }}>
                  <h3 style={{ fontSize: 16 }}>Agent terminal</h3>
                  <button className="btn-ghost btn-xs" onClick={() => setActiveTab('logs')}>Open full <ChevronRight size={12} /></button>
                </div>
                <div className="terminal-console" onScroll={handleTerminalScroll} style={{ flex: 1, minHeight: 200, maxHeight: 280 }}>
                  {logs.length === 0 ? (
                    <div className="terminal-system">System online. Waiting for agent activity…</div>
                  ) : logs.slice(-12).map((log, idx) => (
                    <div key={idx} className={`terminal-line terminal-${log.type}`}>
                      <span style={{ color: 'var(--text-muted)' }}>[{(log.timestamp || '').substring(11, 19)}]</span> {log.message}
                    </div>
                  ))}
                  <div ref={terminalEndRef} />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ============================== HUNTER ============================== */}
        {activeTab === 'hunter' && (
          <div className="glass-panel fade-in" style={{ padding: 24 }}>
            <div className="flex-between" style={{ marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
              <div>
                <h3 style={{ fontSize: 18 }}>Scraping pipeline</h3>
                <p className="muted" style={{ fontSize: 12, marginTop: 2 }}>Sources: LinkedIn · Indeed SA · PNet · CareerJunction · Google Jobs · Adzuna SA · Executive Placements · Job Placements · National Govt · JobMail · Jobs.co.za · Gumtree SA</p>
              </div>
              <div className="flex-gap">
                {jobs.length > 0 && (
                  <button className="btn-danger btn-sm" onClick={handleClearAllJobs} title="Remove all jobs">
                    <Trash2 size={14} /> Clear all
                  </button>
                )}
                <button className="btn-secondary" onClick={() => setAddJobOpen(true)}>
                  <Plus size={14} /> Add manually
                </button>
                {jobs.some((j) => j.status === 'found') && (
                  <button className="btn-secondary" onClick={triggerBatchTailor} title="Tailor all found jobs concurrently (Agent 2)">
                    <Wand2 size={14} /> Tailor all found
                  </button>
                )}
                {jobs.length > 0 && (
                  <button className="btn-secondary" onClick={revalidateLinks} disabled={revalidating} title="Re-check saved job links — flags ones that have since expired (never deletes)">
                    {revalidating ? <Loader2 size={14} className="spin" /> : <ShieldCheck size={14} />} Re-check links
                  </button>
                )}
                {hunterRunning ? (
                  <button className="btn-danger" onClick={stopJobHunter} title="Stop after the current source">
                    <Loader2 size={14} className="spin" /> Stop crawler
                  </button>
                ) : (
                  <button className="btn-primary" onClick={triggerJobHunter}>
                    <Search size={14} /> Launch crawler
                  </button>
                )}
              </div>
            </div>

            {/* Engine + scope echo — confirms exactly what the next run will do */}
            <div style={{ marginBottom: 14, padding: '10px 14px', borderRadius: 8, background: 'var(--bg-surface-2)', border: '1px solid var(--border)', fontSize: 12, color: 'var(--text-secondary)', display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Next run:</span>
              <span>engine</span>
              <span className={`badge ${aiSearchOn ? 'badge-success' : 'badge-info'}`}>{aiSearchOn ? 'AI Search (Claude)' : 'Scrapers only'}</span>
              {aiSearchOn && <span className="badge badge-accent" title="Search thoroughness — change in Settings → Job Search">depth: {profile.searchDepth || 'standard'}</span>}
              {aiSearchOn && !profile.hasAnthropicKey && <span className="badge" style={{ background: '#FEF2F2', color: '#DC2626', borderColor: '#FECACA' }} title="AI search needs an Anthropic key">⚠ no Anthropic key</span>}
              <span>·</span>
              <span>searching <strong>{Math.min(keywordCount, Number(profile.maxKeywords) || 3)}</strong> of {keywordCount} keyword{keywordCount === 1 ? '' : 's'} ×</span>
              <strong>{Math.min(locationCount, Number(profile.maxLocations) || 2)}</strong>
              <span>of {locationCount} location{locationCount === 1 ? '' : 's'}</span>
            </div>

            <div className="grid-2" style={{ marginBottom: 20 }}>
              <ChipCard label="Target keywords" items={(profile.keywords || '').split(',').map((s) => s.trim()).filter(Boolean)} color="accent" />
              <ChipCard label="Target locations" items={(profile.locations || '').split(',').map((s) => s.trim()).filter(Boolean)} color="info" icon={<MapPin size={10} />} />
            </div>

            <RunSummary
              result={hunterResult}
              running={hunterRunning}
              aiSearchOn={aiSearchOn}
              hasAnthropicKey={Boolean(profile.hasAnthropicKey)}
              onConfig={() => setActiveTab('profile')}
            />

            {/* Filters */}
            <div className="flex-between" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
              <h3 style={{ fontSize: 15 }}>All discovered opportunities ({filteredJobs.length})</h3>
              <div className="flex-gap">
                <div style={{ position: 'relative' }}>
                  <Search size={12} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input
                    placeholder="Search jobs…"
                    value={jobQuery}
                    onChange={(e) => setJobQuery(e.target.value)}
                    style={{ paddingLeft: 28, width: 220, fontSize: 12 }}
                  />
                </div>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ width: 150, fontSize: 12 }}>
                  <option value="all">All statuses</option>
                  <option value="found">Discovered</option>
                  <option value="tailored">Tailored</option>
                  <option value="applied">Applied</option>
                </select>
              </div>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Role &amp; Company</th>
                    <th>Location</th>
                    <th>Source</th>
                    <th title="Keyword relevance 0–100: how strongly your keywords appear in the job title (weighted high) and description. ≥80 is a strong title match.">Match ⓘ</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredJobs.map((job) => (
                    <tr key={job.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{job.title}</div>
                        <div className="tiny">{job.company}</div>
                      </td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <MapPin size={12} color="var(--text-muted)" /> {job.location}
                        </span>
                      </td>
                      <td><span className="badge badge-info">{job.source || 'Unknown'}</span></td>
                      <td>
                        <span style={{ color: job.matchScore >= 80 ? 'var(--color-success)' : 'var(--color-accent)', fontWeight: 700 }}>
                          {job.matchScore}%
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                          <StatusBadge status={job.status} />
                          <LinkBadge status={job.linkStatus} />
                        </div>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          {job.applyUrl && (
                            <a href={job.applyUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary btn-xs" style={{ textDecoration: 'none' }}>
                              <ExternalLink size={12} /> Open
                            </a>
                          )}
                          <button className="btn-secondary btn-xs" onClick={() => { setSelectedJob(job); setActiveTab('tailor'); }}>
                            <Wand2 size={12} /> Tailor
                          </button>
                          <button className="btn-danger btn-xs" onClick={() => handleDeleteJob(job.id, job.title)} title="Dismiss">
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredJobs.length === 0 && (
                    <tr><td colSpan="6" style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
                      {jobs.length === 0 ? 'No records harvested yet. Set parameters and start your crawler!' : 'No jobs match your current filter.'}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ============================== TAILOR ============================== */}
        {activeTab === 'tailor' && (
          <div style={{ display: 'grid', gridTemplateColumns: selectedJob ? '260px 1fr' : '1fr', gap: 20 }} className="fade-in tailor-grid">
            {/* Picker */}
            <div className="glass-panel" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8, alignSelf: 'start', position: 'sticky', top: 20, maxHeight: 'calc(100vh - 100px)', overflowY: 'auto' }}>
              <h4 style={{ fontSize: 13, marginBottom: 6, color: 'var(--color-accent)' }}>Select an opportunity</h4>
              {jobs.length === 0 && <p className="tiny">No jobs found. Run the hunter first.</p>}
              {jobs.map((job) => (
                <button
                  key={job.id}
                  onClick={() => setSelectedJob(job)}
                  style={{
                    textAlign: 'left',
                    background: selectedJob?.id === job.id ? '#FFFBEB' : 'transparent',
                    border: '1px solid',
                    borderColor: selectedJob?.id === job.id ? 'var(--color-accent)' : 'var(--border)',
                    color: selectedJob?.id === job.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                    borderRadius: 8, padding: 10, cursor: 'pointer', fontSize: 12,
                    fontFamily: 'inherit'
                  }}
                >
                  <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{job.title}</div>
                  <div className="tiny" style={{ marginTop: 2, display: 'flex', justifyContent: 'space-between' }}>
                    <span>{job.company}</span>
                    <StatusBadge status={job.status} />
                  </div>
                </button>
              ))}
            </div>

            {selectedJob ? (
              <div className="glass-panel" style={{ padding: 24 }}>
                <div className="flex-between" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 16, marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
                  <div>
                    <h3 style={{ fontSize: 18 }}>{selectedJob.title}</h3>
                    <p className="muted" style={{ fontSize: 13 }}>{selectedJob.company} • {selectedJob.location}</p>
                    <div className="flex-gap" style={{ marginTop: 8 }}>
                      <span className={`badge ${selectedJob.matchScore >= 80 ? 'badge-success' : 'badge-accent'}`}>{selectedJob.matchScore}% match</span>
                      <StatusBadge status={selectedJob.status} />
                      <LinkBadge status={selectedJob.linkStatus} />
                      {selectedJob.source && <span className="badge badge-info">{selectedJob.source}</span>}
                    </div>
                  </div>
                  <div className="flex-gap">
                    <button className="btn-primary" onClick={() => triggerTailor(selectedJob.id)} disabled={tailoringJobId === selectedJob.id || selectedJob.status === 'tailoring'}>
                      {(tailoringJobId === selectedJob.id || selectedJob.status === 'tailoring') ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
                      {(tailoringJobId === selectedJob.id || selectedJob.status === 'tailoring') ? 'Tailoring…' : (selectedJob.status === 'found' ? 'Optimise CV & letter' : 'Re-tailor')}
                    </button>
                    <button className="btn-secondary" onClick={() => triggerApplyCopilot(selectedJob.id)}>
                      <Send size={14} /> Apply
                    </button>
                  </div>
                </div>

                {selectedJob.description && (
                  <details className="glass-panel" style={{ padding: 14, marginBottom: 18, background: 'var(--bg-surface-2)', border: '1px solid var(--border)' }}>
                    <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--text-secondary)' }}>Job description</summary>
                    <p style={{ marginTop: 10, fontSize: 12.5, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
                      {selectedJob.description}
                    </p>
                  </details>
                )}

                {selectedJob.status === 'found' ? (
                  <EmptyState
                    icon={<Wand2 size={40} color="var(--color-accent)" />}
                    title="Documents not tailored yet"
                    body="Click Optimise above to have the AI rewrite your CV and draft a cover letter targeted at this role."
                  />
                ) : (
                  <div className="grid-2">
                    <DocumentBox
                      title="Tailored CV"
                      tone="accent"
                      text={selectedJob.tailoredCvText}
                      filename={`CV_${slug(selectedJob.title)}_${slug(selectedJob.company)}.md`}
                      onCopy={copyText}
                      onDownload={downloadText}
                    />
                    <DocumentBox
                      title="Tailored Cover Letter"
                      tone="info"
                      text={selectedJob.tailoredCoverLetterText}
                      filename={`CoverLetter_${slug(selectedJob.title)}_${slug(selectedJob.company)}.md`}
                      onCopy={copyText}
                      onDownload={downloadText}
                    />
                  </div>
                )}
              </div>
            ) : (
              <div className="glass-panel" style={{ padding: 48, textAlign: 'center' }}>
                <EmptyState
                  icon={<FileText size={36} color="var(--text-muted)" />}
                  title="Pick a job to tailor"
                  body="Select a role from the left to view its description and generate a custom CV and cover letter."
                />
              </div>
            )}
          </div>
        )}

        {/* ============================== COPILOT ============================== */}
        {activeTab === 'copilot' && (
          <div className="glass-panel fade-in" style={{ padding: 24 }}>
            <h3 style={{ fontSize: 18, marginBottom: 8 }}>Apply Copilot control room</h3>
            <p className="muted" style={{ fontSize: 13, marginBottom: 20 }}>
              Launches a visible Chromium browser on the server host with a floating HUD. It pre-fills your contact details,
              gives you one-click access to your tailored CV and cover letter, and waits for you to review before submitting.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {jobs.filter((j) => j.status === 'tailored' || j.status === 'applied').map((job) => (
                <div key={job.id} className="glass-panel" style={{ padding: 18 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                    <div>
                      <h4 style={{ fontSize: 15, fontWeight: 600 }}>{job.title}</h4>
                      <p className="tiny" style={{ marginTop: 2 }}>{job.company} • {job.location}</p>
                    </div>

                    <div className="flex-gap">
                      <StatusBadge status={job.status} />
                      {job.status !== 'applied' && (
                        <button className="btn-ghost btn-sm" onClick={() => markApplied(job.id)} title="Manually mark as applied">
                          <CheckCircle size={12} /> Mark applied
                        </button>
                      )}
                      <button
                        className="btn-primary btn-sm"
                        onClick={() => triggerApplyCopilot(job.id)}
                        disabled={copilotJobId === job.id}
                      >
                        {copilotJobId === job.id ? <Loader2 size={12} className="spin" /> : <Send size={12} />}
                        {job.status === 'applied' ? 'Re-launch' : 'Launch copilot'}
                      </button>
                    </div>
                  </div>

                  {/* Once applied, the outreach channel lives in its own Direct Outreach tab. */}
                  {job.status === 'applied' && (
                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px dashed var(--border)' }}>
                      <button className="btn-ghost btn-sm" onClick={() => setActiveTab('referrals')}>
                        <Network size={12} /> Open Direct Outreach{job.referral ? ' (ready)' : ''}
                      </button>
                    </div>
                  )}
                </div>
              ))}

              {jobs.filter((j) => j.status === 'tailored' || j.status === 'applied').length === 0 && (
                <EmptyState
                  icon={<Send size={36} color="var(--text-muted)" />}
                  title="Nothing ready to apply"
                  body="Tailor a CV for a job and it will show up here, ready for the copilot."
                />
              )}
            </div>
          </div>
        )}

        {/* ============================== DIRECT OUTREACH ============================== */}
        {activeTab === 'referrals' && (
          <div className="glass-panel fade-in" style={{ padding: 24 }}>
            <div className="flex-gap" style={{ alignItems: 'center', marginBottom: 8 }}>
              <Network size={18} color="var(--color-accent)" />
              <h3 style={{ fontSize: 18 }}>Direct Outreach Channel</h3>
            </div>
            <p className="muted" style={{ fontSize: 13, marginBottom: 20, lineHeight: 1.6 }}>
              Applications can disappear into an ATS. For each job you've applied to, this finds one real senior engineer
              (Engineering Manager / Tech Lead / CTO) at the company and drafts a short, peer-to-peer message you can send
              to open a human conversation. <strong>Nothing is sent automatically</strong> — you review, edit, and reach out.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {jobs.filter((j) => j.status === 'applied').map((job) => (
                <div key={job.id} className="glass-panel" style={{ padding: 18 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                    <div>
                      <h4 style={{ fontSize: 15, fontWeight: 600 }}>{job.title}</h4>
                      <p className="tiny" style={{ marginTop: 2 }}>{job.company} • {job.location}</p>
                    </div>
                    <StatusBadge status={job.status} />
                  </div>
                  <ReferralPanel
                    job={job}
                    apiBase={API_BASE}
                    toasts={toasts}
                    copyText={copyText}
                    onSaved={fetchJobs}
                  />
                </div>
              ))}

              {jobs.filter((j) => j.status === 'applied').length === 0 && (
                <EmptyState
                  icon={<Network size={36} color="var(--text-muted)" />}
                  title="No applications yet"
                  body="Once you've applied to a job (Apply Copilot, or 'Mark applied'), it appears here so you can open a direct line to the team."
                />
              )}
            </div>
          </div>
        )}

        {/* ============================== ROUTINES ============================== */}
        {activeTab === 'routines' && (
          <Routines
            apiBase={API_BASE}
            toasts={toasts}
            jobs={jobs}
            onReview={(job) => { setSelectedJob(job); setActiveTab('copilot'); }}
            refreshSignal={refreshTick}
          />
        )}

        {activeTab === 'memory' && (
          <CandidateMemory apiBase={API_BASE} toasts={toasts} refreshSignal={refreshTick} />
        )}

        {activeTab === 'logs' && (
          <div className="glass-panel fade-in" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="flex-between" style={{ flexWrap: 'wrap', gap: 10 }}>
              <div>
                <h3 style={{ fontSize: 18 }}>Real-time agent console</h3>
                <p className="muted" style={{ fontSize: 12 }}>Browser steps, AI calls and database changes — all streamed live.</p>
              </div>
              <button className="btn-secondary" onClick={clearSystemLogs}><Trash2 size={12} /> Clear logs</button>
            </div>

            <div className="terminal-console" onScroll={handleTerminalScroll} style={{ height: '60vh', minHeight: 360 }}>
              {logs.map((log, idx) => (
                <div key={idx} className={`terminal-line terminal-${log.type}`}>
                  <span style={{ color: 'var(--text-muted)' }}>[{log.timestamp}]</span>
                  {' '}<span style={{ color: 'var(--text-muted)' }}>[{(log.type || 'info').toUpperCase()}]</span>
                  {' '}{log.message}
                </div>
              ))}
              {logs.length === 0 && <div className="terminal-system">System online. Waiting for agent execution…</div>}
              <div ref={terminalEndRef} />
            </div>
          </div>
        )}

        {/* ============================== PROFILE ============================== */}
        {activeTab === 'profile' && (
          <div className="glass-panel fade-in" style={{ padding: 24 }}>
            <div className="flex-between" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 12, marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
              <h3 style={{ fontSize: 18 }}>System configuration</h3>
              <button type="button" className="btn-primary btn-sm" onClick={handleSaveProfile} disabled={isSavingProfile}>
                {isSavingProfile ? <Loader2 size={13} className="spin" /> : <Database size={13} />}
                {isSavingProfile ? 'Saving…' : 'Save configuration'}
              </button>
            </div>

            {/* Sub-tab navigation — settings grouped instead of one long scroll */}
            <SettingsSubTabs
              current={settingsTab}
              onChange={setSettingsTab}
              tabs={[
                { id: 'ai',      label: 'AI & Cost',           icon: <Sparkles size={13} /> },
                { id: 'profile', label: 'Profile & CV',        icon: <FileText size={13} /> },
                { id: 'search',  label: 'Job Search',          icon: <Search size={13} /> },
                { id: 'answers', label: 'Application Answers', icon: <Database size={13} /> },
                { id: 'data',    label: 'Documents & Data',    icon: <ShieldCheck size={13} /> }
              ]}
            />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

            {settingsTab === 'ai' && (<>
              {/* Performance mode — one click sets every cost toggle */}
              <section>
                <SectionHeader title="Performance mode" subtitle="One click configures every cost-relevant setting at once. Token Saver protects your API spend; Maximum turns everything on. Tweak any toggle afterwards and the mode honestly reads as Custom." />
                <PresetCards active={profile.performanceModeActual || 'custom'} busy={applyingPreset} onApply={applyPreset} />
              </section>

              {/* Usage & budget */}
              <section>
                <SectionHeader title="AI usage & daily budget" subtitle="Estimated spend across every AI feature (your provider invoice is the source of truth). Set a daily cap to hard-stop AI calls when it's reached — it resets at midnight." />
                <UsagePanel
                  apiBase={API_BASE}
                  refreshSignal={refreshTick}
                  budgetUSD={profile.dailyBudgetUSD}
                  onChangeBudget={(v) => setProfile({ ...profile, dailyBudgetUSD: v })}
                  onClearUsage={clearUsageHistory}
                />
              </section>

              {/* AI provider */}
              <section>
                <SectionHeader title="AI provider" subtitle="Pick the model that will write your tailored documents." />
                <div className="grid-2">
                  <div>
                    <label>AI provider</label>
                    <select value={profile.aiProvider} onChange={(e) => setProfile({ ...profile, aiProvider: e.target.value })}>
                      <option value="gemini">Google Gemini</option>
                      <option value="anthropic">Anthropic Claude</option>
                      <option value="openrouter">OpenRouter (DeepSeek, Qwen, Meta)</option>
                    </select>
                  </div>
                  <div>
                    <label>Specific model (optional)</label>
                    <input
                      placeholder={
                        profile.aiProvider === 'gemini' ? 'gemini-1.5-flash'
                        : profile.aiProvider === 'anthropic' ? 'claude-3-5-sonnet-latest'
                        : 'deepseek/deepseek-chat'
                      }
                      value={profile.selectedModel || ''}
                      onChange={(e) => setProfile({ ...profile, selectedModel: e.target.value })}
                    />
                    <span className="hint">Leave blank to use the recommended default.</span>
                  </div>
                </div>

                <div style={{ marginTop: 16 }}>
                  {profile.aiProvider === 'gemini' && (
                    <ApiKeyField
                      label="Gemini API key" provider="gemini"
                      hasKey={profile.hasGeminiKey} revealed={revealKey.gemini}
                      value={profile.geminiApiKey}
                      onChange={(v) => setProfile({ ...profile, geminiApiKey: v })}
                      onReveal={() => setRevealKey((r) => ({ ...r, gemini: !r.gemini }))}
                      onClear={() => clearApiKey('gemini')}
                      docsUrl="https://aistudio.google.com/"
                    />
                  )}
                  {profile.aiProvider === 'anthropic' && (
                    <ApiKeyField
                      label="Anthropic API key" provider="anthropic"
                      hasKey={profile.hasAnthropicKey} revealed={revealKey.anthropic}
                      value={profile.anthropicApiKey}
                      onChange={(v) => setProfile({ ...profile, anthropicApiKey: v })}
                      onReveal={() => setRevealKey((r) => ({ ...r, anthropic: !r.anthropic }))}
                      onClear={() => clearApiKey('anthropic')}
                      docsUrl="https://console.anthropic.com/"
                    />
                  )}
                  {profile.aiProvider === 'openrouter' && (
                    <ApiKeyField
                      label="OpenRouter API key" provider="openrouter"
                      hasKey={profile.hasOpenRouterKey} revealed={revealKey.openrouter}
                      value={profile.openRouterApiKey}
                      onChange={(v) => setProfile({ ...profile, openRouterApiKey: v })}
                      onReveal={() => setRevealKey((r) => ({ ...r, openrouter: !r.openrouter }))}
                      onClear={() => clearApiKey('openrouter')}
                      docsUrl="https://openrouter.ai/"
                    />
                  )}
                </div>
              </section>

              {/* Apply Copilot intelligence (planner / vision / computer-use) */}
              <section>
                <SectionHeader title="Apply Copilot intelligence" subtitle="How much AI the copilot uses while walking application forms. Each step up is smarter — and costs more." />

                <div style={{ marginTop: 14, padding: 12, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-surface-2)' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', margin: 0 }}>
                    <input
                      type="checkbox"
                      checked={profile.useAiPlanner !== false}
                      onChange={(e) => setProfile({ ...profile, useAiPlanner: e.target.checked })}
                      style={{ width: 16, height: 16 }}
                    />
                    <span style={{ fontWeight: 600 }}>Apply Copilot — smart page understanding (planner)</span>
                  </label>
                  <span className="hint" style={{ display: 'block', marginTop: 6 }}>
                    Lets Agent 3 use your selected AI key to comprehend each page (form vs listing vs login) and decide whether to fill it or click through to the real application. One cheap text call per page, capped per session. Recommended on.
                  </span>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', margin: '12px 0 0 0' }}>
                    <input
                      type="checkbox"
                      checked={profile.useVision === true}
                      onChange={(e) => setProfile({ ...profile, useVision: e.target.checked })}
                      style={{ width: 16, height: 16 }}
                    />
                    <span style={{ fontWeight: 600 }}>AI vision fallback (experimental — uses more credit)</span>
                  </label>
                  <span className="hint" style={{ display: 'block', marginTop: 6 }}>
                    When the planner is unsure, send a screenshot to a multimodal model so it can actually see tricky or custom pages. Costs more per call; Gemini or Anthropic only (DeepSeek cannot see). Off by default.
                  </span>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', margin: '12px 0 0 0' }}>
                    <input
                      type="checkbox"
                      checked={profile.useComputerUse === true}
                      onChange={(e) => setProfile({ ...profile, useComputerUse: e.target.checked })}
                      style={{ width: 16, height: 16 }}
                    />
                    <span style={{ fontWeight: 600 }}>Computer-use form filler (advanced — Anthropic only, highest cost)</span>
                  </label>
                  <span className="hint" style={{ display: 'block', marginTop: 6 }}>
                    Lets Claude <strong>see and operate</strong> the live form after smart-fill, completing tricky or custom fields that label-matching can&apos;t. <strong>Anthropic key required</strong>; it is the most token-hungry feature, so it&apos;s off by default. It <strong>never clicks Submit</strong> — that&apos;s hard-blocked in code — and stops on any CAPTCHA. Best on a window around 1280px wide for click accuracy.
                  </span>
                  {profile.useComputerUse === true && (
                    <div className="grid-2" style={{ marginTop: 10 }}>
                      <div>
                        <label>Computer-use model (optional)</label>
                        <input
                          value={profile.computerUseModel || ''}
                          onChange={(e) => setProfile({ ...profile, computerUseModel: e.target.value })}
                          placeholder="claude-sonnet-4-6"
                        />
                        <span className="hint">Blank = a sensible default. Needs a computer-use-capable Claude 4.x model.</span>
                      </div>
                      <div>
                        <label>Max steps per form</label>
                        <input
                          type="number" min="1" max="25"
                          value={profile.computerUseMaxSteps ?? 12}
                          onChange={(e) => setProfile({ ...profile, computerUseMaxSteps: e.target.value })}
                        />
                        <span className="hint">Caps cost: each step is one screenshot + model call (1–25).</span>
                      </div>
                    </div>
                  )}
                </div>
              </section>

              {/* Tailoring & learning engine */}
              <section>
                <SectionHeader title="Tailoring & learning" subtitle="Parallelism, employer research, and the cost/reliability features behind the Document Tailor and candidate memory." />
                <div style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-surface-2)' }}>
                  <div className="grid-2">
                    <div>
                      <label>Parallel tailoring (jobs at once)</label>
                      <input
                        type="number" min="1" max="5"
                        value={profile.tailorConcurrency ?? 3}
                        onChange={(e) => setProfile({ ...profile, tailorConcurrency: e.target.value })}
                      />
                      <span className="hint">How many jobs Agent 2 tailors concurrently in a batch or routine (1–5). Higher = faster mornings, more API calls in flight.</span>
                    </div>
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', margin: '12px 0 0 0' }}>
                    <input
                      type="checkbox"
                      checked={profile.useResearchFanout === true}
                      onChange={(e) => setProfile({ ...profile, useResearchFanout: e.target.checked })}
                      style={{ width: 16, height: 16 }}
                    />
                    <span style={{ fontWeight: 600 }}>Company research fan-out (richer cover letters — Anthropic only)</span>
                  </label>
                  <span className="hint" style={{ display: 'block', marginTop: 6 }}>
                    Before tailoring, a sub-agent uses <strong>live web search</strong> to research each employer and role (sector, recent news, salary context) so the cover letter is specific to the company — not generic. <strong>Anthropic key required</strong>; web search is billed (~$10/1,000) and it&apos;s the most token-hungry tailoring add-on, so it&apos;s off by default. Briefs are gathered in parallel across a batch.
                  </span>
                </div>

                <div style={{ marginTop: 14, padding: 12, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-surface-2)' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', margin: 0 }}>
                    <input
                      type="checkbox"
                      checked={profile.useStructuredOutputs !== false}
                      onChange={(e) => setProfile({ ...profile, useStructuredOutputs: e.target.checked })}
                      style={{ width: 16, height: 16 }}
                    />
                    <span style={{ fontWeight: 600 }}>Structured outputs — reliable form-filling & planning</span>
                  </label>
                  <span className="hint" style={{ display: 'block', marginTop: 6 }}>
                    Forces the AI to return guaranteed-valid JSON when mapping forms and planning pages, removing a whole class of parsing errors. <strong>Anthropic models only</strong> (Haiku 4.5 / Sonnet 4.6 / Opus); no extra cost. Recommended on — switch off if you use Gemini/OpenRouter or hit a schema error.
                  </span>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', margin: '12px 0 0 0' }}>
                    <input
                      type="checkbox"
                      checked={profile.usePromptCaching !== false}
                      onChange={(e) => setProfile({ ...profile, usePromptCaching: e.target.checked })}
                      style={{ width: 16, height: 16 }}
                    />
                    <span style={{ fontWeight: 600 }}>Prompt caching — cheaper repeat tailoring</span>
                  </label>
                  <span className="hint" style={{ display: 'block', marginTop: 6 }}>
                    Caches your base CV across tailoring calls so repeat runs reuse it at ~10% of the input cost. <strong>Anthropic only</strong>; needs a CV long enough to meet the cache minimum (longer on Haiku). It only ever saves money. Recommended on.
                  </span>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', margin: '12px 0 0 0' }}>
                    <input
                      type="checkbox"
                      checked={profile.useMemoryReflection !== false}
                      onChange={(e) => setProfile({ ...profile, useMemoryReflection: e.target.checked })}
                      style={{ width: 16, height: 16 }}
                    />
                    <span style={{ fontWeight: 600 }}>Candidate memory — learn from each application</span>
                  </label>
                  <span className="hint" style={{ display: 'block', marginTop: 6 }}>
                    After each confirmed application, the AI distils a few durable insights about you (strengths, preferences, what you said) into your <strong>Candidate Memory</strong> dossier, which all three agents then read. Works with any provider key; costs one small call per application. Turn off to keep memory manual-only — the dossier still records your application history either way.
                  </span>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', margin: '12px 0 0 0' }}>
                    <input
                      type="checkbox"
                      checked={profile.useDreaming !== false}
                      onChange={(e) => setProfile({ ...profile, useDreaming: e.target.checked })}
                      style={{ width: 16, height: 16 }}
                    />
                    <span style={{ fontWeight: 600 }}>Dreaming — let memory learn what wins</span>
                  </label>
                  <span className="hint" style={{ display: 'block', marginTop: 6 }}>
                    A periodic reflective pass that reviews your application <strong>outcomes</strong> (interview/offer vs rejected) and curates the dossier — strengthening the insights and phrasings that keep winning, dropping noise. Run it on a schedule via a <strong>Reflect &amp; learn</strong> routine, or on demand with <strong>Reflect now</strong> in the Candidate Memory tab. Works with any provider key; one small call per pass. Your manually-added insights are never removed.
                  </span>
                </div>
              </section>

            </>)}

            {settingsTab === 'profile' && (<>
              {/* Contact info */}
              <section>
                <SectionHeader title="Personal contact info" subtitle="Used by Apply Copilot to autofill application forms." />
                <div className="grid-2">
                  <div>
                    <label>Full name</label>
                    <input value={profile.fullName || ''} onChange={(e) => setProfile({ ...profile, fullName: e.target.value })} placeholder="Thandi Mokoena" />
                  </div>
                  <div>
                    <label>Email</label>
                    <input type="email" value={profile.email || ''} onChange={(e) => setProfile({ ...profile, email: e.target.value })} placeholder="thandi@example.co.za" />
                  </div>
                  <div>
                    <label>Phone</label>
                    <input value={profile.phone || ''} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} placeholder="+27 71 234 5678" />
                  </div>
                  <div>
                    <label>LinkedIn URL</label>
                    <input value={profile.linkedInUrl || ''} onChange={(e) => setProfile({ ...profile, linkedInUrl: e.target.value })} placeholder="https://linkedin.com/in/..." />
                  </div>
                  <div style={{ gridColumn: 'span 2' }}>
                    <label>Portfolio / website</label>
                    <input value={profile.portfolioUrl || ''} onChange={(e) => setProfile({ ...profile, portfolioUrl: e.target.value })} placeholder="https://yoursite.dev" />
                  </div>
                </div>
              </section>

              {/* Base CV */}
              <section>
                <div className="flex-between" style={{ marginBottom: 8 }}>
                  <div>
                    <h4 style={{ fontSize: 14 }}>Base CV</h4>
                    <p className="hint" style={{ marginTop: 2 }}>Paste your full resume. The tailor agent rewrites this for each role.</p>
                  </div>
                  <div className="flex-gap">
                    <input
                      ref={cvFileInputRef}
                      type="file"
                      accept=".txt,.md,.markdown"
                      style={{ display: 'none' }}
                      onChange={handleCvFileUpload}
                    />
                    <button type="button" className="btn-secondary btn-sm" onClick={() => cvFileInputRef.current?.click()}>
                      <Upload size={12} /> Upload .txt / .md
                    </button>
                  </div>
                </div>
                <textarea
                  placeholder="Paste your complete resume (work experience, skills, metrics, education, contact info)..."
                  value={profile.baseCv || ''}
                  onChange={(e) => setProfile({ ...profile, baseCv: e.target.value })}
                  style={{ minHeight: 260, fontSize: 12, fontFamily: 'JetBrains Mono, monospace', resize: 'vertical' }}
                />
                <span className="hint">{(profile.baseCv || '').length.toLocaleString()} characters.</span>
              </section>
            </>)}

            {settingsTab === 'search' && (<>
              {/* Search criteria */}
              <section>
                <SectionHeader title="Search criteria" subtitle="Comma-separated lists. The hunter scrapes a matrix of keyword × location across all SA sources." />
                <div className="grid-2">
                  <div>
                    <label>Target keywords</label>
                    <input value={profile.keywords || ''} onChange={(e) => setProfile({ ...profile, keywords: e.target.value })} placeholder="Software Engineer, React, Node.js" />
                  </div>
                  <div>
                    <label>Target locations</label>
                    <input value={profile.locations || ''} onChange={(e) => setProfile({ ...profile, locations: e.target.value })} placeholder="Johannesburg, Cape Town, Remote" />
                  </div>
                  <div>
                    <label>Max keywords per run</label>
                    <input
                      type="number" min="1" max="10"
                      value={profile.maxKeywords ?? 3}
                      onChange={(e) => setProfile({ ...profile, maxKeywords: e.target.value })}
                    />
                    <span className="hint">How many of the keywords above to search each run (1–10). Higher = broader but slower.</span>
                  </div>
                  <div>
                    <label>Max locations per run</label>
                    <input
                      type="number" min="1" max="8"
                      value={profile.maxLocations ?? 2}
                      onChange={(e) => setProfile({ ...profile, maxLocations: e.target.value })}
                    />
                    <span className="hint">How many locations to search per per-location source (1–8). National sources ignore this.</span>
                  </div>
                </div>

                <div style={{ marginTop: 14, padding: 12, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-surface-2)' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', margin: 0 }}>
                    <input
                      type="checkbox"
                      checked={profile.useAiSearch !== false}
                      onChange={(e) => setProfile({ ...profile, useAiSearch: e.target.checked })}
                      style={{ width: 16, height: 16 }}
                    />
                    <span style={{ fontWeight: 600 }}>AI job search (Claude live web search) — primary engine</span>
                  </label>
                  <span className="hint" style={{ display: 'block', marginTop: 6 }}>
                    Uses your <strong>Anthropic API key</strong> to search the live web for real SA vacancies (grounded, with source links — not invented). This is the most reliable source; the site scrapers run as a fallback. Web search is billed by Anthropic (~$10/1,000 searches) and must be enabled in your Anthropic Console.
                  </span>
                  {profile.useAiSearch !== false && (
                    <div style={{ marginTop: 12, maxWidth: 460 }}>
                      <label>Search thoroughness</label>
                      <select
                        value={profile.searchDepth || 'standard'}
                        onChange={(e) => setProfile({ ...profile, searchDepth: e.target.value })}
                      >
                        <option value="light">Light — cheapest (2 web searches per keyword, ~10 results)</option>
                        <option value="standard">Standard — recommended (5 searches per keyword, ~20 results)</option>
                        <option value="deep">Deep — most thorough (8 searches + a second pass per keyword)</option>
                      </select>
                      <span className="hint">Deep runs a second, differently-targeted search round per keyword (PNet, CareerJunction, employer ATS pages) so far fewer roles slip through — at roughly double the search cost.</span>
                    </div>
                  )}
                </div>

                <div style={{ marginTop: 14, padding: 12, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-surface-2)' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', margin: 0 }}>
                    <input
                      type="checkbox"
                      checked={profile.useLinkValidation !== false}
                      onChange={(e) => setProfile({ ...profile, useLinkValidation: e.target.checked })}
                      style={{ width: 16, height: 16 }}
                    />
                    <span style={{ fontWeight: 600 }}>Verify job links before saving (recommended)</span>
                  </label>
                  <span className="hint" style={{ display: 'block', marginTop: 6 }}>
                    Before a job is saved, its link is shape-checked and opened (browser-grade) to confirm the advert is live — so <strong>only confirmed-dead links are dropped</strong>. Links on junk repost-aggregators (Jooble, Jobrapido, WhatJobs…) are stripped so the copilot never lands on them. Anything we can't confirm is kept and flagged <em>Unverified</em>. Adds a few seconds per run.
                  </span>
                </div>

                <div style={{ marginTop: 14, padding: 12, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-surface-2)' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', margin: 0 }}>
                    <input
                      type="checkbox"
                      checked={profile.useLinkRepair === true}
                      onChange={(e) => setProfile({ ...profile, useLinkRepair: e.target.checked })}
                      style={{ width: 16, height: 16 }}
                    />
                    <span style={{ fontWeight: 600 }}>Repair missing links with AI</span>
                    {!profile.hasAnthropicKey && <span className="badge badge-warning" style={{ marginLeft: 6 }}>needs Anthropic key</span>}
                  </label>
                  <span className="hint" style={{ display: 'block', marginTop: 6 }}>
                    When a found job has no usable apply link, ask Claude (grounded web search) to find the real posting URL, then re-verify it before saving. <strong>Billed per search and capped per run</strong>, so it's off by default — turn on if you want fewer linkless leads. Anthropic only.
                  </span>
                </div>
              </section>

              {/* Browser session setup */}
              <section>
                <SectionHeader
                  title="Job site logins"
                  subtitle="Sign in to all 6 SA job sites at once. Sessions are saved to your persistent browser profile and reused by every future scraping run — no need to sign in again."
                />
                <div className="flex-gap" style={{ alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={setupBrowserLogins}
                    disabled={isBrowserSetupOpen}
                  >
                    {isBrowserSetupOpen ? <Loader2 size={14} className="spin" /> : <ExternalLink size={14} />}
                    {isBrowserSetupOpen ? 'Browser open — sign in then close window…' : 'Open login browser'}
                  </button>
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={fetchLoginStatuses}
                    disabled={isCheckingLogins || isBrowserSetupOpen}
                    title="Check which sites are currently logged in"
                  >
                    {isCheckingLogins ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
                    {isCheckingLogins ? 'Checking…' : 'Check status'}
                  </button>
                  <span className="hint">Opens Chrome with login tabs for LinkedIn, Indeed SA, PNet, CareerJunction &amp; Gumtree SA. Do this once — sessions are saved permanently to your browser profile.</span>
                </div>

                {/* Per-site login status badges */}
                {loginStatuses && (() => {
                  const sites = [
                    { key: 'linkedin',       label: 'LinkedIn' },
                    { key: 'indeedSa',       label: 'Indeed SA' },
                    { key: 'pnet',           label: 'PNet' },
                    { key: 'careerJunction', label: 'CareerJunction' },
                    { key: 'gumtreeSa',      label: 'Gumtree SA' },
                  ];
                  return (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {sites.map(({ key, label }) => {
                        const ok = loginStatuses[key];
                        return (
                          <span
                            key={key}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 5,
                              padding: '4px 10px',
                              borderRadius: 20,
                              fontSize: 12,
                              fontWeight: 500,
                              background: ok
                                ? 'rgba(34,197,94,0.12)'
                                : 'rgba(255,255,255,0.05)',
                              border: `1px solid ${ok ? 'rgba(34,197,94,0.35)' : 'rgba(255,255,255,0.1)'}`,
                              color: ok ? '#4ade80' : 'var(--color-muted)',
                            }}
                          >
                            {ok
                              ? <CheckCircle2 size={12} color="#4ade80" />
                              : <span style={{ width: 12, height: 12, borderRadius: '50%', background: 'rgba(255,255,255,0.15)', display: 'inline-block' }} />
                            }
                            {label}
                          </span>
                        );
                      })}
                    </div>
                  );
                })()}
              </section>
            </>)}

            {settingsTab === 'answers' && (
              /* Application defaults — structured questionnaire + learn-as-you-go bank */
              <ApplicationAnswers
                appProfile={profile.applicationProfile || {}}
                onChangeField={(key, value) =>
                  setProfile((p) => ({
                    ...p,
                    applicationProfile: { ...(p.applicationProfile || {}), [key]: value }
                  }))
                }
                notes={profile.applicationDefaultsText || ''}
                onChangeNotes={(value) => setProfile((p) => ({ ...p, applicationDefaultsText: value }))}
                apiBase={API_BASE}
                toasts={toasts}
                refreshSignal={refreshTick}
              />
            )}

            {settingsTab === 'data' && (<>
              {/* Supporting documents — reusable PDFs Agent 3 attaches to matching
                  upload fields (ID, matric, degree, academic record). Managed via
                  their own endpoints, so they save instantly (no form submit). */}
              <section className="glass-panel" style={{ padding: 20 }}>
                <h3 style={{ fontSize: 16, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <FileText size={16} /> Supporting documents
                </h3>
                <p className="hint" style={{ marginBottom: 16 }}>
                  Upload your ID, matric certificate, qualification and academic record once — <strong>PDF only, max 15 MB</strong>.
                  The Apply Copilot attaches each to the matching upload field automatically, and never uploads a non-PDF.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {documents.map((doc) => (
                    <div key={doc.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{doc.label}</div>
                        {doc.uploaded ? (
                          <div className="tiny" style={{ color: 'var(--color-success)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 320 }}>
                            ✓ {doc.originalName}{doc.size ? ` · ${(doc.size / 1024).toFixed(0)} KB` : ''}
                          </div>
                        ) : (
                          <div className="tiny" style={{ color: 'var(--text-muted)' }}>Not uploaded</div>
                        )}
                      </div>
                      <div className="flex-gap" style={{ flexShrink: 0 }}>
                        <input
                          ref={(el) => { docInputRefs.current[doc.key] = el; }}
                          type="file"
                          accept="application/pdf,.pdf"
                          style={{ display: 'none' }}
                          onChange={(e) => handleDocUpload(doc.key, e)}
                        />
                        <button type="button" className="btn-secondary btn-sm" disabled={uploadingDoc === doc.key} onClick={() => docInputRefs.current[doc.key]?.click()}>
                          {uploadingDoc === doc.key ? <Loader2 size={12} className="spin" /> : <Upload size={12} />}
                          {doc.uploaded ? 'Replace' : 'Upload PDF'}
                        </button>
                        {doc.uploaded && (
                          <button type="button" className="btn-danger btn-sm" onClick={() => handleDocDelete(doc.key, doc.label)} title={`Remove ${doc.label}`}>
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Backup safety net */}
              <section className="glass-panel" style={{ padding: 20, borderLeft: '3px solid var(--color-info)' }}>
                <h3 style={{ fontSize: 16, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <ShieldCheck size={16} /> Backup &amp; restore
                </h3>
                <p className="hint" style={{ marginBottom: 12 }}>
                  Before any bulk clear below, a snapshot of your data is saved automatically. If you cleared something by mistake, restore it here.
                </p>
                <button type="button" className="btn-secondary btn-sm" onClick={restoreBackup}>
                  <RefreshCw size={12} /> Restore last backup
                </button>
              </section>

              {/* Danger zone — wipe stored data. Profile, API keys and uploaded
                  documents are preserved. */}
              <section className="glass-panel" style={{ padding: 20, borderLeft: '3px solid #DC2626' }}>
                <h3 style={{ fontSize: 16, marginBottom: 4, color: '#DC2626' }}>Danger zone</h3>
                <p className="hint" style={{ marginBottom: 16 }}>
                  Permanently delete stored data. Your profile, API keys and uploaded documents are kept (remove documents individually above). A backup snapshot is taken automatically before each clear.
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => clearData('jobs')}><Trash2 size={12} /> Clear all jobs</button>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => clearData('answers')}><Trash2 size={12} /> Clear saved answers</button>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => clearData('pending')}><Trash2 size={12} /> Clear pending questions</button>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => clearData('memory')}><Trash2 size={12} /> Clear candidate memory</button>
                  <button type="button" className="btn-danger btn-sm" onClick={clearEverything}><Trash2 size={12} /> Clear everything</button>
                </div>
              </section>
            </>)}

            </div>
          </div>
        )}

        {/* Global footer */}
        <footer className="app-footer" style={{ marginTop: 'auto' }}>
          <div className="foot-credit">
            Designed &amp; built by <b>Kone Tshivhinda</b> · Software Engineer · © {new Date().getFullYear()}
          </div>
          <SocialLinks size="sm" />
        </footer>
      </main>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Subcomponents                                                    */
/* ---------------------------------------------------------------- */
function KpiCard({ color, icon, value, label }) {
  const palette = {
    info:    { bg: '#F0F9FF', fg: 'var(--color-info)' },
    accent:  { bg: '#FFFBEB', fg: '#B45309' },
    success: { bg: '#ECFDF5', fg: 'var(--color-success)' }
  }[color];
  return (
    <div className="glass-panel" style={{ padding: 22, display: 'flex', alignItems: 'center', gap: 16 }}>
      <div style={{ background: palette.bg, color: palette.fg, padding: 12, borderRadius: 12 }}>{icon}</div>
      <div>
        <h3 style={{ fontSize: 24, fontWeight: 700 }}>{value}</h3>
        <p className="tiny" style={{ marginTop: 2 }}>{label}</p>
      </div>
    </div>
  );
}

function SetupChecklist({ checks, complete, warnings, onFix }) {
  // When everything's ready and there are no warnings, stay out of the way.
  const items = !complete ? checks : (warnings.length ? warnings : []);
  if (items.length === 0) return null;

  const heading = !complete ? 'Finish setup to start hunting' : 'Heads up';
  const tone = !complete ? 'var(--color-accent)' : '#B45309';

  return (
    <div className="glass-panel" style={{ padding: 18, borderLeft: `3px solid ${tone}` }}>
      <div className="flex-between" style={{ marginBottom: 12 }}>
        <h3 style={{ fontSize: 15 }}>{heading}</h3>
        <button className="btn-secondary btn-xs" onClick={onFix}>Open Settings <ChevronRight size={12} /></button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((c) => (
          <div key={c.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            {c.ok
              ? <CheckCircle2 size={16} color="var(--color-success)" style={{ flexShrink: 0, marginTop: 1 }} />
              : (c.warn
                  ? <AlertTriangle size={16} color="#B45309" style={{ flexShrink: 0, marginTop: 1 }} />
                  : <X size={16} color="#DC2626" style={{ flexShrink: 0, marginTop: 1 }} />)}
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: c.ok ? 'var(--text-secondary)' : 'var(--text-primary)' }}>{c.label}</div>
              {!c.ok && <div className="tiny" style={{ marginTop: 1 }}>{c.hint}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RunSummary({ result, running, aiSearchOn, hasAnthropicKey, onConfig }) {
  if (!result) {
    return running
      ? <div className="glass-panel" style={{ padding: 14, fontSize: 13, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Loader2 size={14} className="spin" /> Hunter is running — results will appear here when it finishes.
        </div>
      : null;
  }

  const saved = result.totalSaved || 0;
  const found = result.totalFound || 0;
  const perSource = result.perSource || {};
  const sources = Object.entries(perSource);
  const zero = saved === 0;
  const tone = zero ? '#B45309' : 'var(--color-success)';
  const ls = result.linkStats || null;
  const hasLinkStats = ls && (ls.live || ls.unverified || ls.noLink || ls.dead || ls.repaired);

  let diagnosis = null;
  if (zero) {
    if (!aiSearchOn) {
      diagnosis = 'AI Search is off, and the site scrapers alone are frequently bot-blocked. Turn on AI Search (needs an Anthropic key) for reliable results.';
    } else if (!hasAnthropicKey) {
      diagnosis = 'AI Search is on but no Anthropic key is set, so it was skipped — and the scrapers returned nothing. Add an Anthropic key to enable AI search.';
    } else {
      diagnosis = 'The engine ran but matched nothing. Try broader or fewer keywords, add more locations, or check the Activity Console for bot-blocks on individual sites.';
    }
  }

  return (
    <div className="glass-panel" style={{ padding: 16, borderLeft: `3px solid ${tone}` }}>
      <div className="flex-between" style={{ flexWrap: 'wrap', gap: 8, marginBottom: sources.length || zero ? 10 : 0 }}>
        <h3 style={{ fontSize: 15 }}>
          Last run{result.stopped ? ' (stopped early)' : ''}: <span style={{ color: tone }}>{saved} saved</span> · {found} found
        </h3>
        {zero && <button className="btn-secondary btn-xs" onClick={onConfig}>Fix in Settings <ChevronRight size={12} /></button>}
      </div>

      {sources.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: hasLinkStats || zero ? 10 : 0 }}>
          {sources.map(([name, n]) => (
            <span key={name} className={`badge ${n > 0 ? 'badge-success' : 'badge-info'}`}>{name}: {n}</span>
          ))}
        </div>
      )}

      {hasLinkStats && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: zero ? 10 : 0 }}>
          <span className="tiny" style={{ color: 'var(--text-muted)' }}>Link health:</span>
          {ls.live > 0 && <span className="badge badge-success" title="Verified live before saving"><ShieldCheck size={10} /> {ls.live} live</span>}
          {ls.unverified > 0 && <span className="badge badge-warning" title="Couldn't confirm (bot-blocked/timeout) — kept anyway">{ls.unverified} unverified</span>}
          {ls.noLink > 0 && <span className="badge badge-info" title="Kept as leads — no direct apply link">{ls.noLink} lead{ls.noLink === 1 ? '' : 's'}</span>}
          {ls.repaired > 0 && <span className="badge badge-accent" title="Missing links found via AI grounded search">↻ {ls.repaired} repaired</span>}
          {ls.dead > 0 && <span className="badge badge-error" title="Confirmed-dead links dropped (never saved)">{ls.dead} dead dropped</span>}
        </div>
      )}

      {diagnosis && (
        <div style={{ display: 'flex', gap: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
          <AlertTriangle size={15} color="#B45309" style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{diagnosis}</span>
        </div>
      )}
    </div>
  );
}

function ChipCard({ label, items, color, icon }) {
  return (
    <div className="glass-panel" style={{ padding: 14, background: 'var(--bg-surface-2)' }}>
      <h4 style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8, fontWeight: 600 }}>{label}</h4>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {items.length === 0 ? <span className="tiny">None set - configure in Profile & Settings.</span> : items.map((it, i) => (
          <span key={i} className={`badge badge-${color}`}>{icon}{it}</span>
        ))}
      </div>
    </div>
  );
}

function EmptyState({ icon, title, body }) {
  return (
    <div style={{ padding: '32px 0', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
      {icon}
      <h4 style={{ fontSize: 15 }}>{title}</h4>
      <p className="muted" style={{ fontSize: 13, maxWidth: 420 }}>{body}</p>
    </div>
  );
}

function SectionHeader({ title, subtitle }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <h4 style={{ fontSize: 14 }}>{title}</h4>
      {subtitle && <p className="hint" style={{ marginTop: 2 }}>{subtitle}</p>}
    </div>
  );
}

function ApiKeyField({ label, hasKey, revealed, value, onChange, onReveal, onClear, docsUrl }) {
  return (
    <div>
      <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <KeyRound size={12} /> {label}
          {hasKey && !revealed && <span className="badge badge-success" style={{ marginLeft: 6 }}>Saved</span>}
        </span>
        {docsUrl && <a href={docsUrl} target="_blank" rel="noopener noreferrer" className="tiny" style={{ color: 'var(--color-info)' }}>Get a key &#8599;</a>}
      </label>

      {hasKey && !revealed ? (
        <div className="flex-gap">
          <input value="****************" disabled style={{ flex: 1 }} />
          <button type="button" className="btn-secondary btn-sm" onClick={onReveal}><Eye size={12} /> Replace</button>
          <button type="button" className="btn-danger btn-sm" onClick={onClear}><Trash2 size={12} /> Remove</button>
        </div>
      ) : (
        <div className="flex-gap">
          <input
            type="password"
            placeholder="Paste your API key"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            style={{ flex: 1 }}
          />
          {hasKey && (
            <button type="button" className="btn-ghost btn-sm" onClick={onReveal}>
              <EyeOff size={12} /> Keep existing
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Settings sub-tabs, performance presets & usage panel              */
/* ---------------------------------------------------------------- */
function SettingsSubTabs({ current, onChange, tabs }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          className={current === t.id ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
          onClick={() => onChange(t.id)}
        >
          {t.icon} {t.label}
        </button>
      ))}
    </div>
  );
}

function PresetCards({ active, busy, onApply }) {
  const cards = [
    {
      id: 'saver', title: 'Token Saver', emoji: '🪙', note: 'Cheapest',
      points: ['AI search on Haiku · light depth', 'Optional AI features all off', 'Caching on · tailor 1 at a time']
    },
    {
      id: 'balanced', title: 'Balanced', emoji: '⚖️', note: 'Recommended',
      points: ['Standard search depth', 'Planner + memory + dreaming on', 'Vision / computer-use / research off']
    },
    {
      id: 'max', title: 'Maximum', emoji: '🚀', note: 'Most capable',
      points: ['Deep 2-round search on Sonnet', 'Link repair + company research on', 'Vision + computer-use finisher on']
    }
  ];
  return (
    <div>
      <div className="grid-3">
        {cards.map((c) => {
          const isActive = active === c.id;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onApply(c.id)}
              disabled={Boolean(busy)}
              className="glass-panel"
              style={{
                textAlign: 'left', padding: 16, cursor: 'pointer', fontFamily: 'inherit',
                border: '2px solid', borderRadius: 12,
                borderColor: isActive ? 'var(--color-accent)' : 'var(--border)',
                background: isActive ? 'rgba(245,158,11,0.07)' : 'var(--bg-surface-2)',
                opacity: busy && busy !== c.id ? 0.6 : 1
              }}
            >
              <div className="flex-between" style={{ marginBottom: 8 }}>
                <span style={{ fontSize: 15, fontWeight: 700 }}>{c.emoji} {c.title}</span>
                {busy === c.id
                  ? <Loader2 size={14} className="spin" />
                  : isActive
                    ? <span className="badge badge-success">Active</span>
                    : <span className="badge badge-info">{c.note}</span>}
              </div>
              <ul style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 3 }}>
                {c.points.map((p, i) => (
                  <li key={i} className="tiny" style={{ lineHeight: 1.5 }}>{p}</li>
                ))}
              </ul>
            </button>
          );
        })}
      </div>
      {active === 'custom' && (
        <p className="hint" style={{ marginTop: 10 }}>
          Current mode: <strong>Custom</strong> — your settings don't exactly match a preset. Click a card to snap every cost toggle to that bundle.
        </p>
      )}
    </div>
  );
}

// Labels for the usage buckets recorded server-side (db/helper.js addUsage).
const BUCKET_LABELS = {
  'ai-search': 'AI job search', 'link-repair': 'Link repair', tailor: 'Tailoring',
  'smart-fill': 'Smart-fill', planner: 'Page planner', vision: 'Vision',
  'computer-use': 'Computer-use', research: 'Company research', referral: 'Referrals',
  memory: 'Memory & dreaming', core: 'Other'
};

function UsagePanel({ apiBase, refreshSignal, budgetUSD, onChangeBudget, onClearUsage }) {
  const [usage, setUsage] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`${apiBase}/usage`, { cache: 'no-store' });
        const data = await res.json();
        if (alive) setUsage(data);
      } catch { /* server may be booting */ }
    };
    load();
    const t = setInterval(load, 20000);
    return () => { alive = false; clearInterval(t); };
  }, [apiBase, refreshSignal]);

  const today = usage?.today || {};
  const spent = today.estCostUSD || 0;
  const serverCap = usage?.budget?.capUSD || 0;
  const exceeded = Boolean(usage?.budget?.exceeded);
  const pct = serverCap > 0 ? Math.min(100, (spent / serverCap) * 100) : 0;
  const buckets = Object.entries(today.byBucket || {})
    .sort((a, b) => (b[1].estCostUSD || 0) - (a[1].estCostUSD || 0));

  const fmtUsd = (v) => `$${(v || 0) >= 1 ? (v || 0).toFixed(2) : (v || 0).toFixed(3)}`;
  const fmtTok = (v) => (v || 0) >= 1e6 ? `${((v || 0) / 1e6).toFixed(1)}M` : (v || 0) >= 1000 ? `${((v || 0) / 1000).toFixed(1)}k` : String(v || 0);

  return (
    <div style={{ padding: 14, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-surface-2)' }}>
      {exceeded && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '10px 12px', borderRadius: 8, marginBottom: 12, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.35)' }}>
          <AlertTriangle size={15} color="#DC2626" style={{ flexShrink: 0, marginTop: 1 }} />
          <span style={{ fontSize: 12.5, color: 'var(--text-primary)' }}>
            <strong>Daily budget reached.</strong> All AI calls are paused until tomorrow. Raise or clear the cap below to resume today.
          </span>
        </div>
      )}

      {/* Headline stats */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: exceeded ? '#DC2626' : 'var(--text-primary)' }}>{fmtUsd(spent)}</div>
          <div className="tiny">est. spend today</div>
        </div>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{fmtUsd(usage?.last7CostUSD)}</div>
          <div className="tiny">est. last 7 days</div>
        </div>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{fmtTok(today.inputTokens)} / {fmtTok(today.outputTokens)}</div>
          <div className="tiny">tokens in / out today</div>
        </div>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{today.webSearches || 0}</div>
          <div className="tiny">web searches today</div>
        </div>
        {Boolean(today.cacheReadTokens) && (
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--color-success)' }}>{fmtTok(today.cacheReadTokens)}</div>
            <div className="tiny">cached tokens reused (≈90% off)</div>
          </div>
        )}
      </div>

      {/* Budget progress */}
      {serverCap > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ height: 8, borderRadius: 6, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', borderRadius: 6, background: pct >= 100 ? '#DC2626' : pct >= 75 ? '#B45309' : 'var(--color-success)', transition: 'width .4s' }} />
          </div>
          <div className="tiny" style={{ marginTop: 4 }}>{fmtUsd(spent)} of {fmtUsd(serverCap)} daily cap ({Math.round(pct)}%)</div>
        </div>
      )}

      {/* Per-feature breakdown */}
      {buckets.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
          {buckets.map(([k, v]) => (
            <span key={k} className="badge badge-info" title={`${v.calls} call(s) · ${fmtTok(v.inputTokens)} in / ${fmtTok(v.outputTokens)} out${v.webSearches ? ` · ${v.webSearches} searches` : ''}`}>
              {BUCKET_LABELS[k] || k}: {fmtUsd(v.estCostUSD)}
            </span>
          ))}
        </div>
      )}
      {buckets.length === 0 && (
        <p className="tiny" style={{ marginBottom: 12 }}>No AI calls recorded today yet — run the hunter or tailor a job and the breakdown appears here.</p>
      )}

      {/* Budget cap input */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ maxWidth: 220 }}>
          <label>Daily budget cap (USD)</label>
          <input
            type="number" min="0" step="0.5"
            value={budgetUSD ?? 0}
            onChange={(e) => onChangeBudget(e.target.value)}
            placeholder="0 = no cap"
          />
        </div>
        <button type="button" className="btn-ghost btn-sm" onClick={onClearUsage} title="Reset the token/cost tallies">
          <Trash2 size={12} /> Clear usage history
        </button>
      </div>
      <span className="hint" style={{ display: 'block', marginTop: 6 }}>
        0 = no cap. When today's estimated spend reaches the cap, <strong>every AI call refuses</strong> (hunter AI search, tailoring, smart-fill, research, dreaming…) until midnight. Costs are estimates from public pricing — check your provider console for exact billing. Click <strong>Save configuration</strong> to apply a new cap.
      </span>
    </div>
  );
}

function DocumentBox({ title, tone, text, filename, onCopy, onDownload }) {
  const color = tone === 'accent' ? 'var(--color-accent)' : 'var(--color-info)';
  return (
    <div className="glass-panel" style={{ padding: 16, background: 'var(--bg-surface-2)' }}>
      <div className="flex-between" style={{ marginBottom: 10 }}>
        <h4 style={{ fontSize: 14, color }}>{title}</h4>
        <div className="flex-gap">
          <button type="button" className="btn-ghost btn-xs" onClick={() => onCopy(text, `${title} copied to clipboard.`)}>
            <Copy size={12} /> Copy
          </button>
          <button type="button" className="btn-ghost btn-xs" onClick={() => onDownload(text, filename)}>
            <Download size={12} /> .md
          </button>
        </div>
      </div>
      <textarea
        readOnly
        value={text || ''}
        placeholder="Run the tailor to populate this section."
        style={{ height: 360, fontFamily: 'JetBrains Mono, monospace', fontSize: 12, resize: 'vertical', border: 'none', background: 'transparent' }}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Referral Network Bypass — post-application direct outreach        */
/* ---------------------------------------------------------------- */
function ReferralPanel({ job, apiBase, toasts, copyText, onSaved }) {
  const [referral, setReferral] = useState(job.referral || null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { setReferral(job.referral || null); }, [job.referral]);

  const build = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/jobs/${job.id}/referral`, { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        setReferral(data.referral);
        toasts.success(
          data.referral.contact?.full_name
            ? `Found ${data.referral.contact.full_name} at ${job.company}.`
            : 'Outreach channel ready — search link + draft message.',
          'Direct Outreach Channel'
        );
        onSaved && onSaved();
      } else {
        toasts.error(data.error || 'Could not build the outreach channel.');
      }
    } catch (e) {
      toasts.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  const contact = referral?.contact;
  const hasName = Boolean(contact?.full_name);

  return (
    <div
      style={{
        marginTop: 14,
        paddingTop: 14,
        borderTop: '1px dashed var(--border)'
      }}
    >
      <div className="flex-between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div className="flex-gap" style={{ alignItems: 'center' }}>
          <Send size={14} color="var(--color-accent)" />
          <span style={{ fontSize: 13, fontWeight: 700 }}>Direct Outreach Channel</span>
          <span className="tiny muted">Skip the ATS — reach a human</span>
        </div>
        {referral && (
          <button className="btn-ghost btn-xs" onClick={build} disabled={loading} title="Find a different contact / redraft">
            {loading ? <Loader2 size={12} className="spin" /> : <RefreshCw size={12} />} Regenerate
          </button>
        )}
      </div>

      {!referral && (
        <div style={{ marginTop: 10 }}>
          <p className="tiny muted" style={{ marginBottom: 8, lineHeight: 1.5 }}>
            Find a senior engineer (Eng Manager / Tech Lead / CTO) at {job.company} and draft a peer-to-peer
            message you can send for a referral. Drafts only — nothing is sent automatically.
          </p>
          <button className="btn-secondary btn-sm" onClick={build} disabled={loading}>
            {loading ? <Loader2 size={13} className="spin" /> : <Search size={13} />}
            {loading ? 'Building channel…' : 'Find referral contact'}
          </button>
        </div>
      )}

      {referral && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Contact card */}
          <div className="glass-panel" style={{ padding: 12, background: 'var(--bg-surface-2)' }}>
            {hasName ? (
              <>
                <div className="flex-between" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{contact.full_name}</div>
                    <div className="tiny muted">{contact.exact_role || 'Senior engineering'} • {contact.company}</div>
                  </div>
                  <span className={`badge ${referral.grounded ? 'badge-success' : 'badge-info'}`}>
                    {referral.grounded ? 'Verified via web search' : 'Suggested'}
                  </span>
                </div>
                {contact.profile_url && (
                  <a
                    href={contact.profile_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-ghost btn-xs"
                    style={{ marginTop: 10, display: 'inline-flex', textDecoration: 'none' }}
                  >
                    <ExternalLink size={12} /> Open profile
                  </a>
                )}
              </>
            ) : (
              <>
                <div className="flex-gap" style={{ alignItems: 'center' }}>
                  <Info size={14} color="var(--color-info)" />
                  <span style={{ fontWeight: 600, fontSize: 13 }}>No specific contact verified</span>
                </div>
                <p className="tiny muted" style={{ margin: '8px 0 10px', lineHeight: 1.5 }}>
                  Use this pre-filtered LinkedIn search to pick the right person at {job.company}, then send the draft below.
                </p>
                {contact?.profile_url && (
                  <a
                    href={contact.profile_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-secondary btn-xs"
                    style={{ display: 'inline-flex', textDecoration: 'none' }}
                  >
                    <ExternalLink size={12} /> Search contacts on LinkedIn
                  </a>
                )}
              </>
            )}
          </div>

          {/* Outreach message */}
          <div className="glass-panel" style={{ padding: 12, background: 'var(--bg-surface-2)' }}>
            <div className="flex-between" style={{ marginBottom: 8 }}>
              <h4 style={{ fontSize: 13, color: 'var(--color-accent)' }}>Outreach message</h4>
              <button
                className="btn-ghost btn-xs"
                onClick={() => copyText(referral.message, 'Outreach message copied.')}
              >
                <Copy size={12} /> Copy
              </button>
            </div>
            <textarea
              readOnly
              value={referral.message || ''}
              style={{ height: 150, fontSize: 12.5, lineHeight: 1.5, resize: 'vertical', border: 'none', background: 'transparent', width: '100%' }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Helpers                                                          */
/* ---------------------------------------------------------------- */
function slug(s = '') {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
}
