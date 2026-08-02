/**
 * CohortDynamicsSystem (interaction scaling P3, S3.1 + S3.2) — the statistical
 * population tier's LAWS. Before this, `GameState.cohorts` was inert between
 * materializations: `CohortSystem` asserted its counts never changed, and its
 * belief never changed either, so a settlement nobody was looking at was frozen
 * in amber. This is the mean-field layer of the brainstorm's §5 — the LOD tier
 * evolving under the same forces the named tier feels.
 *
 * Runs at `GAME_HOUR_HZ`, the day-keyed observer cadence (`CohortSystem`,
 * `SettlementAggregateSystem`, `LordSystem`), and REGISTERED AFTER the aggregate
 * sweep so it reads this hour's numbers. Two steps, in this order:
 *
 *   1. `driftSettlementBelief` — belief mass evolves (decay / comfort /
 *      desperation / communion). Counts are untouched.
 *   2. `stepCohortMigration` — young adults move toward better prospects along
 *      the road graph. Counts move, and every move is metered into the flux
 *      tally and LEDGERED as a `souls_migrated` event so CohortSystem's
 *      conservation audit can explain it. Migrants carry their belief.
 *
 * Order matters: a migrant should leave with the belief it holds NOW, not the
 * belief it held an hour ago.
 *
 * STATELESS by design — the drift's only memory is the cohorts themselves and
 * the migration's only memory is `SettlementCohorts.migrationFrac`, both of
 * which ride the Snapshot with `state.cohorts`. So there is no scrub-ghost
 * baseline to register with `state.systemState`: a scrubbed timeline inherits
 * exactly the cohorts it had at that tick and nothing else.
 *
 * TIME SKIP: `applySkip` is a closed-form jump that ticks nothing, and it
 * already leaves the NAMED tier's belief frozen ("Survivors are untouched
 * (frozen belief) and no power regenerates"). The statistical tier freezing
 * across the same jump is therefore tier PARITY, not a gap — no
 * `projectRoadClassesOverSkip`-style projection is owed here until the named
 * tier gets one. Pinned in `tests/unit/cohort-drift-parity.test.ts`.
 *
 * Deterministic: no rng, sorted folds, integer apportionment.
 */
import type { System, SystemContext } from '@/core/scheduler';
import type { SpiritId } from '@/core/spirit';
import type { GameMap, POI } from '@/core/types';
import { GAME_HOUR_HZ } from '@/core/calendar';
import {
  FICTION_POP_BY_SIZE, YOUNG_ADULT_BAND_INDEX, transferCohortSouls,
  type SettlementCohorts,
} from '@/sim/cohorts';
import { driftSettlementBelief, type NamedCongregation } from '@/sim/cohort-drift';
import {
  MIGRATION_MAX_HOPS, settlementProspect, stepCohortMigration,
} from '@/sim/cohort-migration';
import type { SettlementAggregateStore } from '@/sim/settlement-aggregates';
import type { SettlementFluxTally } from '@/sim/settlement-flux';
import { roadNeighbours } from '@/world/road-neighbours';

export class CohortDynamicsSystem implements System {
  readonly name = 'cohort_dynamics';
  readonly tickHz = GAME_HOUR_HZ;

  constructor(
    private readonly getCohorts: () => ReadonlyMap<string, SettlementCohorts> | null | undefined,
    private readonly getAggregates: () => SettlementAggregateStore | null | undefined,
    private readonly getMap: () => GameMap | null | undefined,
    private readonly getFlux: () => SettlementFluxTally | null | undefined = () => null,
  ) {}

  tick(ctx: SystemContext): void {
    const cohorts = this.getCohorts();
    if (!cohorts || cohorts.size === 0) return;
    const aggregates = this.getAggregates();

    // ── S3.1: belief drift ───────────────────────────────────────────────────
    for (const poiId of [...cohorts.keys()].sort()) {
      const sc = cohorts.get(poiId)!;
      driftSettlementBelief(sc, { named: namedCongregationFor(sc, aggregates) });
    }

    // ── S3.2: migration ──────────────────────────────────────────────────────
    const map = this.getMap();
    if (!map || !aggregates || aggregates.size() === 0) return;

    const prospects = new Map<string, number>();
    const sizeByPoi = new Map<string, NonNullable<POI['size']>>();
    for (const poi of map.worldSeed?.pois ?? []) sizeByPoi.set(poi.id, poi.size ?? 'small');
    for (const poiId of [...cohorts.keys()].sort()) {
      const agg = aggregates.get(poiId);
      if (!agg) continue;
      const size = sizeByPoi.get(poiId);
      prospects.set(poiId, settlementProspect({
        poiId,
        population: agg.population.named + agg.population.statistical,
        prosperitySatisfaction: 1 - agg.needPressure.prosperity,
        carryingCapacity: size === undefined ? 0 : FICTION_POP_BY_SIZE[size],
      }));
    }

    // Road neighbours are a pure read over a static graph within a tick; memoize
    // so a world of N settlements runs one search per settlement, not N².
    const neighbourCache = new Map<string, string[]>();
    const neighboursOf = (poiId: string): readonly string[] => {
      let list = neighbourCache.get(poiId);
      if (!list) {
        list = roadNeighbours(map, poiId, MIGRATION_MAX_HOPS).map(n => n.poiId);
        neighbourCache.set(poiId, list);
      }
      return list;
    };

    const flows = stepCohortMigration({ cohorts, prospects, neighboursOf });
    if (flows.length === 0) return;
    const flux = this.getFlux();
    for (const flow of flows) {
      const src = cohorts.get(flow.srcPoiId);
      const dst = cohorts.get(flow.dstPoiId);
      if (!src || !dst) continue;
      const moved = transferCohortSouls(
        src, dst, YOUNG_ADULT_BAND_INDEX, flow.count, spiritsTracked(src),
      );
      if (moved <= 0) continue;
      for (let k = 0; k < moved; k++) flux?.noteMigrant(flow.srcPoiId, flow.dstPoiId);
      ctx.log.append({
        type: 'souls_migrated',
        srcPoiId: flow.srcPoiId, dstPoiId: flow.dstPoiId, count: moved,
      });
    }
  }
}

/** Every spirit any of this settlement's bands tracks, sorted — the same spirit
 *  set `drawCohortSouls` gives a materialized soul, so a migrant and a
 *  materialized extra carry belief in exactly the same gods. */
function spiritsTracked(sc: SettlementCohorts): SpiritId[] {
  const ids = new Set<SpiritId>();
  for (const band of sc.bands) for (const sid of Object.keys(band.belief)) ids.add(sid);
  return [...ids].sort();
}

/**
 * The NAMED tier's congregation in this settlement, per spirit — the mean
 * field's once-an-hour boundary condition (see `NamedCongregation`). Derived
 * from the aggregate store (which folds BOTH tiers) minus this settlement's own
 * statistical share, so it costs no extra sweep: the store already paid for the
 * one pass, and S1.1's whole point was that everyone reads it instead of
 * re-walking the world. Returns null when there is no sweep to read yet — the
 * drift then runs on the statistical tier alone, which is exactly what a
 * settlement with no named residents actually has.
 */
function namedCongregationFor(
  sc: SettlementCohorts,
  aggregates: SettlementAggregateStore | null | undefined,
): Map<SpiritId, NamedCongregation> | null {
  const agg = aggregates?.get(sc.poiId);
  if (!agg) return null;
  const total = agg.population.named + agg.population.statistical;
  if (total <= 0) return null;
  const out = new Map<SpiritId, NamedCongregation>();
  for (const sid of Object.keys(agg.believers).sort()) {
    const stats = agg.believers[sid];
    let statBelievers = 0, statFaith = 0;
    for (const band of sc.bands) {
      const rec = band.belief[sid];
      if (!rec) continue;
      statBelievers += rec.believerCount;
      statFaith += rec.sumFaith;
    }
    // `meanFaith` dilutes over the whole settlement, so × total recovers Σ faith.
    const believers = Math.max(0, stats.count - statBelievers);
    const faithSum = Math.max(0, stats.meanFaith * total - statFaith);
    if (believers > 0) out.set(sid, { believers, faithSum });
  }
  return out;
}
