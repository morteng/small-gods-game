/**
 * settlement-digest-baseline.ts — interaction scaling P5 (S5.1): the previous
 * Fate settlement digest's per-spirit meanFaith, so `describeSettlementsForFate`
 * can report a belief TREND without inventing one.
 *
 * `SettlementAggregate.populationTrend` already carries a population trend
 * (threaded by `SettlementAggregateSystem`'s own internal baseline, an hourly
 * scheduler cadence). Belief trend has no such upstream source — the aggregate
 * store only ever holds the LATEST sweep's `meanFaith`. This store fills that
 * gap the same way `rivalFollowerDelta` does (`@/sim/rival-claims`): NO
 * baseline for a (poiId, spiritId) pair ⇒ NO trend reported, never "growth" by
 * default.
 *
 * Written inline by `describeSettlementsForFate` at the moment Fate looks — not
 * on a scheduler tick — so it lives as a plain `GameState` field mutated by a
 * plain function, the `FateArcStore.recomputeGoals` precedent (called from
 * `FateBrainService.deliberate`), rather than a `SerializableSystem` registered
 * on `state.systemState` (that machinery exists for scheduler cadences this
 * store doesn't have).
 *
 * REPLACEABLE, not identity-stable: nothing outside `GameState` holds a direct
 * reference, so `resetState` swaps in a fresh one on quit-to-title exactly like
 * `settlementAggregates` does. Snapshot-authoritative like the other P1 stores
 * — a scrub restores exactly the baseline Fate had at that tick, so a scrubbed
 * timeline can't inherit a discarded future's belief numbers as "the trend."
 */
import type { SpiritId } from '@/core/spirit';

/** poiId-sorted, then spiritId-sorted `[poiId, [[spiritId, meanFaith], ...]][]`. */
export type SettlementDigestBaselineSnapshot = [string, [SpiritId, number][]][];

export class FateSettlementDigestBaseline {
  private byPoi = new Map<string, Map<SpiritId, number>>();

  /** meanFaith of `spiritId` in `poiId` as of the last digest Fate read, or
   *  `undefined` if this pair was never recorded — the caller's cue to report
   *  no trend at all. */
  get(poiId: string, spiritId: SpiritId): number | undefined {
    return this.byPoi.get(poiId)?.get(spiritId);
  }

  /** Overwrite one settlement's snapshot with the CURRENT digest's numbers, for
   *  the next time Fate looks. Takes ownership of nothing — copies the map. */
  set(poiId: string, meanFaithBySpirit: ReadonlyMap<SpiritId, number>): void {
    this.byPoi.set(poiId, new Map(meanFaithBySpirit));
  }

  size(): number {
    return this.byPoi.size;
  }

  serialize(): SettlementDigestBaselineSnapshot {
    return [...this.byPoi.keys()].sort().map((poiId) => [
      poiId,
      [...this.byPoi.get(poiId)!.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
    ]);
  }

  static fromSnapshot(s: SettlementDigestBaselineSnapshot | undefined): FateSettlementDigestBaseline {
    const store = new FateSettlementDigestBaseline();
    for (const [poiId, entries] of s ?? []) store.byPoi.set(poiId, new Map(entries));
    return store;
  }
}
