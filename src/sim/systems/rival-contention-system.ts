/**
 * RivalContentionSystem — the low-Hz driver of the persistent contention ladder.
 *
 * Each tick it censuses the live per-settlement believer balance, folds in the
 * `rival_dispute` events logged since the last step, steps the `ContentionLedger`
 * (heat integration + hysteresis), and appends a `contention_escalated` /
 * `contention_eased` event per state transition. The LEDGER STATE (not the
 * events) is the inbox's source of truth — the divine inbox reads
 * `state.contention` directly; the events feed the chronicle + the future
 * LLM-narration seam. Deterministic and `Math.random`-free (uses no `ctx.rng`).
 */
import type { System, SystemContext } from '@/core/scheduler';
import type { SettlementCohorts } from '@/sim/cohorts';
import { TICKS_PER_DAY } from '@/core/calendar';
import { censusBelieversByPoi, ContentionLedger, stateRank } from '@/sim/rival-contention';

/** Event-log window folded into each step for the dispute bump. Sized to the
 *  ~5 s step cadence (tickHz 0.2) in TICKS_PER_DAY fractions, never a raw literal:
 *  5 s = TICKS_PER_DAY·5/86400 = TICKS_PER_DAY/17280. */
export const CONTENTION_STEP_WINDOW_TICKS = TICKS_PER_DAY / 17280;

export class RivalContentionSystem implements System {
  readonly name = 'rival-contention-system';
  readonly tickHz = 0.2; // step the ladder roughly every 5 sim seconds

  constructor(
    private readonly getContention: () => ContentionLedger,
    private readonly getCohorts?: () => ReadonlyMap<string, SettlementCohorts> | null | undefined,
  ) {}

  tick(ctx: SystemContext): void {
    const ledger = this.getContention();
    const census = censusBelieversByPoi(ctx.world, ctx.spirits, this.getCohorts?.());

    // Fold the disputes logged since the last step into a per-poi bump count.
    const disputes = new Map<string, number>();
    for (const a of ctx.log.range(ctx.now - CONTENTION_STEP_WINDOW_TICKS, ctx.now + 1)) {
      if (a.event.type === 'rival_dispute') {
        const poi = a.event.data.poiId;
        if (poi) disputes.set(poi, (disputes.get(poi) ?? 0) + 1);
      }
    }

    for (const t of ledger.step(census, disputes, ctx.now)) {
      const escalating = stateRank(t.to) > stateRank(t.from);
      // Two append calls so the discriminant `type` is a concrete literal (a
      // SimEvent can't be built with a union-typed discriminant).
      if (escalating) {
        ctx.log.append({ type: 'contention_escalated', poiId: t.poiId, from: t.from, to: t.to, rivals: t.rivals });
      } else {
        ctx.log.append({ type: 'contention_eased', poiId: t.poiId, from: t.from, to: t.to, rivals: t.rivals });
      }
    }
  }
}
