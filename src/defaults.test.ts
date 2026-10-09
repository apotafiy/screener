import { describe, expect, it } from 'vitest';
import { presetById, PRESETS, defaultProvider, exampleSchedule, defaultSettings } from './defaults';
import type { PresetId } from './types';
import { Strictness } from './types';

describe('presetById', () => {
  it('returns the correct preset', () => {
    expect(presetById('openrouter-jev').label).toBe('OpenRouter (Jev decision model)');
    expect(presetById('typesafe').kind).toBe('jev');
    expect(presetById('mock').kind).toBe('mock');
    expect(presetById('mock').needsKey).toBe(false);
  });

  it('exposes Jev decision-model presets', () => {
    const or = presetById('openrouter-jev');
    expect(or.kind).toBe('jev');
    expect(or.baseUrl).toBe('https://openrouter.ai/api/alpha/decisions');
    expect(or.model).toBe('typesafe/jev-1.13');
    expect(or.needsKey).toBe(true);

    const ts = presetById('typesafe');
    expect(ts.kind).toBe('jev');
    expect(ts.baseUrl).toBe('https://api.typesafe.ai/v1/systemone');
    expect(ts.model).toBe('jev-latest');
  });

  it('falls back to the first preset for an unknown id', () => {
    const fallback = presetById('nonexistent' as PresetId);
    expect(fallback.id).toBe(PRESETS[0]!.id);
  });
});

describe('defaultProvider', () => {
  it('returns the OpenRouter Jev config by default', () => {
    expect(defaultProvider().presetId).toBe('openrouter-jev');
    expect(defaultProvider().kind).toBe('jev');
    expect(defaultProvider().timeoutMs).toBe(5000);
  });
});

describe('exampleSchedule', () => {
  it('is disabled', () => {
    expect(exampleSchedule().enabled).toBe(false);
  });

  it('defaults to Mon-Fri 9-5', () => {
    const s = exampleSchedule();
    expect(s.days).toEqual([1, 2, 3, 4, 5]);
    expect(s.startMinutes).toBe(540);
    expect(s.endMinutes).toBe(1020);
  });
});

describe('defaultSettings', () => {
  it('includes one disabled schedule', () => {
    const s = defaultSettings();
    expect(s.version).toBe(1);
    expect(s.schedules).toHaveLength(1);
    expect(s.schedules[0]!.enabled).toBe(false);
  });

  it('defaults to medium strictness', () => {
    expect(defaultSettings().strictness).toBe(Strictness.Medium);
  });
});