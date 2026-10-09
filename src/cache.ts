import type { CacheEntry, NoulDecision, ProviderConfig, Schedule } from './types';
import { withLock } from './mutex';

/**
 * LRU decision cache backed by chrome.storage.session.
 *
 * Array order encodes recency: oldest entries sit at the front (index 0)
 * and are evicted first when the cap is hit. Every read (cacheGet) or
 * write (cachePut) promotes the touched entry to the end.
 */
const CACHE_KEY = 'verdictCache';
export const MAX_ENTRIES = 2000;

/**
 * A stable hash over the parts of a schedule that affect the verdict.
 * Editing any of these changes the hash and therefore invalidates all
 * prior cached verdicts for that schedule.
 *
 * Hand-rolled (FNV-1a-style) rather than crypto.subtle.digest('SHA-256', ...)
 * deliberately: this only needs to be a short, synchronous, collision-resistant
 * cache key, not a cryptographically secure digest — nothing here needs
 * resistance to adversarial tampering. Web Crypto's digest API is the only
 * built-in hashing primitive on the web platform, but it's async (would force
 * this function and its one call site to become async for no real benefit)
 * and produces a much longer output (64 hex chars for SHA-256 vs. 16 here).
 */
export function criteriaHash(schedule: Schedule, provider?: ProviderConfig): string {
  const parts = [
    schedule.allowCriteria,
    schedule.blockCriteria,
    schedule.allowKeywords.join('\u0000'),
    schedule.blockKeywords.join('\u0000'),
    // Fold the model into the hash so switching providers/models invalidates
    // prior verdicts, which may have come from a model the user disliked.
    provider ? `${provider.kind}|${provider.model}` : '',
  ].join('\u0001');

  let h1 = 0x811c9dc5;
  let h2 = 0x1000193;
  for (let i = 0; i < parts.length; i++) {
    const c = parts.charCodeAt(i);
    h1 = (h1 ^ c) >>> 0;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 = (h2 ^ c) >>> 0;
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

function findIndex(entries: CacheEntry[], videoId: string, hash: string): number {
  return entries.findIndex((e) => e.videoId === videoId && e.criteriaHash === hash);
}

/** Moves the entry for (videoId, hash) to the end (MRU) and returns it, or null. */
export function touchLru(
  entries: CacheEntry[],
  videoId: string,
  hash: string,
): CacheEntry | null {
  const idx = findIndex(entries, videoId, hash);
  if (idx === -1) return null;
  const [entry] = entries.splice(idx, 1);
  entries.push(entry!);
  return entry!;
}

/** Drops from the front (oldest LRU entries) until length <= max. */
export function evictToCap(entries: CacheEntry[], max: number): void {
  while (entries.length > max) entries.shift();
}

async function load(): Promise<CacheEntry[]> {
  const raw = await chrome.storage.session.get(CACHE_KEY);
  const arr = raw[CACHE_KEY];
  if (!Array.isArray(arr)) return [];
  return arr as CacheEntry[];
}

async function persist(entries: CacheEntry[]): Promise<void> {
  await chrome.storage.session.set({ [CACHE_KEY]: entries });
}

export async function cacheGet(videoId: string, hash: string): Promise<CacheEntry | null> {
  return withLock(async () => {
    const entries = await load();
    const entry = touchLru(entries, videoId, hash);
    if (entry) await persist(entries);
    return entry;
  });
}

export async function cachePut(
  videoId: string,
  hash: string,
  nouls: NoulDecision,
  title?: string,
): Promise<void> {
  await withLock(async () => {
    const entries = await load();
    const idx = findIndex(entries, videoId, hash);
    // Remove any existing entry for this key (concurrent-write dedup,
    // or unifies with subsequent .push to promote it to the LRU end).
    if (idx !== -1) entries.splice(idx, 1);

    entries.push({ videoId, criteriaHash: hash, nouls, title });
    evictToCap(entries, MAX_ENTRIES);
    await persist(entries);
  });
}
