import type { Adapter } from '../types';

/**
 * Placeholder for OpenAI's Decisions API (announced at DevDay, Sep 2026).
 *
 * As of this writing the API is in limited preview with no public request/
 * response schema, endpoint docs, SDK support, or pricing, and standard API
 * keys receive a 403 for `POST /v1/decisions`. Until OpenAI publishes the
 * contract, this adapter intentionally fails fast rather than guessing the
 * wire format.
 *
 * What is known from OpenAI's DevDay recap:
 *   - Input: context (text or images) plus developer-defined questions with
 *     finite pre-defined answers; output is "a selection" your code branches
 *     on (possibly with a confidence score, per press coverage).
 *   - Engine: a specialized version of GPT-6 Luna; ~150ms advertised.
 *   - Candidate endpoint: `POST https://api.openai.com/v1/decisions`.
 *
 * When it ships, mirror `src/ai/jev.ts`: add `'openai-decisions'` to
 * `ProviderKind` and a `PresetId`, register this adapter in `judge.ts`,
 * add a preset in `defaults.ts`, and list the kind in `schema.ts`. The
 * adapter returns a `NoulDecision` (see `src/ai/decisions.ts`), mapping
 * OpenAI's selection/confidence onto the matchesBlock/matchesAllow fields.
 */
export const openaiDecisions: Adapter = {
  async call() {
    throw new Error(
      'OpenAI Decisions API is not yet available (limited preview, no public docs).',
    );
  },
};
