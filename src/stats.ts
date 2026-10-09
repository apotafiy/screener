import type { Stats } from './types';
import { withLock } from './mutex';

const STATS_KEY = 'stats';

export type StatField = 'checked' | 'blocked' | 'allowed' | 'cached' | 'errors';

function todayKey(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function empty(): Stats {
  return { date: todayKey(new Date()), checked: 0, blocked: 0, allowed: 0, cached: 0, errors: 0 };
}

/** Loads stats, resetting to zero if the stored date is not today. */
export async function loadStats(): Promise<Stats> {
  const raw = await chrome.storage.local.get(STATS_KEY);
  const stored = raw[STATS_KEY] as Stats | undefined;
  const today = todayKey(new Date());
  if (stored && stored.date === today) return stored;
  return empty();
}

/**
 * Increments each field once in a single read-modify-write. The read and
 * write are serialized via withLock so concurrent checks cannot interleave
 * and lose updates.
 */
export async function recordStats(fields: StatField[]): Promise<Stats> {
  return withLock(async () => {
    const stats = await loadStats();
    for (const f of fields) stats[f] += 1;
    await chrome.storage.local.set({ [STATS_KEY]: stats });
    return stats;
  });
}
