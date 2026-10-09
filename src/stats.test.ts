import { describe, expect, it, beforeEach, vi } from 'vitest';
import { loadStats, recordStats } from './stats';

let store = {} as Record<string, unknown>;
let setCalls = 0;
beforeEach(() => {
  store = {};
  setCalls = 0;
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        async get(key: string) {
          return { [key]: store[key] };
        },
        async set(obj: Record<string, unknown>) {
          setCalls += 1;
          Object.assign(store, obj);
        },
      },
      session: {
        async get() {
          return {};
        },
        async set() {},
      },
    },
  });
});

describe('stats', () => {
  it('starts empty', async () => {
    const s = await loadStats();
    expect(s.checked).toBe(0);
    expect(s.blocked).toBe(0);
  });

  it('increments a single field', async () => {
    let s = await recordStats(['checked']);
    expect(s.checked).toBe(1);
    s = await recordStats(['blocked']);
    expect(s.blocked).toBe(1);
    expect(s.checked).toBe(1);
  });

  it('increments multiple fields in a single write', async () => {
    const s = await recordStats(['checked', 'blocked', 'cached']);
    expect(s.checked).toBe(1);
    expect(s.blocked).toBe(1);
    expect(s.cached).toBe(1);
    expect(s.allowed).toBe(0);
    expect(setCalls).toBe(1); // one storage write for the batch
  });

  it('rolls over when date changes', async () => {
    await recordStats(['checked']);
    store['stats'] = { date: '2024-01-01', checked: 5, blocked: 2, allowed: 1, cached: 0, errors: 0 };
    const s = await loadStats();
    expect(s.checked).toBe(0); // rolled over
  });
});
