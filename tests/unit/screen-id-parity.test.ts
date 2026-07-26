// tests/unit/screen-id-parity.test.ts
//
// `ScreenId` (the shell stack's union) and the set `game.ts` validates an
// `open_screen` command against USED TO BE two independent hand-written lists
// with nothing tying them together. The failure mode was silent and one-sided:
// `Shell.push('hall')` works fine internally, but an agent's
// `open_screen screen=hall` over the bus — the EXTERNAL AGENT API — is refused
// with no error logged, so the screen simply never opens and nothing says why.
// (Hall of the Gods recon gotcha 10.)
//
// The real fix is structural and lives in `shell-state.ts`: `SCREEN_ID_KEYS` is
// a `Record<ScreenId, true>`, so a new `ScreenId` fails `tsc` until it is listed,
// `ALL_SCREEN_IDS` is derived from it, and the `isScreenId` predicate moved out
// of `game.ts` to sit with the union it decides — there is no second list left.
// This file is the belt to those braces, catching the two things the compiler
// cannot: a hand-maintained list drifting from the union's ACTUAL members (the
// literals below are transcribed on purpose, so adding a screen has to touch
// this file too and the addition is deliberate), and the predicate being wired
// to some other set entirely.

import { describe, it, expect } from 'vitest';
import { ALL_SCREEN_IDS, isScreenId, type ScreenId } from '@/render/ui/shell/shell-state';

/** Every member of the `ScreenId` union, transcribed by hand. The `satisfies`
 *  makes a typo a compile error, and the equality assertion below makes a
 *  MISSING entry a test failure — so the union, `ALL_SCREEN_IDS` and this list
 *  can only agree. */
const EXPECTED = [
  'title', 'newgame', 'load', 'save', 'settings',
  'controls', 'loading', 'pause', 'gameover', 'photo',
  'hall',
] as const satisfies readonly ScreenId[];

describe('ScreenId ↔ open_screen parity', () => {
  it('ALL_SCREEN_IDS is exactly the ScreenId union, with no duplicates', () => {
    expect([...ALL_SCREEN_IDS].sort()).toEqual([...EXPECTED].sort());
    expect(new Set(ALL_SCREEN_IDS).size).toBe(ALL_SCREEN_IDS.length);
  });

  it('every ScreenId is accepted by the open_screen validator', () => {
    // The whole point: a screen the stack can hold MUST be one an agent can ask
    // for. Any id missing here would be a screen only the game's own code could
    // reach.
    for (const id of ALL_SCREEN_IDS) {
      expect(isScreenId(id), `open_screen refuses '${id}'`).toBe(true);
    }
  });

  it('the hall is reachable over the agent API', () => {
    // Named explicitly rather than left to the loop: this is the screen the
    // gotcha was discovered while adding, and `open_screen screen=hall` is the
    // documented way in (there is no keybind).
    expect(ALL_SCREEN_IDS).toContain('hall');
    expect(isScreenId('hall')).toBe(true);
  });

  it('an unknown screen name is still REFUSED, not cast and trusted', () => {
    // Deriving the set must not have widened it: the param arrives from outside.
    for (const junk of ['', 'HALL', 'hall ', 'pantheon', '__proto__', 'toString']) {
      expect(isScreenId(junk), `accepted junk screen '${junk}'`).toBe(false);
    }
  });
});
