import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { estimateCostUSD } from './costs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Data file paths ──────────────────────────────────────────────────────────
// In packaged Electron, DB_PATH and KEYS_PATH are injected by the main process
// pointing at app.getPath('userData') — a writable directory outside the ASAR.
// In dev mode the old project-root paths are used as fallback.
const DB_PATH   = process.env.DB_PATH   || path.join(__dirname, '../../../db.json');
const KEYS_PATH = process.env.KEYS_PATH || path.join(path.dirname(DB_PATH), 'keys.json');
export const BROWSER_PROFILE_PATH = process.env.BROWSER_PROFILE_PATH || path.join(path.dirname(DB_PATH), 'browser-profile');
// Where Agent 2 writes generated CV/cover-letter PDFs and Agent 3 saves
// submission-confirmation screenshots. Injected in packaged Electron; falls back
// to a project-root dir in dev.
export const GENERATED_DOCS_PATH = process.env.GENERATED_DOCS_PATH || path.join(path.dirname(DB_PATH), 'generated-docs');
// Where the user's reusable supporting documents live (ID, matric certificate,
// degree/diploma, academic record). These are the user's OWN files, attached by
// Agent 3 to the matching upload field on an application form. Injected in
// packaged Electron; project-root fallback in dev. Gitignored.
export const SUPPORTING_DOCS_PATH = process.env.SUPPORTING_DOCS_PATH || path.join(path.dirname(DB_PATH), 'supporting-docs');

// Canonical set of supporting-document types the suite understands. `key` is the
// stable id + on-disk filename stem; `label` is shown in Settings; `match` is the
// regex Agent 3 uses to recognise the right file-upload field on a form. Order
// matters: more specific types are listed first so a generic "qualification"
// field doesn't grab the matric before the degree.
export const SUPPORTING_DOC_TYPES = [
  {
    key: 'id',
    label: 'ID Document / Passport',
    match: /\b(id\s*document|identity\s*document|id\s*copy|copy\s*of\s*(your\s*)?id|certified\s*id|national\s*id|smart\s*id|green\s*(bar(coded)?\s*)?id|id\/passport|passport|rsa\s*id|sa\s*id|id\s*number\s*document)\b/i
  },
  {
    key: 'matric',
    label: 'Matric Certificate (Grade 12)',
    match: /\b(matric(ulation)?|grade\s*12|senior\s*certificate|national\s*senior\s*certificate|nsc|school\s*leaving|matric\s*certificate)\b/i
  },
  {
    key: 'degree',
    label: 'Degree / Diploma Certificate',
    match: /\b(degree|diploma|graduation\s*certificate|qualification\s*certificate|tertiary\s*qualification|certificate\s*of\s*qualification|highest\s*qualification\s*(certificate|document)|btech|national\s*diploma)\b/i
  },
  {
    key: 'academicRecord',
    label: 'Academic Record / Statement of Results',
    match: /\b(academic\s*record|academic\s*transcript|statement\s*of\s*results|academic\s*results|transcript|record\s*of\s*results|results\s*(slip|statement))\b/i
  }
];
const SUPPORTING_DOC_KEYS = SUPPORTING_DOC_TYPES.map((d) => d.key);

// A real PDF starts with the "%PDF" magic bytes. We refuse to store or attach
// anything that isn't one — this is the guard that stops a stray .md/.txt being
// uploaded to a portal in place of a PDF.
export function isPdfBuffer(buf) {
  return Buffer.isBuffer(buf) && buf.length > 4 &&
    buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46; // %PDF
}
export function isRealPdfFile(filePath) {
  try {
    if (!filePath || !/\.pdf$/i.test(filePath) || !fs.existsSync(filePath)) return false;
    const fd = fs.openSync(filePath, 'r');
    const head = Buffer.alloc(5);
    fs.readSync(fd, head, 0, 5, 0);
    fs.closeSync(fd);
    return isPdfBuffer(head);
  } catch {
    return false;
  }
}

// ── Schema defaults ──────────────────────────────────────────────────────────
const DEFAULT_DB = {
  profile: {
    aiProvider: 'gemini',
    selectedModel: '',
    fullName: '',
    email: '',
    phone: '',
    linkedInUrl: '',
    portfolioUrl: '',
    keywords: 'Software Engineer, Software Developer, Full Stack Developer, IT Specialist',
    locations: 'Johannesburg, Pretoria, Gauteng, Remote',
    maxKeywords: 3,
    maxLocations: 2,
    // Performance mode: which preset bundle ('saver' | 'balanced' | 'max') was
    // last APPLIED. The UI highlights the preset whose values actually match the
    // current profile (detectActivePreset), so manual tweaks read as "Custom".
    performanceMode: 'balanced',
    // AI search thoroughness (Agent 1): 'light' (cheapest), 'standard', or
    // 'deep' (second search round per keyword + higher caps — most thorough).
    searchDepth: 'standard',
    // Daily AI spend cap in USD (estimates — see db/costs.js). 0 = no cap.
    // When today's estimated spend exceeds this, every AI entry point refuses
    // with a clear log until tomorrow (or until the cap is raised).
    dailyBudgetUSD: 0,
    // AI web-search engine (Claude). Primary, grounded job source for Agent 1.
    useAiSearch: true,
    aiSearchModel: '',
    // Link validation (Agent 1). When ON, every candidate job link is shape-checked
    // and fetched to confirm the posting is live before it's saved — drops only
    // confirmed-dead links; search/category links are kept as linkless leads.
    // Default ON. See linkValidator.js.
    useLinkValidation: true,
    // AI link repair (Agent 1). When ON, a job kept WITHOUT a usable link triggers
    // a grounded Claude web search for the real posting URL (capped per run).
    // Anthropic-only and billed per search → default OFF.
    useLinkRepair: false,
    // Agent 3 page understanding. The planner is a cheap text call that lets the
    // copilot comprehend a page (form vs listing vs login) and decide what to do;
    // vision is an opt-in screenshot fallback (more expensive, Gemini/Anthropic).
    useAiPlanner: true,
    useVision: false,
    // T3 computer-use: opt-in Anthropic driver that SEES and operates the live
    // form as a finisher after smart-fill. Anthropic-only, off by default (it's
    // the most token-hungry feature). Never submits — see agents/computerUse.js.
    useComputerUse: false,
    computerUseModel: '',
    computerUseMaxSteps: 12,
    // T4 parallel sub-agents. tailorConcurrency caps how many jobs are tailored
    // at once (1–5; the cost cap / tier gate). useResearchFanout spawns a grounded
    // company-research sub-agent per job to enrich cover letters — Anthropic-only,
    // token-hungry, off by default (a top-tier feature).
    tailorConcurrency: 3,
    useResearchFanout: false,
    // Anthropic-only cost/reliability features (see agents/llm.js). Default ON;
    // honoured only on the Anthropic provider, ignored elsewhere.
    useStructuredOutputs: true,
    usePromptCaching: true,
    // T2 "Dreaming": a periodic reflective pass that curates the candidate
    // dossier — reinforces insights tied to interviews/offers, prunes redundant
    // ones. Provider-agnostic; default ON; no-ops without a key.
    useDreaming: true,
    // Evolving candidate memory — after each confirmed application an AI
    // "reflection" pass distills durable insights (preferences, strengths,
    // winning phrasings, employer notes) into candidateMemory below. Toggle in
    // Settings; provider-agnostic (uses whichever key is set). Default ON, but
    // no-ops gracefully when no provider key is available.
    useMemoryReflection: true,
    // Free-form "anything else" catch-all the user volunteers. Still used by
    // Agent 3's AI field-mapper as extra context, but the structured
    // applicationProfile below is now the primary, deterministic source.
    applicationDefaultsText: '',
    // Structured answers to the questions that recur on SA job-application sites.
    // Filled via the guided questionnaire in Settings. Agent 3 maps these to form
    // fields DETERMINISTICALLY (no LLM guessing for demographics/salary). All
    // optional; sensitive attributes (EE race/gender/disability, salary) live
    // here only because the user chose to enter them into their own local app.
    // NOTE: ID/passport number is deliberately NOT stored — paste it per-application.
    applicationProfile: {
      rightToWorkSA: '',        // Yes / No
      nationality: '',
      eeRace: '',               // EE / population group (optional)
      gender: '',
      disability: '',           // Yes / No
      noticePeriod: '',
      currentSalary: '',
      expectedSalary: '',
      willingToRelocate: '',    // Yes / No
      driversLicense: '',       // None / Code A / Code B / Code C ...
      ownVehicle: '',           // Yes / No
      highestQualification: '',
      yearsExperience: '',
      criminalRecord: '',       // Yes / No
      creditCheckConsent: '',   // Yes / No
      languages: '',
      availabilityDate: ''
    },
    baseCv: ''
  },
  jobs: [],
  // Reusable supporting documents the user uploads once (ID, matric, degree,
  // academic record). Stored as metadata only — the PDFs live on disk in
  // SUPPORTING_DOCS_PATH. Keyed by the doc-type key (see SUPPORTING_DOC_TYPES):
  //   { [key]: { fileName, originalName, uploadedAt, size } }
  supportingDocuments: {},
  // Learn-as-you-go Q&A. Agent 3 saves answers the user gives to questions that
  // weren't in the structured profile, keyed by normalized question text, and
  // reuses them on future applications across any site.
  answerBank: [],
  // Questions Agent 3 encountered but couldn't answer — surfaced in Settings so
  // the user can answer them once and feed the answerBank.
  pendingQuestions: [],
  // ── Evolving candidate dossier ────────────────────────────────────────────
  // Grows with every application. insights = AI/manually distilled durable facts
  // about the candidate; employers = per-company notes; applications = an outcome
  // log (screening Q&A transcript + salary snapshot) the user can mark
  // applied → interview → offer/rejected, so the suite learns which phrasings win.
  // All three agents read a compact digest of this (buildMemoryDigest).
  candidateMemory: {
    version: 1,
    updatedAt: null,
    insights: [],      // { id, text, category, source, createdAt, weight, lastConfirmedAt }
    employers: [],     // { id, company, normalized, notes:[string], applications:int, updatedAt }
    applications: [],  // { id, jobId, title, company, appliedAt, outcome, salarySnapshot, transcript:[{question,answer}] }
    // T2: result of the last Dreaming pass — { at, added, reinforced, pruned }.
    lastDream: null
  },
  // ── Routines (T1): unattended, recurring runs ──────────────────────────────
  // Each routine runs the Hunter (and optionally auto-tailors the top matches)
  // on a schedule, so the user wakes up to application-ready packages. Routines
  // DELIBERATELY never run Agent 3 / never auto-submit — they only find and
  // prepare; the human always reviews and applies. Stored here (no API keys).
  //   { id, name, enabled, type:'hunt'|'hunt_and_tailor',
  //     schedule:{ frequency:'daily'|'weekdays'|'every_n_hours', timeOfDay:'HH:MM', everyHours:int },
  //     autoTailorCount:int, catchUp:bool, createdAt,
  //     lastRun, lastStatus:'idle'|'running'|'ok'|'error'|'skipped', lastResult }
  routines: [],
  hunterState: {
    isRunning: false,
    startedAt: null,
    finishedAt: null,
    lastResult: null,
    stopRequested: false
  },
  applyState: {
    isRunning: false,
    jobId: null,
    startedAt: null
  },
  // ── AI usage ledger ─────────────────────────────────────────────────────────
  // Per-day token/search tallies + ESTIMATED USD cost, bucketed by feature
  // ('ai-search', 'research', 'core', …) so the user can see exactly what is
  // draining the key. Pruned to the most recent ~35 days. See db/costs.js.
  //   days: { 'YYYY-MM-DD': { calls, inputTokens, outputTokens, cacheReadTokens,
  //                           cacheWriteTokens, webSearches, estCostUSD,
  //                           byBucket: { [bucket]: same-shape-minus-byBucket } } }
  usage: { days: {} }
};

const DEFAULT_KEYS = {
  geminiApiKey: '',
  anthropicApiKey: '',
  openRouterApiKey: ''
};

// ── In-memory log buffer ─────────────────────────────────────────────────────
// Logs are intentionally not persisted — they're per-session agent output.
// Keeping them in memory eliminates the read-modify-write of the entire db.json
// on every addLog call inside the scraper's hot loop.
let logBuffer = [];

// ── Core DB helpers ──────────────────────────────────────────────────────────
function initDb() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(DEFAULT_DB, null, 2), 'utf-8');
  }
}

export function readDb() {
  initDb();
  try {
    const data = fs.readFileSync(DB_PATH, 'utf-8');
    const parsed = JSON.parse(data);
    return {
      ...DEFAULT_DB,
      ...parsed,
      profile: {
        ...DEFAULT_DB.profile,
        ...(parsed.profile || {}),
        // Deep-merge so newly-added structured keys still get defaults.
        applicationProfile: {
          ...DEFAULT_DB.profile.applicationProfile,
          ...((parsed.profile || {}).applicationProfile || {})
        }
      },
      supportingDocuments: (parsed.supportingDocuments && typeof parsed.supportingDocuments === 'object' && !Array.isArray(parsed.supportingDocuments)) ? parsed.supportingDocuments : {},
      answerBank:      Array.isArray(parsed.answerBank)      ? parsed.answerBank      : [],
      pendingQuestions: Array.isArray(parsed.pendingQuestions) ? parsed.pendingQuestions : [],
      routines:        Array.isArray(parsed.routines)        ? parsed.routines        : [],
      candidateMemory: {
        ...DEFAULT_DB.candidateMemory,
        ...(parsed.candidateMemory || {}),
        insights:     Array.isArray((parsed.candidateMemory || {}).insights)     ? parsed.candidateMemory.insights     : [],
        employers:    Array.isArray((parsed.candidateMemory || {}).employers)    ? parsed.candidateMemory.employers    : [],
        applications: Array.isArray((parsed.candidateMemory || {}).applications) ? parsed.candidateMemory.applications : []
      },
      hunterState: { ...DEFAULT_DB.hunterState, ...(parsed.hunterState || {}) },
      applyState:  { ...DEFAULT_DB.applyState,  ...(parsed.applyState  || {}) },
      usage: (parsed.usage && typeof parsed.usage === 'object' && parsed.usage.days)
        ? parsed.usage
        : { days: {} }
    };
  } catch {
    return { ...DEFAULT_DB };
  }
}

export function writeDb(data) {
  initDb();
  // Errors are allowed to propagate — a silent swallow here is what caused
  // writes to fail invisibly when the packaged ASAR directory was read-only.
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

// ── API-key helpers (separate file, never stored in db.json) ─────────────────
function readKeys() {
  if (!fs.existsSync(KEYS_PATH)) {
    // One-time migration: if an old db.json has keys inside the profile object,
    // move them to keys.json so the user doesn't have to re-enter them.
    try {
      const raw = fs.readFileSync(DB_PATH, 'utf-8');
      const old = JSON.parse(raw);
      const p = old.profile || {};
      if (p.geminiApiKey || p.anthropicApiKey || p.openRouterApiKey) {
        const migrated = {
          geminiApiKey:     p.geminiApiKey     || '',
          anthropicApiKey:  p.anthropicApiKey  || '',
          openRouterApiKey: p.openRouterApiKey || ''
        };
        writeKeys(migrated);
        delete p.geminiApiKey;
        delete p.anthropicApiKey;
        delete p.openRouterApiKey;
        fs.writeFileSync(DB_PATH, JSON.stringify(old, null, 2), 'utf-8');
        return { ...DEFAULT_KEYS, ...migrated };
      }
    } catch {}
    return { ...DEFAULT_KEYS };
  }
  try {
    return { ...DEFAULT_KEYS, ...JSON.parse(fs.readFileSync(KEYS_PATH, 'utf-8')) };
  } catch {
    return { ...DEFAULT_KEYS };
  }
}

function writeKeys(keys) {
  // mode 0o600: owner-only read/write where the OS honours it (POSIX). On
  // Windows this is mostly a no-op, but the file already lives in the user's
  // own profile directory — this just tightens the posture elsewhere.
  fs.writeFileSync(KEYS_PATH, JSON.stringify(keys, null, 2), { encoding: 'utf-8', mode: 0o600 });
}

// ── Profile ───────────────────────────────────────────────────────────────────
// getProfile merges db fields + keys so callers see one unified object and
// don't need to know about the two-file separation.
export function getProfile() {
  return { ...readDb().profile, ...readKeys() };
}

export function saveProfile(profile) {
  const db = readDb();
  const currentKeys = readKeys();

  const { geminiApiKey, anthropicApiKey, openRouterApiKey, ...profileFields } = profile;

  const mergeKey = (incoming, existing) =>
    (incoming !== undefined && typeof incoming === 'string' && incoming.trim().length > 0)
      ? incoming.trim()
      : existing;

  const updatedKeys = {
    geminiApiKey:     mergeKey(geminiApiKey,     currentKeys.geminiApiKey),
    anthropicApiKey:  mergeKey(anthropicApiKey,  currentKeys.anthropicApiKey),
    openRouterApiKey: mergeKey(openRouterApiKey, currentKeys.openRouterApiKey)
  };

  writeKeys(updatedKeys);
  // Deep-merge the structured applicationProfile so a partial save never wipes
  // unrelated fields.
  const mergedAppProfile = profileFields.applicationProfile
    ? { ...db.profile.applicationProfile, ...profileFields.applicationProfile }
    : db.profile.applicationProfile;
  db.profile = { ...db.profile, ...profileFields, applicationProfile: mergedAppProfile };
  // Sanitise the cost-control fields so a bad payload can't disable the budget
  // guard or set a nonsense search depth.
  if (!SEARCH_DEPTHS.includes(db.profile.searchDepth)) db.profile.searchDepth = 'standard';
  if (!['saver', 'balanced', 'max', 'custom'].includes(db.profile.performanceMode)) db.profile.performanceMode = 'custom';
  {
    const cap = parseFloat(db.profile.dailyBudgetUSD);
    db.profile.dailyBudgetUSD = Number.isFinite(cap) && cap > 0 ? Math.min(cap, 1000) : 0;
  }
  writeDb(db);

  return { ...db.profile, ...updatedKeys };
}

// ── Supporting documents (ID, matric, degree, academic record) ─────────────────
// The user's own files, uploaded once and reused. PDFs only — enforced here and
// again at attach time in Agent 3, so a markdown/text file can never slip into a
// portal in place of a PDF.

export function getSupportingDocuments() {
  const docs = readDb().supportingDocuments || {};
  // Echo back the configured types so the UI can render every slot, filled or not.
  return SUPPORTING_DOC_TYPES.map((t) => ({
    key: t.key,
    label: t.label,
    uploaded: Boolean(docs[t.key]),
    ...(docs[t.key] || {})
  }));
}

/**
 * Saves one supporting document. `dataBase64` may be a bare base64 string or a
 * data: URL ("data:application/pdf;base64,...."). Validates the decoded bytes are
 * a real PDF, writes <key>.pdf to disk, and records metadata. Throws on bad input.
 */
export function saveSupportingDocument({ docType, originalName = '', dataBase64 = '' }) {
  if (!SUPPORTING_DOC_KEYS.includes(docType)) throw new Error(`Unknown document type: ${docType}`);
  const b64 = String(dataBase64).includes(',') ? String(dataBase64).split(',').pop() : String(dataBase64);
  let buf;
  try { buf = Buffer.from(b64, 'base64'); } catch { throw new Error('Could not decode the uploaded file.'); }
  if (!isPdfBuffer(buf)) throw new Error('That file is not a PDF. Please upload your document as a PDF.');
  // Size cap: a certified-copy PDF is a few MB at most; refuse anything huge so a
  // mis-clicked file can't balloon disk usage or the JSON body pipeline.
  const MAX_DOC_BYTES = 15 * 1024 * 1024;
  if (buf.length > MAX_DOC_BYTES) throw new Error('That PDF is larger than 15 MB. Please upload a smaller scan.');

  fs.mkdirSync(SUPPORTING_DOCS_PATH, { recursive: true });
  const fileName = `${docType}.pdf`;
  fs.writeFileSync(path.join(SUPPORTING_DOCS_PATH, fileName), buf);

  const db = readDb();
  db.supportingDocuments = db.supportingDocuments || {};
  db.supportingDocuments[docType] = {
    fileName,
    originalName: String(originalName || fileName).slice(0, 200),
    uploadedAt: new Date().toISOString(),
    size: buf.length
  };
  writeDb(db);
  return db.supportingDocuments[docType];
}

export function deleteSupportingDocument(docType) {
  const db = readDb();
  if (db.supportingDocuments && db.supportingDocuments[docType]) {
    const fp = path.join(SUPPORTING_DOCS_PATH, db.supportingDocuments[docType].fileName || `${docType}.pdf`);
    try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch {}
    delete db.supportingDocuments[docType];
    writeDb(db);
  }
  return true;
}

/**
 * Returns the absolute on-disk path of a stored supporting doc, but ONLY if the
 * file is present and is a genuine PDF. Returns null otherwise — Agent 3 relies
 * on this so it never attaches a missing or non-PDF file.
 */
export function getSupportingDocPath(docType) {
  const db = readDb();
  const meta = (db.supportingDocuments || {})[docType];
  if (!meta) return null;
  const fp = path.join(SUPPORTING_DOCS_PATH, meta.fileName || `${docType}.pdf`);
  return isRealPdfFile(fp) ? fp : null;
}

// ── Application answers: structured profile + learn-as-you-go bank ─────────────

/**
 * Normalizes a question / field label so the same question phrased slightly
 * differently across sites maps to one answer-bank entry. Lowercases, drops
 * parentheticals and punctuation, and strips filler words.
 */
export function normalizeQuestion(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')                       // drop "(optional)" etc.
    .replace(/[^a-z0-9\s]/g, ' ')                      // strip punctuation/asterisks
    .replace(/\b(required|optional|please|kindly|your|the)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getAnswerBank() {
  return readDb().answerBank || [];
}

/**
 * Inserts or updates a learned answer, keyed by normalized question text.
 * Returns the stored entry, or null if question/answer were empty.
 */
export function upsertAnswer({ question, answer }) {
  if (!question || !answer || !String(answer).trim()) return null;
  const db = readDb();
  if (!Array.isArray(db.answerBank)) db.answerBank = [];
  const normalized = normalizeQuestion(question);
  const now = new Date().toISOString();
  const existing = db.answerBank.find((a) => a.normalized === normalized);
  if (existing) {
    existing.question = question;
    existing.answer = String(answer).trim();
    existing.updatedAt = now;
    writeDb(db);
    return existing;
  }
  const entry = { id: randomUUID(), question, normalized, answer: String(answer).trim(), createdAt: now, updatedAt: now };
  db.answerBank.push(entry);
  writeDb(db);
  return entry;
}

export function deleteAnswer(id) {
  const db = readDb();
  db.answerBank = (db.answerBank || []).filter((a) => a.id !== id);
  writeDb(db);
}

/** Wipes the entire learn-as-you-go answer bank. Returns the number removed. */
export function clearAnswerBank() {
  backupDb('clear-answer-bank');
  const db = readDb();
  const n = (db.answerBank || []).length;
  db.answerBank = [];
  writeDb(db);
  return n;
}

export function getPendingQuestions() {
  return readDb().pendingQuestions || [];
}

/**
 * Records a question Agent 3 couldn't answer. Deduped against both the pending
 * list and the answer bank (already-answered questions aren't re-queued).
 * Returns the new entry, or null if it was a duplicate/empty.
 */
export function addPendingQuestion({ question, jobId = null }) {
  if (!question || !String(question).trim()) return null;
  const db = readDb();
  if (!Array.isArray(db.pendingQuestions)) db.pendingQuestions = [];
  const normalized = normalizeQuestion(question);
  if (!normalized) return null;
  if ((db.answerBank || []).some((a) => a.normalized === normalized)) return null;
  if (db.pendingQuestions.some((q) => q.normalized === normalized)) return null;
  const entry = { id: randomUUID(), question, normalized, jobId, seenAt: new Date().toISOString() };
  db.pendingQuestions.push(entry);
  // Cap growth so a pathological page can't balloon the file.
  if (db.pendingQuestions.length > 100) db.pendingQuestions.shift();
  writeDb(db);
  return entry;
}

/**
 * Answers a pending question: removes it from the queue and (if an answer was
 * given) stores it in the answer bank for reuse.
 */
export function resolvePending(id, answer) {
  const db = readDb();
  const idx = (db.pendingQuestions || []).findIndex((q) => q.id === id);
  if (idx === -1) return null;
  const [q] = db.pendingQuestions.splice(idx, 1);
  writeDb(db);
  if (answer && String(answer).trim()) return upsertAnswer({ question: q.question, answer });
  return null;
}

export function clearPending(id) {
  const db = readDb();
  db.pendingQuestions = (db.pendingQuestions || []).filter((q) => q.id !== id);
  writeDb(db);
}

/** Wipes all captured-but-unanswered questions. Returns the number removed. */
export function clearAllPending() {
  backupDb('clear-pending');
  const db = readDb();
  const n = (db.pendingQuestions || []).length;
  db.pendingQuestions = [];
  writeDb(db);
  return n;
}

// ── Evolving candidate memory (dossier) ───────────────────────────────────────
// A growing profile of the person that all three agents read. Distinct from the
// answerBank (reusable per-field answers) — this holds durable INSIGHTS, per-
// EMPLOYER notes, and an APPLICATION outcome log used to learn what wins.
export const INSIGHT_CATEGORIES = ['preference', 'strength', 'achievement', 'style', 'constraint', 'other'];
const MAX_INSIGHTS = 250;

export function getCandidateMemory() {
  return readDb().candidateMemory;
}

function touchMemory(mem) {
  mem.updatedAt = new Date().toISOString();
  return mem;
}

/**
 * Adds a durable insight about the candidate, deduped by normalized text. The
 * category is coerced to the known set. Returns the entry, or null if empty/dup.
 */
export function addInsight({ text, category = 'other', source = 'manual', weight = 1 }) {
  if (!text || !String(text).trim()) return null;
  const clean = String(text).trim();
  const db = readDb();
  const mem = db.candidateMemory;
  if (!Array.isArray(mem.insights)) mem.insights = [];
  const normalized = normalizeQuestion(clean);
  if (mem.insights.some((i) => normalizeQuestion(i.text) === normalized)) return null;
  const cat = INSIGHT_CATEGORIES.includes(category) ? category : 'other';
  const w = Math.max(1, Math.min(10, parseInt(weight, 10) || 1));
  const now = new Date().toISOString();
  const entry = { id: randomUUID(), text: clean, category: cat, source, createdAt: now, weight: w, lastConfirmedAt: now };
  mem.insights.push(entry);
  if (mem.insights.length > MAX_INSIGHTS) mem.insights.shift();
  touchMemory(mem);
  writeDb(db);
  return entry;
}

/**
 * Strengthens an existing insight (the Dreaming signal that a phrasing/fact keeps
 * paying off). Matches by id OR normalized text. Bumps weight (capped) and stamps
 * lastConfirmedAt. Returns the updated insight, or null if not found.
 */
export function reinforceInsight(idOrText, by = 1) {
  const db = readDb();
  const mem = db.candidateMemory;
  if (!Array.isArray(mem.insights)) return null;
  const norm = normalizeQuestion(idOrText);
  const rec = mem.insights.find((i) => i.id === idOrText || normalizeQuestion(i.text) === norm);
  if (!rec) return null;
  rec.weight = Math.max(1, Math.min(10, (parseInt(rec.weight, 10) || 1) + (parseInt(by, 10) || 1)));
  rec.lastConfirmedAt = new Date().toISOString();
  touchMemory(mem);
  writeDb(db);
  return rec;
}

/**
 * Records the summary of a Dreaming pass so the UI can show "last reflected …".
 */
export function recordDreamResult({ added = 0, reinforced = 0, pruned = 0 } = {}) {
  const db = readDb();
  const mem = db.candidateMemory;
  mem.lastDream = { at: new Date().toISOString(), added, reinforced, pruned };
  touchMemory(mem);
  writeDb(db);
  return mem.lastDream;
}

export function deleteInsight(id) {
  const db = readDb();
  const mem = db.candidateMemory;
  mem.insights = (mem.insights || []).filter((i) => i.id !== id);
  touchMemory(mem);
  writeDb(db);
}

/**
 * Appends a note to a per-employer record (deduped), keyed by normalized company
 * name. Creates the employer record if it doesn't exist.
 */
export function upsertEmployerNote({ company, note }) {
  if (!company || !String(company).trim()) return null;
  const db = readDb();
  const mem = db.candidateMemory;
  if (!Array.isArray(mem.employers)) mem.employers = [];
  const normalized = normalizeQuestion(company);
  let rec = mem.employers.find((e) => e.normalized === normalized);
  if (!rec) {
    rec = { id: randomUUID(), company: String(company).trim(), normalized, notes: [], applications: 0, updatedAt: null };
    mem.employers.push(rec);
  }
  const clean = note && String(note).trim();
  if (clean && !rec.notes.includes(clean)) rec.notes.push(clean);
  rec.updatedAt = new Date().toISOString();
  touchMemory(mem);
  writeDb(db);
  return rec;
}

/**
 * Records (or updates) an application in the outcome log, keyed by jobId. Bumps
 * the employer's application count the first time a given job is recorded.
 */
export function recordApplication({ jobId, title, company, salarySnapshot = null, transcript = [], outcome = 'applied' }) {
  const db = readDb();
  const mem = db.candidateMemory;
  if (!Array.isArray(mem.applications)) mem.applications = [];
  const cleanTranscript = Array.isArray(transcript)
    ? transcript
        .filter((t) => t && t.question && t.answer)
        .map((t) => ({ question: String(t.question).slice(0, 300), answer: String(t.answer).slice(0, 1500) }))
    : [];
  let rec = jobId ? mem.applications.find((a) => a.jobId === jobId) : null;
  const isNew = !rec;
  if (!rec) {
    rec = {
      id: randomUUID(), jobId: jobId || null, title: title || '', company: company || '',
      appliedAt: new Date().toISOString(), outcome, salarySnapshot, transcript: cleanTranscript
    };
    mem.applications.push(rec);
  } else {
    rec.title = title || rec.title;
    rec.company = company || rec.company;
    if (outcome) rec.outcome = outcome;
    if (salarySnapshot) rec.salarySnapshot = salarySnapshot;
    if (cleanTranscript.length) rec.transcript = cleanTranscript;
  }
  if (isNew && company && String(company).trim()) {
    const normalized = normalizeQuestion(company);
    if (!Array.isArray(mem.employers)) mem.employers = [];
    let emp = mem.employers.find((e) => e.normalized === normalized);
    if (!emp) {
      emp = { id: randomUUID(), company: String(company).trim(), normalized, notes: [], applications: 0, updatedAt: null };
      mem.employers.push(emp);
    }
    emp.applications = (emp.applications || 0) + 1;
    emp.updatedAt = new Date().toISOString();
  }
  touchMemory(mem);
  writeDb(db);
  return rec;
}

/**
 * Updates the outcome of a recorded application (applied → interview → offer /
 * rejected). This is the signal that lets the dossier learn which phrasings won.
 * Accepts either the application's jobId or its own id.
 */
export function updateApplicationOutcome(idOrJobId, outcome) {
  const db = readDb();
  const mem = db.candidateMemory;
  const rec = (mem.applications || []).find((a) => a.jobId === idOrJobId || a.id === idOrJobId);
  if (!rec) return null;
  rec.outcome = outcome;
  touchMemory(mem);
  writeDb(db);
  return rec;
}

export function clearCandidateMemory() {
  backupDb('clear-candidate-memory');
  const db = readDb();
  db.candidateMemory = { version: 1, updatedAt: new Date().toISOString(), insights: [], employers: [], applications: [], lastDream: null };
  writeDb(db);
  return db.candidateMemory;
}

/**
 * Builds a compact, prompt-ready digest of the dossier for Agent 2 (tailoring)
 * and Agent 3 (smart-fill). Optionally focuses employer notes on a target
 * company. Returns '' when the dossier is empty so callers can skip it cleanly.
 */
export function buildMemoryDigest({ company = '', maxInsights = 14 } = {}) {
  const mem = readDb().candidateMemory || {};
  const lines = [];

  // Surface the strongest insights first: weight (reinforced by Dreaming when a
  // phrasing keeps winning) desc, then most-recently-confirmed. Falls back
  // gracefully for older insights that predate weighting.
  const insights = [...(mem.insights || [])]
    .sort((a, b) => {
      const wa = a.weight || 1, wb = b.weight || 1;
      if (wb !== wa) return wb - wa;
      return new Date(b.lastConfirmedAt || b.createdAt || 0) - new Date(a.lastConfirmedAt || a.createdAt || 0);
    })
    .slice(0, maxInsights);
  if (insights.length) {
    lines.push('Candidate insights (learned over time, strongest first):');
    for (const i of insights) lines.push(`- [${i.category}] ${i.text}`);
  }

  const employers = mem.employers || [];
  const norm = normalizeQuestion(company || '');
  const target = norm ? employers.find((e) => e.normalized === norm) : null;
  if (target && target.notes.length) {
    lines.push('', 'Employer notes:', `- ${target.company}: ${target.notes.join(' | ')}`);
  }

  const apps = (mem.applications || []).slice(-8);
  const wins = apps.filter((a) => ['interview', 'offer'].includes(a.outcome));
  if (wins.length) {
    lines.push('', 'Roles that advanced to interview/offer (emphasise what worked):');
    for (const a of wins) lines.push(`- ${a.title}${a.company ? ' @ ' + a.company : ''} (${a.outcome})`);
  }
  const salaried = apps.filter((a) => a.salarySnapshot && (a.salarySnapshot.current || a.salarySnapshot.expected));
  if (salaried.length) {
    const last = salaried[salaried.length - 1].salarySnapshot;
    lines.push('', `Salary reference — current: ${last.current || 'n/a'}, expected: ${last.expected || 'n/a'}.`);
  }

  return lines.join('\n').trim();
}

export function clearKey(provider) {
  const field = {
    gemini:      'geminiApiKey',
    anthropic:   'anthropicApiKey',
    openrouter:  'openRouterApiKey'
  }[provider];
  if (!field) return false;
  const keys = readKeys();
  keys[field] = '';
  writeKeys(keys);
  return true;
}

// ── Jobs ─────────────────────────────────────────────────────────────────────
export function getJobs() {
  return readDb().jobs;
}

// A link is "usable" if it's a real http(s) URL that hasn't been stripped to a
// linkless lead or confirmed dead. Used by the upgrade-on-duplicate path below.
function hasUsableLink(job) {
  return Boolean(job && job.applyUrl) &&
    /^https?:\/\//i.test(job.applyUrl) &&
    job.linkStatus !== 'no-link' && job.linkStatus !== 'dead';
}

export function addJob(job) {
  const db = readDb();
  const exists = db.jobs.find(
    (j) => (job.applyUrl && j.applyUrl === job.applyUrl) ||
           (j.title === job.title && j.company === job.company)
  );
  if (!exists) {
    db.jobs.push(job);
    writeDb(db);
    return true;
  }
  // Upgrade-on-duplicate: an earlier pass (usually the AI search, which runs
  // first) often saves a vacancy as a LINKLESS lead. If a later source finds the
  // SAME job WITH a real apply link, adopt that link instead of leaving the job
  // permanently unopenable. Only patches link fields on a still-`found` job —
  // never overwrites one the user has already tailored/applied, and never
  // downgrades a good link.
  if (!hasUsableLink(exists) && hasUsableLink(job) && exists.status === 'found') {
    exists.applyUrl = job.applyUrl;
    exists.linkStatus = job.linkStatus || 'unverified';
    exists.linkCheckedAt = job.linkCheckedAt || new Date().toISOString();
    if (job.source) exists.source = job.source;
    if (typeof job.matchScore === 'number' && job.matchScore > (exists.matchScore || 0)) {
      exists.matchScore = job.matchScore;
    }
    writeDb(db);
  }
  return false;
}

export function updateJob(jobId, updates) {
  const db = readDb();
  const index = db.jobs.findIndex((j) => j.id === jobId);
  if (index !== -1) {
    db.jobs[index] = { ...db.jobs[index], ...updates };
    writeDb(db);
    return db.jobs[index];
  }
  return null;
}

export function deleteJob(jobId) {
  const db = readDb();
  db.jobs = db.jobs.filter((j) => j.id !== jobId);
  writeDb(db);
}

export function clearAllJobs() {
  backupDb('clear-jobs');
  const db = readDb();
  db.jobs = [];
  writeDb(db);
}

// ── Logs ─────────────────────────────────────────────────────────────────────
export function getLogs() {
  return logBuffer;
}

// SECURITY: scrub anything that looks like an API key before it can reach the
// log buffer (which the UI renders) or stdout. Belt-and-braces — keys should
// never be interpolated into a log line, but an upstream error message (e.g. an
// SDK exception echoing a request header) must not leak one either.
const KEY_PATTERNS = [
  /sk-ant-[A-Za-z0-9_-]{8,}/g,   // Anthropic
  /sk-or-[A-Za-z0-9_-]{8,}/g,    // OpenRouter
  /AIza[0-9A-Za-z_-]{20,}/g      // Google API keys
];
export function scrubSecrets(s) {
  let out = String(s == null ? '' : s);
  for (const re of KEY_PATTERNS) out = out.replace(re, '•••redacted-key•••');
  return out;
}

export function addLog(message, type = 'info') {
  const safe = scrubSecrets(message);
  logBuffer.push({ timestamp: new Date().toISOString(), message: safe, type });
  if (logBuffer.length > 200) logBuffer.shift();
  console.log(`[${type}] ${safe}`);
}

export function clearLogs() {
  logBuffer = [];
}

// ── Hunter state ─────────────────────────────────────────────────────────────
export function getHunterState() {
  return readDb().hunterState;
}

export function setHunterState(updates) {
  const db = readDb();
  db.hunterState = { ...db.hunterState, ...updates };
  writeDb(db);
  return db.hunterState;
}

// ── Apply state ──────────────────────────────────────────────────────────────
export function getApplyState() {
  return readDb().applyState;
}

export function setApplyState(updates) {
  const db = readDb();
  db.applyState = { ...db.applyState, ...updates };
  writeDb(db);
  return db.applyState;
}

// ── Routines (T1): unattended, recurring Hunter/Tailor runs ───────────────────
// SAFETY: a routine can only ever be type 'hunt' or 'hunt_and_tailor'. There is
// deliberately no auto-apply routine — Agent 3 is never invoked unattended, so
// nothing is ever submitted without the human present. Don't change this without
// revisiting the whole human-on-the-loop safety model.
// 'dream' = a Dreaming/reflection pass only (no hunting, no applying). Cheap:
// one LLM call that curates the candidate dossier (see memoryReflect.js).
export const ROUTINE_TYPES = ['hunt', 'hunt_and_tailor', 'dream'];
export const ROUTINE_FREQUENCIES = ['daily', 'weekdays', 'every_n_hours'];
const MAX_ROUTINES = 20;
const MAX_AUTO_TAILOR = 10;

function clampRoutineInt(v, dflt, min, max) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return dflt;
  return Math.max(min, Math.min(max, n));
}

// Validates + normalises an incoming routine payload into the stored shape.
function sanitizeRoutine(input = {}, existing = null) {
  const type = ROUTINE_TYPES.includes(input.type) ? input.type
    : (existing?.type || 'hunt');

  const sIn = input.schedule || {};
  const frequency = ROUTINE_FREQUENCIES.includes(sIn.frequency) ? sIn.frequency
    : (existing?.schedule?.frequency || 'daily');

  // HH:MM, 24h. Falls back to 07:00.
  let timeOfDay = typeof sIn.timeOfDay === 'string' && /^\d{1,2}:\d{2}$/.test(sIn.timeOfDay)
    ? sIn.timeOfDay
    : (existing?.schedule?.timeOfDay || '07:00');
  const [hh, mm] = timeOfDay.split(':').map((x) => parseInt(x, 10));
  timeOfDay = `${String(Math.max(0, Math.min(23, hh))).padStart(2, '0')}:${String(Math.max(0, Math.min(59, mm))).padStart(2, '0')}`;

  // every_n_hours has a hard floor of 1h so a typo can't hammer the API.
  const everyHours = clampRoutineInt(sIn.everyHours, existing?.schedule?.everyHours || 6, 1, 24);

  return {
    id: existing?.id || randomUUID(),
    name: (typeof input.name === 'string' && input.name.trim())
      ? input.name.trim().slice(0, 80)
      : (existing?.name || 'Morning job hunt'),
    enabled: input.enabled !== undefined ? Boolean(input.enabled) : (existing?.enabled ?? true),
    type,
    schedule: { frequency, timeOfDay, everyHours },
    // Only meaningful for hunt_and_tailor. 0 ⇒ behaves like hunt-only.
    autoTailorCount: type === 'hunt_and_tailor'
      ? clampRoutineInt(input.autoTailorCount, existing?.autoTailorCount ?? 3, 0, MAX_AUTO_TAILOR)
      : 0,
    catchUp: input.catchUp !== undefined ? Boolean(input.catchUp) : (existing?.catchUp ?? true),
    createdAt: existing?.createdAt || new Date().toISOString(),
    lastRun: existing?.lastRun || null,
    lastStatus: existing?.lastStatus || 'idle',
    lastResult: existing?.lastResult || null
  };
}

export function getRoutines() {
  return readDb().routines || [];
}

export function getRoutine(id) {
  return (readDb().routines || []).find((r) => r.id === id) || null;
}

export function addRoutine(input) {
  const db = readDb();
  if (!Array.isArray(db.routines)) db.routines = [];
  if (db.routines.length >= MAX_ROUTINES) {
    throw new Error(`Routine limit reached (${MAX_ROUTINES}). Delete one first.`);
  }
  const routine = sanitizeRoutine(input, null);
  db.routines.push(routine);
  writeDb(db);
  return routine;
}

export function updateRoutine(id, updates) {
  const db = readDb();
  const idx = (db.routines || []).findIndex((r) => r.id === id);
  if (idx === -1) return null;
  // Re-sanitise against the existing record so partial edits keep valid bounds.
  db.routines[idx] = sanitizeRoutine({ ...db.routines[idx], ...updates }, db.routines[idx]);
  writeDb(db);
  return db.routines[idx];
}

export function deleteRoutine(id) {
  const db = readDb();
  db.routines = (db.routines || []).filter((r) => r.id !== id);
  writeDb(db);
}

// ── AI usage ledger + daily budget guard ──────────────────────────────────────
// Every AI call (any provider) reports its token/search usage here, bucketed by
// feature so the user can see what is actually draining the key. Costs are
// ESTIMATES (db/costs.js) for budgeting; the provider invoice is ground truth.

export const SEARCH_DEPTHS = ['light', 'standard', 'deep'];
const USAGE_KEEP_DAYS = 35;

function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function emptyTally() {
  return { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 0, estCostUSD: 0 };
}

function accumulate(t, u, cost) {
  t.calls += 1;
  t.inputTokens      += u.inputTokens || 0;
  t.outputTokens     += u.outputTokens || 0;
  t.cacheReadTokens  += u.cacheReadTokens || 0;
  t.cacheWriteTokens += u.cacheWriteTokens || 0;
  t.webSearches      += u.webSearches || 0;
  t.estCostUSD       += cost;
}

/**
 * Records one AI call's usage. `bucket` labels the feature ('ai-search',
 * 'link-repair', 'research', 'referral', 'computer-use', 'vision', 'core', …).
 * Best-effort: never throws (a usage-ledger failure must never break an agent).
 */
export function addUsage({ provider = 'unknown', model = '', bucket = 'core', ...tokens } = {}) {
  try {
    const cost = estimateCostUSD({ provider, model, ...tokens });
    const db = readDb();
    if (!db.usage || !db.usage.days) db.usage = { days: {} };
    const key = todayKey();
    const day = db.usage.days[key] || { ...emptyTally(), byBucket: {} };
    accumulate(day, tokens, cost);
    day.byBucket[bucket] = day.byBucket[bucket] || emptyTally();
    accumulate(day.byBucket[bucket], tokens, cost);
    db.usage.days[key] = day;
    // Prune old days so db.json never balloons.
    const keys = Object.keys(db.usage.days).sort();
    while (keys.length > USAGE_KEEP_DAYS) delete db.usage.days[keys.shift()];
    writeDb(db);
    return cost;
  } catch {
    return 0;
  }
}

/** Today's tally + a short history, for the Settings usage panel. */
export function getUsageSummary() {
  const db = readDb();
  const days = (db.usage && db.usage.days) || {};
  const today = days[todayKey()] || { ...emptyTally(), byBucket: {} };
  const sorted = Object.keys(days).sort().slice(-14);
  const history = sorted.map((d) => ({ date: d, estCostUSD: days[d].estCostUSD || 0, calls: days[d].calls || 0 }));
  const last7 = history.slice(-7).reduce((s, d) => s + d.estCostUSD, 0);
  const profile = db.profile || {};
  const cap = parseFloat(profile.dailyBudgetUSD) || 0;
  return {
    today,
    history,
    last7CostUSD: last7,
    budget: { capUSD: cap, spentUSD: today.estCostUSD || 0, exceeded: cap > 0 && (today.estCostUSD || 0) >= cap }
  };
}

export function clearUsage() {
  const db = readDb();
  db.usage = { days: {} };
  writeDb(db);
}

/**
 * THE budget gate. Returns { exceeded, capUSD, spentUSD }. Call sites skip the
 * AI call (with a clear log) when exceeded. capUSD 0/unset = no cap.
 */
export function budgetStatus() {
  const db = readDb();
  const cap = parseFloat((db.profile || {}).dailyBudgetUSD) || 0;
  const spent = ((db.usage && db.usage.days && db.usage.days[todayKey()]) || {}).estCostUSD || 0;
  return { exceeded: cap > 0 && spent >= cap, capUSD: cap, spentUSD: spent };
}

/** Standard user-facing message for a budget refusal. */
export function budgetMessage(b = budgetStatus()) {
  return `Daily AI budget reached (~$${b.spentUSD.toFixed(2)} of $${b.capUSD.toFixed(2)} est.) — AI calls are paused until tomorrow. Raise or clear the cap in Settings → AI & Cost.`;
}

// ── Performance presets (Token Saver / Balanced / Maximum) ────────────────────
// One click flips every cost-relevant toggle to a coherent bundle. The bundles
// only touch the fields listed in their own keys — provider, API keys, personal
// info, CV and answers are never altered by a preset.
export const PERFORMANCE_PRESETS = {
  saver: {
    label: 'Token Saver',
    description: 'Cheapest useful setup: AI search on Haiku at light depth, all optional AI off, caching on. Roughly a tenth of Maximum\'s spend.',
    values: {
      useAiSearch: true,
      aiSearchModel: 'claude-haiku-4-5',
      searchDepth: 'light',
      useLinkValidation: true,   // free safety — probing isn't billed
      useLinkRepair: false,
      useAiPlanner: false,
      useVision: false,
      useComputerUse: false,
      useResearchFanout: false,
      useMemoryReflection: false,
      useDreaming: false,
      useStructuredOutputs: true, // free reliability
      usePromptCaching: true,     // only ever saves money
      tailorConcurrency: 1,
      maxKeywords: 2,
      maxLocations: 1
    }
  },
  balanced: {
    label: 'Balanced',
    description: 'The recommended defaults: standard search depth, planner + memory on, expensive extras (vision, computer-use, research fan-out, link repair) off.',
    values: {
      useAiSearch: true,
      aiSearchModel: '',
      searchDepth: 'standard',
      useLinkValidation: true,
      useLinkRepair: false,
      useAiPlanner: true,
      useVision: false,
      useComputerUse: false,
      useResearchFanout: false,
      useMemoryReflection: true,
      useDreaming: true,
      useStructuredOutputs: true,
      usePromptCaching: true,
      tailorConcurrency: 3,
      maxKeywords: 3,
      maxLocations: 2
    }
  },
  max: {
    label: 'Maximum',
    description: 'Everything on: deep two-round search on Sonnet, AI link repair, company research, vision, computer-use finisher, 5-wide parallel tailoring. Most capable, most expensive.',
    values: {
      useAiSearch: true,
      aiSearchModel: 'claude-sonnet-4-6',
      searchDepth: 'deep',
      useLinkValidation: true,
      useLinkRepair: true,
      useAiPlanner: true,
      useVision: true,
      useComputerUse: true,
      useResearchFanout: true,
      useMemoryReflection: true,
      useDreaming: true,
      useStructuredOutputs: true,
      usePromptCaching: true,
      tailorConcurrency: 5,
      maxKeywords: 5,
      maxLocations: 3
    }
  }
};

/** Applies one preset bundle to the profile. Returns the merged profile. */
export function applyPerformancePreset(mode) {
  const preset = PERFORMANCE_PRESETS[mode];
  if (!preset) throw new Error(`Unknown performance mode: ${mode}`);
  return saveProfile({ ...preset.values, performanceMode: mode });
}

/**
 * Which preset do the CURRENT profile values actually match? Returns
 * 'saver' | 'balanced' | 'max' | 'custom'. The UI highlights this (not the
 * stored performanceMode) so any manual tweak honestly reads as Custom.
 */
export function detectActivePreset(profile = getProfile()) {
  for (const [mode, preset] of Object.entries(PERFORMANCE_PRESETS)) {
    const match = Object.entries(preset.values).every(([k, v]) => {
      const cur = profile[k];
      if (typeof v === 'boolean') return Boolean(cur) === v || (v === true && cur === undefined);
      if (typeof v === 'number') return parseInt(cur, 10) === v;
      return String(cur ?? '') === String(v);
    });
    if (match) return mode;
  }
  return 'custom';
}

// ── Safety backup (Danger Zone) ───────────────────────────────────────────────
// Before any destructive bulk clear, snapshot db.json to db.backup.json (single
// rolling backup, same directory). Restore puts it back wholesale.
const BACKUP_PATH = () => path.join(path.dirname(DB_PATH), 'db.backup.json');

export function backupDb(reason = 'manual') {
  try {
    // Debounce: "Clear everything" fires four clears in one burst; only the
    // FIRST should snapshot (it still holds all the data). If a backup was
    // written in the last 60s, keep it.
    try {
      const prev = JSON.parse(fs.readFileSync(BACKUP_PATH(), 'utf-8'));
      if (prev.backedUpAt && Date.now() - new Date(prev.backedUpAt).getTime() < 60_000) return true;
    } catch { /* no/unreadable previous backup — proceed */ }
    const db = readDb();
    const snapshot = { backedUpAt: new Date().toISOString(), reason, db };
    fs.writeFileSync(BACKUP_PATH(), JSON.stringify(snapshot, null, 2), 'utf-8');
    return true;
  } catch {
    return false; // best-effort — never block the user's action on a backup hiccup
  }
}

export function getBackupInfo() {
  try {
    const raw = fs.readFileSync(BACKUP_PATH(), 'utf-8');
    const snap = JSON.parse(raw);
    return { exists: true, backedUpAt: snap.backedUpAt || null, reason: snap.reason || '' };
  } catch {
    return { exists: false, backedUpAt: null, reason: '' };
  }
}

/** Restores the last backup. Returns its info, or throws if none exists. */
export function restoreDbBackup() {
  const raw = fs.readFileSync(BACKUP_PATH(), 'utf-8'); // throws if missing
  const snap = JSON.parse(raw);
  if (!snap || typeof snap.db !== 'object') throw new Error('Backup file is unreadable.');
  writeDb(snap.db);
  return { backedUpAt: snap.backedUpAt || null, reason: snap.reason || '' };
}

// Records the outcome of a routine run (used by the scheduler). Separate from
// updateRoutine so a run can't accidentally rewrite the user's config.
export function setRoutineRunState(id, { lastRun, lastStatus, lastResult } = {}) {
  const db = readDb();
  const r = (db.routines || []).find((x) => x.id === id);
  if (!r) return null;
  if (lastRun !== undefined) r.lastRun = lastRun;
  if (lastStatus !== undefined) r.lastStatus = lastStatus;
  if (lastResult !== undefined) r.lastResult = lastResult;
  writeDb(db);
  return r;
}
