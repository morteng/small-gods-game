/**
 * Prospective staging — types.
 *
 * A StagedBeat is dormant, pre-authored content bound to a subject, armed and
 * invisible until its trigger fires (usually the player DISCOVERING the subject).
 * On fire it materializes: HARD payload = armed commands released onto the command
 * channel (source 'fate'); SOFT payload = pre-written narration primed into the
 * NpcAttentionStore. This is the prep-ahead / discover-later loop; the Fate brain
 * (Track 4) later produces beats in place of the deterministic stub producer.
 */
import type { Command } from '@/sim/command/types';
import type { ThreadId, ThreadSubject } from './thread-types';

export type BeatId = number;
export type BeatStatus = 'armed' | 'fired' | 'expired';

export type ActivationTrigger =
  | { kind: 'discovery' }                                          // subject enters the player's attention
  | { kind: 'sim_condition'; predicateId: string }                // a named predicate over world state
  | { kind: 'thread_phase'; threadId: ThreadId; phase: string }   // owning thread reaches a phase
  | { kind: 'after_tick'; tick: number };                         // time-based

export interface SoftBeat {
  kind: 'npc_thought' | 'location_vibe' | 'narration';
  text: string;
}

export interface StagedBeat {
  id: BeatId;
  /** Beats usually belong to a staged/active thread. */
  threadId?: ThreadId;
  subject: ThreadSubject;
  trigger: ActivationTrigger;
  /** Armed commands released on fire (emitted with source 'fate'). */
  hard: Command[];
  /** Pre-written narration primed into the attention store on fire. */
  soft?: SoftBeat;
  /**
   * Optional id of a storylet (in a loaded StoryPack) to ENTER on fire — the
   * branching/interactive payload single-beat staging lacks. Surfaced via the
   * activation system's `onStoryletBeat` callback; the game layer plays it in a
   * StorySession. `hard`/`soft` still apply alongside. See src/story/.
   */
  storylet?: string;
  /**
   * Optional id of a music cue the presentation layer triggers when this beat
   * fires (a Composer-chosen swell/leitmotif for the moment). Pure presentation —
   * it rides the `beat_fired` event so the score reacts off the SAME beat
   * substrate as prose/camera, never touching sim determinism. See
   * src/presentation/cue-types.ts.
   */
  musicCue?: string;
  status: BeatStatus;
  stagedTick: number;
}
