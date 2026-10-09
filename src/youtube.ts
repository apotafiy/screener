import type { VideoMetadata } from './types';

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

interface OEmbedResponse {
  title?: string;
  author_name?: string;
}

/**
 * Fetches title + channel via YouTube oEmbed. Resolves to null on any
 * failure (age-restricted, private, unlisted, deleted videos all 401/404),
 * letting the caller fall back to DOM scraping.
 */
export async function fetchOEmbed(videoId: string, timeoutMs = 5000): Promise<VideoMetadata | null> {
  const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(
    `https://www.youtube.com/watch?v=${videoId}`,
  )}&format=json`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const json = (await res.json()) as OEmbedResponse;
    const title = json.title?.trim() ?? '';
    const channel = json.author_name?.trim() ?? '';
    if (!title && !channel) return null;
    return { title, channel };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
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

/**
 * Logs a field whose type is not what we expect. Absent (undefined/null) fields
 * are normal and skipped, so this only fires on real shape surprises — making
 * YouTube markup/JSON changes easy to spot while debugging.
 */
function warnTypeMismatch(field: string, value: unknown, expected: string): void {
  if (value !== undefined && value !== null && typeof value !== expected) {
    console.warn(
      `Screener: ${field} in ytInitialPlayerResponse has unexpected type ${typeof value} (expected ${expected})`,
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

  let data: {
    videoDetails?: {
      title?: unknown;
      author?: unknown;
      keywords?: unknown;
      shortDescription?: unknown;
    };
    microformat?: { playerMicroformatRenderer?: { category?: unknown } };
  };
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.warn('Screener: could not parse ytInitialPlayerResponse', e);
    return null;
  }

  const video = data.videoDetails ?? {};
  const category = data.microformat?.playerMicroformatRenderer?.category;

  // Debug aid: surface shape surprises instead of silently dropping fields.
  warnTypeMismatch('videoDetails', data.videoDetails, 'object');
  warnTypeMismatch('videoDetails.title', video.title, 'string');
  warnTypeMismatch('videoDetails.author', video.author, 'string');
  warnTypeMismatch('videoDetails.shortDescription', video.shortDescription, 'string');
  warnTypeMismatch('microformat.playerMicroformatRenderer.category', category, 'string');
  if (video.keywords !== undefined && !Array.isArray(video.keywords)) {
    console.warn(
      `Screener: videoDetails.keywords in ytInitialPlayerResponse is not an array (got ${typeof video.keywords})`,
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

async function fetchWatchPage(videoId: string): Promise<WatchPageData | null> {
  let html: string;
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`);
    if (!res.ok) {
      console.warn(`Screener: watch page fetch failed (${res.status})`);
      return null;
    }
    html = await res.text();
  } catch (e) {
    console.warn('Screener: watch page fetch error', e);
    return null;
  }
  return parsePlayerResponse(html);
}

/**
 * Resolves the video context shared by live checks and pasted-link tests:
 * title, channel, tags, category, and description.
 *
 * Fetches the watch page (for tags/category/description) and oEmbed (title/
 * channel fallback) in parallel. Returns null when neither yields a title or
 * channel.
 */
export async function resolveVideoContext(videoId: string): Promise<VideoMetadata | null> {
  const watchPromise = fetchWatchPage(videoId);
  const oembedPromise = fetchOEmbed(videoId);

  const watch = await watchPromise;
  const oembed = await oembedPromise;

  const title = watch?.title || oembed?.title || '';
  const channel = watch?.channel || oembed?.channel || '';
  if (!title && !channel) return null;

  const meta: VideoMetadata = { title, channel };
  if (watch?.tags?.length) meta.tags = watch.tags;
  if (watch?.category) meta.category = watch.category;
  if (watch?.description) meta.description = watch.description.slice(0, 1000);
  return meta;
}
