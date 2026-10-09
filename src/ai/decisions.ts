import type { NoulDecision, Verdict } from '../types';
import { Strictness } from '../types';

export interface NoulThresholds {
  /** Block when P(matches BLOCK criteria) >= block. */
  block: number;
  /** Block when P(matches ALLOW criteria) <= allow. */
  allow: number;
}

/**
 * Cutoffs per strictness level. Both gates fire more as strictness rises: the
 * block cutoff falls (blocks on weaker block matches) and the allow cutoff
 * rises (demands a clearer allow match). 'medium' preserves the historical 0.6
 * allow cutoff.
 */
export const THRESHOLDS: Record<Strictness, NoulThresholds> = {
  [Strictness.Low]: { block: 0.9, allow: 0.4 },
  [Strictness.Medium]: { block: 0.8, allow: 0.6 },
  [Strictness.High]: { block: 0.7, allow: 0.8 },
};

/**
 * Applies the content-filter rule order to a decision model's answers:
 * 1. matches BLOCK criteria -> block
 * 2. fails to clearly match ALLOW criteria -> block
 * 3. otherwise allow
 *
 * A question is "asked" iff its field is present (i.e. the corresponding
 * criteria were non-empty), so the field presence alone drives the rules.
 */
export function verdictFromNouls(n: NoulDecision, strictness: Strictness): Verdict {
  const { block, allow } = THRESHOLDS[strictness];
  if (n.matchesBlock !== undefined && n.matchesBlock >= block) return 'block';
  if (n.matchesAllow !== undefined && n.matchesAllow <= allow) return 'block';
  return 'allow';
}
