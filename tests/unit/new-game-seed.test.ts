// tests/unit/new-game-seed.test.ts
// The next-Game "which world" roll (src/game/new-game-seed.ts). It is the one
// deliberately nondeterministic value in boot — so the sim-stays-deterministic
// rule doesn't apply to it — but its MAPPING (draw → seed) and its range are
// pinned here, and the regression this guards is the one just fixed: RANDOM /
// NEW GAME previously always re-landed on the pinned demo world. Falling back to
// the pinned seed would freeze the set below to a single value again.
import { describe, it, expect, afterEach } from 'vitest';
import { newGameSeed, pickPlayableWorld } from '@/game/new-game-seed';

// `globalThis.crypto` is a getter-only accessor in the node test env, so stubbing
// it requires Object.defineProperty (a plain assignment throws).
function stubCrypto(getRandomValues?: (a: Uint32Array) => void): void {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: getRandomValues
      ? { getRandomValues }
      : undefined,
  });
}

const realCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');

afterEach(() => {
  if (realCrypto) Object.defineProperty(globalThis, 'crypto', realCrypto);
  else delete (globalThis as { crypto?: unknown }).crypto;
});

describe('newGameSeed — the New-Game "which world" roll', () => {
  it('returns a valid integer seed in [1, 0x7fffffff] every time', () => {
    for (let i = 0; i < 500; i++) {
      const s = newGameSeed();
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(1);
      expect(s).toBeLessThanOrEqual(0x7fffffff);
    }
  });

  it('is NOT frozen to a single value across calls (the pinned-demo regression)', () => {
    // Over a decent real-CSPRNG sample two identical draws are astronomically
    // unlikely, so this asserts the roll isn't a constant (which is exactly the
    // bug: RANDOM always produced the same pinned world).
    const seen = new Set<number>();
    for (let i = 0; i < 100; i++) seen.add(newGameSeed());
    expect(seen.size).toBeGreaterThan(1);
  });

  it('maps a CSPRNG draw of 0 to seed 1 — never a bogus seed 0', () => {
    stubCrypto((a: Uint32Array) => { a[0] = 0; });
    expect(newGameSeed()).toBe(1);
  });

  it('maps the top-of-range draw to the top seed 0x7fffffff', () => {
    stubCrypto((a: Uint32Array) => { a[0] = 0x7ffffffe; });
    expect(newGameSeed()).toBe(0x7fffffff);
  });

  it('falls back to Math.random on hosts without crypto, still in range', () => {
    stubCrypto(undefined);
    const s = newGameSeed();
    expect(Number.isInteger(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(1);
    expect(s).toBeLessThanOrEqual(0x7fffffff);
  });
});

describe('pickPlayableWorld — the New-Game "which world" pick', () => {
  it('with a single-entry registry always returns default (a no-op, as expected)', () => {
    expect(pickPlayableWorld()).toBe('default');
    expect(pickPlayableWorld()).toBe('default');
  });

  it('maps a CSPRNG draw deterministically onto the playable set', () => {
    stubCrypto((a: Uint32Array) => { a[0] = 12345; });
    // 12345 % 1 = 0 -> names[0] = 'default' regardless of the draw.
    expect(pickPlayableWorld()).toBe('default');
  });

  it('never returns a value outside the playable set', () => {
    for (let i = 0; i < 200; i++) {
      const w = pickPlayableWorld();
      expect(['default']).toContain(w);
    }
  });
});
