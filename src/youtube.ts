import type { VideoMetadata } from './types';

/** Maximum description characters sent to the decision model. */
export const DESCRIPTION_MAX_CHARS = 10000;

// Any plausible WEB client version is accepted by the unauthenticated player
// endpoint; this is metadata-only. Bump it if YouTube starts rejecting it.
// TODO: avoid hardcoding this. Prefer the live `ytcfg` client context from the
// page (main-world access or parsed ytcfg script text), cache it per origin,
// and keep this constant only as a fallback.
const INNERTUBE_CLIENT_VERSION = '2.20260101.00.00';
const PLAYER_TIMEOUT_MS = 2500;
const WATCH_TIMEOUT_MS = 4000;

export function parseVideoId(url: string): string | null {
  if (url.length === 11 && /^[A-Za-z0-9_-]{11}$/.test(url)) return url;
  try {
    const u = new URL(url);
    if (u.hostname.endsWith('youtube.com') || u.hostname.endsWith('youtu.be')) {
      if (u.pathname === '/watch') return u.searchParams.get('v');
      const m = u.pathname.match(/^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})/);
      if (m) return m[1]!;
    }
    if (u.hostname === 'youtu.be') {
      const m = u.pathname.match(/^\/([A-Za-z0-9_-]{11})/);
      if (m) return m[1]!;
    }
  } catch {
    return null;
  }
  return null;
}

export interface WatchPageData {
  title?: string;
  channel?: string;
  tags?: string[];
  category?: string;
  description?: string;
}

/**
 * Finds `marker = { ... }` in the page HTML and returns the balanced object
 * literal, walking brace depth while skipping string contents. A greedy regex
 * would swallow the rest of the document (a description can contain `};var`).
 */
function extractJsonObject(html: string, marker: string): string | null {
  const idx = html.indexOf(marker);
  if (idx === -1) return null;
  const start = html.indexOf('{', idx);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  return null;
}

interface RawPlayerData {
  videoDetails?: {
    title?: unknown;
    author?: unknown;
    keywords?: unknown;
    shortDescription?: unknown;
  };
  microformat?: { playerMicroformatRenderer?: { category?: unknown } };
}

enum MetadataSource {
  WatchPage = 'ytInitialPlayerResponse',
  Player = 'youtubei player response',
}

/**
 * Logs a field whose type is not what we expect. Absent (undefined/null) fields
 * are normal and skipped, so this only fires on real shape surprises — making
 * YouTube markup/JSON changes easy to spot while debugging.
 */
function warnTypeMismatch(
  field: string,
  value: unknown,
  expected: string,
  source: MetadataSource,
): void {
  if (value !== undefined && value !== null && typeof value !== expected) {
    console.warn(
      `Screener: ${field} in ${source} has unexpected type ${typeof value} (expected ${expected})`,
    );
  }
}

/** Normalizes the shared `videoDetails` shape from a player response. */
function parseVideoDetails(data: RawPlayerData, source: MetadataSource): WatchPageData {
  const video = data.videoDetails ?? {};
  const category = data.microformat?.playerMicroformatRenderer?.category;

  // Debug aid: surface shape surprises instead of silently dropping fields.
  warnTypeMismatch('videoDetails', data.videoDetails, 'object', source);
  warnTypeMismatch('videoDetails.title', video.title, 'string', source);
  warnTypeMismatch('videoDetails.author', video.author, 'string', source);
  warnTypeMismatch('videoDetails.shortDescription', video.shortDescription, 'string', source);
  warnTypeMismatch('microformat.playerMicroformatRenderer.category', category, 'string', source);
  if (video.keywords !== undefined && !Array.isArray(video.keywords)) {
    console.warn(
      `Screener: videoDetails.keywords in ${source} is not an array (got ${typeof video.keywords})`,
    );
  }

  const tags = Array.isArray(video.keywords)
    ? video.keywords.filter((k): k is string => typeof k === 'string' && k.trim() !== '')
    : [];

  return {
    title: typeof video.title === 'string' ? video.title.trim() : undefined,
    channel: typeof video.author === 'string' ? video.author.trim() : undefined,
    tags: tags.length ? tags : undefined,
    category: typeof category === 'string' && category.trim() !== '' ? category.trim() : undefined,
    description: typeof video.shortDescription === 'string' ? video.shortDescription : undefined,
  };
}

/**
 * Logs incomplete metadata at debug level. Missing tags/description/category
 * is common, and visible warnings for failed fallbacks are emitted by the
 * service worker, so this does not flood the console on every normal check.
 */
function logMissingMetadata(
  data: WatchPageData,
  videoId: string,
  source: MetadataSource,
): void {
  const missing: string[] = [];
  if (!data.title) missing.push('title');
  if (!data.channel) missing.push('channel');
  if (!data.description) missing.push('description');
  if (!data.tags?.length) missing.push('tags');
  if (!data.category) missing.push('category');
  if (missing.length > 0) {
    console.debug(
      `Screener: ${source} metadata for ${videoId} is missing ${missing.join(', ')}`,
    );
  }
}

/**
 * Parses tags, category, description, and title/channel out of the watch page's
 * inline `ytInitialPlayerResponse`. Returns null when the JSON is missing or
 * unparseable.
 */
export function parsePlayerResponse(html: string): WatchPageData | null {
  const raw = extractJsonObject(html, 'ytInitialPlayerResponse');
  if (!raw) return null;

  let data: RawPlayerData;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.warn('Screener: could not parse ytInitialPlayerResponse', e);
    return null;
  }
  return parseVideoDetails(data, MetadataSource.WatchPage);
}

async function fetchWatchPage(videoId: string): Promise<WatchPageData | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), WATCH_TIMEOUT_MS);
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      signal: ctrl.signal,
    });
    if (!res.ok) {
      console.warn(`Screener: watch page fetch failed (${res.status})`);
      return null;
    }
    const data = parsePlayerResponse(await res.text());
    if (!data) {
      console.warn(`Screener: watch page for ${videoId} had no player response`);
      return null;
    }
    logMissingMetadata(data, videoId, MetadataSource.WatchPage);
    return data;
  } catch (e) {
    console.warn('Screener: watch page fetch error', e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchInnertubePlayer(
  videoId: string,
  origin: string,
): Promise<WatchPageData | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PLAYER_TIMEOUT_MS);
  try {
    const res = await fetch(new URL('/youtubei/v1/player', origin).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'WEB',
            clientVersion: INNERTUBE_CLIENT_VERSION,
            hl: 'en',
            gl: 'US',
          },
        },
        videoId,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      console.warn(`Screener: player endpoint fetch failed (${res.status})`);
      return null;
    }
    const data = parseVideoDetails(
      (await res.json()) as RawPlayerData,
      MetadataSource.Player,
    );
    logMissingMetadata(data, videoId, MetadataSource.Player);
    return data;
  } catch (e) {
    console.warn('Screener: player endpoint fetch error', e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Shapes resolved player data into the shared metadata used by decisions. */
function toVideoMetadata(data: WatchPageData | null): VideoMetadata | null {
  if (!data) return null;
  const title = data.title ?? '';
  const channel = data.channel ?? '';
  if (!title && !channel) return null;

  const meta: VideoMetadata = { title, channel };
  if (data.tags?.length) meta.tags = data.tags;
  if (data.category) meta.category = data.category;
  if (data.description) meta.description = data.description.slice(0, DESCRIPTION_MAX_CHARS);
  return meta;
}

/**
 * Fetches full metadata from the Innertube player endpoint. Must run in a
 * YouTube content script: the endpoint rejects the extension origin used by
 * the service worker, but accepts the page origin.
 */
export async function fetchMetadataFromPlayer(
  videoId: string,
  origin: string,
): Promise<VideoMetadata | null> {
  return toVideoMetadata(await fetchInnertubePlayer(videoId, origin));
}

/**
 * Fetches full metadata from the watch page. Used by the service worker when
 * page-context player metadata is unavailable, and by pasted-link tests.
 */
export async function fetchMetadataFromWatchPage(videoId: string): Promise<VideoMetadata | null> {
  return toVideoMetadata(await fetchWatchPage(videoId));
}
