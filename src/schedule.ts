import type { Schedule } from './types';

export interface ActiveWindow {
  schedule: Schedule;
  /** timestamp (ms) at which the current window closes */
  windowEndTs: number;
}

/**
 * Returns the first enabled schedule active at `now` (ms epoch),
 * or null if none is active. Array order = precedence, so the
 * first matching schedule wins when windows overlap.
 */
export function findActiveSchedule(schedules: Schedule[], now: number): ActiveWindow | null {
  const date = new Date(now);
  const today = date.getDay();
  const mins = date.getHours() * 60 + date.getMinutes();

  for (const schedule of schedules) {
    if (!schedule.enabled) continue;
    if (isActive(schedule, today, mins)) {
      return { schedule, windowEndTs: windowEndTs(schedule, now) };
    }
  }
  return null;
}

/**
 * Whether a schedule is active at (day, minutes-since-midnight).
 * `day` is the current local day. Days on the schedule refer to the
 * day the window STARTS, so a spanning window (end <= start) is also
 * active during the following day's pre-end hours.
 */
export function isActive(schedule: Schedule, day: number, mins: number): boolean {
  const { startMinutes: start, endMinutes: end, days } = schedule;
  if (end > start) {
    return days.includes(day) && mins >= start && mins < end;
  }
  // spans midnight
  const prevDay = (day + 6) % 7;
  return (days.includes(day) && mins >= start) || (days.includes(prevDay) && mins < end);
}

/**
 * Timestamp at which the window that is currently active (or would be
 * active for a schedule starting today) closes. For spanning windows,
 * the "pre-midnight half" returns tomorrow's end time.
 */
export function windowEndTs(schedule: Schedule, now: number): number {
  const date = new Date(now);
  const { endMinutes: end, startMinutes: start } = schedule;
  const day = date.getDay();
  const mins = date.getHours() * 60 + date.getMinutes();

  let endDate: Date;
  if (end > start) {
    // non-spanning: same day end
    endDate = new Date(date);
    endDate.setHours(0, end, 0, 0);
  } else {
    // spanning: if we are in the pre-midnight half (mins >= start), end is tomorrow
    const inPreMidnightHalf = mins >= start && schedule.days.includes(day);
    endDate = new Date(date);
    endDate.setHours(0, end, 0, 0);
    if (inPreMidnightHalf) {
      endDate.setDate(endDate.getDate() + 1);
    }
  }
  return endDate.getTime();
}

export function minutesUntil(ts: number, now: number): number {
  return Math.max(0, Math.ceil((ts - now) / 60000));
}
