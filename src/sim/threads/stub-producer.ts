/**
 * Stub producers — deterministic stand-ins for the future Fate brain.
 *
 * A producer reads thread state and ARMS staged beats (prospective content) onto
 * subjects. This single stub proves the prep→discover→materialize loop end-to-end
 * and is fully testable; the Fate brain (Track 4) later replaces it as the
 * authoring intelligence. Producers must be deterministic (no Math.random).
 */
import type { Rng } from '@/core/rng';
import type { World } from '@/world/world';
import type { Command } from '@/sim/command/types';
import type { StoryRegistry } from '@/story/story-registry';
import { selectStorylet } from '@/story/select';
import { Scope } from '@/story/story-state';
import type { PlotThreadStore } from './thread-store';
import type { StagingBuffer } from './staging-buffer';

export interface ProducerCtx {
  world: World;
  threads: PlotThreadStore;
  staging: StagingBuffer;
  now: number;
  rng: Rng;
  /**
   * Loaded story packs a producer may draw an entry storylet from. Optional —
   * tests that don't exercise storylet arming may omit it, in which case beats
   * arm with hard/soft only (unchanged prior behaviour).
   */
  storyRegistry?: StoryRegistry;
}

export type Producer = (ctx: ProducerCtx) => void;

/**
 * Deterministically pick a storylet id to attach to a beat, from whatever packs
 * are loaded. Uses the same reservoir selection the story engine's dumb director
 * uses (`selectStorylet`), scoped over each pack's OWN initial state — so the
 * chosen storylet is always the pack's entry point (e.g. the highest-priority
 * eligible storylet), never a mid-pack node reachable only via `goto`.
 * `undefined` when no pack is loaded or nothing is eligible — the beat still
 * arms, just without a storylet ref. The `registry.has()` re-check is defensive
 * (the id always comes from the pack it was selected out of) but keeps this on
 * the same drift-guard discipline every other storylet ref uses.
 */
function pickStoryletFor(registry: StoryRegistry | undefined, rng: Rng): string | undefined {
  if (!registry) return undefined;
  for (const pack of registry.all()) {
    // No StoryHost: entry selection only ever needs the pack's own seeded scope
    // (`when` guards like `drought`/`elder.faith` in the shipped pack), same as
    // StorySession's own default-entry path (`start()` with no explicit id).
    const scope = new Scope(undefined, pack.state);
    const chosen = selectStorylet(pack, scope, rng, new Set());
    if (!chosen) continue;
    if (registry.has(chosen.id)) return chosen.id;
    console.warn('[storylet] producer selected an unregistered storylet id, dropping ref:', chosen.id);
  }
  return undefined;
}

/**
 * When a settlement's trial reaches `hardship`, stage a stranger to be found
 * there — a beggar spawns (hard) and a vibe line is primed (soft), armed on
 * discovery. Uses `vars.staged` to fire exactly once per thread. Also attaches
 * an entry storylet from a loaded pack (if any) so discovery opens an
 * interactive card, not just the hard/soft beat.
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
    const storylet = pickStoryletFor(ctx.storyRegistry, ctx.rng);
    ctx.staging.arm({
      threadId: t.id,
      subject: t.subject,
      trigger: { kind: 'discovery' },
      hard: [spawn],
      soft: { kind: 'location_vibe', text: 'A stranger lingers at the edge of the fields, watching.' },
      ...(storylet ? { storylet } : {}),
      stagedTick: ctx.now,
    });
    t.vars.staged = 1;
  }
};

export const STUB_PRODUCERS: Producer[] = [stageStrangerOnHardship];
