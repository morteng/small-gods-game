// tests/unit/playable-worlds.test.ts
// The playable-world registry (src/world/playable-worlds.ts) — the single place
// "which worlds a New Game can begin in" lives. Pins the shipped set and the
// name-resolution fallback that keeps old codes / display names from ever
// pointing at a nonexistent world.
import { describe, it, expect } from 'vitest';
import { PLAYABLE_WORLD_NAMES, resolvePlayableWorld } from '@/world/playable-worlds';

describe('playable-worlds registry', () => {
  it('ships the seeded default, dawn and frost as playable worlds', () => {
    expect(PLAYABLE_WORLD_NAMES).toEqual(['default', 'dawn', 'frost']);
  });

  it('resolves each canonical id itself, and case/whitespace-insensitively', () => {
    expect(resolvePlayableWorld('default')).toBe('default');
    expect(resolvePlayableWorld('dawn')).toBe('dawn');
    expect(resolvePlayableWorld('  FROST ')).toBe('frost');
  });

  it('falls back to default for any unknown/empty key — never throws', () => {
    expect(resolvePlayableWorld('dawnwood')).toBe('default');
    expect(resolvePlayableWorld('A Steppe To The Sun')).toBe('default'); // display name ≠ id
    expect(resolvePlayableWorld('')).toBe('default');
    expect(resolvePlayableWorld(undefined)).toBe('default');
  });
});
