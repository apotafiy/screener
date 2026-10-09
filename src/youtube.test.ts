import { describe, expect, it, vi, afterEach } from 'vitest';
import { parseVideoId, parsePlayerResponse, resolveVideoContext } from './youtube';

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

describe('resolveVideoContext', () => {
  it('uses the watch page and oEmbed as fallback', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/oembed')) return json({ title: 'Embed', author_name: 'EmbedChannel' });
      if (url.includes('/watch')) return new Response(playerHtml(), { status: 200 });
      throw new Error('unexpected ' + url);
    }));

    const meta = await resolveVideoContext('abc');
    expect(meta).not.toBeNull();
    expect(meta!.title).toBe('My Game Video');
    expect(meta!.channel).toBe('SomeChannel');
    expect(meta!.tags).toEqual(['Minecraft', 'Gameplay']);
    expect(meta!.category).toBe('Gaming');
    expect(meta!.description).toContain('Minecraft');
  });

  it('falls back to oEmbed when the watch page fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/oembed')) return json({ title: 'Embed', author_name: 'EmbedChannel' });
      return new Response('', { status: 500 });
    }));
    const meta = await resolveVideoContext('abc');
    expect(meta!.title).toBe('Embed');
    expect(meta!.channel).toBe('EmbedChannel');
    expect(meta!.tags).toBeUndefined();
  });

  it('returns null when both sources fail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
    expect(await resolveVideoContext('abc')).toBeNull();
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