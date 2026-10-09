import { describe, expect, it } from 'vitest';
import { Strictness } from '../types';
import { verdictFromNouls, THRESHOLDS } from './decisions';

describe('verdictFromNouls', () => {
  it('blocks when matchesBlock is at/above the block cutoff', () => {
    expect(verdictFromNouls({ matchesBlock: THRESHOLDS[Strictness.Medium].block, matchesAllow: 1 }, Strictness.Medium)).toBe('block');
    expect(verdictFromNouls({ matchesBlock: 0.99 }, Strictness.Medium)).toBe('block');
  });

  it('allows when block is low and allow is high', () => {
    expect(verdictFromNouls({ matchesBlock: 0.1, matchesAllow: 0.9 }, Strictness.Medium)).toBe('allow');
  });

  it('blocks when allow is at/below the allow cutoff even if block is low', () => {
    expect(verdictFromNouls({ matchesBlock: 0.1, matchesAllow: THRESHOLDS[Strictness.Medium].allow }, Strictness.Medium)).toBe('block');
    expect(verdictFromNouls({ matchesBlock: 0.1, matchesAllow: 0.4 }, Strictness.Medium)).toBe('block');
  });

  it('allows with only block present and low', () => {
    expect(verdictFromNouls({ matchesBlock: 0.1 }, Strictness.Medium)).toBe('allow');
  });

  it('blocks with only allow present and low', () => {
    expect(verdictFromNouls({ matchesAllow: 0.2 }, Strictness.Medium)).toBe('block');
  });

  it('allows with only allow present and high', () => {
    expect(verdictFromNouls({ matchesAllow: 0.9 }, Strictness.Medium)).toBe('allow');
  });

  it('allows an empty decision', () => {
    expect(verdictFromNouls({}, Strictness.Medium)).toBe('allow');
  });

  it('blocks more as strictness rises', () => {
    // A moderate block match and a moderate allow match straddle the levels.
    const n = { matchesBlock: 0.75, matchesAllow: 0.5 };
    expect(verdictFromNouls(n, Strictness.Low)).toBe('allow');
    expect(verdictFromNouls(n, Strictness.Medium)).toBe('block');
    expect(verdictFromNouls(n, Strictness.High)).toBe('block');
  });

  it('uses the documented cutoffs per level', () => {
    expect(THRESHOLDS).toEqual({
      [Strictness.Low]: { block: 0.9, allow: 0.4 },
      [Strictness.Medium]: { block: 0.8, allow: 0.6 },
      [Strictness.High]: { block: 0.7, allow: 0.8 },
    });
  });
});
