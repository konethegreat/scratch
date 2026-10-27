// The server-less `/api/*` port. It answers the subset the desktop UI uses,
// backed by the vault, and returns the same error contract as the Express
// server so the client needs no second error path.
import { AppError, ERROR_CODES, statusForCode, toUserError } from '@sajas/core/errors';
import { MODELS } from '@sajas/core/models';
import { fingerprint } from '@sajas/core/feeds';
import { STORES } from './vault.js';
import { limit } from './limits.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const MAX_TEXT = 20000;
const INSIGHT_CATEGORIES = ['preference', 'strength', 'achievement', 'style', 'constraint', 'other'];
const TRACKER_STATUSES = ['found', 'tailored', 'applied', 'interviewing', 'offer', 'rejected', 'tailoring'];

function ok(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function fail(err) {
  const payload = toUserError(err);
  const body = { error: payload.message, ...payload };
  return new Response(JSON.stringify(body), { status: statusForCode(payload.code), headers: JSON_HEADERS });
}

function notSupported() {
  return fail(new AppError(ERROR_CODES.NOT_SUPPORTED_IN_WEB, undefined));
}

function notFound(message = 'No such endpoint.') {
  return fail(new AppError(ERROR_CODES.NOT_FOUND, message));
}

function publicModels() {
  return Object.values(MODELS).map(({ id, label, tier, inputPerMTok, outputPerMTok, optIn }) => ({
    id, label, tier, inputPerMTok, outputPerMTok, optIn: Boolean(optIn)
  }));
}

function emptyMemory() {
  return { version: 1, updatedAt: new Date().toISOString(), insights: [], employers: [], applications: [], lastDream: null };
}

function memoryOf(stored) {
  const base = stored && typeof stored === 'object' ? stored : {};
  return {
    ...emptyMemory(),
    ...base,
    insights: Array.isArray(base.insights) ? base.insights : [],
    employers: Array.isArray(base.employers) ? base.employers : [],
    applications: Array.isArray(base.applications) ? base.applications : []
  };
}

function emptyUsage(profile = {}) {
  const cap = Number(profile.dailyBudgetUSD) || 0;
  return {
    today: {
      date: new Date().toISOString().slice(0, 10),
      calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
      webSearches: 0, estCostUSD: 0, byBucket: {}, byTask: {}
    },
    history: [],
    last7CostUSD: 0,
    budget: { capUSD: cap, spentUSD: 0, exceeded: false }
  };
}

// Routes that exist on the desktop server but have no browser equivalent:
// background agents, the local browser, backups, routines and AI-only features.
const SERVER_ONLY = [
  /^\/profile\/preset$/,
  /^\/application\/(?:bank|pending)(?:\/.*)?$/,
  /^\/backup(?:\/.*)?$/,
  /^\/documents(?:\/[^/]+)?$/, // GET /documents is answered above; uploads are server-only
  /^\/jobs\/hunter(?:\/stop)?$/,
  /^\/jobs\/revalidate$/,
  /^\/jobs\/tailor-batch$/,
  /^\/jobs\/[^/]+\/(?:tailor|apply|referral)$/,
  /^\/routines(?:\/.*)?$/,
  /^\/hunter\/sources(?:\/.*)?$/,
  /^\/browser\/(?:setup|login-status)$/,
  /^\/memory\/dream$/,
  /^\/health$/
];

export function createWebApi({ apiBase, vault, keyStore, activity, now = () => new Date() }) {
  const base = new URL(apiBase);
  const basePath = base.pathname.replace(/\/$/, '');

  function pathOf(input) {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
    const url = new URL(raw, base);
    if (url.pathname === basePath) return '/';
    if (url.pathname.startsWith(`${basePath}/`)) return url.pathname.slice(basePath.length);
    return url.pathname || '/';
  }

  async function bodyOf(input, init) {
    const raw = init?.body ?? (typeof input === 'object' && input?.clone ? await input.clone().text() : undefined);
    if (raw == null || raw === '') return {};
    if (typeof raw !== 'string') return raw;
    try {
      const parsed = JSON.parse(raw);
      // A JSON null/array is not a record; treat it like an empty body instead
      // of letting destructuring throw an UNKNOWN error.
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      throw new AppError(ERROR_CODES.VALIDATION, 'That request was not valid JSON.');
    }
  }

  async function getProfile() {
    const stored = (await vault.get(STORES.profile, 'current', {})) || {};
    const { anthropicApiKey, hasAnthropicKey, ...rest } = stored;
    return { ...rest, hasAnthropicKey: keyStore.hasKey() };
  }

  async function saveProfile(input, init) {
    const incoming = await bodyOf(input, init);
    if (incoming.anthropicApiKey && String(incoming.anthropicApiKey).trim()) {
      throw new AppError(ERROR_CODES.VALIDATION, 'Enter your Anthropic key in the key panel so it can be validated and saved safely.');
    }
    const current = (await vault.get(STORES.profile, 'current', {})) || {};
    const { anthropicApiKey, hasAnthropicKey, ...rest } = incoming;
    const next = { ...current, ...rest };
    delete next.anthropicApiKey;
    delete next.hasAnthropicKey;
    await vault.put(STORES.profile, 'current', next);
    activity.add('Profile settings saved.', 'system');
    return ok({ success: true, profile: { ...next, hasAnthropicKey: keyStore.hasKey() } });
  }

  async function clearKey(_input, _init, provider) {
    if (provider !== 'anthropic') return notFound('Unknown provider');
    await keyStore.forget();
    activity.add('Anthropic API key cleared.', 'system');
    return ok({ success: true });
  }

  async function addJob(input, init) {
    const { title, company, location, description, applyUrl, source, matchScore, datePosted } = await bodyOf(input, init);
    if (!String(title || '').trim() || !String(company || '').trim()) {
      throw new AppError(ERROR_CODES.VALIDATION, 'Title and company are required.');
    }
    const jobs = await vault.getAll(STORES.jobs);
    const wanted = fingerprint(title, company);
    const same = jobs.find((job) => fingerprint(job.title, job.company) === wanted);
    if (same) {
      throw new AppError(ERROR_CODES.CONFLICT, 'A similar job already exists.', {
        retryable: false,
        hint: 'Find the existing job in your tracker instead of adding it again.'
      });
    }
    const score = Number(matchScore);
    const posted = String(datePosted || '');
    const job = {
      id: crypto.randomUUID(),
      title: limit(title, 300),
      company: limit(company, 200),
      location: limit(location || 'South Africa', 200),
      description: limit(description, MAX_TEXT),
      applyUrl: limit(applyUrl, 2000),
      datePosted: /^\d{4}-\d{2}-\d{2}$/.test(posted) ? posted : now().toISOString().slice(0, 10),
      matchScore: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 75,
      status: 'found',
      notes: '',
      source: limit(source || 'Manual', 80),
      tailoredCvText: '',
      tailoredCoverLetterText: '',
      dateAdded: now().toISOString().slice(0, 10)
    };
    await vault.put(STORES.jobs, job.id, job);
    activity.add(`Manual job added: ${job.title} at ${job.company}`, 'system');
    return ok({ success: true, job });
  }

  async function updateJob(input, init, id) {
    const current = await vault.get(STORES.jobs, id);
    if (!current) throw new AppError(ERROR_CODES.NOT_FOUND, 'Job not found.');
    const patch = await bodyOf(input, init);
    const next = { ...current };
    if (patch.status !== undefined) {
      if (!TRACKER_STATUSES.includes(patch.status)) {
        throw new AppError(ERROR_CODES.VALIDATION, 'That is not a status this tracker uses.', {
          retryable: false,
          hint: 'Use one of: found, tailoring, tailored, applied, interviewing, offer, rejected.'
        });
      }
      next.status = patch.status;
    }
    if (patch.notes !== undefined) {
      if (typeof patch.notes !== 'string') {
        throw new AppError(ERROR_CODES.VALIDATION, 'Notes must be text.');
      }
      next.notes = limit(patch.notes, MAX_TEXT);
    }
    if (patch.applyUrl !== undefined) next.applyUrl = limit(patch.applyUrl, 2000);
    if (patch.description !== undefined) next.description = limit(patch.description, MAX_TEXT);
    await vault.put(STORES.jobs, id, next);
    return ok({ success: true, job: next });
  }

  async function getMemory() {
    return memoryOf(await vault.get(STORES.memory, 'dossier'));
  }

  async function saveMemory(memory) {
    memory.updatedAt = now().toISOString();
    await vault.put(STORES.memory, 'dossier', memory);
  }

  async function addInsight(input, init) {
    const { text, category } = await bodyOf(input, init);
    const clean = limit(String(text || '').trim(), 1000);
    if (!clean) throw new AppError(ERROR_CODES.VALIDATION, 'Insight text is required.');
    const memory = await getMemory();
    if (memory.insights.some((entry) => String(entry.text || '').toLowerCase() === clean.toLowerCase())) {
      throw new AppError(ERROR_CODES.CONFLICT, 'That insight already exists.', {
        retryable: false,
        hint: 'Open the existing insight instead of adding it again.'
      });
    }
    const stamp = now().toISOString();
    const entry = {
      id: crypto.randomUUID(),
      text: clean,
      category: INSIGHT_CATEGORIES.includes(category) ? category : 'other',
      source: 'manual',
      createdAt: stamp,
      weight: 1,
      lastConfirmedAt: stamp
    };
    memory.insights.push(entry);
    await saveMemory(memory);
    return ok({ success: true, entry });
  }

  async function deleteInsight(_input, _init, id) {
    const memory = await getMemory();
    memory.insights = memory.insights.filter((entry) => entry.id !== id);
    await saveMemory(memory);
    return ok({ success: true });
  }

  async function upsertEmployer(input, init) {
    const { company, note } = await bodyOf(input, init);
    const clean = limit(String(company || '').trim(), 200);
    if (!clean) throw new AppError(ERROR_CODES.VALIDATION, 'Company is required.');
    const memory = await getMemory();
    const normalized = clean.toLowerCase();
    let record = memory.employers.find((entry) => String(entry.normalized || entry.company || '').toLowerCase() === normalized);
    if (!record) {
      record = { id: crypto.randomUUID(), company: clean, normalized, notes: [], applications: 0, updatedAt: null };
      memory.employers.push(record);
    }
    const cleanNote = limit(note, 5000);
    if (!Array.isArray(record.notes)) record.notes = [];
    if (cleanNote && !record.notes.includes(cleanNote)) record.notes.push(cleanNote);
    record.updatedAt = now().toISOString();
    await saveMemory(memory);
    return ok({ success: true, entry: record });
  }

  async function updateOutcome(input, init, jobId) {
    const { outcome } = await bodyOf(input, init);
    if (!String(outcome || '').trim()) throw new AppError(ERROR_CODES.VALIDATION, 'An outcome is required.');
    const job = await vault.get(STORES.jobs, jobId);
    if (!job) throw new AppError(ERROR_CODES.NOT_FOUND, 'Job not found.');
    const memory = await getMemory();
    const existing = memory.applications.find((entry) => entry.jobId === jobId || entry.id === jobId);
    const record = existing || {
      id: crypto.randomUUID(),
      jobId,
      title: job.title,
      company: job.company,
      appliedAt: now().toISOString(),
      outcome: 'applied',
      salarySnapshot: null,
      transcript: []
    };
    record.outcome = limit(outcome, 60);
    if (!existing) {
      memory.applications.push(record);
      const normalized = String(job.company || '').trim().toLowerCase();
      let employer = memory.employers.find((entry) => String(entry.normalized || entry.company || '').toLowerCase() === normalized);
      if (!employer) {
        employer = { id: crypto.randomUUID(), company: job.company, normalized, notes: [], applications: 0, updatedAt: null };
        memory.employers.push(employer);
      }
      employer.applications = (Number(employer.applications) || 0) + 1;
      employer.updatedAt = now().toISOString();
    }
    await saveMemory(memory);
    return ok({ success: true, entry: record });
  }

  async function clearMemory() {
    const memory = emptyMemory();
    await vault.put(STORES.memory, 'dossier', memory);
    return ok({ success: true, memory });
  }

  async function getJobs() {
    const jobs = await vault.getAll(STORES.jobs);
    jobs.sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0));
    return ok(jobs);
  }

  async function handle(input, init = {}) {
    try {
      const path = pathOf(input);
      const method = String(init.method || (typeof input === 'object' && input?.method) || 'GET').toUpperCase();
      let match;
      if ((match = path.match(/^\/profile\/key\/([^/]+)$/)) && method === 'DELETE') return await clearKey(input, init, match[1]);
      if (path === '/profile' && method === 'GET') return ok(await getProfile());
      if (path === '/profile' && method === 'POST') return await saveProfile(input, init);
      if (path === '/models' && method === 'GET') return ok(publicModels());
      if (path === '/status' && method === 'GET') {
        return ok({ hunter: { isRunning: false, lastResult: null }, apply: {}, routines: [], uptime: 0 });
      }
      if (path === '/logs' && method === 'GET') return ok(activity.list());
      if (path === '/logs/clear' && method === 'POST') { activity.clear(); return ok({ success: true }); }
      if (path === '/usage' && method === 'GET') {
        return ok(emptyUsage((await vault.get(STORES.profile, 'current', {})) || {}));
      }
      if (path === '/usage' && method === 'DELETE') return ok({ success: true });
      if (path === '/documents' && method === 'GET') return ok([]);
      if (path === '/jobs' && method === 'GET') return await getJobs();
      if (path === '/jobs' && method === 'POST') return await addJob(input, init);
      if (path === '/jobs' && method === 'DELETE') {
        await vault.clear(STORES.jobs);
        activity.add('All jobs cleared by user.', 'system');
        return ok({ success: true });
      }
      if ((match = path.match(/^\/jobs\/([^/]+)$/))) {
        if (method === 'PATCH') return await updateJob(input, init, match[1]);
        if (method === 'DELETE') { await vault.delete(STORES.jobs, match[1]); return ok({ success: true }); }
      }
      if (path === '/memory' && method === 'GET') return ok(await getMemory());
      if (path === '/memory' && method === 'DELETE') return await clearMemory();
      if (path === '/memory/insight' && method === 'POST') return await addInsight(input, init);
      if ((match = path.match(/^\/memory\/insight\/([^/]+)$/)) && method === 'DELETE') return await deleteInsight(input, init, match[1]);
      if (path === '/memory/employer' && method === 'POST') return await upsertEmployer(input, init);
      if ((match = path.match(/^\/memory\/application\/([^/]+)$/)) && method === 'PATCH') return await updateOutcome(input, init, match[1]);

      if (SERVER_ONLY.some((pattern) => pattern.test(path))) return notSupported();
      return notFound();
    } catch (err) {
      return fail(err);
    }
  }

  return { handle };
}
