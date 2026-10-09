import { describe, expect, it } from 'vitest';
import type { ProviderConfig, Schedule } from '../types';
import { mock } from './mock';

const cfg: ProviderConfig = {
  kind: 'mock',
  presetId: 'mock',
  baseUrl: '',
  model: 'mock',
  timeoutMs: 12000,
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

describe('mock adapter', () => {
  it('returns blocking nouls for titles containing BLOCKME', async () => {
    const result = await mock.call(
      cfg,
      '',
      schedule,
      { title: 'BLOCKME video', channel: 'x' },
      new AbortController().signal,
    );
    expect(result).toEqual({ matchesBlock: 0.99, matchesAllow: 0.01 });
  });

  it('returns allowing nouls otherwise', async () => {
    const result = await mock.call(
      cfg,
      '',
      schedule,
      { title: 'normal video', channel: 'x' },
      new AbortController().signal,
    );
    expect(result).toEqual({ matchesBlock: 0.01, matchesAllow: 0.99 });
  });

  it('emits only matchesBlock when allow criteria empty', async () => {
    const onlyBlock = { ...schedule, allowCriteria: '' };
    expect(
      await mock.call(cfg, '', onlyBlock, { title: 'normal', channel: 'x' }, new AbortController().signal),
    ).toEqual({ matchesBlock: 0.01 });
  });

  it('emits only matchesAllow when block criteria empty', async () => {
    const onlyAllow = { ...schedule, blockCriteria: '' };
    expect(
      await mock.call(cfg, '', onlyAllow, { title: 'BLOCKME', channel: 'x' }, new AbortController().signal),
    ).toEqual({ matchesAllow: 0.01 });
  });
});