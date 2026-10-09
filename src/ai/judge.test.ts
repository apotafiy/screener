import { describe, expect, it, vi, afterEach } from 'vitest';
import type { ProviderConfig, Schedule, VideoMetadata } from '../types';
import { judge } from './judge';

const primaryCfg: ProviderConfig = {
  kind: 'jev',
  presetId: 'typesafe',
  baseUrl: 'https://primary.example.com/v1/systemone',
  model: 'primary-model',
  timeoutMs: 5000,
};

const fallbackCfg: ProviderConfig = {
  kind: 'jev',
  presetId: 'typesafe',
  baseUrl: 'https://fallback.example.com/v1/systemone',
  model: 'fallback-model',
  timeoutMs: 5000,
};

const schedule: Schedule = {
  id: 's1',
  name: 'Test',
  enabled: true,
  days: [1],
  startMinutes: 480,
  endMinutes: 1020,
  allowCriteria: 'coding tutorials',
  blockCriteria: 'gaming',
  allowKeywords: [],
  blockKeywords: [],
};

const meta: VideoMetadata = { title: 'Test Title', channel: 'TestChannel' };

function okResponse(blockNoul = 0.1, allowNoul = 0.9) {
  return new Response(
    JSON.stringify({
      answers: {
        matches_block: { type: 'noul', noul: blockNoul },
        matches_allow: { type: 'noul', noul: allowNoul },
      },
    }),
    { status: 200 },
  );
}

function errorResponse(status: number) {
  return new Response('rate limited', { status });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('judge (single provider)', () => {
  it('returns a decision on first success', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => { calls++; return okResponse(); }));
    const result = await judge(primaryCfg, 'key', undefined, '', schedule, meta);
    expect(result.decision?.matchesBlock).toBe(0.1);
    expect(result.decision?.matchesAllow).toBe(0.9);
    expect(calls).toBe(1);
  });

  it('retries on failure then succeeds', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++;
      if (calls === 1) throw new Error('timeout');
      return okResponse();
    }));
    const result = await judge(primaryCfg, 'key', undefined, '', schedule, meta);
    expect(result.decision?.matchesAllow).toBe(0.9);
    expect(calls).toBeGreaterThan(1);
  });

  it('returns error after all retries exhausted', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const result = await judge(primaryCfg, 'key', undefined, '', schedule, meta);
    expect(result.decision).toBeNull();
    expect(result.error).toContain('network down');
  });
});

describe('judge (with fallback)', () => {
  it('uses primary only when primary succeeds', async () => {
    let primaryCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if ((url as string).includes('primary')) { primaryCalls++; return okResponse(); }
      throw new Error('fallback should not be called');
    }));
    const result = await judge(primaryCfg, 'pk', fallbackCfg, 'fk', schedule, meta);
    expect(result.usedFallback).toBe(false);
    expect(result.decision?.matchesAllow).toBe(0.9);
    expect(primaryCalls).toBe(1);
  });

  it('falls back when primary fails and fallback succeeds', async () => {
    let fbCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if ((url as string).includes('primary')) throw new Error('primary down');
      if ((url as string).includes('fallback')) { fbCalls++; return okResponse(); }
      throw new Error('unexpected');
    }));
    const result = await judge(primaryCfg, 'pk', fallbackCfg, 'fk', schedule, meta);
    expect(result.usedFallback).toBe(true);
    expect(result.decision?.matchesAllow).toBe(0.9);
    expect(result.primaryError).toContain('primary down');
    expect(fbCalls).toBe(1);
  });

  it('returns error when both providers fail', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if ((url as string).includes('primary')) throw new Error('primary down');
      if ((url as string).includes('fallback')) return errorResponse(429);
      throw new Error('unexpected');
    }));
    const result = await judge(primaryCfg, 'pk', fallbackCfg, 'fk', schedule, meta);
    expect(result.decision).toBeNull();
    expect(result.error).toContain('primary: primary down');
    expect(result.error).toContain('backup:');
    expect(result.usedFallback).toBe(true);
  });

  it('retries primary before falling back', async () => {
    let primaryAttempts = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if ((url as string).includes('primary')) {
        primaryAttempts++;
        throw new Error('primary down');
      }
      if ((url as string).includes('fallback')) return okResponse();
      throw new Error('unexpected');
    }));
    const result = await judge(
      { ...primaryCfg, timeoutMs: 100 }, 'pk',
      fallbackCfg, 'fk',
      schedule, meta,
    );
    expect(primaryAttempts).toBe(3);
    expect(result.usedFallback).toBe(true);
  });

  it('returns error when no fallback configured', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('primary down'); }));
    const result = await judge(primaryCfg, 'pk', undefined, '', schedule, meta);
    expect(result.decision).toBeNull();
    expect(result.error).toBe('primary down');
    expect(result.usedFallback).toBe(false);
  });
});

describe('judge (block verdict derivation is handled by the caller)', () => {
  it('passes through calibrated nouls without deriving a verdict', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse(0.9, 0.1)));
    const result = await judge(primaryCfg, 'key', undefined, '', schedule, meta);
    expect(result.decision).toEqual({ matchesBlock: 0.9, matchesAllow: 0.1 });
  });
});