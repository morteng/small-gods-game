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
import type { StagingBuffer } from '../staging-buffer';
import { RECOGNIZERS, type RecognizerCtx } from '../recognizers';
import { STUB_PRODUCERS } from '../stub-producer';

export class PlotThreadSystem implements System {
  readonly name = 'plot-thread';
  readonly tickHz = 0.5;
  private cursor = 0;

  /**
   * @param getStore         lazy thread-store getter (restore-safe).
   * @param getStaging       lazy staging-buffer getter; when supplied, the stub
   *                         producers run each tick to arm prospective beats.
   *                         Omit it (e.g. recognition-only tests) to skip
   *                         production.
   * @param isProducerActive optional gate (default ⇒ true). game.ts passes
   *                         `() => llmClientCapable === null` so the deterministic
   *                         stub producers run ONLY as the offline fallback — when
   *                         the Fate brain is active it owns staging (no double-arm).
   */
  constructor(
    private readonly getStore: () => PlotThreadStore,
    private readonly getStaging?: () => StagingBuffer,
    private readonly isProducerActive: () => boolean = () => true,
  ) {}

  tick(ctx: SystemContext): void {
    const evs = ctx.log.since(this.cursor);
    if (evs.length) this.cursor = evs[evs.length - 1].id;

    const store = this.getStore();
    const rctx: RecognizerCtx = {
      world: ctx.world,
      spirits: ctx.spirits,
      store,
      log: ctx.log,
      rng: ctx.rng,
      now: ctx.now,
    };
    for (const recognize of RECOGNIZERS) recognize(evs, rctx);

    // Prospective authoring (stub for the Fate brain): runs only when wired with
    // a staging buffer. Silent under replay is irrelevant — it only mutates the
    // staging store, which rides the snapshot.
    const staging = this.getStaging?.();
    if (staging && this.isProducerActive()) {
      const pctx = { world: ctx.world, threads: store, staging, now: ctx.now };
      for (const produce of STUB_PRODUCERS) produce(pctx);
    }
  }
}
