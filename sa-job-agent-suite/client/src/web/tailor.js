// Browser Document Tailor: the same prompts as desktop, called directly from the
// page with the user's key. No document text or key reaches our origin.
import { AppError, ERROR_CODES } from '@sajas/core/errors';
import { buildTailorPrompts } from '@sajas/core/tailor';
import { STORES } from './vault.js';

const MIN_CV = 50;

const stripFences = (text = '') => String(text).trim()
  .replace(/^```[a-zA-Z]*\s*\r?\n?/, '')
  .replace(/\r?\n?```\s*$/, '')
  .trim();

function budgetMessage(budget) {
  return `Daily AI budget reached (est. $${budget.spentUSD.toFixed(2)} of $${budget.capUSD.toFixed(2)}). Raise or clear the cap in Profile & Settings, or wait until tomorrow.`;
}

export function createWebTailor({
  vault,
  keyStore,
  usage,
  activity = { add() {} },
  now = () => new Date(),
  loadAi = () => import('@sajas/core/ai')
}) {
  async function saveJob(job) {
    await vault.put(STORES.jobs, job.id, job);
    return job;
  }

  async function tailorJob(jobId, profile = {}) {
    const baseCv = String(profile.baseCv || '').trim();
    if (baseCv.length < MIN_CV) {
      throw new AppError(ERROR_CODES.VALIDATION, 'Your base CV is empty or too short. Paste your full CV in Profile & Settings first.');
    }
    const key = keyStore.getKey();
    if (!key) {
      throw new AppError(ERROR_CODES.KEY_INVALID, 'No Anthropic API key is loaded. Add one in the key panel first.');
    }
    const current = await vault.get(STORES.jobs, jobId);
    if (!current) throw new AppError(ERROR_CODES.NOT_FOUND, 'Job not found.');

    const previousStatus = current.status;
    let job = await saveJob({ ...current, status: 'tailoring' });
    activity.add(`Tailoring started for ${job.title} at ${job.company}.`, 'agent2');

    const { callClaude, makeClient } = await loadAi();
    // The key lives only in this closure and in the SDK client.
    const client = makeClient({ apiKey: key, allowBrowser: true });
    const { system, cvPrompt, coverLetterPrompt } = buildTailorPrompts({ baseCv, job });

    const generate = async (prompt, what) => {
      const pending = [];
      try {
        const result = await callClaude({
          apiKey: key,
          task: 'tailor',
          prompt,
          system,
          cacheSystem: profile.usePromptCaching !== false
        }, {
          client,
          beforeCall: async () => {
            const budget = await usage.budget(profile);
            if (budget.exceeded) {
              throw new AppError(ERROR_CODES.BUDGET_EXCEEDED, budgetMessage(budget));
            }
          },
          onUsage: (u) => pending.push(u),
          onLog: (message, type) => activity.add(message, type || 'system')
        });
        if (result.truncated) {
          throw new AppError(ERROR_CODES.UNKNOWN, `The ${what} was cut off before it finished, so it was not saved. Try again.`);
        }
        const text = stripFences(result.text);
        if (!text) {
          throw new AppError(ERROR_CODES.UNKNOWN, `The ${what} came back empty, so nothing was saved. Try again.`);
        }
        return text;
      } finally {
        for (const u of pending.splice(0)) {
          await usage.record({ ...u, bucket: 'tailor' });
        }
      }
    };

    let tailoredCv;
    try {
      tailoredCv = await generate(cvPrompt, 'tailored CV');
    } catch (err) {
      await saveJob({ ...current, status: previousStatus });
      activity.add(`Tailoring failed for ${job.title}: ${err.message}`, 'error');
      throw err;
    }

    job = await saveJob({ ...job, tailoredCvText: tailoredCv, status: 'tailored' });
    activity.add('Tailored CV saved.', 'agent2');

    let warning = '';
    try {
      const tailoredCoverLetterText = await generate(coverLetterPrompt, 'cover letter');
      job = await saveJob({ ...job, tailoredCoverLetterText });
      activity.add('Tailored cover letter saved.', 'agent2');
    } catch (err) {
      warning = `The cover letter was not generated: ${err.message}`;
      activity.add(warning, 'error');
    }

    return { job, warning };
  }

  return { tailorJob };
}
