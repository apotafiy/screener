import type { PresetId, ProviderConfig, ProviderKind, Schedule, Settings } from './types';
import { Strictness } from './types';

export const DEFAULT_TIMEOUT_MS = 5000;

interface Preset {
  id: PresetId;
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  model: string;
  needsKey: boolean;
}

export const PRESETS: Preset[] = [
  {
    id: 'openrouter-jev',
    label: 'OpenRouter (Jev decision model)',
    kind: 'jev',
    baseUrl: 'https://openrouter.ai/api/alpha/decisions',
    model: 'typesafe/jev-1.13',
    needsKey: true,
  },
  {
    id: 'typesafe',
    label: 'TypeSafe (Jev decision model)',
    kind: 'jev',
    baseUrl: 'https://api.typesafe.ai/v1/systemone',
    model: 'jev-latest',
    needsKey: true,
  },
  {
    id: 'mock',
    label: 'Mock (testing)',
    kind: 'mock',
    baseUrl: '',
    model: 'mock',
    needsKey: false,
  },
];

export function presetById(id: PresetId): Preset {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) return PRESETS[0]!;
  return p;
}

/**
 * True when two provider configs point at the same provider (service) — the
 * kind and endpoint. Two models on one endpoint share the same failure domain
 * (network, rate limit, auth, outage), so they don't count as a distinct backup.
 */
export function sameProvider(a: ProviderConfig, b: ProviderConfig): boolean {
  return a.kind === b.kind && a.baseUrl === b.baseUrl;
}

export function defaultProvider(): ProviderConfig {
  const p = presetById('openrouter-jev');
  return {
    kind: p.kind,
    presetId: 'openrouter-jev',
    baseUrl: p.baseUrl,
    model: p.model,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
}

export function exampleSchedule(): Schedule {
  return {
    id: 'example-work-hours',
    name: 'Work hours',
    enabled: false,
    days: [1, 2, 3, 4, 5],
    startMinutes: 9 * 60,
    endMinutes: 17 * 60,
    allowCriteria: 'Software engineering, coding, Linux, mathematics, and technical tutorials.',
    blockCriteria: 'Tech hardware reviews, gaming, vlogs, and reaction content.',
    allowKeywords: [],
    blockKeywords: [],
  };
}

export function defaultSettings(): Settings {
  return {
    version: 1,
    provider: defaultProvider(),
    allowTempBypass: true,
    strictness: Strictness.Medium,
    schedules: [exampleSchedule()],
  };
}
