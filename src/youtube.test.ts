import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  parseVideoId,
  parsePlayerResponse,
  fetchMetadataFromPlayer,
  fetchMetadataFromWatchPage,
} from './youtube';

afterEach(() => {
  vi.unstubAllGlobals();
});

function json(obj: unknown): Response {
  return new Response(JSON.stringify(obj), { status: 200 });
}

function playerHtml(details: Record<string, unknown> = {}): string {
  const player = {
    videoDetails: {
      title: 'My Game Video',
      author: 'SomeChannel',
      keywords: ['Minecraft', 'Gameplay', 123, '  '],
      shortDescription: 'Playing Minecraft today };var not the end',
    },
    microformat: { playerMicroformatRenderer: { category: 'Gaming' } },
    ...details,
  };
  return `<html><script>var ytInitialPlayerResponse = ${JSON.stringify(player)};var meta = 1;</script></html>`;
}

function playerJson(details: Record<string, unknown> = {}): Response {
  return json({
    videoDetails: {
      title: 'My Game Video',
      author: 'SomeChannel',
      keywords: ['Minecraft', 'Gameplay', 123, '  '],
      shortDescription: 'Playing Minecraft today };var not the end',
      ...details,
    },
    microformat: { playerMicroformatRenderer: { category: 'Gaming' } },
  });
}

describe('parsePlayerResponse', () => {
  it('extracts title, channel, tags, category, and description', () => {
    const data = parsePlayerResponse(playerHtml());
    expect(data).not.toBeNull();
    expect(data!.title).toBe('My Game Video');
    expect(data!.channel).toBe('SomeChannel');
    expect(data!.tags).toEqual(['Minecraft', 'Gameplay']);
    expect(data!.category).toBe('Gaming');
    expect(data!.description).toBe('Playing Minecraft today };var not the end');
  });

  it('returns null when the marker is missing', () => {
    expect(parsePlayerResponse('<html>nothing here</html>')).toBeNull();
  });

  it('returns null when the JSON is malformed', () => {
    expect(parsePlayerResponse('<script>var ytInitialPlayerResponse = {oops};</script>')).toBeNull();
  });

  it('omits empty tags and missing category', () => {
    const html = playerHtml({
      videoDetails: { title: 'T', author: 'C', keywords: [1, null], shortDescription: '' },
      microformat: { playerMicroformatRenderer: {} },
    });
    const data = parsePlayerResponse(html);
    expect(data!.tags).toBeUndefined();
    expect(data!.category).toBeUndefined();
  });

  it('warns when a field has an unexpected type', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const html = playerHtml({
        videoDetails: { title: 123, author: 'C', keywords: 'not-an-array', shortDescription: 'd' },
      });
      const data = parsePlayerResponse(html);
      expect(data!.title).toBeUndefined();
      const messages = warn.mock.calls.map((c) => String(c[0]));
      expect(messages.some((m) => m.includes('videoDetails.title'))).toBe(true);
      expect(messages.some((m) => m.includes('keywords'))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('fetchMetadataFromPlayer', () => {
  const origin = 'https://www.youtube.com';

  it('uses the player endpoint and sends a POST for the video', async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.includes('/youtubei/v1/player')) return playerJson();
      throw new Error('unexpected ' + url);
    });
    vi.stubGlobal('fetch', fetchMock);

    const meta = await fetchMetadataFromPlayer('abc', origin);
    expect(meta).not.toBeNull();
    expect(meta!.title).toBe('My Game Video');
    expect(meta!.channel).toBe('SomeChannel');
    expect(meta!.tags).toEqual(['Minecraft', 'Gameplay']);
    expect(meta!.category).toBe('Gaming');
    expect(meta!.description).toContain('Minecraft');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://www.youtube.com/youtubei/v1/player');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toMatchObject({ videoId: 'abc' });
  });

  it('uses the current page origin for mobile/music hosts', async () => {
    const fetchMock = vi.fn(async (_url: string) => playerJson());
    vi.stubGlobal('fetch', fetchMock);

    await fetchMetadataFromPlayer('abc', 'https://m.youtube.com');
    expect(fetchMock.mock.calls[0]![0]).toBe('https://m.youtube.com/youtubei/v1/player');
  });

  it('keeps a partial player result instead of discarding it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({
      videoDetails: { title: 'Only Title', keywords: ['Minecraft'] },
    })));
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      const meta = await fetchMetadataFromPlayer('abc', origin);
      expect(meta).toEqual({
        title: 'Only Title',
        channel: '',
        tags: ['Minecraft'],
      });
      expect(debug.mock.calls.some((c) => String(c[0]).includes('channel, description, category'))).toBe(true);
    } finally {
      debug.mockRestore();
    }
  });

  it('returns null when the player endpoint fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
    expect(await fetchMetadataFromPlayer('abc', origin)).toBeNull();
  });
});

describe('fetchMetadataFromWatchPage', () => {
  it('uses the watch page for full metadata', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/watch')) return new Response(playerHtml(), { status: 200 });
      throw new Error('unexpected ' + url);
    });
    vi.stubGlobal('fetch', fetchMock);

    const meta = await fetchMetadataFromWatchPage('abc');
    expect(meta).not.toBeNull();
    expect(meta!.title).toBe('My Game Video');
    expect(meta!.channel).toBe('SomeChannel');
    expect(meta!.tags).toEqual(['Minecraft', 'Gameplay']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns null when the watch page fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
    expect(await fetchMetadataFromWatchPage('abc')).toBeNull();
  });
});

describe('parseVideoId', () => {
  it('returns null for empty or garbage', () => {
    expect(parseVideoId('')).toBeNull();
    expect(parseVideoId('not a url')).toBeNull();
    expect(parseVideoId('http://google.com')).toBeNull();
  });

  it('parses a raw 11-char video ID', () => {
    expect(parseVideoId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(parseVideoId('12345678901')).toBe('12345678901');
    expect(parseVideoId('abcdefghij_')).toBe('abcdefghij_');
    expect(parseVideoId('ABCdefGHI-J')).toBe('ABCdefGHI-J');
  });

  it('rejects strings that look like IDs but are wrong length', () => {
    expect(parseVideoId('abc')).toBeNull();
    expect(parseVideoId('dQw4w9WgXcQx')).toBeNull(); // 12 chars
  });

  it('parses a standard /watch URL', () => {
    expect(parseVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(parseVideoId('https://youtube.com/watch?v=abc&t=10')).toBe('abc');
  });

  it('parses /shorts /embed /live URLs', () => {
    expect(parseVideoId('https://www.youtube.com/shorts/abc123def01')).toBe('abc123def01');
    expect(parseVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(parseVideoId('https://www.youtube.com/live/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('parses youtu.be short links', () => {
    expect(parseVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(parseVideoId('https://youtu.be/dQw4w9WgXcQ?t=10')).toBe('dQw4w9WgXcQ');
  });

  it('handles music.youtube.com subdomain', () => {
    expect(parseVideoId('https://music.youtube.com/watch?v=abc123')).toBe('abc123');
  });
});