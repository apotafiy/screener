import { describe, expect, it, beforeEach, vi } from 'vitest';
import { criteriaHash, cachePut, cacheGet, touchLru, evictToCap } from './cache';
import type { CacheEntry, Schedule } from './types';

function sched(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: 's1',
    name: 'Test',
    enabled: true,
    days: [1],
    startMinutes: 0,
    endMinutes: 60,
    allowCriteria: 'allow stuff',
    blockCriteria: 'block stuff',
    allowKeywords: ['a'],
    blockKeywords: ['b'],
    ...overrides,
  };
}

const store = new Map<string, unknown>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal('chrome', {
    storage: {
      session: {
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

describe('criteriaHash', () => {
  it('changes when any relevant field changes', () => {
    const base = criteriaHash(sched());
    expect(criteriaHash(sched({ allowCriteria: 'different' }))).not.toBe(base);
    expect(criteriaHash(sched({ blockCriteria: 'different' }))).not.toBe(base);
    expect(criteriaHash(sched({ allowKeywords: ['x'] }))).not.toBe(base);
    expect(criteriaHash(sched({ blockKeywords: ['x'] }))).not.toBe(base);
  });

  it('is stable for identical schedules', () => {
    expect(criteriaHash(sched())).toBe(criteriaHash(sched()));
  });

  it('changes when provider/model changes', () => {
    const base = criteriaHash(sched());
    expect(criteriaHash(sched(), { kind: 'jev', presetId: 'typesafe', baseUrl: '', model: 'a', timeoutMs: 1000 })).not.toBe(base);
    expect(
      criteriaHash(sched(), { kind: 'jev', presetId: 'typesafe', baseUrl: '', model: 'a', timeoutMs: 1000 }),
    ).not.toBe(
      criteriaHash(sched(), { kind: 'jev', presetId: 'typesafe', baseUrl: '', model: 'b', timeoutMs: 1000 }),
    );
  });

  it('returns a 16-character hex string', () => {
    const hash = criteriaHash(sched());
    expect(hash).toHaveLength(16);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('handles empty schedule fields without error', () => {
    expect(() => criteriaHash(sched({
      allowCriteria: '',
      blockCriteria: '',
      allowKeywords: [],
      blockKeywords: [],
    }))).not.toThrow();
  });

  it('handles undefined name field', () => {
    expect(() => criteriaHash({ ...sched(), name: undefined as unknown as string })).not.toThrow();
  });

  it('same provider with different model yields different hash', () => {
    const base = criteriaHash(sched(), { kind: 'jev', presetId: 'typesafe', baseUrl: '', model: 'jev-latest', timeoutMs: 1000 });
    expect(criteriaHash(sched(), { kind: 'jev', presetId: 'typesafe', baseUrl: '', model: 'jev-1.13.0', timeoutMs: 1000 })).not.toBe(base);
  });

  it('no provider yields a hash', () => {
    const hash = criteriaHash(sched());
    expect(hash).toHaveLength(16);
  });
});

describe('cacheGet/cachePut', () => {
  it('stores and retrieves nouls', async () => {
    await cachePut('vid1', 'hash1', { matchesBlock: 0.98, matchesAllow: 0.02 });
    const got = await cacheGet('vid1', 'hash1');
    expect(got?.nouls).toEqual({ matchesBlock: 0.98, matchesAllow: 0.02 });
  });

  it('misses on different hash', async () => {
    await cachePut('vid1', 'hash1', { matchesBlock: 0.98 });
    expect(await cacheGet('vid1', 'hash2')).toBeNull();
  });

  it('overwrites on re-put of same key', async () => {
    await cachePut('vid1', 'hash1', { matchesBlock: 0.98 });
    await cachePut('vid1', 'hash1', { matchesBlock: 0.01, matchesAllow: 0.99 });
    const got = await cacheGet('vid1', 'hash1');
    expect(got?.nouls).toEqual({ matchesBlock: 0.01, matchesAllow: 0.99 });
  });

  it('round-trips title through cache', async () => {
    await cachePut('vid1', 'hash1', { matchesBlock: 0.98 }, 'Test Video Title');
    const got = await cacheGet('vid1', 'hash1');
    expect(got?.title).toBe('Test Video Title');
  });

  it('stores without title when omitted', async () => {
    await cachePut('vid1', 'hash1', { matchesBlock: 0.98 });
    const got = await cacheGet('vid1', 'hash1');
    expect(got?.title).toBeUndefined();
  });
});

describe('LRU helpers', () => {
  const e = (id: string): CacheEntry => ({ videoId: id, criteriaHash: 'h', nouls: { matchesBlock: 0.5 } });

  it('touchLru moves to end and returns entry', () => {
    const entries = [e('a'), e('b'), e('c')];
    const t = touchLru(entries, 'a', 'h');
    expect(t?.videoId).toBe('a');
    expect(entries.map((x) => x.videoId)).toEqual(['b', 'c', 'a']);
  });

  it('touchLru returns null on miss', () => {
    const entries = [e('a')];
    expect(touchLru(entries, 'zzz', 'h')).toBeNull();
  });

  it('evictToCap drops from the front', () => {
    const entries = [e('a'), e('b'), e('c'), e('d'), e('e')];
    evictToCap(entries, 3);
    expect(entries.map((x) => x.videoId)).toEqual(['c', 'd', 'e']);
  });

  it('evictToCap leaves list untouched when under cap', () => {
    const entries = [e('a'), e('b')];
    evictToCap(entries, 5);
    expect(entries.length).toBe(2);
  });
});
