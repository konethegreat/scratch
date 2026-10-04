import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import {
  getProfile,
  saveProfile,
  clearKey,
  getJobs,
  addJob,
  updateJob,
  deleteJob,
  clearAllJobs,
  getLogs,
  clearLogs,
  addLog,
  getHunterState,
  setHunterState,
  getApplyState,
  setApplyState,
  getAnswerBank,
  upsertAnswer,
  deleteAnswer,
  clearAnswerBank,
  getPendingQuestions,
  resolvePending,
  clearPending,
  clearAllPending,
  getSupportingDocuments,
  saveSupportingDocument,
  deleteSupportingDocument,
  getCandidateMemory,
  addInsight,
  deleteInsight,
  upsertEmployerNote,
  updateApplicationOutcome,
  clearCandidateMemory,
  getRoutines,
  getRoutine,
  addRoutine,
  updateRoutine,
  deleteRoutine,
  getUsageSummary,
  clearUsage,
  applyPerformancePreset,
  detectActivePreset,
  PERFORMANCE_PRESETS,
  getBackupInfo,
  restoreDbBackup
} from './db/helper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../../.env') });
dotenv.config({ path: path.join(__dirname, '../.env') });

import { runJobHunterAgent, setupBrowserSession, checkLoginStatuses } from './agents/agent1-hunter.js';
import { revalidateJobLinks } from './agents/linkValidator.js';
import { runDocumentTailorAgent } from './agents/agent2-tailor.js';
import { runApplyAssistantAgent, closeDemoBrowsers } from './agents/agent3-applier.js';
import { startScheduler, runRoutineNow } from './agents/routineRunner.js';
import { tailorJobsConcurrently } from './agents/subAgents.js';
import { dreamOverMemory } from './agents/memoryReflect.js';
import { runReferralPipeline } from './agents/referralAgent.js';
import { demoOrigin, installDemo } from './demo.js';

const app = express();
const PORT = process.env.PORT || 5000;

// CORS: this is a local desktop app. Only allow same-machine origins (the Vite
// dev server and Electron's renderer) instead of the previous wide-open policy.
// Requests with no Origin header (Electron file:// renderer, curl, same-origin)
// are permitted; any non-localhost browser origin is rejected.
const corsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true); // Electron renderer / non-browser
    try {
      const { hostname } = new URL(origin);
      const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
      return callback(null, isLocal);
    } catch {
      return callback(null, false);
    }
  }
};
app.use(cors(corsOptions));
// Raised from 10mb so a base64-encoded supporting-document PDF (ID, matric,
// degree, academic record) fits comfortably in a single upload request.
app.use(express.json({ limit: '30mb' }));
installDemo(app);

// -------------------- Profile Routes --------------------

app.get('/api/profile', (req, res) => {
  try {
    const profile = getProfile();
    const { geminiApiKey, anthropicApiKey, openRouterApiKey, ...rest } = profile;
    res.json({
      ...rest,
      // Which preset the CURRENT values actually match ('custom' if hand-tuned)
      // — the UI highlights this, not the stored performanceMode.
      performanceModeActual: detectActivePreset(profile),
      hasGeminiKey:    Boolean(geminiApiKey),
      hasAnthropicKey: Boolean(anthropicApiKey),
      hasOpenRouterKey: Boolean(openRouterApiKey)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/profile', (req, res) => {
  try {
    const incoming = req.body || {};
    const currentProfile = getProfile();

    const updated = saveProfile({
      aiProvider:      incoming.aiProvider      ?? currentProfile.aiProvider,
      selectedModel:   incoming.selectedModel   ?? currentProfile.selectedModel,
      geminiApiKey:    incoming.geminiApiKey,
      anthropicApiKey: incoming.anthropicApiKey,
      openRouterApiKey: incoming.openRouterApiKey,
      fullName:        incoming.fullName        ?? currentProfile.fullName,
      email:           incoming.email           ?? currentProfile.email,
      phone:           incoming.phone           ?? currentProfile.phone,
      linkedInUrl:     incoming.linkedInUrl     ?? currentProfile.linkedInUrl,
      portfolioUrl:    incoming.portfolioUrl    ?? currentProfile.portfolioUrl,
      keywords:        incoming.keywords        ?? currentProfile.keywords,
      locations:       incoming.locations       ?? currentProfile.locations,
      maxKeywords:     incoming.maxKeywords     ?? currentProfile.maxKeywords,
      maxLocations:    incoming.maxLocations    ?? currentProfile.maxLocations,
      useAiSearch:     incoming.useAiSearch     ?? currentProfile.useAiSearch,
      aiSearchModel:   incoming.aiSearchModel   ?? currentProfile.aiSearchModel,
      searchDepth:     incoming.searchDepth     ?? currentProfile.searchDepth,
      performanceMode: incoming.performanceMode ?? currentProfile.performanceMode,
      dailyBudgetUSD:  incoming.dailyBudgetUSD  ?? currentProfile.dailyBudgetUSD,
      useLinkValidation: incoming.useLinkValidation ?? currentProfile.useLinkValidation,
      useLinkRepair:   incoming.useLinkRepair   ?? currentProfile.useLinkRepair,
      useAiPlanner:    incoming.useAiPlanner    ?? currentProfile.useAiPlanner,
      useVision:       incoming.useVision       ?? currentProfile.useVision,
      useComputerUse:  incoming.useComputerUse  ?? currentProfile.useComputerUse,
      computerUseModel: incoming.computerUseModel ?? currentProfile.computerUseModel,
      computerUseMaxSteps: incoming.computerUseMaxSteps ?? currentProfile.computerUseMaxSteps,
      tailorConcurrency: incoming.tailorConcurrency ?? currentProfile.tailorConcurrency,
      useResearchFanout: incoming.useResearchFanout ?? currentProfile.useResearchFanout,
      useStructuredOutputs: incoming.useStructuredOutputs ?? currentProfile.useStructuredOutputs,
      usePromptCaching:     incoming.usePromptCaching     ?? currentProfile.usePromptCaching,
      useMemoryReflection:  incoming.useMemoryReflection  ?? currentProfile.useMemoryReflection,
      useDreaming:          incoming.useDreaming          ?? currentProfile.useDreaming,
      applicationDefaultsText: incoming.applicationDefaultsText ?? currentProfile.applicationDefaultsText,
      applicationProfile: incoming.applicationProfile ?? currentProfile.applicationProfile,
      baseCv:          incoming.baseCv          ?? currentProfile.baseCv
    });

    addLog('Profile settings updated.', 'system');

    const { geminiApiKey, anthropicApiKey, openRouterApiKey, ...rest } = updated;
    res.json({
      success: true,
      profile: {
        ...rest,
        hasGeminiKey:    Boolean(geminiApiKey),
        hasAnthropicKey: Boolean(anthropicApiKey),
        hasOpenRouterKey: Boolean(openRouterApiKey)
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Apply a performance preset (Token Saver / Balanced / Maximum) — flips every
// cost-relevant toggle in one server-authoritative bundle. Never touches the
// provider choice, API keys, personal info, CV or answers.
app.post('/api/profile/preset', (req, res) => {
  try {
    const { mode } = req.body || {};
    if (!PERFORMANCE_PRESETS[mode]) {
      return res.status(400).json({ error: `Unknown performance mode: ${mode}` });
    }
    const updated = applyPerformancePreset(mode);
    addLog(`Performance mode applied: ${PERFORMANCE_PRESETS[mode].label}.`, 'system');
    const { geminiApiKey, anthropicApiKey, openRouterApiKey, ...rest } = updated;
    res.json({
      success: true,
      profile: {
        ...rest,
        performanceModeActual: detectActivePreset(updated),
        hasGeminiKey: Boolean(geminiApiKey),
        hasAnthropicKey: Boolean(anthropicApiKey),
        hasOpenRouterKey: Boolean(openRouterApiKey)
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------- AI usage & budget --------------------

// Today's token/search usage + estimated spend, per feature bucket, with a
// short history — powers the Settings → AI & Cost usage panel.
app.get('/api/usage', (req, res) => {
  try {
    res.json(getUsageSummary());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/usage', (req, res) => {
  try {
    clearUsage();
    addLog('AI usage history cleared.', 'system');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------- Backup / restore (Danger Zone safety net) --------------------

app.get('/api/backup', (req, res) => {
  try {
    res.json(getBackupInfo());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Restores db.json from the automatic pre-clear snapshot (db.backup.json).
app.post('/api/backup/restore', (req, res) => {
  try {
    const info = restoreDbBackup();
    addLog(`Database restored from backup (taken ${info.backedUpAt || 'unknown'}).`, 'system');
    res.json({ success: true, ...info });
  } catch (error) {
    res.status(400).json({ error: `Could not restore: ${error.message}` });
  }
});

app.delete('/api/profile/key/:provider', (req, res) => {
  try {
    const ok = clearKey(req.params.provider);
    if (!ok) return res.status(400).json({ error: 'Unknown provider' });
    addLog(`${req.params.provider} API key cleared.`, 'system');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------- Application Answers (bank + pending) --------------------

// Learn-as-you-go answer bank.
app.get('/api/application/bank', (req, res) => {
  try {
    res.json(getAnswerBank());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/application/bank', (req, res) => {
  try {
    const { question, answer } = req.body || {};
    if (!question || !answer) {
      return res.status(400).json({ error: 'Both question and answer are required.' });
    }
    const entry = upsertAnswer({ question, answer });
    res.json({ success: true, entry });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/application/bank/:id', (req, res) => {
  try {
    deleteAnswer(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Clear the ENTIRE answer bank (Danger Zone in Settings).
app.delete('/api/application/bank', (req, res) => {
  try {
    const removed = clearAnswerBank();
    addLog(`Cleared answer bank (${removed} entr${removed === 1 ? 'y' : 'ies'}).`, 'system');
    res.json({ success: true, removed });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Questions Agent 3 captured but couldn't answer.
app.get('/api/application/pending', (req, res) => {
  try {
    res.json(getPendingQuestions());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Answer a pending question → stores it in the bank and clears it from pending.
app.post('/api/application/pending/:id/resolve', (req, res) => {
  try {
    const { answer } = req.body || {};
    if (!answer) return res.status(400).json({ error: 'An answer is required.' });
    const entry = resolvePending(req.params.id, answer);
    if (!entry) return res.status(404).json({ error: 'Pending question not found.' });
    res.json({ success: true, entry });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Dismiss a pending question without answering it.
app.delete('/api/application/pending/:id', (req, res) => {
  try {
    clearPending(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Dismiss ALL pending questions (Danger Zone in Settings).
app.delete('/api/application/pending', (req, res) => {
  try {
    const removed = clearAllPending();
    addLog(`Cleared ${removed} pending question(s).`, 'system');
    res.json({ success: true, removed });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------- Supporting documents (ID, matric, degree, results) --------------------

// List every document slot with its upload status + metadata.
app.get('/api/documents', (req, res) => {
  try {
    res.json(getSupportingDocuments());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Upload (or replace) one document. Body: { docType, fileName, dataBase64 }.
// dataBase64 may be a data: URL or a bare base64 string; saveSupportingDocument
// validates it is a real PDF before writing it to disk.
app.post('/api/documents', (req, res) => {
  try {
    const { docType, fileName, dataBase64 } = req.body || {};
    if (!docType || !dataBase64) {
      return res.status(400).json({ error: 'docType and the file are required.' });
    }
    const entry = saveSupportingDocument({ docType, originalName: fileName, dataBase64 });
    addLog(`Supporting document saved: ${docType} (${entry.originalName}).`, 'system');
    res.json({ success: true, entry });
  } catch (error) {
    // Validation failures (not a PDF, unknown type) are user errors → 400.
    res.status(400).json({ error: error.message });
  }
});

// Remove one stored document.
app.delete('/api/documents/:docType', (req, res) => {
  try {
    deleteSupportingDocument(req.params.docType);
    addLog(`Supporting document removed: ${req.params.docType}.`, 'system');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------- Candidate Memory (evolving dossier) --------------------

// Full dossier: insights, employers, application outcome log.
app.get('/api/memory', (req, res) => {
  try {
    res.json(getCandidateMemory());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add a durable insight manually.
app.post('/api/memory/insight', (req, res) => {
  try {
    const { text, category } = req.body || {};
    if (!text || !String(text).trim()) {
      return res.status(400).json({ error: 'Insight text is required.' });
    }
    const entry = addInsight({ text, category, source: 'manual' });
    if (!entry) return res.status(409).json({ error: 'That insight already exists.' });
    res.json({ success: true, entry });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete an insight.
app.delete('/api/memory/insight/:id', (req, res) => {
  try {
    deleteInsight(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add a note about a specific employer.
app.post('/api/memory/employer', (req, res) => {
  try {
    const { company, note } = req.body || {};
    if (!company || !String(company).trim()) {
      return res.status(400).json({ error: 'Company is required.' });
    }
    const rec = upsertEmployerNote({ company, note });
    res.json({ success: true, entry: rec });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update an application's outcome (applied → interview → offer / rejected) — the
// signal the dossier uses to learn which phrasings win.
app.patch('/api/memory/application/:jobId', (req, res) => {
  try {
    const { outcome } = req.body || {};
    if (!outcome) return res.status(400).json({ error: 'An outcome is required.' });
    const rec = updateApplicationOutcome(req.params.jobId, outcome);
    if (!rec) return res.status(404).json({ error: 'Application not found in memory.' });
    res.json({ success: true, entry: rec });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Run a Dreaming pass on demand (the same curation the nightly routine does).
// Awaits the single AI call so the UI can show what changed.
app.post('/api/memory/dream', async (req, res) => {
  try {
    const result = await dreamOverMemory(getProfile());
    if (result.skipped === 'no-key') {
      return res.status(400).json({ error: 'No AI provider key is set — add one in Profile & Settings.' });
    }
    if (result.skipped === 'disabled') {
      return res.status(400).json({ error: 'Dreaming is turned off in Settings.' });
    }
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Wipe the entire dossier.
app.delete('/api/memory', (req, res) => {
  try {
    const mem = clearCandidateMemory();
    res.json({ success: true, memory: mem });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------- Jobs Routes --------------------

app.get('/api/jobs', (req, res) => {
  try {
    const jobs = getJobs();
    jobs.sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0));
    res.json(jobs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/jobs', (req, res) => {
  try {
    const { title, company, location, description, applyUrl, source } = req.body || {};
    if (!title || !company) {
      return res.status(400).json({ error: 'Title and company are required.' });
    }
    const job = {
      id: uuidv4(),
      title,
      company,
      location:   location   || 'South Africa',
      description: description || '',
      applyUrl:   applyUrl   || '',
      datePosted: new Date().toISOString().split('T')[0],
      matchScore: 75,
      status: 'found',
      source: source || 'Manual',
      tailoredCvText: '',
      tailoredCoverLetterText: '',
      dateAdded: new Date().toISOString().split('T')[0]
    };
    const added = addJob(job);
    if (added) {
      addLog(`Manual job added: ${title} at ${company}`, 'system');
      return res.json({ success: true, job });
    }
    res.status(409).json({ error: 'A similar job already exists.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/jobs/:id', (req, res) => {
  try {
    const updated = updateJob(req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: 'Job not found' });
    res.json({ success: true, job: updated });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/jobs', (req, res) => {
  try {
    clearAllJobs();
    addLog('All jobs cleared by user.', 'system');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/jobs/:id', (req, res) => {
  try {
    deleteJob(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Re-check the links of jobs already saved (postings go dead over time). Runs in
// the background and updates each job's linkStatus in place — it NEVER deletes a
// job, so a confirmed-dead link is just flagged 'dead' (red "Expired" badge).
let revalidating = false;
app.post('/api/jobs/revalidate', (req, res) => {
  if (revalidating) {
    return res.status(409).json({ error: 'A link re-check is already running.' });
  }
  revalidating = true;
  res.json({ success: true, message: 'Re-checking saved job links in the background.' });
  const statuses = Array.isArray(req.body?.statuses) && req.body.statuses.length
    ? req.body.statuses
    : ['found', 'tailored', 'tailoring'];
  revalidateJobLinks({ statuses })
    .catch((err) => addLog(`Link re-check failed: ${err.message}`, 'error'))
    .finally(() => { revalidating = false; });
});

// -------------------- Logs Routes --------------------

app.get('/api/logs', (req, res) => {
  try {
    res.json(getLogs());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/logs/clear', (req, res) => {
  try {
    clearLogs();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------- Status Route --------------------

app.get('/api/status', (req, res) => {
  try {
    res.json({
      hunter: getHunterState(),
      apply:  getApplyState(),
      routines: getRoutines(),
      uptime: process.uptime()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------- Agent Trigger Endpoints --------------------

app.post('/api/jobs/hunter', (req, res) => {
  const state = getHunterState();
  if (state.isRunning) {
    return res.status(409).json({
      error: 'Job hunter is already running. Please wait for the current scrape to finish.'
    });
  }

  res.json({ success: true, message: 'Agent 1: Job Hunter started in background.' });

  // stopRequested is reset on every fresh start so a prior cancel doesn't leak in.
  setHunterState({ isRunning: true, startedAt: new Date().toISOString(), finishedAt: null, stopRequested: false });
  runJobHunterAgent()
    .then((result) => {
      setHunterState({ isRunning: false, finishedAt: new Date().toISOString(), lastResult: result, stopRequested: false });
    })
    .catch((err) => {
      addLog(`Background Job Hunter failed: ${err.message}`, 'error');
      console.error('Job Hunter error:', err);
      setHunterState({ isRunning: false, finishedAt: new Date().toISOString(), stopRequested: false });
    });
});

// Cooperative cancellation: sets a flag the running hunter checks between sources.
app.post('/api/jobs/hunter/stop', (req, res) => {
  const state = getHunterState();
  if (!state.isRunning) {
    return res.status(409).json({ error: 'Job hunter is not currently running.' });
  }
  setHunterState({ stopRequested: true });
  addLog('Stop requested by user — hunter will halt after the current source.', 'system');
  res.json({ success: true, message: 'Stop requested. The hunter will wind down shortly.' });
});

// B3 fix: fire-and-forget like the other agents. Status goes found → tailoring
// → tailored (or back to found on hard failure) so the UI can track progress
// by polling /api/jobs instead of waiting on this HTTP connection.
app.post('/api/jobs/:id/tailor', (req, res) => {
  const jobId = req.params.id;
  const jobs = getJobs();
  const job = jobs.find((j) => j.id === jobId);

  if (!job) return res.status(404).json({ error: 'Job not found.' });
  if (job.status === 'tailoring') {
    return res.status(409).json({ error: 'Already tailoring this job.' });
  }

  updateJob(jobId, { status: 'tailoring' });
  res.json({ success: true, message: 'Agent 2: Document Tailor started.' });

  runDocumentTailorAgent(jobId).catch((err) => {
    addLog(`Document Tailor failed for job ${jobId}: ${err.message}`, 'error');
    console.error('Document Tailor error:', err);
    // Revert only if the agent threw before saving any CV (hard failure).
    const current = getJobs().find((j) => j.id === jobId);
    if (current && !current.tailoredCvText) {
      updateJob(jobId, { status: 'found' });
    }
  });
});

// T4: tailor many jobs concurrently (bounded by profile.tailorConcurrency).
// Body { jobIds?: string[] } — omit to tailor all currently 'found' jobs (top
// matches, hard-capped). Fire-and-forget like the single-job route: flips status
// to 'tailoring' up front, then the UI tracks completion via /api/jobs.
// SAFETY: this only runs Agent 2. It never applies / never submits.
app.post('/api/jobs/tailor-batch', (req, res) => {
  let { jobIds } = req.body || {};
  if (!Array.isArray(jobIds) || jobIds.length === 0) {
    jobIds = getJobs()
      .filter((j) => j.status === 'found')
      .sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0))
      .map((j) => j.id);
  }
  if (!jobIds.length) {
    return res.status(400).json({ error: 'No jobs to tailor. Find some jobs first.' });
  }

  res.json({ success: true, message: `Tailoring ${Math.min(jobIds.length, 10)} job(s) in parallel.`, queued: Math.min(jobIds.length, 10) });

  tailorJobsConcurrently(jobIds, { trigger: 'manual-batch' }).catch((err) => {
    addLog(`Batch tailoring failed: ${err.message}`, 'error');
    console.error('Batch tailor error:', err);
  });
});

app.post('/api/jobs/:id/apply', (req, res) => {
  const jobId = req.params.id;

  const applyState = getApplyState();
  if (applyState.isRunning) {
    return res.status(409).json({
      error: `An apply session is already open for another job. Close it first.`
    });
  }

  setApplyState({ isRunning: true, jobId, startedAt: new Date().toISOString() });
  res.json({ success: true, message: 'Agent 3: Apply Copilot launched on host machine.' });

  runApplyAssistantAgent(jobId).catch((err) => {
    addLog(`Apply Copilot failed: ${err.message}`, 'error');
    console.error('Apply Copilot error:', err);
  }).finally(() => {
    setApplyState({ isRunning: false, jobId: null, startedAt: null });
  });
});

// -------------------- Referral pipeline (post-application outreach) --------------------

// Find ONE senior engineering contact at the applied-to company (grounded web
// search, LinkedIn-search-link fallback) and draft a peer-to-peer outreach
// message. Manual trigger from the applied-job UI; awaited so the result returns
// directly. Persists to job.referral. Never sends anything — human-on-the-loop.
app.post('/api/jobs/:id/referral', async (req, res) => {
  const jobId = req.params.id;
  const job = getJobs().find((j) => j.id === jobId);
  if (!job) return res.status(404).json({ error: 'Job not found.' });

  try {
    const profile = getProfile();
    addLog(`[Referral] Building a direct outreach channel for "${job.title}" at ${job.company}…`, 'agent3');
    const referral = await runReferralPipeline(profile, job);
    updateJob(jobId, { referral });
    addLog(
      referral.grounded
        ? `[Referral] Channel ready: ${referral.contact.full_name || 'a contact'} at ${job.company}.`
        : `[Referral] Channel ready: LinkedIn search link + draft message for ${job.company}.`,
      'agent3'
    );
    res.json({ success: true, referral });
  } catch (err) {
    addLog(`[Referral] Pipeline failed: ${err.message}`, 'error');
    res.status(500).json({ error: err.message });
  }
});

// -------------------- Browser Session Setup --------------------

app.post('/api/browser/setup', (req, res) => {
  res.json({ success: true, message: 'Browser opened. Sign in to LinkedIn, Indeed, and other sites, then close the window.' });
  setupBrowserSession().catch((err) => {
    addLog(`Browser setup failed: ${err.message}`, 'error');
  });
});

app.get('/api/browser/login-status', async (req, res) => {
  try {
    const statuses = await checkLoginStatuses();
    res.json({ success: true, statuses });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------- Routines (T1: unattended recurring runs) --------------------
// SAFETY: routines only ever run the Hunter and (optionally) the Tailor. They
// never launch Agent 3 and never submit an application — see routineRunner.js.

app.get('/api/routines', (req, res) => {
  try {
    res.json(getRoutines());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/routines', (req, res) => {
  try {
    const routine = addRoutine(req.body || {});
    addLog(`Routine created: "${routine.name}".`, 'system');
    res.json({ success: true, routine });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.patch('/api/routines/:id', (req, res) => {
  try {
    const updated = updateRoutine(req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: 'Routine not found.' });
    res.json({ success: true, routine: updated });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/routines/:id', (req, res) => {
  try {
    deleteRoutine(req.params.id);
    addLog('Routine deleted.', 'system');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Run a routine immediately (manual trigger). Fire-and-forget like the agents:
// respond at once, let the scheduler's guards manage execution.
app.post('/api/routines/:id/run', (req, res) => {
  const routine = getRoutine(req.params.id);
  if (!routine) return res.status(404).json({ error: 'Routine not found.' });

  // Pre-check the concurrency guard so the user gets an immediate 409 instead of
  // a silent skip.
  const hunter = getHunterState();
  const apply = getApplyState();
  if (hunter.isRunning || apply.isRunning) {
    return res.status(409).json({ error: 'Another run is already in progress. Try again once it finishes.' });
  }

  res.json({ success: true, message: `Routine "${routine.name}" started.` });
  runRoutineNow(routine).catch((err) => {
    addLog(`Manual routine run failed: ${err.message}`, 'error');
  });
});

// -------------------- Health Check --------------------

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// -------------------- Startup --------------------

// SECURITY: bind to the loopback interface only. Without an explicit host,
// Express/Node listens on 0.0.0.0 (every interface), so anyone on the same
// Wi-Fi/LAN could reach this unauthenticated API — read the profile, trigger the
// hunter, even launch the apply browser. The CORS rule doesn't stop that (it only
// governs browser cross-origin requests and deliberately allows no-Origin clients
// like curl/the Electron renderer). Binding to 127.0.0.1 makes the API truly
// machine-local, matching the single-user desktop trust model in SECURITY.md.
const HOST = process.env.HOST || '127.0.0.1';
if (demoOrigin() && HOST !== '127.0.0.1') throw new Error('The demo API must bind to 127.0.0.1.');
const server = app.listen(PORT, HOST, () => {
  setHunterState({ isRunning: false, stopRequested: false });
  setApplyState({ isRunning: false, jobId: null, startedAt: null });
  console.log(`[SA-JAS Server] Backend running on http://${HOST}:${PORT}`);
  addLog(`System startup. Server running on port ${PORT}. Ready to launch agents.`, 'system');
  // T1: bring the routine scheduler online (also runs a one-time catch-up pass
  // for any daily/weekday routine whose slot passed while the app was closed).
  if (!demoOrigin()) startScheduler();
});

// The demo launcher owns this child and closes its disposable browser first.
if (demoOrigin()) {
  let closing = false;
  const stopDemo = async () => {
    if (closing) return;
    closing = true;
    await closeDemoBrowsers();
    server.close(() => process.exit(0));
  };
  process.on('message', message => { if (message?.type === 'stop-demo') void stopDemo(); });
  process.on('SIGINT', stopDemo);
  process.on('SIGTERM', stopDemo);
}
