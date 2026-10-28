import type { TempAllow } from './types';
import { withLock } from './mutex';

const TEMP_ALLOWS_KEY = 'tempAllows';

export type TempAllowMap = Record<string, TempAllow[]>;

function isTempAllow(v: unknown): v is TempAllow {
  if (typeof v !== 'object' || v === null) return false;
  const a = v as Partial<TempAllow>;
  return typeof a.scheduleId === 'string' && typeof a.windowEndTs === 'number';
}

/**
 * Loads earned bypasses by video id. Every video maps to a list of per-schedule
 * grants; anything else in storage is ignored.
 */
export async function loadTempAllows(): Promise<TempAllowMap> {
  const raw = await chrome.storage.local.get(TEMP_ALLOWS_KEY);
  const stored = raw[TEMP_ALLOWS_KEY];
  if (typeof stored !== 'object' || stored === null) return {};

  const out: TempAllowMap = {};
  for (const [videoId, entry] of Object.entries(stored as Record<string, unknown>)) {
    if (!Array.isArray(entry)) continue;
    const list = entry.filter(isTempAllow);
    if (list.length > 0) out[videoId] = list;
  }
  return out;
}

export async function saveTempAllows(allows: TempAllowMap): Promise<void> {
  await chrome.storage.local.set({ [TEMP_ALLOWS_KEY]: allows });
}

/**
 * Adds a bypass for every schedule open at the moment of the click, each
 * expiring at that schedule's own window end. Live entries for schedules that
 * are not open now are kept; expired ones are dropped.
 */
export function addTempAllows(
  existing: TempAllow[],
  active: { scheduleId: string; windowEndTs: number }[],
  now: number,
): TempAllow[] {
  const bySchedule = new Map<string, number>();
  for (const a of existing) {
    if (a.windowEndTs > now) bySchedule.set(a.scheduleId, a.windowEndTs);
  }
  for (const a of active) {
    bySchedule.set(a.scheduleId, a.windowEndTs);
  }
  return [...bySchedule].map(([scheduleId, windowEndTs]) => ({ scheduleId, windowEndTs }));
}

/**
 * Drops earned bypasses whose schedule window has already closed. Runs on the
 * periodic alarm; without it the map would only ever grow.
 */
export async function pruneTempAllows(now: number): Promise<void> {
  await withLock(async () => {
    const allows = await loadTempAllows();
    let changed = false;
    for (const [videoId, list] of Object.entries(allows)) {
      const live = list.filter((a) => a.windowEndTs > now);
      if (live.length === 0) {
        delete allows[videoId];
        changed = true;
      } else if (live.length !== list.length) {
        allows[videoId] = live;
        changed = true;
      }
    }
    if (changed) await saveTempAllows(allows);
  });
}
