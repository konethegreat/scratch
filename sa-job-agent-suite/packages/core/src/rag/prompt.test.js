import test from 'node:test';
import assert from 'node:assert/strict';
import { RAG_SYSTEM, CHECK_SYSTEM, REFUSAL_SENTENCE, renderChunkHeader, buildAskPrompt, buildCheckPrompt } from './prompt.js';

const CHUNK = {
  docTitle: 'Base CV', section: 'Experience', index: 2, version: 'abcd1234', text: 'Built payment systems.'
};

test('the system prompts carry the four grounding protocols and no question data', () => {
  for (const prompt of [RAG_SYSTEM, CHECK_SYSTEM]) {
    assert.match(prompt, /only facts stated in the retrieved context/i);
    assert.match(prompt, /\[Doc: <document title> \| Chunk: <chunk number>\]/);
    assert.match(prompt, /check each claim/i);
    assert.match(prompt, /untrusted data/i);
    assert.equal(prompt.includes('Base CV'), false);
  }
  assert.match(CHECK_SYSTEM, /document under review is not evidence/i);
});

test('chunk headers carry document, section, number and version', () => {
  assert.equal(renderChunkHeader(CHUNK), '[Doc: Base CV | Section: Experience | Chunk: 2 | Version: abcd1234]');
});

test('ask prompts contain the retrieved context, the question and the purpose line', () => {
  const general = buildAskPrompt({ question: 'What are my strongest achievements?', purpose: 'general', chunks: [CHUNK] });
  assert.match(general, /\[RETRIEVED CONTEXT\]/);
  assert.match(general, /\[USER QUERY\]/);
  assert.match(general, /What are my strongest achievements\?/);
  assert.match(general, /Answer the question directly/);
  const application = buildAskPrompt({ question: 'Why should we hire you?', purpose: 'application-answer', chunks: [CHUNK] });
  assert.match(application, /first-person answer/);
});

test('check prompts separate source evidence from the document under review', () => {
  const prompt = buildCheckPrompt({ documentTitle: 'Tailored CV: Dev at Acme', documentText: 'Led forty engineers.', chunks: [CHUNK] });
  assert.match(prompt, /\[DOCUMENT UNDER REVIEW\]/);
  assert.match(prompt, /Led forty engineers\./);
  assert.match(prompt, /not supported just because the document states it/);
  assert.equal(REFUSAL_SENTENCE, 'The retrieved context does not contain sufficient information to answer this query.');
});
