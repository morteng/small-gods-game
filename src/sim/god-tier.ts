// src/sim/god-tier.ts
//
// Track 5 (T5.0) — the reality number. "A god is only as real as its belief"
// (VISION §5). `SpiritSystem` already sums, per spirit and per sim second,
//
//     contribution = faith × (1 + 2·understanding) × (1 + 2·devotion)
//
// and then discards the total after scaling it by POWER_REGEN_RATE. That total is
// not a regen input — it is how REAL the god is. This module is the pure half:
// the tier ladder over that mass, plus the fading rules that hang off it. No
// imports from systems, so tests, sim, and UI all agree on one implementation.

import type { Spirit } from '@/core/spirit';
import { TICKS_PER_DAY } from '@/core/calendar';

/** VISION §5's cast, as a ladder. `nameless` is the tortoise — "nothing but
 *  names" — and applies to the player, rivals, and great gods alike. */
export type GodTier = 'nameless' | 'small' | 'cult' | 'major';

const RANK: Record<GodTier, number> = { nameless: 0, small: 1, cult: 2, major: 3 };

// ── Tier edges ───────────────────────────────────────────────────────────────
//
// Calibrated, not invented — anchored to `FICTION_POP_BY_SIZE` (small 36 ·
// medium 72 · large 144 · huge 288) and a measurement of the shipped default
// world (6 named believers at faith .40 / U .10 / D .15 → mass 3.744):
//
//   6 fickle believers ................................  3.7  → small
//   one small settlement, moderate depth (.5/.3/.4) ...   52  → cult
//   two-to-three settlements, deeper ..................  207  → major
//   a broad hollow church (432 souls at .5/.2/.2) .....  423  → major
//
// Each boundary is an INDEPENDENT hysteresis pair (the `zoom-band.ts` pattern):
// `_IN` is what you must reach to climb, `_OUT` what you must fall below to
// drop. The dead-zone is 20%, so a god parked on an edge cannot flicker its
// title every tick — a god's name changing is a story beat, not a jitter.

/** At/above this mass a god is at least `small` — i.e. it is not yet nothing. */
export const SMALL_IN = 1.0;
/** Below this, a `small`-or-better god drops to `nameless`. */
export const SMALL_OUT = 0.8;
/** At/above this mass belief has organized: a `cult`. */
export const CULT_IN = 40;
/** Below this, a `cult`-or-better god drops to `small`. */
export const CULT_OUT = 32;
/** At/above this mass a god is `major` — broad, powerful, and usually hollow. */
export const MAJOR_IN = 200;
/** Below this, a `major` god drops to `cult`. */
export const MAJOR_OUT = 160;

/**
 * The tier for a given belief mass, resolved against the previously committed
 * tier so every boundary is hysteretic. Pure and total: any finite mass and any
 * (or no) previous tier yields a tier. Non-finite / negative mass reads as 0.
 *
 * `prev` omitted ⇒ cold read (no hysteresis; every edge uses its `_IN`), which
 * is what a fresh spirit or a pre-T5.0 save gets on its first tick.
 */
export function tierFor(mass: number, prev?: GodTier): GodTier {
  const m = Number.isFinite(mass) && mass > 0 ? mass : 0;
  const held = prev ? RANK[prev] : 0;
  // Descending cascade: each rung uses its OUT threshold only if the god already
  // held that rung or better (so it is *keeping* ground, not taking it).
  if (m >= (held >= RANK.major ? MAJOR_OUT : MAJOR_IN)) return 'major';
  if (m >= (held >= RANK.cult ? CULT_OUT : CULT_IN)) return 'cult';
  if (m >= (held >= RANK.small ? SMALL_OUT : SMALL_IN)) return 'small';
  return 'nameless';
}

// ── Fading ───────────────────────────────────────────────────────────────────

/** Mass at/below which a god is starving. Same line as the `nameless` edge — a
 *  god fades exactly when it stops being anything. */
export const FADE_MASS = SMALL_IN;

/** How long the mass must stay below `FADE_MASS` before the god actually fades.
 *  Two GAME DAYS — one bad hour must never kill a god. Per the house rule,
 *  constants meaning fiction-days are `TICKS_PER_DAY` multiples, never raw tick
 *  literals (time is 1:1 realtime; a game day is 24 real hours at rate 1). */
export const FADE_SUSTAIN_TICKS = 2 * TICKS_PER_DAY;

/**
 * The one action a faded god keeps. This is canon, not a mercy: tenet 6 makes
 * the whisper "the primal, contested channel," and the whole of *Small Gods* is
 * a tortoise whispering to one novice.
 *
 * It is also load-bearing. Without it a faded god has NO route back — a player
 * at zero believers could never earn one — and the lose-state becomes a
 * softlock instead of the game's best story beat.
 */
export const FADED_ACTIONS: ReadonlySet<string> = new Set(['whisper']);

/**
 * True when this god has faded and the action is not one it kept. The single
 * predicate every divine-action guard consults, so player commands, rival AI,
 * Fate, and the dev bus all inherit the rule with no per-caller work.
 */
export function isSilenced(spirit: Pick<Spirit, 'faded'>, action: string): boolean {
  return spirit.faded === true && !FADED_ACTIONS.has(action);
}

/**
 * Fade bookkeeping for one spirit at one tick, as a pure decision over the
 * spirit's persisted `belowSinceTick` / `faded`.
 *
 * Returns the new pressure state plus the transition (if any) the caller should
 * log. Kept pure so replay, snapshot-scrub, and tests exercise the same rules
 * the live system does.
 */
export function stepFading(
  state: { belowSinceTick?: number; faded?: boolean },
  mass: number,
  now: number,
): { belowSinceTick?: number; faded: boolean; transition: 'faded' | 'returned' | null } {
  const starving = !(mass >= FADE_MASS);   // NaN-safe: a non-finite mass starves
  if (!starving) {
    // Back above the line: pressure clears immediately, and a faded god returns.
    return {
      belowSinceTick: undefined,
      faded: false,
      transition: state.faded ? 'returned' : null,
    };
  }
  const since = state.belowSinceTick ?? now;
  const faded = state.faded === true || now - since >= FADE_SUSTAIN_TICKS;
  return {
    belowSinceTick: since,
    faded,
    transition: faded && !state.faded ? 'faded' : null,
  };
}
