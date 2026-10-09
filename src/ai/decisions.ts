import type { NoulDecision, Verdict } from '../types';

/**
 * Threshold at or above which a `noul` answer counts as "yes". The verdict
 * rules treat a tie as a block on both questions: matchesBlock >= threshold
 * blocks, and matchesAllow <= threshold (i.e. not clearly matching) blocks.
 */
export const NOUL_THRESHOLD = 0.6;

/**
 * Applies the content-filter rule order to a decision model's answers:
 * 1. matches BLOCK criteria -> block
 * 2. fails to clearly match ALLOW criteria -> block
 * 3. otherwise allow
 *
 * A question is "asked" iff its field is present (i.e. the corresponding
 * criteria were non-empty), so the field presence alone drives the rules.
 */
export function verdictFromNouls(n: NoulDecision): Verdict {
  if (n.matchesBlock !== undefined && n.matchesBlock >= NOUL_THRESHOLD) return 'block';
  if (n.matchesAllow !== undefined && n.matchesAllow <= NOUL_THRESHOLD) return 'block';
  return 'allow';
}
