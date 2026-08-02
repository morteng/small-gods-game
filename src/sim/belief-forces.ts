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

// ── The fire, and the day (moved here from `@/sim/npc-sim`) ─────────────────
//
// These are the DENOMINATOR every rate below is made of, so they belong beside
// them rather than in a module that imports the world. `npc-sim.ts` is
// REPOINTED at this file and re-exports both for its existing callers.

/** One named-tier belief fire, in sim-milliseconds (`NpcSimSystem.tickHz` 1). */
export const SIM_TICK_MS = 1000;

/** 1 Hz fires in one solar day. Under 1:1 realtime a calendar day IS a 24-hour
 *  solar day and a fire is `SIM_TICK_MS`, so this is the seconds in a day —
 *  derived rather than written as 86,400 so a tick-rate change carries. */
export const FIRES_PER_DAY = (24 * 60 * 60 * 1000) / SIM_TICK_MS;

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

// ── Passive fade of understanding and devotion ───────────────────────────────
//
// WHY THESE EXIST. Faith has had a drain since the first commit; understanding
// and devotion never did. Every write to them was `Math.min(1, x + delta·FRAC)`
// — monotonic — so the only forces that could ever lower them were EVENTS: a
// miracle drawing on the devotion pool (`spendDevotionAt`), the smite penalty,
// and LLM writeback deltas. Nothing touched understanding at all. Measured on
// the default world: both pinned at exactly 1.0000 by game-hour 2 and stayed
// byte-identical for the next 46 hours, so `beliefContribution =
// f·(1+2u)(1+2d)` was permanently 9f and the belief economy had a CEILING
// where it should have had an EQUILIBRIUM. These two rates are that drain.
//
// WHY PROPORTIONAL, NOT FLAT. The communion inflow does not depend on u or d
// (it is `A·g(S)·(1−f)`, all faith terms), so a FLAT drain would have no
// interior fixed point: `du/dt = ι − λ` is a knife edge that pins u at 1 or
// runs it to 0 — the ceiling we are removing, upside down. A drain
// proportional to what is held gives `du/dt = ι − λ·u`, hence
//
//     u* = ι_u / λ_u        d* = ι_d / λ_d
//
// and a mortal who stops hearing about the god loses 1/e of what it understood
// in 1/λ days.
//
// WHY THE PER-DAY NUMBERS ARE LARGE, which is the part that looks wrong and is
// not. AT FAITH EQUILIBRIUM THE COMMUNION INFLOW EQUALS THE FAITH DECAY — that
// is what equilibrium means — so ι = FAITH_DECAY_BASE × skepticism ≈ 0.001 per
// fire for the median mortal (skepticism 0.5), plus any comfort/abandonment
// decay on top. `UNDERSTANDING_FRAC` (0.3) and `DEVOTION_FRAC` (0.15) of that
// land on u and d, i.e. the two are PUMPED at ≈ 0.0003 and 0.00015 per fire —
// **25.9 and 13.0 whole measures per day**. A drain that "fades slowly" in
// calendar terms cannot hold anything below 1 against that; to keep u* under 1
// at all, λ_u must exceed 25.9/day. So these are denominated per day (house
// rule — never a raw per-fire literal, never the number 86,400) but they are
// TENS per day, i.e. hour-scale e-folding times. That is the honest consequence
// of a belief loop that is per-fire REAL-TIME by design (CLAUDE.md: "the
// belief/need economy stays REAL-TIME per-fire") while the need economy is
// day-keyed: belief churns fast in both directions, and until now only the
// inflow half of that churn existed.
//
// WHY THE TWO RATES DIFFER — from the fiction and from the code, both:
//   • FICTION. Understanding is comprehension; devotion is practice. You go on
//     knowing what a god is for long after you stop keeping its rites, so
//     practice lapses faster than comprehension: λ_d > λ_u.
//   • CODE. Understanding has NO other downward path — this is its only drain,
//     so it is set the gentler of the two. Devotion already has three
//     (`spendDevotionAt`'s pro-rata pool draw for miracles, the smite penalty,
//     writeback), so a passive drain COMPOUNDS with a live spend economy: it is
//     not just lower on average, it is lower exactly when a god has been
//     spending. That is deliberate — devotion is the half a god SPENDS, and a
//     god that spends it should have to re-earn it. It refills off the same
//     communion pump at half understanding's fraction, with a time constant of
//     1/λ_d days (≈ 20 game-minutes here), so a miracle's cost is real but
//     recoverable within the hour rather than permanent.
//
// MEASURED, and reproducible with `npx tsx scripts/probe-belief-decay.ts`: the
// equilibria, the per-believer contribution, the tier-ladder timings for three
// candidate rate pairs on the default world (seed 12345, drift live), and the
// Track 5 comfort result are recorded under "Phase 3 addendum" in
// `docs/superpowers/plans/2026-08-01-interaction-scaling-plan.md`. The headline:
// a believer at rest is worth 2.71 instead of 8.62, `major` (200) stops being
// handed to both rivals in the first three game-hours, and `COMFORT_DECAY`'s
// (1 − devotion) resistance goes from EXACTLY 0.000 — VISION §4's secularization
// trap was unreachable by construction — to 0.604.

/** Proportional fade of `understanding` per DAY, applied per fire as
 *  `u ← u·(1 − UNDERSTANDING_FADE_PER_DAY/FIRES_PER_DAY)`. 48/day ⇒ an
 *  e-folding time of 30 game-minutes for a mortal hearing nothing, and (against
 *  the ≈25.9/day communion pump) an equilibrium u* ≈ 0.54 for a congregation
 *  resting at its faith fixed point. */
export const UNDERSTANDING_FADE_PER_DAY = 48;

/** Proportional fade of `devotion` per DAY. 1.5× understanding's — practice
 *  lapses faster than comprehension — which against the ≈13.0/day pump (half
 *  understanding's fraction of the same inflow) rests at d* ≈ 0.18. */
export const DEVOTION_FADE_PER_DAY = 72;

/** Per-fire fade fractions. Denominated per day and DIVIDED BY THE DAY. */
export const UNDERSTANDING_FADE = UNDERSTANDING_FADE_PER_DAY / FIRES_PER_DAY;
export const DEVOTION_FADE = DEVOTION_FADE_PER_DAY / FIRES_PER_DAY;

/**
 * Congregation strength from the trust-weighted believing neighbourhood S.
 * The positive root of `g(1 + g) = S`, i.e. `g(S) = (√(1+4S) − 1) / 2` — LINEAR
 * as S → 0 and √-ASYMPTOTIC as S → ∞ (scaling P2b, S2b.1). Concave and
 * unbounded: a bigger congregation always pays, just less per head.
 */
export function congregationCurve(s: number): number {
  return (Math.sqrt(1 + 4 * s) - 1) / 2;
}
