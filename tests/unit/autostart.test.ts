import { describe, it, expect } from 'vitest';
import { resolveAutostart } from '@/game/autostart';

/**
 * The one thing the UI-v3 boot restructure MUST not regress: every dev and
 * automation entry point still boots straight into a world, exactly as it did
 * before the title screen existed. Only a plain visit reaches the title.
 */
describe('resolveAutostart — which URLs skip the title', () => {
  it('a plain visit gets the TITLE (nothing is generated on page load)', () => {
    expect(resolveAutostart('', true)).toBeNull();
    expect(resolveAutostart('?', true)).toBeNull();
    expect(resolveAutostart('?dev', true)).toBeNull();
    expect(resolveAutostart('?solarhour=12', true)).toBeNull();
  });

  it('?genseed=N boots a FRESH world at that seed', () => {
    expect(resolveAutostart('?genseed=4242', true)).toEqual({ kind: 'fresh', genSeed: 4242 });
  });

  it('ignores a non-numeric, zero or negative genseed', () => {
    // A malformed flag must not silently become "seed 0" or NaN — it just is not
    // an autostart, so the player lands on the title and can pick.
    expect(resolveAutostart('?genseed=abc', true)).toBeNull();
    expect(resolveAutostart('?genseed=0', true)).toBeNull();
    expect(resolveAutostart('?genseed=-5', true)).toBeNull();
  });

  it('?genome=NAME boots a fresh EPHEMERAL world (a throwaway terrain study)', () => {
    expect(resolveAutostart('?genome=woodland', true))
      .toEqual({ kind: 'fresh', genome: 'woodland', ephemeral: true });
  });

  it('ignores ?genome in a distribution build (no dev tools)', () => {
    expect(resolveAutostart('?genome=woodland', false)).toBeNull();
  });

  it('genseed WINS over genome when both are present', () => {
    // An explicit seed is the more specific ask; picking one deterministically
    // matters because the two would otherwise fight over the world.
    expect(resolveAutostart('?genome=woodland&genseed=7', true))
      .toEqual({ kind: 'fresh', genSeed: 7 });
  });

  it('?world=testbed boots the dev integration testbed, fresh and EPHEMERAL', () => {
    // No genSeed here: the testbed carries its own pinned one, resolved in `Game`
    // alongside the seed module (dynamic import ⇒ tree-shaken from dist builds).
    expect(resolveAutostart('?world=testbed', true))
      .toEqual({ kind: 'fresh', testbed: true, ephemeral: true });
  });

  it('ignores ?world=testbed in a distribution build (no dev tools)', () => {
    // Same gate as `?genome`: the testbed must be unreachable in a shipped build, and it
    // is never in PLAYABLE_WORLD_NAMES either, so the New Game menu stays clean of it.
    expect(resolveAutostart('?world=testbed', false)).toBeNull();
  });

  it('ignores any other ?world value rather than guessing at a world', () => {
    // `?world` is NOT a general world selector — named playable worlds boot through the
    // New Game screen / `new_game` verb. An unknown value must reach the title, not
    // silently fold to `default`.
    expect(resolveAutostart('?world=default', true)).toBeNull();
    expect(resolveAutostart('?world=', true)).toBeNull();
    expect(resolveAutostart('?world=nonsense', true)).toBeNull();
  });

  it('genseed and genome both WIN over ?world=testbed', () => {
    // The testbed is only defined at its own pinned seed, so an explicit `?genseed`
    // asking for a different world is the more specific ask and takes the whole boot.
    expect(resolveAutostart('?world=testbed&genseed=7', true)).toEqual({ kind: 'fresh', genSeed: 7 });
    expect(resolveAutostart('?world=testbed&genome=woodland', true))
      .toEqual({ kind: 'fresh', genome: 'woodland', ephemeral: true });
  });

  it('?bridge boots a world so an attaching CLI/MCP client finds one running', () => {
    expect(resolveAutostart('?bridge', true)).toEqual({ kind: 'auto' });
    expect(resolveAutostart('?bridge=rw', true)).toEqual({ kind: 'auto' });
  });

  it('?bridge still boots in a distribution build', () => {
    // The bridge flag is not dev-tools gated at this layer (its CLIENT is), so a
    // bridged tab behaves the same either way.
    expect(resolveAutostart('?bridge=rw', false)).toEqual({ kind: 'auto' });
  });

  it('?autostart is the plain opt-in for the old straight-to-world behaviour', () => {
    expect(resolveAutostart('?autostart', true)).toEqual({ kind: 'auto' });
  });

  it('is total over junk query strings — never throws', () => {
    // `URLSearchParams` is remarkably forgiving with string input, so the guard
    // clause is insurance rather than a reachable branch for these; what matters
    // is that no input makes this throw during boot.
    for (const junk of ['?&&&', '?=', '???', '?%', '?a=%E0%A4%A', '#hash', 'not a query']) {
      expect(() => resolveAutostart(junk, true)).not.toThrow();
    }
  });
});
