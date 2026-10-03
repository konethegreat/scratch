import Anthropic from '@anthropic-ai/sdk';
import { addLog, addUsage, budgetStatus, budgetMessage } from '../db/helper.js';
import { fromAnthropicUsage } from '../db/costs.js';
import { callLlm, extractJson } from './llm.js';

// ── Referral pipeline (post-application "direct outreach channel") ──────────────
// A counter-measure to algorithmic ATS screening: the moment an application is
// confirmed, this helps the user open a human-to-human channel with technical
// leadership at the same firm. It (1) finds ONE relevant senior engineering
// contact at the company and (2) drafts a tight, peer-to-peer outreach message
// the user copies and sends themselves.
//
// Design follows the rest of the suite:
//   • GROUNDED — contact discovery uses Anthropic's server-side web_search tool
//     (real people + real profile URLs, same engine as jobSearchAI/companyResearch).
//     It NEVER invents a person; if it can't verify one it falls back to a
//     pre-built LinkedIn people-search link the user follows themselves.
//   • PROVIDER-AGNOSTIC drafting — the message is written via callLlm(), so it
//     honours whichever key (Gemini / Anthropic / OpenRouter) the user selected.
//   • HUMAN-ON-THE-LOOP — it only drafts. Nothing is sent, connected, or messaged
//     automatically. The user reviews, edits, and reaches out.
//   • BEST-EFFORT — never throws; a failure degrades to the search-link fallback
//     so the channel is always actionable.

const WEB_SEARCH_TOOL = { type: 'web_search_20250305', name: 'web_search', max_uses: 3 };

// Roles we prioritise, most senior/relevant for an engineering referral first.
const TARGET_ROLES = 'Engineering Manager, Tech Lead, Team Lead, Head of Engineering, or CTO (at a smaller company)';

/** True when grounded discovery is possible (a real Anthropic key is present). */
export function groundedReferralReady(profile = {}) {
  const key = profile.anthropicApiKey;
  return Boolean(key && !String(key).includes('your_'));
}

/**
 * A targeted LinkedIn people-search URL for the company + senior eng roles, so
 * the user can find the right person manually when grounded search isn't
 * available or didn't verify a specific name. Always returns a usable link.
 */
export function linkedInPeopleSearchUrl(company = '', roleHint = 'engineering manager OR tech lead OR CTO') {
  const terms = [String(company || '').trim(), String(roleHint || '').trim()]
    .filter(Boolean)
    .join(' ');
  const keywords = encodeURIComponent(terms || 'engineering manager');
  return `https://www.linkedin.com/search/results/people/?keywords=${keywords}&origin=GLOBAL_SEARCH_HEADER`;
}

/** Shape every contact object the same way so the UI can rely on the keys. */
function normalizeContact({ full_name = '', exact_role = '', company = '', profile_url = '' } = {}, grounded = false) {
  return {
    full_name: String(full_name || '').trim(),
    exact_role: String(exact_role || '').trim(),
    company: String(company || '').trim(),
    profile_url: String(profile_url || '').trim(),
    grounded: Boolean(grounded)
  };
}

/**
 * Find ONE senior engineering contact at the target company via grounded web
 * search. Returns a normalized contact ({ full_name, exact_role, company,
 * profile_url, grounded }). On no key, no result, or any error it returns a
 * fallback contact whose profile_url is a LinkedIn people-search link and whose
 * full_name is '' (so the UI shows "search for a contact" instead of a fake name).
 */
export async function findReferralContact(profile, job) {
  const company = job?.company || '';
  const fallback = normalizeContact(
    { company, profile_url: linkedInPeopleSearchUrl(company) },
    false
  );

  if (!groundedReferralReady(profile) || !company) return fallback;
  const budget = budgetStatus();
  if (budget.exceeded) {
    addLog(`[Referral] Grounded contact search skipped — ${budgetMessage(budget)} Using a LinkedIn search link instead.`, 'system');
    return fallback;
  }

  const model = (profile.aiSearchModel || '').trim() || 'claude-sonnet-4-6';
  const anthropic = new Anthropic({ apiKey: profile.anthropicApiKey });

  const prompt = `You are helping a South African software engineer find ONE real person to reach out to for a referral, after applying for a role.

Company: ${company}
Role they applied for: ${job?.title || 'Unknown'}
Location: ${job?.location || 'South Africa'}

Use web search to identify a single, currently-employed senior engineering contact at THIS company. Prioritise, in order: ${TARGET_ROLES}.

Return ONLY a JSON object, no prose, no markdown fences:
{
  "full_name": "their real full name, or \\"\\" if you cannot verify a real person",
  "exact_role": "their exact current title at this company",
  "profile_url": "a public professional profile URL you actually found (LinkedIn etc.), or \\"\\" ",
  "confidence": "high | medium | low"
}

Rules:
- ONLY return a person you can actually verify via search results. Never invent a name, title, or URL.
- The person must currently work at "${company}".
- If you cannot verify a specific real person, return full_name "" and profile_url "".`;

  let messages = [{ role: 'user', content: prompt }];
  const tools = [{
    ...WEB_SEARCH_TOOL,
    user_location: { type: 'approximate', country: 'ZA', timezone: 'Africa/Johannesburg' }
  }];

  try {
    addLog(`[Referral] Searching for an engineering contact at ${company}…`, 'agent3');
    let final = null;
    for (let turn = 0; turn < 4; turn++) {
      const resp = await anthropic.messages.create({ model, max_tokens: 1024, messages, tools });
      addUsage({ ...fromAnthropicUsage(model, resp.usage || {}), bucket: 'referral' });
      if (resp.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: resp.content });
        continue;
      }
      final = resp;
      break;
    }
    if (!final) {
      addLog('[Referral] Search kept pausing — using a LinkedIn search link instead.', 'system');
      return fallback;
    }
    const text = (final.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    const parsed = extractJson(text);
    if (!parsed || !parsed.full_name) {
      addLog(`[Referral] No specific contact verified at ${company} — using a LinkedIn search link.`, 'system');
      return fallback;
    }
    addLog(`[Referral] Found ${parsed.full_name} (${parsed.exact_role || 'role unknown'}) at ${company}.`, 'agent3');
    return normalizeContact(
      {
        full_name: parsed.full_name,
        exact_role: parsed.exact_role,
        company,
        // Keep a verified profile URL; if the model didn't return one, hand the
        // user a search link seeded with the real name so they can confirm.
        profile_url: parsed.profile_url || linkedInPeopleSearchUrl(`${parsed.full_name} ${company}`, '')
      },
      true
    );
  } catch (err) {
    addLog(`[Referral] Contact search skipped (${err.message}) — using a LinkedIn search link.`, 'system');
    return fallback;
  }
}

/** Pull the user's strongest technical signal for the message (CV-first, then keywords). */
function candidateStrengthContext(profile) {
  const cv = String(profile?.baseCv || '').trim();
  const keywords = String(profile?.keywords || '').trim();
  // The CV can be long; the drafter only needs a strength signal, so cap it.
  const cvSnippet = cv ? cv.slice(0, 1500) : '';
  return { cvSnippet, keywords };
}

/**
 * Draft a tight, peer-to-peer outreach message. Provider-agnostic (callLlm).
 * Returns a plain-text message string. Best-effort: returns a minimal,
 * non-empty template on error so the channel is never blank.
 */
export async function draftOutreachMessage(profile, job, contact) {
  const { cvSnippet, keywords } = candidateStrengthContext(profile);
  const portfolio = String(profile?.portfolioUrl || '').trim();
  const linkedIn = String(profile?.linkedInUrl || '').trim();
  const ctaUrl = portfolio || linkedIn;
  const greetingName = contact?.full_name ? contact.full_name.split(/\s+/)[0] : '';

  const system = `You write short, direct, peer-to-peer outreach messages from one software engineer to another. You never use filler ("I hope this email finds you well", "I am writing to", "I would be grateful"). You never use placeholders or brackets. You output ONLY the message body — no subject line, no sign-off block, no commentary.`;

  const prompt = `Write an outreach message from a South African software engineer to a senior engineer at a company where they just applied, to open a direct conversation about the role.

Recipient: ${contact?.full_name || 'a senior engineer on the team'}${contact?.exact_role ? ` (${contact.exact_role})` : ''}
Company: ${job?.company || 'the company'}
Exact role applied for: ${job?.title || 'the open engineering role'}

The sender's technical strengths (infer their single strongest, most relevant strength from this):
- Target keywords: ${keywords || 'software engineering'}
- CV excerpt: ${cvSnippet || '(not provided — keep the strength generic but engineering-specific)'}

Sender's link to share: ${ctaUrl || '(no link available — invite a brief reply instead)'}

Rules:
- Address them by first name if available${greetingName ? ` ("${greetingName}")` : ''}.
- Reference the EXACT role title above by name.
- Lead with one concrete sentence connecting the sender's strongest technical strength to what the company likely works on / its stack.
- End with a direct call to action${ctaUrl ? ` that points to this link: ${ctaUrl}` : ' inviting a short reply'}.
- Tone: direct, respectful, engineer-to-engineer. No fluff, no flattery, no clichés.
- Hard limit: 150 words. Aim for 90–130.
- Output ONLY the message text.`;

  try {
    const text = await callLlm(profile, prompt, { maxTokens: 600, system, bucket: 'referral' });
    const clean = String(text || '').trim();
    if (clean) return clean;
  } catch (err) {
    addLog(`[Referral] Message draft failed (${err.message}) — using a minimal template.`, 'system');
  }
  // Minimal, non-empty fallback so the section is always actionable.
  const who = greetingName ? `Hi ${greetingName},` : 'Hi,';
  const link = ctaUrl ? ` You can see my work here: ${ctaUrl}.` : '';
  return `${who} I just applied for the ${job?.title || 'engineering'} role at ${job?.company || 'your team'}. I work primarily with ${keywords.split(',')[0]?.trim() || 'software engineering'} and would value a quick word with someone on the team about where I could contribute most.${link} Open to a short call whenever suits you.`;
}

/**
 * Orchestrate the full pipeline for one job: find a contact, draft the message.
 * Returns a referral object ready to persist on the job and render in the UI.
 * Never throws.
 */
export async function runReferralPipeline(profile, job) {
  const contact = await findReferralContact(profile, job);
  const message = await draftOutreachMessage(profile, job, contact);
  return {
    contact,
    message,
    grounded: contact.grounded,
    generatedAt: new Date().toISOString()
  };
}
