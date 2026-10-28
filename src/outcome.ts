import type {
  CacheEntry,
  FinalJudgement,
  Judgement,
  Schedule,
  Strictness,
} from './types';
import { VerdictSource } from './types';
import { verdictFromNouls } from './ai/decisions';

/** Projects a cache hit into a per-schedule decision. */
export function judgementFromCache(
  entry: CacheEntry,
  schedule: Schedule,
  scheduleInstanceKey: string,
  strictness: Strictness,
  viaFallback: boolean,
): Judgement {
  return {
    verdict: verdictFromNouls(entry.nouls, strictness),
    source: VerdictSource.Cache,
    scheduleName: schedule.name,
    scheduleId: schedule.id,
    ...(viaFallback ? { viaFallback: true } : {}),
    scheduleInstanceKey,
    nouls: entry.nouls,
  };
}

/** Selects the outcome and projects it to the response shape. */
export function finalizeJudgement(
  decisions: Judgement[],
  warning?: string,
): FinalJudgement {
  const chosen = selectOutcome(decisions);
  if (!chosen) {
    return { verdict: 'allow', source: VerdictSource.Dormant, warning };
  }
  return {
    verdict: chosen.verdict,
    source: chosen.source,
    reason: chosen.reason,
    scheduleName: chosen.scheduleName,
    error: chosen.error,
    warning,
    viaFallback: chosen.viaFallback,
  };
}

/**
 * Picks the decision the caller acts on from one check's per-schedule rows.
 * Order is meaningful:
 * 1. The first block or error is terminal; evaluation stopped there.
 * 2. Otherwise the first live allow (a bypass or cache hit is weaker evidence).
 * 3. Otherwise the first cache allow.
 * 4. Otherwise the first bypass.
 */
export function selectOutcome(decisions: Judgement[]): Judgement | null {
  const stopped = decisions.find(
    (d) => d.verdict === 'block' || d.source === VerdictSource.Error,
  );
  if (stopped) return stopped;

  const evaluated = decisions.filter((d) => d.source !== VerdictSource.Bypass);
  return (
    evaluated.find((d) => d.source !== VerdictSource.Cache) ??
    evaluated[0] ??
    decisions[0] ??
    null
  );
}

/** Decisions that actually used the backup provider and can explain why. */
export function fallbackDecisions(decisions: Judgement[]): Judgement[] {
  return decisions.filter((d) => d.viaFallback && d.primaryError);
}
