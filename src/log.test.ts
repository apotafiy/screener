import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { LogEntry } from './types';
import { VerdictSource } from './types';
import { appendLogs, clearLog, loadLog } from './log';

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

function entry(i: number): LogEntry {
  return {
    timestamp: i,
    videoId: `v${i}`,
    title: `title ${i}`,
    scheduleId: 's1',
    scheduleName: 'Test',
    verdict: 'allow',
    source: VerdictSource.Cache,
  };
}

describe('appendLogs', () => {
  it('appends a batch in order', async () => {
    await appendLogs([entry(1), entry(2)]);
    expect((await loadLog()).map((e) => e.videoId)).toEqual(['v1', 'v2']);
  });

  it('keeps existing rows', async () => {
    await appendLogs([entry(1)]);
    await appendLogs([entry(2)]);
    expect((await loadLog()).map((e) => e.videoId)).toEqual(['v1', 'v2']);
  });

  it('does nothing for an empty batch', async () => {
    await appendLogs([]);
    expect(await loadLog()).toEqual([]);
  });

  it('caps at 1000 rows, dropping the oldest', async () => {
    const batch = Array.from({ length: 1001 }, (_, i) => entry(i));
    await appendLogs(batch);
    const log = await loadLog();
    expect(log).toHaveLength(1000);
    expect(log[0]!.videoId).toBe('v1');
    expect(log[999]!.videoId).toBe('v1000');
  });
});

describe('clearLog', () => {
  it('removes every row', async () => {
    await appendLogs([entry(1)]);
    await clearLog();
    expect(await loadLog()).toEqual([]);
  });
});
