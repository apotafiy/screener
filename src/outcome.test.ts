import { describe, expect, it } from 'vitest';
import type { CacheEntry, Judgement, Schedule } from './types';
import { Strictness, VerdictSource } from './types';
import {
  fallbackDecisions,
  finalizeJudgement,
  judgementFromCache,
  selectOutcome,
} from './outcome';

function j(overrides: Partial<Judgement>): Judgement {
  return { verdict: 'allow', source: VerdictSource.Ai, ...overrides };
}

const schedule: Schedule = {
  id: 's1',
  name: 'Test',
  enabled: true,
  days: [1],
  startMinutes: 0,
  endMinutes: 60,
  allowCriteria: '',
  blockCriteria: '',
  allowKeywords: [],
  blockKeywords: [],
};

describe('selectOutcome', () => {
  it('returns null for an empty check', () => {
    expect(selectOutcome([])).toBeNull();
  });

  it('returns the first block', () => {
    const a = j({ verdict: 'allow', source: VerdictSource.Cache });
    const b = j({ verdict: 'block', source: VerdictSource.Ai });
    expect(selectOutcome([a, b])).toBe(b);
  });

  it('returns an error over an allow', () => {
    const a = j({ source: VerdictSource.Ai });
    const b = j({ source: VerdictSource.Error, error: 'nope' });
    expect(selectOutcome([a, b])).toBe(b);
  });

  it('prefers the first live allow over a cache allow', () => {
    const cached = j({ source: VerdictSource.Cache });
    const live = j({ source: VerdictSource.Ai });
    expect(selectOutcome([cached, live])).toBe(live);
  });

  it('uses the first cache allow when everything is cached', () => {
    const a = j({ source: VerdictSource.Cache });
    const b = j({ source: VerdictSource.Cache });
    expect(selectOutcome([a, b])).toBe(a);
  });

  it('ignores bypasses when a schedule actually evaluated the video', () => {
    const bypass = j({ source: VerdictSource.Bypass });
    const live = j({ source: VerdictSource.Ai });
    expect(selectOutcome([bypass, live])).toBe(live);
  });

  it('falls back to the first bypass when everything was bypassed', () => {
    const a = j({ source: VerdictSource.Bypass });
    const b = j({ source: VerdictSource.Bypass });
    expect(selectOutcome([a, b])).toBe(a);
  });
});

describe('finalizeJudgement', () => {
  it('returns dormant for an empty check', () => {
    expect(finalizeJudgement([])).toMatchObject({
      verdict: 'allow',
      source: VerdictSource.Dormant,
    });
  });

  it('passes the warning through to the outcome', () => {
    const outcome = finalizeJudgement(
      [j({ verdict: 'block', source: VerdictSource.Ai })],
      'backup used',
    );
    expect(outcome.warning).toBe('backup used');
  });

  it('projects only response fields', () => {
    const outcome = finalizeJudgement([
      j({
        nouls: { matchesBlock: 0.9 },
        scheduleInstanceKey: '2026-10-28',
        scheduleId: 's1',
        primaryError: 'timeout',
      }),
    ]);
    expect(outcome).not.toHaveProperty('nouls');
    expect(outcome).not.toHaveProperty('scheduleInstanceKey');
    expect(outcome).not.toHaveProperty('scheduleId');
    expect(outcome).not.toHaveProperty('primaryError');
  });
});

describe('judgementFromCache', () => {
  const entry: CacheEntry = {
    videoId: 'v1',
    criteriaHash: 'h1',
    nouls: { matchesBlock: 0.9 },
    title: 'Title',
  };

  it('projects a cache hit into a decision', () => {
    expect(
      judgementFromCache(entry, schedule, '2026-10-28', Strictness.Medium, false),
    ).toMatchObject({
      verdict: 'block',
      source: VerdictSource.Cache,
      scheduleId: 's1',
      scheduleName: 'Test',
      scheduleInstanceKey: '2026-10-28',
      nouls: { matchesBlock: 0.9 },
    });
  });

  it('marks a fallback hit only when requested', () => {
    expect(
      judgementFromCache(entry, schedule, '2026-10-28', Strictness.Medium, false).viaFallback,
    ).toBeUndefined();
    expect(
      judgementFromCache(entry, schedule, '2026-10-28', Strictness.Medium, true).viaFallback,
    ).toBe(true);
  });

  it('allows when the probabilities pass', () => {
    const allow = judgementFromCache(
      { ...entry, nouls: { matchesBlock: 0.1 } },
      schedule,
      '2026-10-28',
      Strictness.Medium,
      false,
    );
    expect(allow.verdict).toBe('allow');
  });
});

describe('fallbackDecisions', () => {
  it('keeps only results that used the backup and have an error', () => {
    const used = j({ viaFallback: true, primaryError: 'timeout' });
    const cached = j({ viaFallback: true, source: VerdictSource.Cache });
    const normal = j({});
    expect(fallbackDecisions([used, cached, normal])).toEqual([used]);
  });
});
