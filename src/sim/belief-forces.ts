/**
 * belief-forces.ts — the PURE LEAF holding every constant the belief economy's
 * per-fire forces are made of, plus the congregation curve they share.
 *
 * WHY IT EXISTS (interaction scaling P3, S3.1): the mean-field cohort tier has to
 * feel *the same forces* the named tier feels, which means its coefficients must
 * be derived from the named tier's own constants — never re-typed as literals
 * beside them. Those constants lived privately in `@/sim/npc-sim` (the faith
 * half) and `@/sim/systems/belief-propagation-system` (the communion half), and
 * `@/sim/cohort-drift` cannot import a system module without dragging the
 * scheduler + world into a leaf. So they move here, and BOTH original modules
 * are REPOINTED at this file — a re-export from the original does not cut the
 * import edge (`@/sim/divine-costs` is the shipped precedent; see CLAUDE.md).
 *
 * This module imports NOTHING. Every value in it is a rate per 1 Hz fire, or a
 * dimensionless threshold — the units the named tier ticks in.
 */

// ── Faith forces (were private in `@/sim/npc-sim`, unchanged values) ─────────

/** Baseline faith erosion per fire, scaled by the mortal's skepticism. */
export const FAITH_DECAY_BASE = 0.002;

/** Peak faith gained per fire from a collapsing need, scaled by desperation ×
 *  piety. */
export const NEED_FAITH_BOOST = 0.001;

/** EVERY need above this → secularization pressure (VISION §4's comfort trap). */
export const COMFORT_THRESHOLD = 0.6;

/** ANY need below this → desperation pressure. */
export const DESPERATION_THRESHOLD = 0.4;

/** Max extra faith decay from comfort, per fire. Resisted by devotion. */
export const COMFORT_DECAY = 0.004;

/** Extra faith decay per fire while a plea stands unanswered. Resisted by
 *  devotion. NOT part of the mean field: the statistical tier has no activity,
 *  so it never kneels — `SettlementCohorts.pleas` is still inert. See
 *  `@/sim/cohort-drift` for the written model gap. */
export const ABANDON_DECAY = 0.006;

// ── Communion (were private in `belief-propagation-system.ts`) ───────────────

/** Deterministic communion inflow coefficient. The equilibrium arithmetic this
 *  number was tuned to lives in `belief-propagation-system.ts`'s header block —
 *  read it there before touching this. */
export const COMMUNION_RATE = 0.0092;

/** Fraction of a faith delta that also lands on understanding. */
export const UNDERSTANDING_FRAC = 0.3;

/** Fraction of a faith delta that also lands on devotion. */
export const DEVOTION_FRAC = 0.15;

/** A neighbour's faith must exceed this for their belief to reach you at all
 *  (the per-EDGE influence gate in `trustWeightedBeliefConnections`). */
export const INFLUENCE_THRESHOLD = 0.3;

/**
 * Congregation strength from the trust-weighted believing neighbourhood S.
 * The positive root of `g(1 + g) = S`, i.e. `g(S) = (√(1+4S) − 1) / 2` — LINEAR
 * as S → 0 and √-ASYMPTOTIC as S → ∞ (scaling P2b, S2b.1). Concave and
 * unbounded: a bigger congregation always pays, just less per head.
 */
export function congregationCurve(s: number): number {
  return (Math.sqrt(1 + 4 * s) - 1) / 2;
}
