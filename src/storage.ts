import type { Settings } from './types';
import { defaultSettings } from './defaults';
import { validateSettings } from './schema';

const SETTINGS_KEY = 'settings';
const API_KEY_KEY = 'apiKey';
const FALLBACK_API_KEY_KEY = 'fallbackApiKey';

export async function loadSettings(): Promise<Settings> {
  const raw = await chrome.storage.local.get(SETTINGS_KEY);
  const stored = raw[SETTINGS_KEY];
  if (stored === undefined) {
    return defaultSettings();
  }
  const { settings, errors } = validateSettings(stored);
  if (settings) {
    return settings;
  }
  // Invalid stored settings: keep the raw value for the user to repair,
  // but do not let it drive behaviour. Log the problem and fall back.
  console.warn('Screener: stored settings invalid, using defaults', errors);
  return defaultSettings();
}

export async function saveSettings(settings: Settings): Promise<void> {
  const { errors } = validateSettings(settings);
  if (errors.length > 0) {
    throw new Error('Invalid settings: ' + errors.map((e) => `${e.path} ${e.message}`).join('; '));
  }
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

export async function loadApiKey(): Promise<string> {
  const raw = await chrome.storage.local.get(API_KEY_KEY);
  return typeof raw[API_KEY_KEY] === 'string' ? (raw[API_KEY_KEY] as string) : '';
}

export async function saveApiKey(key: string): Promise<void> {
  await chrome.storage.local.set({ [API_KEY_KEY]: key });
}

export async function loadFallbackApiKey(): Promise<string> {
  const raw = await chrome.storage.local.get(FALLBACK_API_KEY_KEY);
  return typeof raw[FALLBACK_API_KEY_KEY] === 'string' ? (raw[FALLBACK_API_KEY_KEY] as string) : '';
}

export async function saveFallbackApiKey(key: string): Promise<void> {
  await chrome.storage.local.set({ [FALLBACK_API_KEY_KEY]: key });
}
