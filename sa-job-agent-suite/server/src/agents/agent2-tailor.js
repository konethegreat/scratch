import path from 'path';
import { getProfile, readDb, updateJob, addLog, buildMemoryDigest, buildEmployerNotes, GENERATED_DOCS_PATH } from '../db/helper.js';
import { callLlm, assertAnthropicKey } from './llm.js';
import { renderMarkdownToPdf } from './pdf.js';
import { researchCompany, researchFanoutReady } from './companyResearch.js';
import { buildTailorPrompts, INJECTION_SHIELD } from './tailorPrompts.js';

/**
 * Tailors the CV + cover letter for one job.
 * @param {string} jobId
 * @param {object} [opts]
 * @param {string} [opts.researchBrief] A pre-computed company research brief
 *   (T4). When the batch orchestrator fans research out in parallel it passes the
 *   brief in so we don't research twice; for a lone run we fetch it here if the
 *   research-fan-out toggle is on.
 */
export async function runDocumentTailorAgent(jobId, opts = {}) {
  const profile = getProfile();

  addLog(`Starting Agent 2: Document Tailor for Job ID: ${jobId}...`, 'agent2');

  // ── Validation — throw early so the route can revert status to 'found' ──────
  assertAnthropicKey(profile);
  if (!profile.baseCv || profile.baseCv.trim().length < 50)
    throw new Error('Your base CV is empty or too short. Paste your full CV in the Profile & Settings tab first.');

  const fullDb = readDb();
  const job = fullDb.jobs.find((j) => j.id === jobId);
  if (!job) throw new Error(`Job with ID ${jobId} not found in database.`);

  const baseCv = profile.baseCv;
  // Company-INDEPENDENT dossier digest: goes into the cached system block. The
  // company-specific employer notes and the research brief go into the per-job
  // prompts instead, so `system` is byte-identical across jobs (prompt caching is
  // a prefix match).
  const memDigest = buildMemoryDigest({ maxInsights: 12 });
  if (memDigest) addLog('Applying learned candidate dossier to tailoring.', 'agent2');
  const employerNotes = buildEmployerNotes(job.company);

  // T4 research fan-out — a grounded brief on the employer/role. The batch
  // orchestrator computes these in parallel and passes one in via opts; a lone
  // run fetches its own only when the toggle is on. Best-effort: '' on failure.
  let researchBrief = typeof opts.researchBrief === 'string' ? opts.researchBrief : '';
  if (!researchBrief && researchFanoutReady(profile)) {
    researchBrief = await researchCompany(profile, job);
  }

  const { system: cvSystem, cvPrompt, coverLetterPrompt } = buildTailorPrompts({
    baseCv,
    memoryDigest: memDigest,
    employerNotes,
    researchBrief,
    job,
    injectionShield: INJECTION_SHIELD
  });

  // ── Generation — provider call is shared with Agent 3 via llm.js ───────────
  // Strip a leading ```lang fence and trailing ``` that some models wrap the
  // whole document in — otherwise they render literally in the generated PDF.
  const stripFences = (s = '') => s.trim()
    .replace(/^```[a-zA-Z]*\s*\r?\n?/, '')
    .replace(/\r?\n?```\s*$/, '')
    .trim();
  const generate = async (prompt) => stripFences(await callLlm(profile, prompt, { system: cvSystem, cacheSystem: true, bucket: 'tailor' }));

  // ── CV generation — if this throws, the caller reverts status to 'found' ──
  addLog('Generating tailored CV...', 'agent2');
  const tailoredCv = await generate(cvPrompt);

  // B2 fix: save CV immediately so it's never lost even if cover letter fails.
  // Status moves to 'tailored' now — a partial result (CV only) is still useful.
  updateJob(jobId, { tailoredCvText: tailoredCv, status: 'tailored' });
  addLog('CV tailored and saved.', 'agent2');

  // Render the CV to a PDF so Agent 3 can attach it to file-upload fields.
  // Best-effort: portals that accept pasted text still work without it.
  try {
    const cvPdfPath = path.join(GENERATED_DOCS_PATH, `${jobId}-CV.pdf`);
    const docTitle = `${profile.fullName || 'CV'} — ${job.title}`;
    await renderMarkdownToPdf(tailoredCv, cvPdfPath, docTitle);
    updateJob(jobId, { tailoredCvPath: cvPdfPath });
    addLog('CV PDF generated for upload.', 'agent2');
  } catch (err) {
    addLog(`CV PDF generation failed (text version still saved): ${err.message}`, 'error');
  }

  // ── Cover letter — best-effort; failure is logged but does not throw ───────
  addLog('Generating tailored cover letter...', 'agent2');
  try {
    const tailoredCoverLetter = await generate(coverLetterPrompt);
    updateJob(jobId, { tailoredCoverLetterText: tailoredCoverLetter });
    addLog('Cover letter tailored and saved.', 'agent2');
    try {
      const clPdfPath = path.join(GENERATED_DOCS_PATH, `${jobId}-CoverLetter.pdf`);
      await renderMarkdownToPdf(tailoredCoverLetter, clPdfPath, `Cover Letter — ${job.title}`);
      updateJob(jobId, { tailoredCoverLetterPath: clPdfPath });
      addLog('Cover letter PDF generated.', 'agent2');
    } catch (err) {
      addLog(`Cover letter PDF generation failed (text saved): ${err.message}`, 'error');
    }
  } catch (err) {
    addLog(`Cover letter generation failed (CV was saved): ${err.message}`, 'error');
  }

  addLog('Agent 2 Complete!', 'agent2');
  return readDb().jobs.find((j) => j.id === jobId);
}
