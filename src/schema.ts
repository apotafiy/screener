import type { PresetId, ProviderConfig, ProviderKind, Schedule, Settings } from './types';
import { PRESETS, sameProvider } from './defaults';

export interface ValidationError {
  path: string;
  message: string;
}

const VALID_KINDS: ProviderKind[] = ['jev', 'mock'];
const VALID_PRESETS: PresetId[] = PRESETS.map((p) => p.id);

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStr(v: unknown): v is string {
  return typeof v === 'string';
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isBool(v: unknown): v is boolean {
  return typeof v === 'boolean';
}

function isStrArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(isStr);
}

function validateProvider(v: unknown, errors: ValidationError[], path: string): ProviderConfig | null {
  if (!isObj(v)) {
    errors.push({ path, message: 'must be an object' });
    return null;
  }
  if (!isStr(v.kind) || !VALID_KINDS.includes(v.kind as ProviderKind)) {
    errors.push({ path: `${path}.kind`, message: 'must be one of ' + VALID_KINDS.join(', ') });
  }
  if (!isStr(v.presetId) || !VALID_PRESETS.includes(v.presetId as PresetId)) {
    errors.push({ path: `${path}.presetId`, message: 'must be one of ' + VALID_PRESETS.join(', ') });
  }
  // Providers are fixed presets: kind and endpoint must match the built-in
  // definition, so custom endpoints can't be smuggled in via import.
  const preset = PRESETS.find((p) => p.id === v.presetId);
  if (preset && isStr(v.kind) && v.kind !== preset.kind) {
    errors.push({ path: `${path}.kind`, message: `must be ${preset.kind} for preset ${preset.id}` });
  }
  if (!isStr(v.baseUrl)) {
    errors.push({ path: `${path}.baseUrl`, message: 'must be a string' });
  } else if (preset && v.baseUrl !== preset.baseUrl) {
    errors.push({ path: `${path}.baseUrl`, message: `must be ${preset.baseUrl || '(empty)'} for preset ${preset.id}` });
  }
  if (!isStr(v.model)) {
    errors.push({ path: `${path}.model`, message: 'must be a string' });
  }
  if (!isNum(v.timeoutMs) || v.timeoutMs < 1000 || v.timeoutMs > 120000) {
    errors.push({ path: `${path}.timeoutMs`, message: 'must be between 1000 and 120000' });
  }
  return v as unknown as ProviderConfig;
}

function validateSchedule(v: unknown, index: number, errors: ValidationError[]): Schedule | null {
  const path = `schedules[${index}]`;
  if (!isObj(v)) {
    errors.push({ path, message: 'must be an object' });
    return null;
  }
  if (!isStr(v.id) || v.id.trim() === '') {
    errors.push({ path: `${path}.id`, message: 'must be a non-empty string' });
  }
  if (!isStr(v.name)) {
    errors.push({ path: `${path}.name`, message: 'must be a string' });
  }
  if (!isBool(v.enabled)) {
    errors.push({ path: `${path}.enabled`, message: 'must be a boolean' });
  }
  if (!Array.isArray(v.days) || v.days.length === 0 || !v.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) {
    errors.push({ path: `${path}.days`, message: 'must be a non-empty array of integers 0..6' });
  }
  if (!isNum(v.startMinutes) || !Number.isInteger(v.startMinutes) || v.startMinutes < 0 || v.startMinutes > 1439) {
    errors.push({ path: `${path}.startMinutes`, message: 'must be an integer 0..1439' });
  }
  if (!isNum(v.endMinutes) || !Number.isInteger(v.endMinutes) || v.endMinutes < 0 || v.endMinutes > 1439) {
    errors.push({ path: `${path}.endMinutes`, message: 'must be an integer 0..1439' });
  } else if (v.startMinutes === v.endMinutes) {
    errors.push({ path: `${path}.endMinutes`, message: 'must not equal startMinutes' });
  }
  if (!isStr(v.allowCriteria)) {
    errors.push({ path: `${path}.allowCriteria`, message: 'must be a string' });
  } else if (v.allowCriteria.length > 100000) {
    errors.push({ path: `${path}.allowCriteria`, message: 'must be at most 100000 characters' });
  }
  if (!isStr(v.blockCriteria)) {
    errors.push({ path: `${path}.blockCriteria`, message: 'must be a string' });
  } else if (v.blockCriteria.length > 100000) {
    errors.push({ path: `${path}.blockCriteria`, message: 'must be at most 100000 characters' });
  }
  if (!isStrArray(v.allowKeywords)) {
    errors.push({ path: `${path}.allowKeywords`, message: 'must be an array of strings' });
  } else if (v.allowKeywords.length > 500) {
    errors.push({ path: `${path}.allowKeywords`, message: 'must have at most 500 entries' });
  }
  if (!isStrArray(v.blockKeywords)) {
    errors.push({ path: `${path}.blockKeywords`, message: 'must be an array of strings' });
  } else if (v.blockKeywords.length > 500) {
    errors.push({ path: `${path}.blockKeywords`, message: 'must have at most 500 entries' });
  }
  return v as unknown as Schedule;
}

export function validateSettings(input: unknown): { errors: ValidationError[]; settings?: Settings } {
  const errors: ValidationError[] = [];
  if (!isObj(input)) {
    errors.push({ path: '', message: 'settings must be an object' });
    return { errors };
  }
  if (input.version !== 1) {
    errors.push({ path: 'version', message: 'must be 1' });
  }
  if (input.allowTempBypass !== undefined && !isBool(input.allowTempBypass)) {
    errors.push({ path: 'allowTempBypass', message: 'must be a boolean' });
  }
  const primary = validateProvider(input.provider, errors, 'provider');
  let fallback: ProviderConfig | null = null;
  if (input.fallbackProvider !== undefined) {
    fallback = validateProvider(input.fallbackProvider, errors, 'fallbackProvider');
  }
  if (primary && fallback && sameProvider(primary, fallback)) {
    errors.push({
      path: 'fallbackProvider',
      message: 'must not be the same provider as the primary',
    });
  }
  if (!Array.isArray(input.schedules)) {
    errors.push({ path: 'schedules', message: 'must be an array' });
  } else {
    input.schedules.forEach((s, i) => validateSchedule(s, i, errors));
    const seen = new Set<string>();
    input.schedules.forEach((s, i) => {
      if (isObj(s) && isStr(s.id) && s.id.trim() !== '') {
        if (seen.has(s.id)) {
          errors.push({ path: `schedules[${i}].id`, message: 'duplicate schedule id' });
        } else {
          seen.add(s.id);
        }
      }
    });
  }
  if (errors.length > 0) {
    return { errors };
  }
  return { errors: [], settings: input as unknown as Settings };
}
