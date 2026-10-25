// Deterministic output checks for the eval harness. Pure: no I/O, no network.
// A check can only prove an output is BAD or "not obviously bad"; it is not a
// quality score. Fabricated years and fenced output are the failure modes the
// tailor prompts have to guard against, so they are the hard failures here.

const MIN_CV_CHARS = 400;
const MIN_KEYWORD_COVERAGE = 0.4;
const YEAR_RE = /\b(?:19|20)\d{2}\b/g;

const years = (s) => new Set(String(s ?? '').match(YEAR_RE) || []);

/**
 * @param {string} baseCv  authoritative CV the model was given
 * @param {{description?:string, keywords?:string[]}} job
 * @param {string} output  the tailored CV the model produced
 * @returns {{ pass: boolean, failures: string[] }}
 */
export function checkTailoredCv(baseCv, job, output) {
  const failures = [];
  const text = typeof output === 'string' ? output : '';
  const trimmed = text.trim();

  if (!trimmed) {
    failures.push('output is empty');
    return { pass: false, failures };
  }
  if (trimmed.length < MIN_CV_CHARS) {
    failures.push(`output is too short (${trimmed.length} chars, need at least ${MIN_CV_CHARS})`);
  }
  if (/^```/.test(trimmed) || /```\s*$/.test(trimmed)) {
    failures.push('output is wrapped in a code fence');
  }

  const allowed = new Set([...years(baseCv), ...years(job?.description)]);
  const invented = [...years(text)].filter((y) => !allowed.has(y));
  if (invented.length) {
    failures.push(`year(s) not in the base CV or job description: ${invented.join(', ')}`);
  }

  const keywords = Array.isArray(job?.keywords) ? job.keywords.filter(Boolean) : [];
  if (keywords.length) {
    const lower = text.toLowerCase();
    const found = keywords.filter((k) => lower.includes(String(k).toLowerCase()));
    const coverage = found.length / keywords.length;
    if (coverage < MIN_KEYWORD_COVERAGE) {
      failures.push(`keyword coverage ${Math.round(coverage * 100)}% is below ${MIN_KEYWORD_COVERAGE * 100}% (${found.length}/${keywords.length})`);
    }
  }

  return { pass: failures.length === 0, failures };
}

/**
 * @param {{pageType:string, action:string}} expected
 * @param {object|null} plan  normalised planner output, or null when planning failed
 */
export function checkPlan(expected, plan) {
  if (!plan || typeof plan !== 'object') return { pass: false, failures: ['no plan returned'] };
  const failures = [];
  if (plan.pageType !== expected.pageType) failures.push(`pageType: expected ${expected.pageType}, got ${plan.pageType}`);
  if (plan.action !== expected.action) failures.push(`action: expected ${expected.action}, got ${plan.action}`);
  return { pass: failures.length === 0, failures };
}
