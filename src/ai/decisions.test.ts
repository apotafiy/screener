import { describe, expect, it } from 'vitest';
import { verdictFromNouls, NOUL_THRESHOLD } from './decisions';

describe('verdictFromNouls', () => {
  it('blocks when matchesBlock is at/above threshold', () => {
    expect(verdictFromNouls({ matchesBlock: NOUL_THRESHOLD, matchesAllow: 1 })).toBe('block');
    expect(verdictFromNouls({ matchesBlock: 0.99 })).toBe('block');
  });

  it('allows when block is low and allow is high', () => {
    expect(verdictFromNouls({ matchesBlock: 0.1, matchesAllow: 0.9 })).toBe('allow');
  });

  it('blocks when allow is at/below threshold even if block is low', () => {
    expect(verdictFromNouls({ matchesBlock: 0.1, matchesAllow: NOUL_THRESHOLD })).toBe('block');
    expect(verdictFromNouls({ matchesBlock: 0.1, matchesAllow: 0.4 })).toBe('block');
  });

  it('allows with only block present and low', () => {
    expect(verdictFromNouls({ matchesBlock: 0.1 })).toBe('allow');
  });

  it('blocks with only allow present and low', () => {
    expect(verdictFromNouls({ matchesAllow: 0.2 })).toBe('block');
  });

  it('allows with only allow present and high', () => {
    expect(verdictFromNouls({ matchesAllow: 0.9 })).toBe('allow');
  });

  it('allows an empty decision', () => {
    expect(verdictFromNouls({})).toBe('allow');
  });
});
