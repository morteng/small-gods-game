/**
 * PlotThreadSystem — runs the deterministic recognizers each beat.
 *
 * It reads the store via a lazy getter (the NpcMovementSystem `() => state.map`
 * pattern) so a snapshot restore — which hydrates the SAME store instance in
 * place — is picked up without re-wiring. It processes events appended since its
 * cursor and lets recognizers open/advance/resolve threads + emit lifecycle
 * events.
 *
 * Replay note: under `SilentEventLog`, `log.since()` returns [] (and `append` is
 * a no-op), so recognizers do nothing during replay. That is intentional —
 * threads are carried by the snapshot itself (they are captured/restored), so
 * scrub-replay restores thread state from the nearest snapshot rather than
 * re-deriving it. This mirrors the full-state-snapshot persistence model.
 */
import type { System, SystemContext } from '@/core/scheduler';
import type { PlotThreadStore } from '../thread-store';
import { RECOGNIZERS, type RecognizerCtx } from '../recognizers';

export class PlotThreadSystem implements System {
  readonly name = 'plot-thread';
  readonly tickHz = 0.5;
  private cursor = 0;

  constructor(private readonly getStore: () => PlotThreadStore) {}

  tick(ctx: SystemContext): void {
    const evs = ctx.log.since(this.cursor);
    if (evs.length) this.cursor = evs[evs.length - 1].id;

    const rctx: RecognizerCtx = {
      world: ctx.world,
      spirits: ctx.spirits,
      store: this.getStore(),
      log: ctx.log,
      rng: ctx.rng,
      now: ctx.now,
    };
    for (const recognize of RECOGNIZERS) recognize(evs, rctx);
  }
}
