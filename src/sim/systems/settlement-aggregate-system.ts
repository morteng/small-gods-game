/**
 * SettlementAggregateSystem (interaction-scaling P1, S1.1; P5, S5.1) — the one
 * sweep.
 *
 * Runs at `GAME_HOUR_HZ`, the same cadence as the other day-keyed observers
 * (`CohortSystem`'s conservation audit, `LordSystem`), because these numbers are
 * a settlement-scale statistic and nothing gains from resolving them faster than
 * an hour. It rebuilds `state.settlementAggregates` from BOTH population tiers
 * and folds the cross-settlement visitor tally into its per-game-day EMAs.
 *
 * PURE MEASUREMENT — this system writes nothing to the world, the spirits, or
 * the cohorts. Phase 1 changes no gameplay behaviour by construction.
 *
 * WHY IT IS A `SerializableSystem`: it carries the TREND BASELINE (the previous
 * sweep's population + per-spirit meanFaith per settlement), which is exactly
 * the scrub-ghost hazard the WP-D pattern exists for — a committed scrubbed
 * timeline must not measure its next trend against numbers the discarded future
 * had. The aggregates and flux EMAs themselves ride the Snapshot with the store
 * (`state` field), the same split the road stores use.
 *
 * P5 (S5.1): the baseline also carries `meanFaith` per spirit, so Fate's
 * settlement digest (`describeSettlementsForFate`) can report a belief TREND
 * on this system's own honest, per-GAME-HOUR cadence — no separate baseline
 * store written from inside the digest function.
 *
 * Deterministic: no rng, sorted folds inside the builder, sorted serialization.
 */
import type { System, SystemContext } from '@/core/scheduler';
import type { SerializableSystem } from '@/core/system-state';
import type { SpiritId } from '@/core/spirit';
import type { SettlementCohorts } from '@/sim/cohorts';
import type { SettlementFluxTally } from '@/sim/settlement-flux';
import {
  buildSettlementAggregates, settlementBaseline,
  type SettlementAggregateBaseline, type SettlementAggregateStore,
} from '@/sim/settlement-aggregates';
import { GAME_HOUR_HZ } from '@/core/calendar';

/** Serialized baseline entry: `meanFaith` as a spiritId-sorted array. */
type SerializedBaselineEntry = { population: number; meanFaith: [SpiritId, number][] };

export class SettlementAggregateSystem implements System, SerializableSystem {
  readonly name = 'settlement_aggregates';
  readonly tickHz = GAME_HOUR_HZ;

  /** Previous sweep's per-settlement reading (population + per-spirit
   *  meanFaith), or null when there has been no previous sweep. NULL IS
   *  LOAD-BEARING: with no baseline the builder emits no `populationTrend` /
   *  `faithTrend` at all, rather than reporting the first sweep's numbers as
   *  growth. */
  private baseline: Map<string, SettlementAggregateBaseline> | null = null;

  constructor(
    private readonly getStore: () => SettlementAggregateStore | null | undefined,
    private readonly getCohorts: () => ReadonlyMap<string, SettlementCohorts> | null | undefined,
    private readonly getFlux: () => SettlementFluxTally | null | undefined,
  ) {}

  tick(ctx: SystemContext): void {
    const store = this.getStore();
    if (!store) return;

    const aggregates = buildSettlementAggregates(ctx.world, ctx.spirits, {
      now: ctx.now,
      cohorts: this.getCohorts() ?? null,
      baseline: this.baseline,
    });
    this.baseline = settlementBaseline(aggregates);
    store.replace(aggregates, ctx.now);

    // Fold the transient cross-settlement visitor tally into the store's
    // per-game-day EMAs. Self-throttling: a no-op until a full window elapsed.
    const flux = this.getFlux();
    if (flux) store.foldFlux(flux, ctx.now);
  }

  serialize(): unknown {
    return {
      baseline: this.baseline
        ? [...this.baseline.entries()]
            .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
            .map(([poiId, entry]): [string, SerializedBaselineEntry] => [
              poiId,
              {
                population: entry.population,
                meanFaith: [...entry.meanFaith.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
              },
            ])
        : null,
    };
  }

  hydrate(state: unknown): void {
    const s = state as { baseline?: [string, SerializedBaselineEntry][] | null } | undefined;
    this.baseline = Array.isArray(s?.baseline)
      ? new Map(s.baseline.map(([poiId, entry]) => [
          poiId,
          { population: entry.population, meanFaith: new Map(entry.meanFaith) },
        ]))
      : null;
  }
}
