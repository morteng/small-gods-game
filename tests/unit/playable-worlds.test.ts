// tests/unit/playable-worlds.test.ts
// The playable-world registry (src/world/playable-worlds.ts) — the single place
// "which worlds a New Game can begin in" lives. Pure; pins the currently-shipped
// set (exactly one, the default) and the name-resolution fallback that keeps old
// codes / display names from ever pointing at a nonexistent world.
import { describe, it, expect } from 'vitest';
import { PLAYABLE_WORLD_NAMES, resolvePlayableWorld } from '@/world/playable-worlds';

describe('playable-worlds registry', () => {
  it('ships exactly the pinned default as the only playable world (for now)', () => {
    expect(PLAYABLE_WORLD_NAMES).toEqual(['default']);
  });

  it('resolves the canonical id itself', () => {
    expect(resolvePlayableWorld('default')).toBe('default');
    expect(resolvePlayableWorld('DEFAULT')).toBe('default');
  });

  it('normalises case/whitespace/punctuation before matching', () => {
    expect(resolvePlayableWorld('  default ')).toBe('default');
  });

  it('falls back to default for any unknown/empty key — never throws', () => {
    expect(resolvePlayableWorld('dawnwood')).toBe('default');
    expect(resolvePlayableWorld('Verdant Vale')).toBe('default'); // display name ≠ id
    expect(resolvePlayableWorld('')).toBe('default');
    expect(resolvePlayableWorld(undefined)).toBe('default');
    expect(resolvePlayableWorld('nonsense!')).toBe('default');
  });
});
