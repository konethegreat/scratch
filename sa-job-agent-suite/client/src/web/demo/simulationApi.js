// The demo's simulation layer. It owns the four routes that would otherwise
// call a model or a desktop agent, and delegates every ordinary CRUD route to
// the vault-backed demo API. No AI client is ever constructed here.
import { AppError, ERROR_CODES, statusForCode, toUserError } from '@sajas/core/errors';
import { buildApplyPacketV2, looksLikeCredential, sanitisePacketV2, summariseSubmission } from '@sajas/core/apply';
import { prepareAsk, prepareCheck, REFUSAL_SENTENCE, tokenize } from '@sajas/core/rag';
import { STORES } from '../vault.js';
import { createUsageLedger } from '../usage.js';
import { DEMO_QUESTION } from './persona.js';
import { tailoredDocuments } from './jobs.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const SIMULATED = 'Simulated';
const CREDENTIAL_ASSIGNMENT = /\b(?:password|passphrase|api[\s_-]?key|secret|token)\b\s*(?:[:=]\s*\S+|\b(?:is|are|was|were)\b\s+\S+)/i;

function ok(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function fail(err) {
  const payload = toUserError(err);
  return new Response(JSON.stringify({ error: payload.message, ...payload }), {
    status: statusForCode(payload.code),
    headers: JSON_HEADERS
  });
}

function pathOf(input, base, basePath) {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
  const url = new URL(raw, base);
  if (url.pathname === basePath) return '/';
  if (url.pathname.startsWith(`${basePath}/`)) return url.pathname.slice(basePath.length);
  return url.pathname || '/';
}

function citationOf(chunk) {
  return {
    id: chunk.id, docId: chunk.docId, docKind: chunk.docKind, docTitle: chunk.docTitle,
    section: chunk.section, index: chunk.index, tag: chunk.tag
  };
}

export function createSimulationRouter({
  base,
  apiBase,
  vault,
  keyStore,
  activity = { add() {} },
  now = () => new Date(),
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  tailorDelayMs = 900
} = {}) {
  const baseUrl = new URL(apiBase);
  const basePath = baseUrl.pathname.replace(/\/$/, '');
  const usage = createUsageLedger({ vault, now });

  async function sources() {
    return {
      profile: (await vault.get(STORES.profile, 'current', {})) || {},
      jobs: await vault.getAll(STORES.jobs),
      memory: (await vault.get(STORES.memory, 'dossier')) || {},
      answers: await vault.getAll(STORES.answers)
    };
  }

  async function bodyOf(input, init) {
    const raw = init?.body ?? (typeof input === 'object' && input?.clone ? await input.clone().text() : undefined);
    if (raw == null || raw === '') return {};
    if (typeof raw !== 'string') return raw;
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      throw new AppError(ERROR_CODES.VALIDATION, 'That request was not valid JSON.');
    }
  }

  async function tailor(jobId) {
    const job = await vault.get(STORES.jobs, jobId);
    if (!job) throw new AppError(ERROR_CODES.NOT_FOUND, 'Job not found.');
    await vault.put(STORES.jobs, jobId, { ...job, status: 'tailoring' });
    await wait(tailorDelayMs);
    const updated = { ...job, ...tailoredDocuments(job), status: 'tailored' };
    await vault.put(STORES.jobs, jobId, updated);
    await usage.record({ model: 'simulated', bucket: 'tailor', inputTokens: 1500, outputTokens: 600 });
    activity.add(`Simulated tailoring finished for ${job.title} at ${job.company}.`, 'system');
    return ok({ success: true, job: updated, simulated: true });
  }

  function refusedAnswer(question, prepared) {
    return ok({
      kind: 'answer',
      question: String(question || '').trim(),
      purpose: prepared.purpose || 'general',
      supported: false,
      refused: true,
      answer: REFUSAL_SENTENCE,
      citations: [],
      searched: prepared.searched,
      missing: prepared.missing,
      simulated: true
    });
  }

  async function ask(input, init) {
    const { question, purpose } = await bodyOf(input, init);
    const prepared = prepareAsk({ ...(await sources()), question, purpose });
    if (prepared.refused) return refusedAnswer(question, prepared);
    // BM25 returns the nearest chunk even for an unrelated question. Without a
    // model to weigh relevance, require most of the question's terms to appear
    // in the retrieved context before treating the answer as supported.
    const terms = [...new Set(tokenize(question))];
    const covered = new Set(tokenize(prepared.chunks.map((chunk) => chunk.text).join(' ')));
    const hits = terms.filter((term) => covered.has(term)).length;
    const grounded = terms.length > 0
      && hits >= Math.min(2, terms.length)
      && hits / terms.length >= 0.5;
    if (!grounded) return refusedAnswer(question, prepared);
    const chunks = prepared.chunks.slice(0, 3);
    const answer = `${chunks.map((chunk, index) => `Simulated point ${index + 1} is drawn from ${chunk.tag}.`).join(' ')} ${SIMULATED} output for the demo.`;
    await usage.record({ model: 'simulated', bucket: 'rag', inputTokens: 900, outputTokens: 220 });
    return ok({
      kind: 'answer',
      question: prepared.question,
      purpose: prepared.purpose,
      supported: true,
      refused: false,
      answer,
      citations: chunks.map(citationOf),
      searched: prepared.searched,
      missing: prepared.missing,
      simulated: true
    });
  }

  async function check(input, init) {
    const { jobId, documentKind } = await bodyOf(input, init);
    const prepared = prepareCheck({ ...(await sources()), jobId, documentKind });
    const baseFields = {
      kind: 'check',
      jobId,
      documentKind: prepared.documentKind,
      documentTitle: prepared.documentTitle,
      searched: prepared.searched,
      missing: prepared.missing,
      simulated: true
    };
    if (prepared.refused) {
      return ok({ ...baseFields, supported: false, refused: true, answer: REFUSAL_SENTENCE, unsupportedClaims: [], citations: [] });
    }
    const top = prepared.chunks[0];
    await usage.record({ model: 'simulated', bucket: 'ground', inputTokens: 800, outputTokens: 180 });
    return ok({
      ...baseFields,
      supported: false,
      refused: false,
      unsupportedClaims: top ? [`The document claims experience this demo cannot verify ${top.tag}.`] : [],
      citations: top ? [citationOf(top)] : []
    });
  }

  async function applySimulated(input, init, jobId) {
    const { fields, answer, documents } = await bodyOf(input, init);
    const job = await vault.get(STORES.jobs, jobId);
    if (!job) throw new AppError(ERROR_CODES.NOT_FOUND, 'Job not found.');
    const submittedFields = Array.isArray(fields) ? fields : [];
    for (const field of submittedFields) {
      if (looksLikeCredential(field?.key, field?.value)) {
        throw new AppError(ERROR_CODES.VALIDATION, 'That field looks like a credential, so it was not recorded.');
      }
    }
    const base = String(job.title || 'application').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'application';
    const allowed = new Map();
    if (job.tailoredCvText) {
      allowed.set('tailored-cv', { key: 'tailored-cv', label: 'Tailored CV', fileName: `${base}-cv.pdf` });
    }
    if (job.tailoredCoverLetterText) {
      allowed.set('tailored-letter', { key: 'tailored-letter', label: 'Tailored cover letter', fileName: `${base}-cover-letter.pdf` });
    }
    for (const stored of await vault.getAll(STORES.documents)) {
      const id = String(stored?.id || '').trim();
      if (id) allowed.set(id, { key: id, label: String(stored.label || '').trim(), fileName: String(stored.fileName || '').trim() });
    }
    const posted = (Array.isArray(documents) ? documents : []).map((document) => ({
      key: String(document?.key || '').trim().slice(0, 40)
    })).filter((document) => document.key);
    const documentMeta = [];
    for (const { key } of posted) {
      const known = allowed.get(key);
      if (!known) {
        throw new AppError(ERROR_CODES.VALIDATION, 'That submission named a document the demo library does not have.');
      }
      if (documentMeta.some((entry) => entry.key === key)) continue;
      documentMeta.push({ ...known, available: true });
    }
    if (!posted.length) {
      for (const key of ['tailored-cv', 'tailored-letter']) {
        const known = allowed.get(key);
        if (known) documentMeta.push({ ...known, available: true });
      }
    }
    const profile = (await vault.get(STORES.profile, 'current', {})) || {};
    const answerBank = await vault.getAll(STORES.answers);
    const extra = String(answer || '').trim();
    if (extra && (looksLikeCredential('answer', extra) || CREDENTIAL_ASSIGNMENT.test(extra))) {
      throw new AppError(ERROR_CODES.VALIDATION, 'That answer looks like a credential, so it was not recorded.');
    }
    const jobQuestions = Array.isArray(job.questions) ? job.questions : [];
    const packetAnswers = [
      ...answerBank,
      ...jobQuestions.map((question, index) => ({ id: `demo-job-question-${index}`, ...question }))
    ];
    if (extra) {
      packetAnswers.push({
        id: 'demo-visitor-answer', question: DEMO_QUESTION, answer: extra, normalized: 'fictional project'
      });
    }
    let cleanPacket;
    try {
      const packet = buildApplyPacketV2({
        profile,
        job,
        answerBank: packetAnswers,
        documents: documentMeta
      });
      const byKey = new Map(
        submittedFields.map((field) => [String(field?.key || ''), field]).filter(([key]) => key)
      );
      const mergedFields = packet.fields.map((field) => {
        const edit = byKey.get(field.key);
        return edit ? { ...field, value: edit.value } : field;
      });
      cleanPacket = sanitisePacketV2({ ...packet, fields: mergedFields });
    } catch (error) {
      throw new AppError(
        ERROR_CODES.VALIDATION,
        error instanceof Error ? error.message : 'That submission could not be validated.'
      );
    }
    const appliedAt = now().toISOString();
    const submission = summariseSubmission(cleanPacket, {
      delivery: 'web-guided',
      submittedBy: 'copilot-confirmed',
      fields: cleanPacket.fields.map(({ label, value }) => ({ label, value })),
      documents: documentMeta,
      confirmation: { confirmedAt: appliedAt, text: 'Send application' }
    });
    if (extra) {
      await vault.put(STORES.answers, 'demo-visitor-answer', {
        id: 'demo-visitor-answer', question: DEMO_QUESTION, answer: extra, normalized: 'fictional project',
        category: 'other', source: 'manual', timesUsed: 0, lastUsed: null, createdAt: appliedAt
      });
    }
    const updated = { ...job, status: 'applied', appliedAt };
    await vault.put(STORES.jobs, jobId, updated);

    const memory = (await vault.get(STORES.memory, 'dossier')) || { insights: [], employers: [], applications: [] };
    if (!Array.isArray(memory.applications)) memory.applications = [];
    if (!Array.isArray(memory.employers)) memory.employers = [];
    let record = memory.applications.find((entry) => entry.jobId === jobId);
    if (!record) {
      record = { id: crypto.randomUUID(), jobId, title: job.title, company: job.company, appliedAt, outcome: 'applied', salarySnapshot: null, transcript: [] };
      memory.applications.push(record);
      const normalized = String(job.company || '').trim().toLowerCase();
      let employer = memory.employers.find((entry) => String(entry.normalized || entry.company || '').toLowerCase() === normalized);
      if (!employer) {
        employer = { id: crypto.randomUUID(), company: job.company, normalized, notes: [], applications: 0, updatedAt: null };
        memory.employers.push(employer);
      }
      employer.applications = (Number(employer.applications) || 0) + 1;
      employer.updatedAt = appliedAt;
    }
    Object.assign(record, submission);
    memory.updatedAt = appliedAt;
    await vault.put(STORES.memory, 'dossier', memory);
    activity.add(`Simulated application recorded for ${job.title} at ${job.company}.`, 'system');
    return ok({ success: true, application: record, job: updated, simulated: true });
  }

  async function handle(input, init = {}) {
    try {
      const path = pathOf(input, baseUrl, basePath);
      const method = String(init.method || (typeof input === 'object' && input?.method) || 'GET').toUpperCase();
      let match;
      if ((match = path.match(/^\/jobs\/([^/]+)\/tailor$/)) && method === 'POST') return await tailor(match[1]);
      if (path === '/rag/ask' && method === 'POST') return await ask(input, init);
      if (path === '/rag/check' && method === 'POST') return await check(input, init);
      if ((match = path.match(/^\/demo\/apply\/([^/]+)$/)) && method === 'POST') return await applySimulated(input, init, match[1]);
      return await base.handle(input, init);
    } catch (err) {
      return fail(err);
    }
  }

  return { handle };
}
