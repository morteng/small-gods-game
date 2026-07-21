import { describe, it, expect } from 'vitest';
import { soulWarmFocusDue, SOUL_WARM_FOCUS_COOLDOWN_MS } from '@/game/soul-warm-focus';

describe('soulWarmFocusDue (UI v2 W3/D6) — the pure per-npc cooldown decision', () => {
  it('is due when the npc has never fired before', () => {
    expect(soulWarmFocusDue('n1', new Map(), 1_000_000)).toBe(true);
  });

  it('is NOT due immediately after firing', () => {
    const fired = new Map([['n1', 1_000_000]]);
    expect(soulWarmFocusDue('n1', fired, 1_000_000)).toBe(false);
    expect(soulWarmFocusDue('n1', fired, 1_000_000 + 1)).toBe(false);
  });

  it('stays not-due right up to the cooldown boundary, then becomes due', () => {
    const fired = new Map([['n1', 1_000_000]]);
    expect(soulWarmFocusDue('n1', fired, 1_000_000 + SOUL_WARM_FOCUS_COOLDOWN_MS - 1)).toBe(false);
    expect(soulWarmFocusDue('n1', fired, 1_000_000 + SOUL_WARM_FOCUS_COOLDOWN_MS)).toBe(true);
    expect(soulWarmFocusDue('n1', fired, 1_000_000 + SOUL_WARM_FOCUS_COOLDOWN_MS + 1)).toBe(true);
  });

  it('cooldown is per-npc — a fired sibling never blocks a fresh id', () => {
    const fired = new Map([['n1', 1_000_000]]);
    expect(soulWarmFocusDue('n2', fired, 1_000_000)).toBe(true);
  });

  it('honours a caller-supplied cooldown override', () => {
    const fired = new Map([['n1', 0]]);
    expect(soulWarmFocusDue('n1', fired, 500, 1000)).toBe(false);
    expect(soulWarmFocusDue('n1', fired, 1000, 1000)).toBe(true);
  });
});
