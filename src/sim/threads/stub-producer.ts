/**
 * Stub producers — deterministic stand-ins for the future Fate brain.
 *
 * A producer reads thread state and ARMS staged beats (prospective content) onto
 * subjects. This single stub proves the prep→discover→materialize loop end-to-end
 * and is fully testable; the Fate brain (Track 4) later replaces it as the
 * authoring intelligence. Producers must be deterministic (no Math.random).
 */
import type { World } from '@/world/world';
import type { Command } from '@/sim/command/types';
import type { PlotThreadStore } from './thread-store';
import type { StagingBuffer } from './staging-buffer';

export interface ProducerCtx {
  world: World;
  threads: PlotThreadStore;
  staging: StagingBuffer;
  now: number;
}

export type Producer = (ctx: ProducerCtx) => void;

/**
 * When a settlement's trial reaches `hardship`, stage a stranger to be found
 * there — a beggar spawns (hard) and a vibe line is primed (soft), armed on
 * discovery. Uses `vars.staged` to fire exactly once per thread.
 */
export const stageStrangerOnHardship: Producer = (ctx) => {
  for (const t of ctx.threads.active()) {
    if (t.shapeId !== 'trial' || t.phase !== 'hardship') continue;
    if (t.subject.kind !== 'settlement') continue;
    if (t.vars.staged) continue; // already staged for this thread

    const spawn: Command = {
      verb: 'author_spawn_npc',
      source: 'fate',
      target: { kind: 'none' },
      payload: { role: 'beggar', count: 1, near: t.subject.poiId, name: 'A stranger', faith: 0 },
      seq: 0,
    };
    ctx.staging.arm({
      threadId: t.id,
      subject: t.subject,
      trigger: { kind: 'discovery' },
      hard: [spawn],
      soft: { kind: 'location_vibe', text: 'A stranger lingers at the edge of the fields, watching.' },
      stagedTick: ctx.now,
    });
    t.vars.staged = 1;
  }
};

export const STUB_PRODUCERS: Producer[] = [stageStrangerOnHardship];
