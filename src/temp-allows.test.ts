import { describe, expect, it, beforeEach, vi } from 'vitest';
import { loadTempAllows, saveTempAllows, pruneTempAllows } from './temp-allows';
import type { TempAllow } from './types';

const store = new Map<string, unknown>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        async get(key: string) {
          return { [key]: store.get(key) };
        },
        async set(obj: Record<string, unknown>) {
          for (const [k, v] of Object.entries(obj)) store.set(k, v);
        },
        async remove(key: string) {
          store.delete(key);
        },
      },
    },
  });
});

describe('loadTempAllows', () => {
  it('returns an empty map when nothing is stored', async () => {
    await expect(loadTempAllows()).resolves.toEqual({});
  });

  it('returns an empty map when the stored value is not an object', async () => {
    store.set('tempAllows', 'nope');
    await expect(loadTempAllows()).resolves.toEqual({});
  });
});

describe('pruneTempAllows', () => {
  it('removes only entries whose window has ended', async () => {
    const now = 1_000_000;
    await saveTempAllows({
      expired: { scheduleId: 's1', windowEndTs: now - 1 },
      alsoExpired: { scheduleId: 's1', windowEndTs: now },
      active: { scheduleId: 's1', windowEndTs: now + 1 },
    });

    await pruneTempAllows(now);

    await expect(loadTempAllows()).resolves.toEqual({
      active: { scheduleId: 's1', windowEndTs: now + 1 },
    });
  });

  it('leaves storage untouched when nothing has expired', async () => {
    const now = 1_000_000;
    const allows: Record<string, TempAllow> = {
      a: { scheduleId: 's1', windowEndTs: now + 60_000 },
    };
    await saveTempAllows(allows);

    await pruneTempAllows(now);

    await expect(loadTempAllows()).resolves.toEqual(allows);
  });
});
