import type { VideoMetadata } from './types';

export interface MatchResult {
  matched: boolean;
  /** the entry that matched, when matched */
  entry: string;
}

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Case-insensitive substring matching. An entry prefixed with `channel:`
 * matches against the channel only; otherwise it matches against both
 * title and channel. Returns the first matching entry.
 */
export function matchList(entries: string[], meta: VideoMetadata): MatchResult {
  const title = normalize(meta.title);
  const channel = normalize(meta.channel);

  for (const raw of entries) {
    const entry = raw.trim();
    if (entry === '') continue;
    if (entry.toLowerCase().startsWith('channel:')) {
      const needle = normalize(entry.slice('channel:'.length));
      if (needle !== '' && channel.includes(needle)) {
        return { matched: true, entry: raw };
      }
    } else {
      const needle = normalize(entry);
      if (needle !== '' && (title.includes(needle) || channel.includes(needle))) {
        return { matched: true, entry: raw };
      }
    }
  }
  return { matched: false, entry: '' };
}
