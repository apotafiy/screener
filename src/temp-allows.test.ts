import { describe, expect, it, beforeEach, vi } from 'vitest';
import { addTempAllows, loadTempAllows, saveTempAllows, pruneTempAllows } from './temp-allows';
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

  it('ignores a non-list video entry', async () => {
    store.set('tempAllows', { vid1: { scheduleId: 's1', windowEndTs: 123 } });
    await expect(loadTempAllows()).resolves.toEqual({});
  });

  it('keeps valid lists and drops invalid entries', async () => {
    store.set('tempAllows', {
      vid1: [
        { scheduleId: 's1', windowEndTs: 1 },
        { scheduleId: 's2', windowEndTs: 2 },
      ],
      bad: [{ scheduleId: 's1' }],
    });
    await expect(loadTempAllows()).resolves.toEqual({
      vid1: [
        { scheduleId: 's1', windowEndTs: 1 },
        { scheduleId: 's2', windowEndTs: 2 },
      ],
    });
  });
});

describe('addTempAllows', () => {
  it('adds an entry for every schedule open now', () => {
    const now = 1_000_000;
    const merged = addTempAllows(
      [],
      [
        { scheduleId: 'a', windowEndTs: now + 60_000 },
        { scheduleId: 'b', windowEndTs: now + 120_000 },
      ],
      now,
    );
    expect(merged).toEqual([
      { scheduleId: 'a', windowEndTs: now + 60_000 },
      { scheduleId: 'b', windowEndTs: now + 120_000 },
    ]);
  });

  it('keeps live entries for schedules that are not open now', () => {
    const now = 1_000_000;
    const merged = addTempAllows(
      [{ scheduleId: 'later', windowEndTs: now + 500_000 }],
      [{ scheduleId: 'a', windowEndTs: now + 60_000 }],
      now,
    );
    expect(merged).toEqual([
      { scheduleId: 'later', windowEndTs: now + 500_000 },
      { scheduleId: 'a', windowEndTs: now + 60_000 },
    ]);
  });

  it('replaces a live entry for the same schedule and drops expired ones', () => {
    const now = 1_000_000;
    const merged = addTempAllows(
      [
        { scheduleId: 'a', windowEndTs: now + 1 },
        { scheduleId: 'expired', windowEndTs: now - 1 },
      ],
      [{ scheduleId: 'a', windowEndTs: now + 60_000 }],
      now,
    );
    expect(merged).toEqual([{ scheduleId: 'a', windowEndTs: now + 60_000 }]);
  });
});

describe('pruneTempAllows', () => {
  it('removes expired entries and drops videos with none left', async () => {
    const now = 1_000_000;
    await saveTempAllows({
      gone: [
        { scheduleId: 's1', windowEndTs: now - 1 },
        { scheduleId: 's2', windowEndTs: now },
      ],
      partial: [
        { scheduleId: 's1', windowEndTs: now - 1 },
        { scheduleId: 's2', windowEndTs: now + 1 },
      ],
      active: [{ scheduleId: 's1', windowEndTs: now + 1 }],
    });

    await pruneTempAllows(now);

    await expect(loadTempAllows()).resolves.toEqual({
      partial: [{ scheduleId: 's2', windowEndTs: now + 1 }],
      active: [{ scheduleId: 's1', windowEndTs: now + 1 }],
    });
  });

  it('leaves storage untouched when nothing has expired', async () => {
    const now = 1_000_000;
    const allows: Record<string, TempAllow[]> = {
      a: [{ scheduleId: 's1', windowEndTs: now + 60_000 }],
    };
    await saveTempAllows(allows);

    await pruneTempAllows(now);

    await expect(loadTempAllows()).resolves.toEqual(allows);
  });
});
