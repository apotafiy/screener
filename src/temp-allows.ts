import type { TempAllow } from './types';
import { withLock } from './mutex';

const TEMP_ALLOWS_KEY = 'tempAllows';

export async function loadTempAllows(): Promise<Record<string, TempAllow>> {
  const raw = await chrome.storage.local.get(TEMP_ALLOWS_KEY);
  const v = raw[TEMP_ALLOWS_KEY];
  return typeof v === 'object' && v !== null ? (v as Record<string, TempAllow>) : {};
}

export async function saveTempAllows(allows: Record<string, TempAllow>): Promise<void> {
  await chrome.storage.local.set({ [TEMP_ALLOWS_KEY]: allows });
}

/**
 * Drops earned bypasses whose schedule window has already closed. Runs on the
 * periodic alarm; without it the map would only ever grow.
 */
export async function pruneTempAllows(now: number): Promise<void> {
  await withLock(async () => {
    const allows = await loadTempAllows();
    let changed = false;
    for (const [id, a] of Object.entries(allows)) {
      if (a.windowEndTs <= now) {
        delete allows[id];
        changed = true;
      }
    }
    if (changed) await saveTempAllows(allows);
  });
}
