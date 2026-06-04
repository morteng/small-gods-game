/**
 * StagingActivationSystem — fires armed beats when their trigger is satisfied.
 *
 * Signal-agnostic: it consumes the DiscoveryQueue (game.ts feeds it NPC focus,
 * POI/region discovery, …) and checks time/thread/condition triggers each tick.
 * Firing RELEASES a beat: hard commands go onto the command channel (the existing
 * deterministic executor applies them next tick), soft narration is handed to the
 * onSoftBeat callback (game.ts → NpcAttentionStore), the owning staged thread is
 * activated, and a `beat_fired` event is emitted.
 *
 * Stores are read via lazy getters (snapshot restore hydrates them in place).
 */
import type { System, SystemContext } from '@/core/scheduler';
import type { CommandQueue } from '@/sim/command/command-queue';
import type { DiscoveryQueue } from '../discovery-queue';
import type { StagingBuffer } from '../staging-buffer';
import type { PlotThreadStore } from '../thread-store';
import type { StagedBeat } from '../staging-types';
import type { ThreadSubject } from '../thread-types';
import { subjectKey } from '../thread-types';

/** Named world predicates for `sim_condition` triggers (extend as needed). */
export type SimPredicate = (ctx: SystemContext) => boolean;
export const SIM_PREDICATES: Record<string, SimPredicate> = {};

export class StagingActivationSystem implements System {
  readonly name = 'staging-activation';
  readonly tickHz = 0.5;

  constructor(
    private readonly discovery: DiscoveryQueue,
    private readonly queue: CommandQueue,
    private readonly getStaging: () => StagingBuffer,
    private readonly getThreads: () => PlotThreadStore,
    private readonly onSoftBeat?: (subject: ThreadSubject, soft: NonNullable<StagedBeat['soft']>) => void,
  ) {}

  tick(ctx: SystemContext): void {
    const staging = this.getStaging();
    const threads = this.getThreads();

    // 1. Discovery-triggered beats.
    const discovered = new Set(this.discovery.drain().map(s => subjectKey(s.subject)));
    if (discovered.size) {
      for (const beat of staging.armedByTrigger('discovery')) {
        if (discovered.has(subjectKey(beat.subject))) this.fire(beat, ctx, staging, threads);
      }
    }

    // 2. Time / thread-phase / sim-condition triggers (checked every tick).
    for (const beat of staging.armedByTrigger('after_tick')) {
      if (beat.trigger.kind === 'after_tick' && ctx.now >= beat.trigger.tick) {
        this.fire(beat, ctx, staging, threads);
      }
    }
    for (const beat of staging.armedByTrigger('thread_phase')) {
      if (beat.trigger.kind === 'thread_phase') {
        const t = threads.get(beat.trigger.threadId);
        if (t && t.phase === beat.trigger.phase) this.fire(beat, ctx, staging, threads);
      }
    }
    for (const beat of staging.armedByTrigger('sim_condition')) {
      if (beat.trigger.kind === 'sim_condition') {
        const pred = SIM_PREDICATES[beat.trigger.predicateId];
        if (pred?.(ctx)) this.fire(beat, ctx, staging, threads);
      }
    }
  }

  private fire(beat: StagedBeat, ctx: SystemContext, staging: StagingBuffer, threads: PlotThreadStore): void {
    for (const cmd of beat.hard) {
      this.queue.emit({ verb: cmd.verb, source: cmd.source, target: cmd.target, params: cmd.params, payload: cmd.payload });
    }
    if (beat.soft) this.onSoftBeat?.(beat.subject, beat.soft);
    if (beat.threadId !== undefined) threads.activate(beat.threadId, ctx.now);
    staging.markFired(beat.id);
    ctx.log.append({ type: 'beat_fired', beatId: beat.id, subject: beat.subject, threadId: beat.threadId });
  }
}
