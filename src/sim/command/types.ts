/**
 * Command channel — core types.
 *
 * One typed intent stream that the player, rival spirits, and (later) Fate all
 * emit onto. A `Command` is a *request*; the executor validates it against the
 * capability registry and either applies it (delegating to divine-actions.ts) or
 * returns a structured rejection. See
 * docs/superpowers/specs/2026-06-03-command-channel-capability-registry-design.md.
 */
import type { Spirit, SpiritId } from '@/core/spirit';
import type { World } from '@/world/world';
import type { EventLog } from '@/core/events';
import type { Rng } from '@/core/rng';
import type { WeatherStepper } from '@/sim/water/weather-stepper';

export type CommandVerb =
  // divine tier — implemented, belief-spending interventions
  | 'whisper' | 'omen' | 'dream' | 'miracle' | 'answer_prayer' | 'probe_mind'
  // divine tier — belief-CONTENT gated dramatic actions (Track B, what believers
  // think you can do unlocks the verb; see src/sim/belief-domains.ts)
  | 'smite' | 'summon_storm'
  // authoring tier — DECLARED, executor pending (filled in by the Fate cycle)
  | 'bias_event' | 'inject_npc' | 'nudge_severity' | 'place_building' | 'grow_settlement'
  | 'rename_ward' | 'retype_ward' | 'set_rival_stance' | 'set_lord_stance'
  // editor tier — god-mode world authoring (the Create panel; cost 0, no spirit)
  | 'author_spawn_npc' | 'author_remove_entity' | 'author_modify_npc'
  | 'author_place_object' | 'author_move_entity' | 'author_set_climate'
  // meta tier (R9 time controls) — change HOW FAST the sim advances, not sim
  // state. Intercepted on the GAME side (never enqueued), so they never enter the
  // sim tick / event log / snapshot / replay. See registry.ts + game-bus onMeta.
  | 'set_time_rate' | 'skip_to_next_event' | 'cancel_seek';

export type CommandTarget =
  | { kind: 'npc'; npcId: string }
  | { kind: 'entity'; id: string }            // any World entity (flora/prop/animal)
  | { kind: 'settlement'; poiId: string }
  | { kind: 'tile'; x: number; y: number }    // a point on the ground
  | { kind: 'none' };

/** The discriminant of every CommandTarget — the vocabulary a verb can accept. */
export type CommandTargetKind = CommandTarget['kind'];

export interface Command {
  verb: CommandVerb;
  /** Who is acting: 'player', a rival id, 'fate', or 'author' (editor tier). */
  source: SpiritId;
  target: CommandTarget;
  /** Verb-specific params (reserved; the v1 divine verbs ignore it). */
  params?: Record<string, number | string>;
  /** Structured args for editor-tier verbs (entityId, role, coords, …). */
  payload?: Record<string, unknown>;
  /** Monotonic emission order, stamped by the queue on emit. */
  seq: number;
}

export type RejectionReason =
  | 'insufficient_power'
  | 'precondition_failed'
  | 'not_implemented'
  | 'invalid_target'
  | 'invalid_payload'
  | 'unknown_source';

export type CommandResult =
  | { status: 'applied'; verb: CommandVerb; source: SpiritId }
  | { status: 'rejected'; verb: CommandVerb; source: SpiritId; reason: RejectionReason };

/** Everything the registry needs to validate + apply a command. */
export interface CommandCtx {
  world: World;
  spirits: Map<SpiritId, Spirit>;
  log: EventLog;
  /** W-H: the deterministic water stepper, so weather verbs (`summon_storm`) can lay
   *  a flood as part of their (logged, replay-safe) command apply. Optional — preview
   *  callers and headless paths omit it; the verb no-ops its flood if absent. */
  weather?: WeatherStepper | null;
}

/**
 * The context an `apply` receives — `CommandCtx` plus the seeded RNG and current
 * tick. Editor verbs need these to place/seed deterministically; divine verbs
 * ignore them. Kept separate from `CommandCtx` so read-only callers
 * (previewCommand, the player UI's optimistic gate) need not supply them.
 */
export interface ApplyCtx extends CommandCtx {
  rng: Rng;
  now: number;
}
