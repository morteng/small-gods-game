// src/game/hall-view.ts
//
// THE HALL OF THE GODS' VOICE (Phase C, slice H3) — the pure half of
// `Game.buildHallView()`: numbers in, PREBUILT PROSE out.
//
// The house rule for every view the shell reads: the screen module is pure
// geometry and knows no fiction, so all wording is composed here, fiction-first,
// never a raw tick, and NEVER A LIE. That last one is the whole reason this is a
// module and not fifteen template literals inside `game.ts`: every line below is
// a claim about the sim, and each is pinned by `tests/unit/hall-view.test.ts`
// against the constant it paraphrases. If a threshold moves and the prose would
// become false, a test fails rather than the game quietly lying to the player.
//
// It composes the ONE projection (`BeliefPowerView`, extended by H1 with
// `dimensions`/`tier`) plus the god's own reality numbers (`Spirit.beliefMass` /
// `intimacy` / `tier` / `faded`, which no other live surface reads yet). It adds
// no sim state and derives nothing the projection has not already derived — the
// tier ladder in particular is read straight off `BeliefPowerView.tier`, never
// recomputed here.

import type {
  HallView, HallNodeView, HallPedestalView,
} from '@/render/ui/shell/hall-screen';
import type { BeliefPowerView } from '@/game/game-query';
import { CLAIM_CONVICTION_FRACTION, DOCTRINE_DEVOTION_BAR } from '@/game/game-query';
import type { GodTier } from '@/sim/god-tier';
import { FADE_MASS, CULT_IN, MAJOR_IN } from '@/sim/god-tier';
import { clamp01 } from '@/core/math';

/** The god's reality numbers, as `buildHallView` reads them off the player
 *  `Spirit`. Every field is REQUIRED here even though the `Spirit`'s are
 *  optional (a pre-T5.0 save, or a spirit whose first `SpiritSystem` tick has
 *  not run): the caller substitutes the honest zero, so this module never has to
 *  decide what an absent belief mass means. */
export interface HallSpiritFacts {
  name: string;
  /** Σ faith·(1+2u)·(1+2d) — how real the god is (`Spirit.beliefMass`). */
  beliefMass: number;
  /** Mass-weighted mean of understanding·devotion, 0..1 (`Spirit.intimacy`). */
  intimacy: number;
  tier: GodTier;
  faded: boolean;
}

/** Canon, VISION tenet 6: a faded god keeps ONLY its whisper. The hall states
 *  that rather than offering live CAST buttons it would have to refuse. */
export const FADED_LINE = 'ONLY WHISPERS REMAIN';

// ── the god: tier, mass, intimacy ───────────────────────────────────────────

/** `GodTier` as the hall says it aloud. `nameless` is the tortoise — VISION §5's
 *  "nothing but names" — so it gets the canon phrasing, not a "rank 0" reading. */
const TIER_LINES: Record<GodTier, string> = {
  nameless: 'NOTHING BUT A NAME',
  small: 'A SMALL GOD',
  cult: 'A GOD WITH A CULT',
  major: 'A MAJOR GOD',
};

// Belief mass in PROSE, not as a float. A bare `3.7` on a 10-foot menu says
// nothing a player can act on; "enough for a hearth or two" says the same number
// in the only unit that matters (how many people). The bands below are the
// measured anchors in `god-tier.ts`'s own calibration comment — 6 fickle
// believers ≈ 3.7, one small settlement at moderate depth ≈ 52, two-to-three
// settlements ≈ 207 — so the two tier edges do the load-bearing work and these
// two interior numbers only subdivide the long `small` and `cult` stretches.
/** Between `FADE_MASS` and here, a god is a rumour among a few people. */
const MASS_HANDFUL = 10;
/** Inside `cult`, the line between one congregation and a town's worth. */
const MASS_SETTLEMENT = 100;

/** Belief mass as the hall says it. Honest at both ends: below `FADE_MASS` the
 *  god is starving (that is the fading line, not a small number), and the top
 *  band claims "several towns" only where the calibration puts 2–3 settlements. */
export function massLineFor(mass: number): string {
  const m = Number.isFinite(mass) && mass > 0 ? mass : 0;
  if (m < FADE_MASS) return 'BELIEF TOO THIN TO HOLD A SHAPE';
  if (m < MASS_HANDFUL) return 'BELIEF ENOUGH FOR A HANDFUL OF SOULS';
  if (m < CULT_IN) return 'BELIEF ENOUGH FOR A HEARTH OR TWO';
  if (m < MASS_SETTLEMENT) return 'BELIEF ENOUGH FOR ONE SETTLEMENT';
  if (m < MAJOR_IN) return 'BELIEF ENOUGH FOR A WHOLE TOWN';
  return 'BELIEF ENOUGH FOR SEVERAL TOWNS';
}

// `intimacy` is a mean of understanding·DEVOTION products, so it lives LOW: the
// shipped default world's believers (u .10 / d .15) average .015, a congregation
// at .5/.3/.4 averages ~.12, and genuine depth (.5+ on both) reaches ~.3. The
// bands are set against those measurements, not against a naive 0/.25/.5/.75.
const INTIMACY_NAMEONLY = 0.02;
const INTIMACY_SHALLOW = 0.08;
const INTIMACY_SOME = 0.2;
const INTIMACY_DEEP = 0.4;

/** Intimacy as prose — the caption under the strip's intimacy bar.
 *
 *  The one cross-referenced case is the HOLLOW god (VISION §5's "broad, powerful
 *  and usually hollow"): wide belief that understands nothing is a different
 *  story from a small god that is truly known, and the numbers alone cannot say
 *  which you are looking at, so the tier is consulted for that one line. */
export function intimacyLineFor(intimacy: number, tier: GodTier): string {
  const v = clamp01(Number.isFinite(intimacy) ? intimacy : 0);
  const broad = tier === 'cult' || tier === 'major';
  if (broad && v < INTIMACY_SHALLOW) return 'A WIDE CHURCH THAT DOES NOT KNOW YOU';
  if (v < INTIMACY_NAMEONLY) return 'THEY DO NOT KNOW WHAT THEY PRAY TO';
  if (v < INTIMACY_SHALLOW) return 'THEY KNOW YOUR NAME AND LITTLE ELSE';
  if (v < INTIMACY_SOME) return 'A FEW UNDERSTAND WHAT THEY PRAY TO';
  if (v < INTIMACY_DEEP) return 'THEY UNDERSTAND YOU AND KEEP FAITH';
  return 'THEY KNOW YOU DEEPLY — YOU ARE NOT GUESSED AT';
}

// ── the pedestals: nodes, reach, what would ripen next ──────────────────────

const TIER_RANK: Record<HallPedestalView['tier'], number> = {
  dormant: 0, claim: 1, command: 2, doctrine: 3,
};

/** What each ripening node MEANS, in one line — carried on `HallNodeView.hint`.
 *  H2 does not draw these yet (no room at 10-foot type); the field is frozen and
 *  a polish slice surfaces it, so the prose is real, not a placeholder. Each
 *  states the node's actual mechanical consequence:
 *  CLAIM = coincidence play is live · COMMAND = the verb is castable ·
 *  DOCTRINE = devotion is cutting the domain's decay rate. */
const NODE_HINTS: Record<HallNodeView['tier'], string> = {
  claim: 'HEARD — THEY GUESS YOUR HAND IN WHAT MERELY HAPPENS',
  command: 'WIELDED — THEY BELIEVE YOU CAN DO THIS, SO YOU CAN',
  doctrine: 'HELD — THE BELIEF NOW OUTLASTS YOUR SILENCE',
};

const NODE_LABELS: Record<HallNodeView['tier'], string> = {
  claim: 'CLAIM', command: 'COMMAND', doctrine: 'DOCTRINE',
};

const NODE_ORDER: readonly HallNodeView['tier'][] = ['claim', 'command', 'doctrine'];

/** Number words 0..10 — a threshold read as "SIX IN TEN" rather than `0.6`, so a
 *  bar the player cannot see the raw value of is still stated in a unit they can
 *  compare against the bar's own fill. */
const TENTHS = [
  'NOTHING', 'ONE IN TEN', 'TWO IN TEN', 'THREE IN TEN', 'FOUR IN TEN', 'HALF',
  'SIX IN TEN', 'SEVEN IN TEN', 'EIGHT IN TEN', 'NINE IN TEN', 'ALL OF IT',
] as const;

/** A 0..1 fraction as prose to the nearest tenth. Derived from the CONSTANT at
 *  every call site, never transcribed — so moving `DOCTRINE_DEVOTION_BAR` moves
 *  the sentence with it instead of turning it into a lie. */
export function tenthsPhrase(v: number): string {
  const i = Math.round(clamp01(Number.isFinite(v) ? v : 0) * 10);
  return TENTHS[Math.max(0, Math.min(10, i))];
}

/** The CLAIM bar in prose. `CLAIM_CONVICTION_FRACTION` is half the unlock mark,
 *  which has a word ("halfway") no generic tenths phrasing improves on; the
 *  fallback keeps this true if the constant ever moves off 0.5, and
 *  `hall-view.test.ts` pins that it has not. */
const CLAIM_PHRASE = CLAIM_CONVICTION_FRACTION === 0.5
  ? 'HALFWAY TO THE MARK'
  : `${tenthsPhrase(CLAIM_CONVICTION_FRACTION)} OF THE MARK`;

/** "BELIEVED BY 12 — REACH 5", or the honest nobody line. `believers` are
 *  faith-bearers toward this god; `reach` are the ones visibly holding THIS
 *  domain (the population the dimension means average over). */
export function reachLineFor(believers: number, reach: number): string {
  if (believers <= 0) return 'NO ONE BELIEVES THIS OF YOU YET';
  return `BELIEVED BY ${Math.round(believers)} — REACH ${Math.round(reach)}`;
}

/**
 * What would ripen the NEXT unreached node — the only "how do I progress" prose
 * in the hall, and the one most able to lie, so each branch names the real gate:
 *
 *  - dormant  → the CLAIM bar (half the unlock mark).
 *  - claim    → the unlock mark itself, UNLESS the verb is unimplemented, in
 *               which case conviction is not what is missing and saying so
 *               would send the player to farm belief for nothing.
 *  - command  → `DOCTRINE_DEVOTION_BAR` devotion, phrased from the constant.
 *  - doctrine → nothing is left; say that, don't invent a fourth rung.
 */
export function nextHintFor(
  tier: HallPedestalView['tier'], implemented: boolean,
): string {
  switch (tier) {
    case 'dormant':
      return `NOT YET HEARD — CONVICTION ${CLAIM_PHRASE} AND THEY WILL BEGIN TO GUESS YOUR HAND`;
    case 'claim':
      return implemented
        ? 'CONVICTION PAST THE MARK AND THEY WILL BELIEVE YOU CAN DO THIS'
        : 'THEY ALREADY GUESS YOUR HAND, BUT THIS POWER IS NOT YET IN THE WORLD';
    case 'command':
      return `DEVOTION PAST ${tenthsPhrase(DOCTRINE_DEVOTION_BAR)} AND THE BELIEF WILL HOLD ITSELF UP`;
    case 'doctrine':
      return 'ALL THREE REACHED — THIS BELIEF SUSTAINS ITSELF NOW';
  }
}

/** Why CAST is refused, or null when it is offered. Ordered most-total-truth
 *  first: a faded god cannot cast ANYTHING (so that reason outranks a
 *  per-domain one), then an unimplemented verb (belief is not the problem), then
 *  the ordinary "not yet believed of you". */
export function castBlockedFor(
  faded: boolean, implemented: boolean, unlocked: boolean,
): string | null {
  if (faded) return FADED_LINE;
  if (!implemented) return 'THIS POWER IS NOT YET IN THE WORLD';
  if (!unlocked) return 'NOT YET BELIEVED OF YOU';
  return null;
}

// ── composition ─────────────────────────────────────────────────────────────

/**
 * Compose the hall's view from the live projection and the god's own numbers.
 *
 * `implemented` is asked per verb rather than baked into the projection because
 * `BeliefPowerView.unlocked` fuses "believed enough" AND "implemented" into one
 * boolean — and the hall must tell those two apart to say anything true about
 * what to do next (see `nextHintFor`). The caller reads it from the capability
 * registry, the same single source of truth `castPower` uses.
 *
 * Pure and total: any finite/non-finite numbers, an empty `powers` list and a
 * spirit whose T5.0 fields never got written all produce a drawable view.
 */
export function composeHallView(
  spirit: HallSpiritFacts,
  powers: readonly BeliefPowerView[],
  implemented: (verb: string) => boolean,
): HallView {
  const pedestals: HallPedestalView[] = powers.map((p) => {
    const tier = p.tier ?? 'dormant';
    const rank = TIER_RANK[tier];
    const impl = implemented(p.verb);
    const dims = p.dimensions ?? { faith: 0, understanding: 0, devotion: 0 };
    const threshold = p.threshold > 0 ? p.threshold : 1;
    return {
      domain: p.domain,
      label: p.label,
      blurb: p.blurb,
      verb: p.verb,
      conviction: clamp01(p.conviction),
      threshold: clamp01(p.threshold),
      // The materialization ramp (plan §1.7) — a PAINT value, not state. It
      // walks backward when belief decays, which is correct: conviction is
      // non-monotonic and a pedestal is allowed to go hazy again.
      materialize: clamp01(p.conviction / threshold),
      tier,
      unlocked: p.unlocked,
      reachLine: reachLineFor(p.believers, p.reach),
      dimensions: {
        faith: clamp01(dims.faith),
        understanding: clamp01(dims.understanding),
        devotion: clamp01(dims.devotion),
      },
      nextHint: nextHintFor(tier, impl),
      nodes: NODE_ORDER.map((t, i) => ({
        tier: t,
        label: NODE_LABELS[t],
        // Reached-ness is READ from the projection's tier (highest reached
        // wins), never re-derived from conviction here — one derivation, in
        // `game-query.ts`, is what keeps the hall and MCP agreeing.
        reached: rank >= i + 1,
        hint: NODE_HINTS[t],
      })),
      castBlocked: castBlockedFor(spirit.faded, impl, p.unlocked),
    };
  });

  // The honest empty state WITH a world: the pedestals exist and are drawn, but
  // nobody believes any of it yet, which is worth saying out loud rather than
  // leaving the player to read three empty bars.
  const anyBelief = pedestals.some((p) => p.conviction > 0);
  return {
    spirit: {
      name: spirit.name,
      tierLine: TIER_LINES[spirit.tier],
      massLine: massLineFor(spirit.beliefMass),
      intimacyLine: intimacyLineFor(spirit.intimacy, spirit.tier),
      intimacy: clamp01(Number.isFinite(spirit.intimacy) ? spirit.intimacy : 0),
      faded: spirit.faded,
      fadedLine: spirit.faded ? FADED_LINE : null,
    },
    pedestals,
    emptyLine: pedestals.length === 0
      ? 'NO POWERS ARE BELIEVED OF YOU'
      : anyBelief ? null : 'NO ONE BELIEVES ANY OF THIS OF YOU YET',
  };
}
