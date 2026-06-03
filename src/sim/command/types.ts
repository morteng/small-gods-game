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

export type CommandVerb =
  // divine tier — implemented, belief-spending interventions
  | 'whisper' | 'omen' | 'dream' | 'miracle' | 'answer_prayer'
  // authoring tier — DECLARED, executor pending (filled in by the Fate cycle)
  | 'bias_event' | 'inject_npc' | 'nudge_severity';

export type CommandTarget =
  | { kind: 'npc'; npcId: string }
  | { kind: 'settlement'; poiId: string }
  | { kind: 'none' };

export interface Command {
  verb: CommandVerb;
  /** Who is acting: 'player', a rival id, or 'fate' (unused this slice). */
  source: SpiritId;
  target: CommandTarget;
  /** Verb-specific params (reserved; the v1 divine verbs ignore it). */
  params?: Record<string, number | string>;
  /** Monotonic emission order, stamped by the queue on emit. */
  seq: number;
}

export type RejectionReason =
  | 'insufficient_power'
  | 'precondition_failed'
  | 'not_implemented'
  | 'invalid_target'
  | 'unknown_source';

export type CommandResult =
  | { status: 'applied'; verb: CommandVerb; source: SpiritId }
  | { status: 'rejected'; verb: CommandVerb; source: SpiritId; reason: RejectionReason };

/** Everything the registry needs to validate + apply a command. */
export interface CommandCtx {
  world: World;
  spirits: Map<SpiritId, Spirit>;
  log: EventLog;
}
