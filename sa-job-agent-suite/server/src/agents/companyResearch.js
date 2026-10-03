import Anthropic from '@anthropic-ai/sdk';
import { addLog, addUsage, budgetStatus, budgetMessage } from '../db/helper.js';
import { fromAnthropicUsage } from '../db/costs.js';

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

const WEB_SEARCH_TOOL = { type: 'web_search_20250305', name: 'web_search', max_uses: 3 };

/** True only when research fan-out is enabled AND an Anthropic key is present. */
export function researchFanoutReady(profile = {}) {
  if (profile.useResearchFanout !== true) return false;
  const key = profile.anthropicApiKey;
  return Boolean(key && !String(key).includes('your_'));
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

  const model = (profile.aiSearchModel || '').trim() || 'claude-sonnet-4-6';
  const anthropic = new Anthropic({ apiKey: profile.anthropicApiKey });

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

  let messages = [{ role: 'user', content: prompt }];
  const tools = [{
    ...WEB_SEARCH_TOOL,
    user_location: { type: 'approximate', country: 'ZA', timezone: 'Africa/Johannesburg' }
  }];

  try {
    addLog(`[Research] Researching ${job.company || 'employer'} for "${job.title}"…`, 'agent2');
    let final = null;
    for (let turn = 0; turn < 4; turn++) {
      const resp = await anthropic.messages.create({ model, max_tokens: 1024, messages, tools });
      addUsage({ ...fromAnthropicUsage(model, resp.usage || {}), bucket: 'research' });
      if (resp.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: resp.content });
        continue;
      }
      final = resp;
      break;
    }
    if (!final) {
      addLog('[Research] Search kept pausing — skipping research for this job.', 'system');
      return '';
    }
    const text = (final.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    if (text) addLog(`[Research] Brief ready for ${job.company || 'employer'}.`, 'agent2');
    return text;
  } catch (err) {
    addLog(`[Research] Skipped (${err.message}).`, 'system');
    return '';
  }
}
