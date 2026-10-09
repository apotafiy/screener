import { describe, expect, it } from 'vitest';
import { matchList } from './matcher';

const meta = { title: 'Minecraft Hardcore Survival', channel: 'GamerDude' };

describe('matchList', () => {
  it('matches case-insensitively on title', () => {
    expect(matchList(['minecraft'], meta).matched).toBe(true);
    expect(matchList(['MINECRAFT'], meta).matched).toBe(true);
    expect(matchList(['MiNeCrAfT'], meta).matched).toBe(true);
  });

  it('matches on channel', () => {
    expect(matchList(['gamerdude'], meta).matched).toBe(true);
  });

  it('scopes channel: prefix to channel only', () => {
    expect(matchList(['channel:GamerDude'], meta).matched).toBe(true);
    expect(matchList(['channel:minecraft'], meta).matched).toBe(false);
  });

  it('returns the matched entry', () => {
    const r = matchList(['foo', 'Minecraft'], meta);
    expect(r.matched).toBe(true);
    expect(r.entry).toBe('Minecraft');
  });

  it('ignores empty and whitespace entries', () => {
    expect(matchList(['', '   ', 'nonexistent'], meta).matched).toBe(false);
  });

  it('returns no match when nothing matches', () => {
    expect(matchList(['cooking', 'vlogs'], meta).matched).toBe(false);
  });

  it('handles empty list', () => {
    expect(matchList([], meta).matched).toBe(false);
  });
});
