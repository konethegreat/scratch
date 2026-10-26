import { webSearchTool } from '@sajas/core';
import { addLog, budgetStatus, budgetMessage } from '../db/helper.js';
import { callLlmFull, hasAnthropicKey } from './llm.js';

// ── Research fan-out sub-agent (T4) ─────────────────────────────────────────────
// Per target job, a lead step (the tailor) can spawn this sub-agent to pull a
// compact, GROUNDED brief about the employer and role — company focus, recent
// news, the role's likely priorities, and any salary context — so Agent 2 writes a
// cover letter that actually references the company instead of generic filler.
//
// Like jobSearchAI.js this uses Anthropic's server-side web_search tool, so it is
// grounded (real sources, not invented) and Anthropic-only. It is best-effort:
// returns '' on any failure or when disabled / keyless, so tailoring never blocks
// on research. Bounded max_uses keeps the cost predictable; it's a top-tier,
// opt-in feature (profile.useResearchFanout, default OFF).

const RESEARCH_MAX_SEARCHES = 3;

/** True only when research fan-out is enabled AND an Anthropic key is present. */
export function researchFanoutReady(profile = {}) {
  return profile.useResearchFanout === true && hasAnthropicKey(profile);
}

/**
 * Returns a short markdown research brief for one job, or '' if unavailable.
 * Never throws — research is an enhancement, not a dependency.
 */
export async function researchCompany(profile, job) {
  if (!researchFanoutReady(profile) || !job) return '';
  const budget = budgetStatus();
  if (budget.exceeded) {
    addLog(`[Research] Skipped — ${budgetMessage(budget)}`, 'system');
    return '';
  }

  const prompt = `You are a research assistant helping a South African job applicant tailor a cover letter.
Use web search to research the employer and role below, then write a TIGHT brief (max ~150 words) the writer can draw on.

Company: ${job.company || 'Unknown'}
Role: ${job.title || 'Unknown'}
Location: ${job.location || 'South Africa'}

Cover, only if you actually find it (never invent):
- What the company does and its market/sector focus.
- Anything recent and notable (funding, products, growth, awards) worth referencing.
- What this role likely prioritises and the tech/skills it implies.
- Any public salary-range context for this role in South Africa.

Rules:
- Only state facts you found via search. If you can't verify the company, say so briefly and keep it generic.
- Output plain prose/bullets, no preamble, no JSON. Be concise.`;

  try {
    addLog(`[Research] Researching ${job.company || 'employer'} for "${job.title}"…`, 'agent2');
    const result = await callLlmFull(profile, {
      task: 'research',
      prompt,
      tools: [webSearchTool({ maxUses: RESEARCH_MAX_SEARCHES })]
    });
    const text = (result.text || '').trim();
    if (text) addLog(`[Research] Brief ready for ${job.company || 'employer'}.`, 'agent2');
    return text;
  } catch (err) {
    addLog(`[Research] Skipped (${err.message}).`, 'system');
    return '';
  }
}
