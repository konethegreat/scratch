// Browser grounded document questions: retrieval runs locally and only the
// retrieved passages travel to Anthropic, inside the user's own request.
import { AppError, ERROR_CODES } from '@sajas/core/errors';
import {
  buildCorpus, chunkDocuments, corpusSignature, describeCorpus,
  prepareAsk, prepareCheck, parseRagAnswer, parseCheckAnswer,
  RAG_SCHEMA, CHECK_SCHEMA, REFUSAL_SENTENCE
} from '@sajas/core/rag';
import { STORES } from './vault.js';

const STRUCTURED_OFF = 'Turn on Structured outputs in Profile & Settings to use Ask your documents. It keeps every answer verifiable.';
const TRUNCATED = 'The answer was cut off before it finished, so nothing was shown. Try again.';

function budgetMessage(budget) {
  return `Daily AI budget reached (est. $${budget.spentUSD.toFixed(2)} of $${budget.capUSD.toFixed(2)}). Raise or clear the cap in Profile & Settings, or wait until tomorrow.`;
}

export function createWebRag({
  vault,
  keyStore,
  usage,
  activity = { add() {} },
  now = () => new Date(),
  loadAi = () => import('@sajas/core/ai')
}) {
  async function sources() {
    const profile = (await vault.get(STORES.profile, 'current', {})) || {};
    return {
      profile,
      jobs: await vault.getAll(STORES.jobs),
      memory: (await vault.get(STORES.memory, 'dossier')) || {},
      answers: await vault.getAll(STORES.answers)
    };
  }

  function assertReady(profile) {
    if (!keyStore.getKey()) {
      throw new AppError(ERROR_CODES.KEY_INVALID, 'No Anthropic API key is loaded. Add one in the key panel first.');
    }
    if (profile.useStructuredOutputs === false) {
      throw new AppError(ERROR_CODES.VALIDATION, STRUCTURED_OFF);
    }
  }

  async function status() {
    const { profile, jobs, memory, answers } = await sources();
    const docs = buildCorpus({ profile, jobs, memory, answers });
    return {
      documents: docs.length,
      chunks: chunkDocuments(docs).length,
      signature: corpusSignature(docs),
      ...describeCorpus(docs),
      hasKey: keyStore.hasKey(),
      structuredOutputs: profile.useStructuredOutputs !== false
    };
  }

  async function run({ task, prepared, schema, parser, profile, bucket }) {
    const key = keyStore.getKey();
    const { callClaude, makeClient } = await loadAi();
    const client = makeClient({ apiKey: key, allowBrowser: true });
    const pending = [];
    try {
      const result = await callClaude({
        apiKey: key,
        task,
        prompt: prepared.prompt,
        system: prepared.system,
        cacheSystem: profile.usePromptCaching !== false,
        schema
      }, {
        client,
        beforeCall: async () => {
          const budget = await usage.budget(profile);
          if (budget.exceeded) throw new AppError(ERROR_CODES.BUDGET_EXCEEDED, budgetMessage(budget));
        },
        onUsage: (entry) => pending.push(entry),
        onLog: (message, type) => activity.add(message, type || 'system')
      });
      if (result.truncated) throw new AppError(ERROR_CODES.UNKNOWN, TRUNCATED);
      return parser(result.text, prepared.chunks);
    } finally {
      for (const entry of pending.splice(0)) {
        await usage.record({ ...entry, bucket });
      }
    }
  }

  async function ask({ question, purpose = 'general' } = {}) {
    const { profile, jobs, memory, answers } = await sources();
    assertReady(profile);
    const prepared = prepareAsk({ profile, jobs, memory, answers, question, purpose });
    if (prepared.refused) {
      return {
        kind: 'answer',
        question: String(question || '').trim(),
        purpose,
        supported: false,
        refused: true,
        answer: REFUSAL_SENTENCE,
        citations: [],
        searched: prepared.searched,
        missing: prepared.missing
      };
    }
    const parsed = await run({ task: 'rag', prepared, schema: RAG_SCHEMA, parser: parseRagAnswer, profile, bucket: 'rag' });
    return {
      kind: 'answer',
      question: prepared.question,
      purpose: prepared.purpose,
      ...parsed,
      searched: prepared.searched,
      missing: prepared.missing
    };
  }

  async function check({ jobId, documentKind = 'cv' } = {}) {
    const { profile, jobs, memory, answers } = await sources();
    assertReady(profile);
    const prepared = prepareCheck({ profile, jobs, memory, answers, jobId, documentKind });
    const base = {
      kind: 'check',
      jobId,
      documentKind: prepared.documentKind,
      documentTitle: prepared.documentTitle,
      searched: prepared.searched,
      missing: prepared.missing
    };
    if (prepared.refused) {
      return { ...base, supported: false, refused: true, answer: REFUSAL_SENTENCE, unsupportedClaims: [], citations: [] };
    }
    const parsed = await run({ task: 'ground', prepared, schema: CHECK_SCHEMA, parser: parseCheckAnswer, profile, bucket: 'ground' });
    return { ...base, ...parsed };
  }

  return { ask, check, status };
}
