import { describe, expect, it } from 'vitest';
import { Strictness } from '../types';
import {
  CLOSE_CALL_ALLOW_MARGIN,
  isCloseCallBlock,
  verdictFromNouls,
  THRESHOLDS,
} from './decisions';

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

describe('isCloseCallBlock', () => {
  it('flags an allow-failure block within 0.1 of the allow cutoff', () => {
    expect(
      isCloseCallBlock({ matchesBlock: 0.2, matchesAllow: 0.7 }, Strictness.High),
    ).toBe(true);
    expect(
      isCloseCallBlock({ matchesBlock: 0.2, matchesAllow: 0.8 }, Strictness.High),
    ).toBe(true);
  });

  it('does not flag an allow-failure block further than 0.1 below the cutoff', () => {
    expect(
      isCloseCallBlock({ matchesBlock: 0.2, matchesAllow: 0.69 }, Strictness.High),
    ).toBe(false);
  });

  it('does not flag when the block rule was met', () => {
    expect(
      isCloseCallBlock({ matchesBlock: 0.7, matchesAllow: 0.7 }, Strictness.High),
    ).toBe(false);
    expect(
      isCloseCallBlock({ matchesBlock: 0.9, matchesAllow: 0.7 }, Strictness.High),
    ).toBe(false);
  });

  it('treats missing block criteria as unmet', () => {
    expect(isCloseCallBlock({ matchesAllow: 0.7 }, Strictness.High)).toBe(true);
  });

  it('does not flag when the allow rule did not fire', () => {
    expect(
      isCloseCallBlock({ matchesBlock: 0.2, matchesAllow: 0.9 }, Strictness.High),
    ).toBe(false);
    expect(isCloseCallBlock({ matchesBlock: 0.2 }, Strictness.High)).toBe(false);
  });

  it('moves the band with the strictness cutoff', () => {
    expect(
      isCloseCallBlock({ matchesBlock: 0.2, matchesAllow: 0.5 }, Strictness.Medium),
    ).toBe(true);
    expect(
      isCloseCallBlock({ matchesBlock: 0.2, matchesAllow: 0.49 }, Strictness.Medium),
    ).toBe(false);
    expect(
      isCloseCallBlock({ matchesBlock: 0.2, matchesAllow: 0.3 }, Strictness.Low),
    ).toBe(true);
    expect(
      isCloseCallBlock({ matchesBlock: 0.2, matchesAllow: 0.29 }, Strictness.Low),
    ).toBe(false);
  });

  it('uses the documented margin', () => {
    expect(CLOSE_CALL_ALLOW_MARGIN).toBe(0.1);
  });
});
