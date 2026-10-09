import type { LogEntry } from './types';
import { withLock } from './mutex';

const LOG_KEY = 'decisionLog';
const MAX_ENTRIES = 200;

export async function loadLog(): Promise<LogEntry[]> {
  const raw = await chrome.storage.local.get(LOG_KEY);
  const arr = raw[LOG_KEY];
  if (!Array.isArray(arr)) return [];
  return arr as LogEntry[];
}

export async function appendLog(entry: LogEntry): Promise<void> {
  await withLock(async () => {
    const entries = await loadLog();
    entries.push(entry);
    while (entries.length > MAX_ENTRIES) entries.shift();
    await chrome.storage.local.set({ [LOG_KEY]: entries });
  });
}

export async function clearLog(): Promise<void> {
  await chrome.storage.local.remove(LOG_KEY);
}
