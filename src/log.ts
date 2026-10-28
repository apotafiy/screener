import type { LogEntry } from './types';
import { withLock } from './mutex';

const LOG_KEY = 'decisionLog';
const MAX_ENTRIES = 1000;

export async function loadLog(): Promise<LogEntry[]> {
  const raw = await chrome.storage.local.get(LOG_KEY);
  const arr = raw[LOG_KEY];
  if (!Array.isArray(arr)) return [];
  return arr as LogEntry[];
}

/**
 * Appends one check's decisions in a single read-modify-write, so a stacked
 * check stays contiguous and does not take the lock once per schedule.
 */
export async function appendLogs(entries: LogEntry[]): Promise<void> {
  if (entries.length === 0) return;
  await withLock(async () => {
    const log = await loadLog();
    log.push(...entries);
    while (log.length > MAX_ENTRIES) log.shift();
    await chrome.storage.local.set({ [LOG_KEY]: log });
  });
}

export async function clearLog(): Promise<void> {
  await chrome.storage.local.remove(LOG_KEY);
}
