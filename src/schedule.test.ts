import { describe, expect, it } from 'vitest';
import type { Schedule } from './types';
import { findActiveSchedule, isActive, windowEndTs, minutesUntil } from './schedule';

function sched(overrides: Partial<Schedule>): Schedule {
  return {
    id: 's1',
    name: 'Test',
    enabled: true,
    days: [1, 2, 3, 4, 5], // Mon-Fri
    startMinutes: 9 * 60,
    endMinutes: 17 * 60,
    allowCriteria: '',
    blockCriteria: '',
    allowKeywords: [],
    blockKeywords: [],
    ...overrides,
  };
}

// local-time epoch helper: build a Date in local time whose getDay() === day.
// Jan 7 2024 is a Sunday, so day d => Jan 7 + d.
function at(day: number, hour: number, minute: number): number {
  const d = new Date(2024, 0, 7 + day, hour, minute, 0, 0);
  return d.getTime();
}

describe('isActive', () => {
  it('is active within a normal window', () => {
    const s = sched({});
    expect(isActive(s, 1, 9 * 60)).toBe(true); // Mon 09:00
    expect(isActive(s, 1, 16 * 60 + 59)).toBe(true); // Mon 16:59
    expect(isActive(s, 1, 17 * 60)).toBe(false); // Mon 17:00 (end exclusive)
    expect(isActive(s, 1, 8 * 60 + 59)).toBe(false); // Mon 08:59
  });

  it('is inactive on non-listed days', () => {
    const s = sched({});
    expect(isActive(s, 0, 12 * 60)).toBe(false); // Sunday
    expect(isActive(s, 6, 12 * 60)).toBe(false); // Saturday
  });

  it('handles a spanning window in both halves', () => {
    const s = sched({ days: [5], startMinutes: 22 * 60, endMinutes: 2 * 60 }); // Fri 22:00 -> Sat 02:00
    // pre-midnight half on Friday
    expect(isActive(s, 5, 22 * 60)).toBe(true);
    expect(isActive(s, 5, 23 * 60 + 59)).toBe(true);
    // post-midnight half on Saturday (prevDay = Friday)
    expect(isActive(s, 6, 0 * 60)).toBe(true);
    expect(isActive(s, 6, 1 * 60 + 59)).toBe(true);
    expect(isActive(s, 6, 2 * 60)).toBe(false); // end exclusive
    // not active earlier Friday
    expect(isActive(s, 5, 21 * 60 + 59)).toBe(false);
    // not active Thursday night (day 4)
    expect(isActive(s, 4, 23 * 60)).toBe(false);
  });

  it('ignores disabled schedules', () => {
    const s = sched({ enabled: false });
    expect(findActiveSchedule([s], at(1, 12, 0))).toBeNull();
  });
});

describe('findActiveSchedule', () => {
  it('returns null when nothing active', () => {
    const s = sched({});
    expect(findActiveSchedule([s], at(0, 12, 0))).toBeNull();
  });

  it('returns the active schedule', () => {
    const s = sched({});
    const result = findActiveSchedule([s], at(1, 10, 0));
    expect(result?.schedule.id).toBe('s1');
  });

  it('first matching schedule wins on overlap', () => {
    const a = sched({ id: 'a', days: [1], startMinutes: 9 * 60, endMinutes: 12 * 60 });
    const b = sched({ id: 'b', days: [1], startMinutes: 10 * 60, endMinutes: 11 * 60 });
    expect(findActiveSchedule([a, b], at(1, 10, 30))?.schedule.id).toBe('a');
    expect(findActiveSchedule([b, a], at(1, 10, 30))?.schedule.id).toBe('b');
  });
});

describe('windowEndTs', () => {
  it('ends same day for normal windows', () => {
    const s = sched({});
    const end = windowEndTs(s, at(1, 10, 0));
    expect(end).toBe(at(1, 17, 0));
  });

  it('ends tomorrow in the pre-midnight half of a spanning window', () => {
    const s = sched({ days: [5], startMinutes: 22 * 60, endMinutes: 2 * 60 });
    const end = windowEndTs(s, at(5, 23, 0));
    expect(end).toBe(at(6, 2, 0));
  });

  it('ends today in the post-midnight half of a spanning window', () => {
    const s = sched({ days: [5], startMinutes: 22 * 60, endMinutes: 2 * 60 });
    const end = windowEndTs(s, at(6, 1, 0));
    expect(end).toBe(at(6, 2, 0));
  });
});

describe('minutesUntil', () => {
  it('computes ceiling minutes remaining', () => {
    expect(minutesUntil(at(1, 17, 0), at(1, 16, 0))).toBe(60);
    expect(minutesUntil(at(1, 16, 1), at(1, 16, 0))).toBe(1);
    expect(minutesUntil(at(1, 16, 0), at(1, 16, 0))).toBe(0);
  });
});
