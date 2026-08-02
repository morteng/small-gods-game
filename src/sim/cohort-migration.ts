/**
 * cohort-migration.ts — prospect-driven movement of the statistical tier's
 * young adults along the road graph (interaction scaling P3, S3.2).
 *
 * This is the first mechanism in the whole epic that can make one settlement
 * BIGGER than another for a reason. Every cross-settlement scaling fit in the
 * plan is starved of an x-lever because the authored world seeds each POI at
 * exactly its own fiction target (`FICTION_POP_BY_SIZE`), so population is a
 * property of an authored `size` string and nothing the sim does moves it. The
 * plan's "Prerequisites the world does not yet meet" §2 is that finding; this
 * module is the answer to it, and "does the distribution actually spread?" is
 * an acceptance criterion in its own right.
 *
 * ── The prospect, and why it is shaped this way ─────────────────────────────
 *
 *   prospect(p) = prosperitySatisfaction(p) − occupancy(p)
 *   occupancy(p) = population(p) / carryingCapacity(p)
 *
 * Both terms are dimensionless and in [0, ~1] and they are weighted EQUALLY —
 * one full measure of prosperity is worth one full carrying-capacity of
 * crowding. That exchange rate is a stated unit choice, not a tuned number: it
 * is the only weighting that does not privilege one term, and the resulting
 * spread is an OUTPUT to be measured, never a target to be hit.
 *
 * Two properties matter more than the exact form:
 *
 *   • It is SELF-LIMITING. The occupancy term rises as a settlement fills and
 *     falls as it empties, so a flow closes its own gradient. Without it,
 *     migration toward a fixed prosperity gradient never stops and one town
 *     eats the world. Equilibrium is `prosperitySat − pop/carry` equalised
 *     across road-connected neighbours — i.e. a settlement under extraction
 *     holds proportionally fewer people than the one next door.
 *   • Its ONLY live differentiator today is the LORD'S TITHE. Statistical needs
 *     are frozen except for `applyCohortTithe`, so on the shipped world the
 *     measured flows are "people leave the settlements that are being taxed".
 *     That is a real and pleasing mechanism, and it is also the honest ceiling
 *     on how much spread this slice can produce — recorded in the plan doc
 *     rather than papered over with a second invented signal.
 *
 * `carryingCapacity` is the AUTHORED fiction target (`FICTION_POP_BY_SIZE` for
 * the POI's `size`), not built housing: only 2–3 POIs per seed have any dwelling
 * capacity at all (the plan's prerequisite §1), so a housing-based capacity
 * would read as "every settlement is infinitely overcrowded" and drive nothing.
 * Housing is the better long-run signal and should replace this the moment
 * settlements grow streets and houses for themselves.
 *
 * Deterministic: sorted settlement + neighbour folds, largest-remainder
 * `apportion` for the integer split, a carried fractional accumulator instead of
 * an rng draw. No `Math.random`, no `ctx.rng`.
 */
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '@/core/calendar';
import {
  apportion, cohortPopulation, YOUNG_ADULT_BAND_INDEX, type SettlementCohorts,
} from '@/sim/cohorts';

/** How far a prospect is felt: ONE road hop. Migration is a neighbourhood
 *  decision — you move to the next town over, not across the continent — and it
 *  matches `MARKET_PULL_MAX_HOPS`, the only other cross-POI pull in the sim. */
export const MIGRATION_MAX_HOPS = 1;

/**
 * Fraction of a settlement's young-adult band that leaves per fiction DAY at a
 * FULL unit of prospect gradient (the theoretical maximum, never observed — real
 * gradients measure ~0.1–0.3, so realized outflow is well under 2%/day).
 *
 * Denominated per DAY and divided by the day, the discipline S2c imposed on the
 * need economy after finding the per-fire constants were a 360× R8 artifact:
 * the fiction ("at most a twentieth of a town's young adults would up sticks in
 * a day, if the next town over were paradise and this one were hell") is stated
 * directly and survives any tick-rate change.
 */
export const MIGRATION_RATE_PER_DAY = 0.05;

/** Game hours in a fiction day — derived from the calendar, never written 24. */
export const GAME_HOURS_PER_DAY = TICKS_PER_DAY / TICKS_PER_HOUR;

export const MIGRATION_RATE_PER_GAME_HOUR = MIGRATION_RATE_PER_DAY / GAME_HOURS_PER_DAY;

/** One settlement's inputs to the prospect. */
export interface SettlementProspectInput {
  poiId: string;
  /** Total souls, BOTH tiers (the aggregate store's population sum). */
  population: number;
  /** 0..1, higher is better — `1 − needPressure.prosperity`. */
  prosperitySatisfaction: number;
  /** Authored fiction target for the POI's size. Non-positive ⇒ the settlement
   *  reads as exactly at capacity (occupancy 1), so it neither pulls nor sheds
   *  on the crowding term. */
  carryingCapacity: number;
}

/** `prosperitySatisfaction − occupancy`. Unbounded below by design — a grossly
 *  overcrowded settlement should read worse than an empty one by however much
 *  it is overcrowded, and clamping that at 0 would flatten the gradient exactly
 *  where it is most real. */
export function settlementProspect(i: SettlementProspectInput): number {
  const occupancy = i.carryingCapacity > 0 ? i.population / i.carryingCapacity : 1;
  return i.prosperitySatisfaction - occupancy;
}

/** One planned flow. `count` is always ≥ 1 (zero flows are not emitted). */
export interface MigrationFlow {
  srcPoiId: string;
  dstPoiId: string;
  count: number;
}

export interface MigrationStepOptions {
  /** The live statistical tier. Accumulators (`migrationFrac`) are MUTATED. */
  cohorts: ReadonlyMap<string, SettlementCohorts>;
  /** Prospect per settlement; a settlement absent here is neither source nor
   *  destination (no signal ⇒ no decision, the explicit-baseline rule). */
  prospects: ReadonlyMap<string, number>;
  /** Road neighbours within `MIGRATION_MAX_HOPS`, sorted by the caller. */
  neighboursOf: (poiId: string) => readonly string[];
  /** Game hours this step covers. Defaults to 1. */
  hours?: number;
}

/**
 * Decide this step's flows and advance each source's fractional accumulator.
 * MUTATES `migrationFrac` on the source cohorts (and nothing else) — the souls
 * themselves are moved by `applyCohortMigration`, so a caller can inspect the
 * plan before it lands.
 *
 * Flow sizing: a settlement sheds in proportion to its BEST available gradient
 * (`max` over neighbours, not the sum — a soul leaves once, for the best offer),
 * and the resulting integer leaver count is split across the neighbours that
 * beat it by largest-remainder `apportion` weighted by each one's gain.
 */
export function stepCohortMigration(opts: MigrationStepOptions): MigrationFlow[] {
  const hours = opts.hours ?? 1;
  if (hours <= 0 || YOUNG_ADULT_BAND_INDEX < 0) return [];
  const flows: MigrationFlow[] = [];

  for (const srcId of [...opts.cohorts.keys()].sort()) {
    const src = opts.cohorts.get(srcId)!;
    const srcProspect = opts.prospects.get(srcId);
    if (srcProspect === undefined) continue;
    const band = src.bands[YOUNG_ADULT_BAND_INDEX];
    if (!band || band.count <= 0) continue;

    // Gains toward each road neighbour that reads better than home.
    const dsts: string[] = [];
    const gains: number[] = [];
    let bestGain = 0;
    for (const dstId of opts.neighboursOf(srcId)) {
      if (dstId === srcId || !opts.cohorts.has(dstId)) continue;
      const dstProspect = opts.prospects.get(dstId);
      if (dstProspect === undefined) continue;
      const gain = dstProspect - srcProspect;
      if (gain <= 0) continue;
      dsts.push(dstId);
      gains.push(gain);
      if (gain > bestGain) bestGain = gain;
    }
    if (dsts.length === 0) continue;

    const owed = (src.migrationFrac ?? 0)
      + MIGRATION_RATE_PER_GAME_HOUR * hours * bestGain * band.count;
    const leavers = Math.min(band.count, Math.floor(owed));
    src.migrationFrac = owed - leavers;
    if (leavers <= 0) continue;

    apportion(leavers, gains).forEach((n, i) => {
      if (n > 0) flows.push({ srcPoiId: srcId, dstPoiId: dsts[i], count: n });
    });
  }
  return flows;
}

/** Total statistical souls across every settlement — the conservation quantity
 *  a migration must leave untouched. */
export function totalCohortSouls(cohorts: ReadonlyMap<string, SettlementCohorts>): number {
  let n = 0;
  for (const poiId of [...cohorts.keys()].sort()) n += cohortPopulation(cohorts.get(poiId)!);
  return n;
}
