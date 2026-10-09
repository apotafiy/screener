import { describe, expect, it, vi, afterEach } from 'vitest';
import type { ProviderConfig, Schedule, VideoMetadata } from '../types';
import { jev, buildState, buildQuestions, toDecision } from './jev';
import type { NoulAnswer } from './jev';

const cfg: ProviderConfig = {
  kind: 'jev',
  presetId: 'typesafe',
  baseUrl: 'https://api.typesafe.ai/v1/systemone',
  model: 'jev-latest',
  timeoutMs: 12000,
};

function sched(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: 's1',
    name: 'Test',
    enabled: true,
    days: [1],
    startMinutes: 480,
    endMinutes: 1020,
    allowCriteria: 'coding tutorials',
    blockCriteria: 'gaming',
    allowKeywords: [],
    blockKeywords: [],
    ...overrides,
  };
}

const meta: VideoMetadata = { title: 'Test Title', channel: 'TestChannel' };

function noul(v: number): NoulAnswer {
  return { type: 'noul', noul: v };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildState', () => {
  it('includes title/channel and optional description', () => {
    expect(buildState(meta)).toEqual({ title: 'Test Title', channel: 'TestChannel' });
    expect(buildState({ ...meta, description: '  desc  ' })).toEqual({
      title: 'Test Title',
      channel: 'TestChannel',
      description: 'desc',
    });
    expect(buildState({ ...meta, description: '   ' })).not.toHaveProperty('description');
  });

  it('includes tags and category when present', () => {
    const s = buildState({
      ...meta,
      tags: ['Minecraft', 'Gameplay'],
      category: 'Gaming',
    });
    expect(s).toEqual({
      title: 'Test Title',
      channel: 'TestChannel',
      tags: 'Minecraft, Gameplay',
      category: 'Gaming',
    });
  });

  it('omits empty tags and category', () => {
    const s = buildState({ ...meta, tags: [], category: '   ' });
    expect(s).not.toHaveProperty('tags');
    expect(s).not.toHaveProperty('category');
  });

  it('caps tags at 100', () => {
    const tags = Array.from({ length: 150 }, (_, i) => `tag${i}`);
    const s = buildState({ ...meta, tags });
    expect(s.tags).toBe(tags.slice(0, 100).join(', '));
  });
});

describe('buildQuestions', () => {
  it('emits both noul questions when both criteria present', () => {
    const q = buildQuestions(sched());
    expect(Object.keys(q).sort()).toEqual(['matches_allow', 'matches_block']);
    expect(q.matches_block!.type).toBe('noul');
    expect(q.matches_block!.instructions).toContain('BLOCK criteria');
    expect(q.matches_block!.instructions).toContain('gaming');
    expect(q.matches_allow!.instructions).toContain('ALLOW criteria');
  });

  it('omits allow question when allow criteria empty', () => {
    const q = buildQuestions(sched({ allowCriteria: '' }));
    expect(Object.keys(q)).toEqual(['matches_block']);
  });

  it('omits block question when block criteria empty', () => {
    const q = buildQuestions(sched({ blockCriteria: '' }));
    expect(Object.keys(q)).toEqual(['matches_allow']);
  });

  it('emits no questions when both empty', () => {
    expect(buildQuestions(sched({ allowCriteria: '', blockCriteria: '' }))).toEqual({});
  });
});

describe('toDecision', () => {
  it('maps both answers into a NoulDecision', () => {
    const answers = { matches_block: noul(0.98), matches_allow: noul(0.2) };
    expect(toDecision(sched(), answers)).toEqual({ matchesBlock: 0.98, matchesAllow: 0.2 });
  });

  it('omits fields for empty criteria', () => {
    expect(toDecision(sched({ allowCriteria: '' }), { matches_block: noul(0.1) })).toEqual({
      matchesBlock: 0.1,
    });
    expect(toDecision(sched({ blockCriteria: '' }), { matches_allow: noul(0.9) })).toEqual({
      matchesAllow: 0.9,
    });
  });

  it('returns an empty decision when both criteria empty', () => {
    expect(toDecision(sched({ allowCriteria: '', blockCriteria: '' }), {})).toEqual({});
  });

  it('throws when a required answer is missing', () => {
    expect(() => toDecision(sched(), { matches_allow: noul(1) })).toThrow('matches_block');
  });

  it('throws on non-numeric or out-of-range noul', () => {
    expect(() => toDecision(sched(), { matches_block: { type: 'noul', noul: 2 }, matches_allow: noul(1) })).toThrow();
    expect(() => toDecision(sched(), { matches_block: { type: 'choice' } as unknown as NoulAnswer, matches_allow: noul(1) })).toThrow();
    expect(() => toDecision(sched(), { matches_block: { type: 'noul', noul: '0.9' } as unknown as NoulAnswer, matches_allow: noul(1) })).toThrow();
  });
});

describe('jev adapter', () => {
  it('posts state + questions and maps the answer', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          model: 'jev-1.13.0',
          answers: { matches_block: { type: 'noul', noul: 0.98 }, matches_allow: { type: 'noul', noul: 0.2 } },
          usage: { input_tokens: 50 },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await jev.call(cfg, 'key', sched(), meta, new AbortController().signal);
    expect(result).toEqual({ matchesBlock: 0.98, matchesAllow: 0.2 });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.typesafe.ai/v1/systemone');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer key');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe('jev-latest');
    expect(body.questions.matches_block.type).toBe('noul');
    expect(body.state.title).toBe('Test Title');
  });

  it('returns an empty decision without a network call when criteria empty', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    const result = await jev.call(
      cfg,
      'key',
      sched({ allowCriteria: '', blockCriteria: '' }),
      meta,
      new AbortController().signal,
    );
    expect(result).toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws on non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response('bad', { status: 401 })));
    await expect(
      jev.call(cfg, 'key', sched(), meta, new AbortController().signal),
    ).rejects.toThrow('Jev error 401');
  });

  it('throws when response has no answers', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(JSON.stringify({}), { status: 200 })));
    await expect(
      jev.call(cfg, 'key', sched(), meta, new AbortController().signal),
    ).rejects.toThrow('no answers');
  });
});