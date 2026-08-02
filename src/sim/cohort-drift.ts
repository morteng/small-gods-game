/**
 * cohort-drift.ts — the MEAN FIELD of the belief economy (interaction scaling
 * P3, S3.1). Gives the statistical population tier the same forces the named
 * tier feels, so a settlement nobody is looking at evolves instead of freezing.
 *
 * ── The representation, stated plainly ──────────────────────────────────────
 * A `CohortBelief` record is read here as **`believerCount` souls who each hold
 * the record's MEAN belief** (`sumFaith / believerCount`, and likewise for
 * understanding/devotion). That denominator is `believerCount` and NOT
 * `band.count`, and the reason is load-bearing:
 *
 *   • The named tier's forces only ever touch souls that HOLD a belief record —
 *     `tickNpcEntity` iterates `Object.values(p.beliefs)`, and `communeFrom`
 *     only reinforces beliefs the NPC already has. A soul with no record for a
 *     spirit is untouched by decay, desperation AND communion.
 *   • `seedStatisticalCohorts` writes exactly `believerCount` holders per band
 *     (`sumFaith = n × STAT_SEED_FAITH`), so at seed the two agree by
 *     construction.
 *   • Dividing by `band.count` instead would spread one believer's faith over
 *     its heathen neighbours and then decay all of them — a settlement of 9
 *     believers among 36 souls would read as 36 souls at faith 0.045 and
 *     annihilate in three game-minutes. That is an artifact of the denominator,
 *     not a property of the belief economy.
 *
 * `bandMeanObservation` (materialization) keeps dividing by `band.count` — that
 * is the DILUTION convention a drawn soul is materialized at, and it stays
 * exactly as shipped. The two denominators answer different questions: "what
 * does an average resident believe" (materialization) vs "what does a believer
 * believe" (the dynamics). S3.3's guard pins that a drawn soul still tracks the
 * DRIFTED sums either way.
 *
 * ── Which forces, and which are deliberately absent ─────────────────────────
 * Present, all derived from `@/sim/belief-forces` (the named tier's own
 * constants — never a re-typed literal) at `FIRES_PER_GAME_HOUR` fires per call:
 *   1. baseline faith decay        (FAITH_DECAY_BASE × mean skepticism)
 *   2. comfort decay               (every band need above COMFORT_THRESHOLD)
 *   3. desperation boost           (any band need below DESPERATION_THRESHOLD)
 *   4. understanding/devotion fade (UNDERSTANDING_FADE / DEVOTION_FADE — the
 *                                   proportional drain that gives the belief
 *                                   economy an equilibrium instead of a 9×
 *                                   ceiling; must be here or the two tiers
 *                                   disagree about what a believer is worth)
 *   5. communion                   (COMMUNION_RATE × g(S), the S2b.1 curve)
 *
 * ABSENT, and each is a stated model gap rather than an oversight:
 *   • `ABANDON_DECAY` — the statistical tier has no activity and never kneels
 *     (`SettlementCohorts.pleas` is still inert), so there is no standing plea
 *     to bleed against.
 *   • the STOCHASTIC `propagateBeliefFrom` channel, which is what SEEDS a belief
 *     in a soul that holds none. Without it the mean field cannot convert
 *     heathens: a band with no record for a spirit never gains one, and a band
 *     whose faith lapses never returns. Conversion at scale remains a named-tier
 *     / divine-action channel. This is the biggest gap in the model and the
 *     first thing a later slice should close.
 *   • need dynamics. Band needs are read, never written — the statistical tier
 *     has no `work`/`sleep`/`socialize` channels, so decaying its needs without
 *     them would starve every settlement to zero on all four axes within a day
 *     and make `needPressure` meaningless. `applyCohortTithe` (LordSystem) stays
 *     the one mean-field need force.
 *
 * ── Where this KNOWINGLY diverges from the named tier ───────────────────────
 * `trustWeightedBeliefConnections` gates each EDGE on the neighbour's faith
 * exceeding `INFLUENCE_THRESHOLD` (0.3). Re-applying that gate to a homogeneous
 * band mean turns it into a hard bifurcation at exactly f = 0.3 — below it the
 * whole settlement's congregation vanishes at once. That is an artifact of the
 * delta-function assumption (a real population has a FRACTION above 0.3 which
 * varies smoothly), so the mean field takes the tier's own membership
 * definition instead: the congregation is the settlement's `believerCount`
 * (faith ≥ `BELIEVER_THRESHOLD`), as the plan specifies. CONSEQUENCE, measured
 * and pinned in `tests/unit/cohort-drift-parity.test.ts`: between
 * BELIEVER_THRESHOLD (0.15) and INFLUENCE_THRESHOLD (0.3) the mean field
 * SUSTAINS a congregation the named tier would let wither. Above 0.3 the two
 * agree, which is where the tier-parity gate is measured.
 *
 * Deterministic: no rng, sorted spirit folds, integer counts untouched (the
 * conservation ledger audits counts, and drift moves none — see CohortSystem).
 */
import type { SpiritId } from '@/core/spirit';
import type { NpcNeeds } from '@/core/types';
import { GAME_HOUR_HZ } from '@/core/calendar';
import { clamp01 } from '@/core/math';
import { BELIEVER_THRESHOLD, isDurable } from '@/sim/believers';
import { beliefContribution, type SettlementCohorts } from '@/sim/cohorts';
import { MAX_SOCIAL_DEGREE } from '@/sim/systems/npc-encounter-system';
import {
  FAITH_DECAY_BASE, NEED_FAITH_BOOST, COMFORT_THRESHOLD, DESPERATION_THRESHOLD,
  COMFORT_DECAY, COMMUNION_RATE, UNDERSTANDING_FRAC, DEVOTION_FRAC,
  UNDERSTANDING_FADE, DEVOTION_FADE, congregationCurve,
} from '@/sim/belief-forces';

/**
 * Fire rate of the two named-tier belief systems (`NpcSimSystem` and
 * `BeliefPropagationSystem` both declare `tickHz = 1`). The mean field's whole
 * conversion factor hangs off this, so `tests/unit/cohort-drift-parity.test.ts`
 * asserts both systems still tick here — a system that changed its rate without
 * this constant following would silently mis-scale every cohort in the world.
 */
export const NAMED_BELIEF_HZ = 1;

/**
 * Named-tier fires inside one drift call. DERIVED from the two rates, never
 * written as 3600 — the same discipline `FIRES_PER_DAY` (`@/sim/npc-sim`) was
 * given after S2c found the per-fire constants were a 360× R8 artifact.
 */
export const FIRES_PER_GAME_HOUR = NAMED_BELIEF_HZ / GAME_HOUR_HZ;

/**
 * The population means the mean field stands in for a mortal's personality with.
 * `personalityFromSeed` (`@/sim/npc-sim`) draws skepticism / sociability from
 * `rng.next()` — uniform on [0,1), mean 0.5 — and piety from the same draw plus
 * a role bonus in [-0.1, +0.3] that averages ≈ +0.04 over the eight roles, which
 * is inside the noise of the assumption and deliberately not modelled. Trust is
 * 0.5 for the same reason the equilibrium block in
 * `belief-propagation-system.ts` uses it: it IS that block's median-NPC anchor,
 * and holding the two arithmetics on one number is the point.
 */
export interface CohortDriftParams {
  skepticism: number;
  piety: number;
  sociability: number;
  trust: number;
}

export const MEAN_PERSONALITY: Readonly<CohortDriftParams> = {
  skepticism: 0.5, piety: 0.5, sociability: 0.5, trust: 0.5,
};

/** The NAMED tier's standing in a settlement, held FIXED across one drift call:
 *  named souls are ticked by their own systems on their own clock, so the mean
 *  field reads them as a once-an-hour boundary condition rather than trying to
 *  co-integrate them. A mixed congregation is one congregation — a statistical
 *  soul's faith is reinforced by the named believers next door. */
export interface NamedCongregation {
  believers: number;
  faithSum: number;
}

export interface CohortDriftOptions {
  /** Named-tier believers per spirit in THIS settlement. Absent ⇒ statistical
   *  tier alone (which is what a probe / a settlement with no named residents
   *  actually has). */
  named?: ReadonlyMap<SpiritId, NamedCongregation> | null;
  /** Named-tier fires to integrate. Defaults to one game hour. */
  fires?: number;
  /** Override the population-mean personality (tests isolate one channel by
   *  moving these; the live system always uses `MEAN_PERSONALITY`). */
  params?: Partial<CohortDriftParams>;
}

/** One band's live drift state for one spirit. */
interface BandState {
  bandIndex: number;
  /** Holders = `believerCount` at entry; never changes during the call. */
  holders: number;
  faith: number;
  understanding: number;
  devotion: number;
  /** The band's WORST need (satisfaction, lower = worse) — the same direction
   *  signal `lowestNeed` gives the named tier (VISION §9 row 11). */
  worstNeed: number;
  /** Set when the mean fell under `BELIEVER_THRESHOLD`: the whole record lapses
   *  (homogeneous population ⇒ all holders cross together) and stops drifting. */
  lapsed: boolean;
}

/** The worst (lowest) of a band's four need means — same fixed key order as
 *  `lowestNeed` / `prayerSubject`, so ties break identically across tiers. */
function worstOf(needs: NpcNeeds): number {
  return Math.min(needs.safety, needs.prosperity, needs.community, needs.meaning);
}

/**
 * Drift one settlement's statistical belief forward by `fires` named-tier fires
 * (default: one game hour). Mutates `sc` in place.
 *
 * Integration is EXPLICIT EULER AT THE NAMED TIER'S OWN STEP SIZE — one substep
 * per named-tier fire, in the named tier's own order (all decay, then all
 * communion, matching `NpcSimSystem` running before `BeliefPropagationSystem`).
 * That is deliberately not a closed form: the tier-parity gate compares this
 * against the real named pipeline, and a coarser step would spend its budget
 * arguing about integration error instead of about the model.
 *
 * Counts (`band.count`, `believerCount` while the record lives) are NOT touched
 * — drift is a belief-mass flow, not a population flow, and CohortSystem's
 * conservation audit is over counts.
 */
export function driftSettlementBelief(
  sc: SettlementCohorts,
  opts: CohortDriftOptions = {},
): void {
  const fires = opts.fires ?? FIRES_PER_GAME_HOUR;
  if (fires <= 0) return;
  const p: CohortDriftParams = { ...MEAN_PERSONALITY, ...opts.params };
  const baseDecay = FAITH_DECAY_BASE * p.skepticism;
  const openness = 1 - 0.5 * p.skepticism;
  const communionCoeff = COMMUNION_RATE * p.sociability * openness;

  // Sorted spirit fold — replay-stable float sums regardless of key order.
  const spiritIds = new Set<SpiritId>();
  for (const band of sc.bands) for (const sid of Object.keys(band.belief)) spiritIds.add(sid);

  for (const sid of [...spiritIds].sort()) {
    const states: BandState[] = [];
    for (let i = 0; i < sc.bands.length; i++) {
      const rec = sc.bands[i].belief[sid];
      if (!rec || rec.believerCount <= 0) continue;
      states.push({
        bandIndex: i,
        holders: rec.believerCount,
        faith: rec.sumFaith / rec.believerCount,
        understanding: rec.sumU / rec.believerCount,
        devotion: rec.sumD / rec.believerCount,
        worstNeed: worstOf(sc.bands[i].needs),
        lapsed: false,
      });
    }
    if (states.length === 0) continue;

    const named = opts.named?.get(sid);
    const namedBelievers = named?.believers ?? 0;
    const namedFaithSum = named?.faithSum ?? 0;

    for (let step = 0; step < fires; step++) {
      // ── pass 1: the faith forces the named tier applies in NpcSimSystem ────
      for (const s of states) {
        if (s.lapsed) continue;
        let decay = baseDecay;
        if (s.worstNeed > COMFORT_THRESHOLD) {
          decay += COMFORT_DECAY
            * ((s.worstNeed - COMFORT_THRESHOLD) / (1 - COMFORT_THRESHOLD))
            * (1 - s.devotion);
        }
        let f = clamp01(s.faith - decay);
        if (s.worstNeed < DESPERATION_THRESHOLD) {
          const desperation = (DESPERATION_THRESHOLD - s.worstNeed) / DESPERATION_THRESHOLD;
          f = clamp01(f + NEED_FAITH_BOOST * desperation * p.piety);
        }
        s.faith = f;
        // The passive fade of comprehension and practice, in the named tier's
        // own order (`tickNpcEntity` applies it after the faith line, inside
        // the same per-belief loop, so the comfort resistance above reads the
        // pre-fade devotion on BOTH sides).
        s.understanding = clamp01(s.understanding * (1 - UNDERSTANDING_FADE));
        s.devotion = clamp01(s.devotion * (1 - DEVOTION_FADE));
      }

      // ── pass 2: communion, off the settlement's congregation as it now is ──
      // S mirrors the named tier's `trustWeightedBeliefConnections` for a mutual
      // congregation of N: S = (N−1) × trust × faith, capped by the shipped
      // per-mortal edge budget (`MAX_SOCIAL_DEGREE`) because a mortal cannot
      // hold more neighbours than that however big its town grows — the same
      // structural ceiling Phase 2a measured on the encounter channel.
      let believers = namedBelievers;
      let faithSum = namedFaithSum;
      for (const s of states) {
        if (s.lapsed) continue;
        believers += s.holders;
        faithSum += s.holders * s.faith;
      }
      const g = believers > 0
        ? congregationCurve(
          p.trust * Math.min(Math.max(believers - 1, 0), MAX_SOCIAL_DEGREE) * (faithSum / believers),
        )
        : 0;
      for (const s of states) {
        if (s.lapsed) continue;
        if (g > 0) {
          const inflow = communionCoeff * g * (1 - s.faith);
          if (inflow > 0) {
            s.faith = Math.min(1, s.faith + inflow);
            s.understanding = Math.min(1, s.understanding + inflow * UNDERSTANDING_FRAC);
            s.devotion = Math.min(1, s.devotion + inflow * DEVOTION_FRAC);
          }
        }
        // Homogeneous lapse: every holder crosses the believer line together, so
        // the record stops being a congregation at all. The residual (< 0.15 per
        // holder) is dropped rather than left as phantom believers with no
        // faith — `believerCount` feeds god tiers and the pantheon, and a god
        // holding followers who believe nothing is the worse lie. Irreversible,
        // because the mean field has no conversion channel (see the header).
        if (s.faith < BELIEVER_THRESHOLD) s.lapsed = true;
      }
    }

    // ── write back: every derived quantity from (holders, f, u, d) ───────────
    for (const s of states) {
      const rec = sc.bands[s.bandIndex].belief[sid];
      if (!rec) continue;
      if (s.lapsed) {
        rec.sumFaith = 0; rec.sumU = 0; rec.sumD = 0; rec.sumContribution = 0;
        rec.believerCount = 0; rec.durableCount = 0;
        continue;
      }
      const belief = { faith: s.faith, understanding: s.understanding, devotion: s.devotion };
      rec.sumFaith = s.holders * s.faith;
      rec.sumU = s.holders * s.understanding;
      rec.sumD = s.holders * s.devotion;
      rec.sumContribution = s.holders * beliefContribution(belief);
      rec.durableCount = isDurable(belief) ? s.holders : 0;
    }
  }
}
