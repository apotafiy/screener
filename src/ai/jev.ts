import type { Adapter, NoulDecision, Schedule, VideoMetadata } from '../types';

interface NoulQuestion {
  type: 'noul';
  instructions: string;
}

export interface NoulAnswer {
  type: 'noul';
  noul?: number;
}

interface DecideResponse {
  answers?: Record<string, NoulAnswer>;
}

/**
 * Builds the Jev `state`: only the video context the decision needs. The
 * criteria live in the question instructions so each question is
 * self-contained, matching the rule ordering.
 */
export function buildState(meta: VideoMetadata): Record<string, string> {
  const state: Record<string, string> = { title: meta.title, channel: meta.channel };
  if (meta.description && meta.description.trim() !== '') {
    state.description = meta.description.trim();
  }
  if (meta.tags && meta.tags.length > 0) {
    state.tags = meta.tags.slice(0, 100).join(', ');
  }
  if (meta.category && meta.category.trim() !== '') {
    state.category = meta.category.trim();
  }
  return state;
}

/**
 * Maps the allow/block rules onto `noul` questions. The verdict rules are
 * applied in code (see decisions.verdictFromNouls), not by the model.
 */
export function buildQuestions(schedule: Schedule): Record<string, NoulQuestion> {
  const questions: Record<string, NoulQuestion> = {};
  const block = schedule.blockCriteria.trim();
  if (block) {
    questions.matches_block = {
      type: 'noul',
      instructions: `Does the video match the following BLOCK criteria? "${block}"`,
    };
  }
  const allow = schedule.allowCriteria.trim();
  if (allow) {
    questions.matches_allow = {
      type: 'noul',
      instructions: `Does the video clearly match the following ALLOW criteria? "${allow}"`,
    };
  }
  return questions;
}

function readNoul(answers: Record<string, NoulAnswer>, key: string): number {
  const a = answers[key];
  if (!a || a.type !== 'noul') { // TODO why would there ever be case where this isn't noul?!?!
    throw new Error(`Jev error: missing or invalid answer for "${key}"`);
  }
  const n = a.noul;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1) {
    throw new Error(`Jev error: invalid noul value for "${key}"`);
  }
  return n;
}

/**
 * Maps the answers back into a NoulDecision, keyed by the same questions.
 * Missing answers throw so the caller treats the request as a failure and
 * retries / falls back, rather than guessing.
 */
export function toDecision(schedule: Schedule, answers: Record<string, NoulAnswer>): NoulDecision {
  const decision: NoulDecision = {};
  if (schedule.blockCriteria.trim()) decision.matchesBlock = readNoul(answers, 'matches_block');
  if (schedule.allowCriteria.trim()) decision.matchesAllow = readNoul(answers, 'matches_allow');
  return decision;
}

/**
 * Jev (TypeSafe) decision-model adapter. Sends a single request carrying the
 * typed questions above and maps the calibrated answers back into a
 * NoulDecision. Jev returns no free text.
 *
 * `config.baseUrl` is the full endpoint URL (e.g.
 * https://api.typesafe.ai/v1/systemone or
 * https://openrouter.ai/api/alpha/decisions) — presets fill it in.
 */
export const jev: Adapter = {
  async call(config, apiKey, schedule, meta, signal) {
    const questions = buildQuestions(schedule);
    if (Object.keys(questions).length === 0) {
      return {};
    }

    const res = await fetch(config.baseUrl, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey.trim() ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.model,
        state: buildState(meta),
        questions,
      }),
    });
    if (!res.ok) {
      const body = (await res.text().catch(() => '')).slice(0, 300);
      throw new Error(`Jev error ${res.status}: ${body}`);
    }

    const json = (await res.json()) as DecideResponse;
    if (!json.answers) {
      throw new Error('Jev error: response has no answers');
    }
    return toDecision(schedule, json.answers);
  },
};
