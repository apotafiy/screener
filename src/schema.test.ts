import { describe, expect, it } from 'vitest';
import { validateSettings } from './schema';
import { defaultSettings } from './defaults';
import type { Settings } from './types';

describe('validateSettings', () => {
  it('accepts default settings', () => {
    const { errors, settings } = validateSettings(defaultSettings());
    expect(errors).toEqual([]);
    expect(settings?.version).toBe(1);
  });

  it('rejects a non-object', () => {
    expect(validateSettings('nope').errors.length).toBeGreaterThan(0);
    expect(validateSettings(null).errors.length).toBeGreaterThan(0);
  });

  it('rejects wrong version', () => {
    const s = { ...defaultSettings(), version: 2 };
    expect(validateSettings(s).errors.some((e) => e.path === 'version')).toBe(true);
  });

  it('rejects invalid timeout', () => {
    const s = defaultSettings();
    s.provider.timeoutMs = 500;
    expect(validateSettings(s).errors.some((e) => e.path === 'provider.timeoutMs')).toBe(true);
  });

  it('rejects a provider baseUrl that differs from its preset', () => {
    const s = defaultSettings();
    s.provider = { ...s.provider, baseUrl: 'http://example.com/v1/systemone' };
    expect(validateSettings(s).errors.some((e) => e.path === 'provider.baseUrl')).toBe(true);
  });

  it('rejects a provider kind that differs from its preset', () => {
    const s = defaultSettings();
    s.provider = { ...s.provider, kind: 'mock', presetId: 'openrouter-jev' };
    expect(validateSettings(s).errors.some((e) => e.path === 'provider.kind')).toBe(true);
  });

  it('rejects empty days array', () => {
    const s = defaultSettings();
    s.schedules[0]!.days = [];
    expect(validateSettings(s).errors.some((e) => e.path === 'schedules[0].days')).toBe(true);
  });

  it('rejects start === end', () => {
    const s = defaultSettings();
    s.schedules[0]!.startMinutes = 540;
    s.schedules[0]!.endMinutes = 540;
    expect(validateSettings(s).errors.some((e) => e.path === 'schedules[0].endMinutes')).toBe(true);
  });

  it('accepts a spanning window (end < start)', () => {
    const s = defaultSettings();
    s.schedules[0]!.startMinutes = 22 * 60;
    s.schedules[0]!.endMinutes = 2 * 60;
    expect(validateSettings(s).errors).toEqual([]);
  });

  it('reports multiple errors at once', () => {
    const s = { ...defaultSettings(), version: 2 } as unknown as Settings;
    s.schedules[0]!.days = [];
    s.schedules[0]!.blockKeywords = 'nope' as unknown as string[];
    const { errors } = validateSettings(s);
    expect(errors.filter((e) => e.path === 'version').length).toBe(1);
    expect(errors.filter((e) => e.path === 'schedules[0].days').length).toBe(1);
    expect(errors.filter((e) => e.path === 'schedules[0].blockKeywords').length).toBe(1);
  });

  it('rejects bad keyword list types', () => {
    const s = defaultSettings();
    s.schedules[0]!.allowKeywords = [1, 2, 3] as unknown as string[];
    expect(validateSettings(s).errors.some((e) => e.path === 'schedules[0].allowKeywords')).toBe(true);
  });

  it('accepts optional fallbackProvider', () => {
    const s = defaultSettings();
    s.fallbackProvider = {
      kind: 'jev',
      presetId: 'typesafe',
      baseUrl: 'https://api.typesafe.ai/v1/systemone',
      model: 'jev-latest',
      timeoutMs: 5000,
    };
    const { errors, settings } = validateSettings(s);
    expect(errors).toEqual([]);
    expect(settings?.fallbackProvider?.presetId).toBe('typesafe');
  });

  it('rejects invalid fallbackProvider timeout', () => {
    const s = defaultSettings();
    s.fallbackProvider = { ...s.provider, timeoutMs: 999 };
    const { errors } = validateSettings(s);
    expect(errors.some((e) => e.path === 'fallbackProvider.timeoutMs')).toBe(true);
  });

  it('rejects a fallback identical to the primary', () => {
    const s = defaultSettings();
    s.fallbackProvider = { ...s.provider };
    const { errors } = validateSettings(s);
    expect(errors.some((e) => e.path === 'fallbackProvider')).toBe(true);
  });

  it('rejects a fallback on the same provider with a different model', () => {
    const s = defaultSettings();
    s.fallbackProvider = { ...s.provider, model: 'typesafe/jev-1.13-other' };
    const { errors } = validateSettings(s);
    expect(errors.some((e) => e.path === 'fallbackProvider')).toBe(true);
  });

  it('allows no fallbackProvider at all', () => {
    const s = defaultSettings();
    s.fallbackProvider = undefined;
    const { errors } = validateSettings(s);
    expect(errors).toEqual([]);
  });

  it('accepts a jev provider kind and preset ids', () => {
    const s = defaultSettings();
    s.provider = { ...s.provider, kind: 'jev', presetId: 'openrouter-jev', baseUrl: 'https://openrouter.ai/api/alpha/decisions', model: 'typesafe/jev-1.13' };
    expect(validateSettings(s).errors).toEqual([]);

    s.provider = { ...s.provider, presetId: 'typesafe', baseUrl: 'https://api.typesafe.ai/v1/systemone', model: 'jev-latest' };
    expect(validateSettings(s).errors).toEqual([]);
  });

  it('rejects an unknown provider kind', () => {
    const s = defaultSettings();
    s.provider = { ...s.provider, kind: 'bogus' as unknown as Settings['provider']['kind'] };
    expect(validateSettings(s).errors.some((e) => e.path === 'provider.kind')).toBe(true);
  });

  it('rejects a non-boolean allowTempBypass', () => {
    const s = defaultSettings();
    (s as unknown as { allowTempBypass: unknown }).allowTempBypass = 'yes';
    expect(validateSettings(s).errors.some((e) => e.path === 'allowTempBypass')).toBe(true);
  });

  it('accepts settings without allowTempBypass', () => {
    const s = defaultSettings();
    delete (s as { allowTempBypass?: boolean }).allowTempBypass;
    expect(validateSettings(s).errors).toEqual([]);
  });
});
