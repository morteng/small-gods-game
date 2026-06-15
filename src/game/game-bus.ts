/**
 * GameBus — the one seam both the WebGPU UI and the (future) MCP bridge consume.
 *
 * It unifies the EXISTING command channel (CommandQueue + capability registry +
 * EventLog) with the read-only GameQuery facade behind a single object. "Who
 * asked" (a human click vs a Claude tool-call) is decoupled from "what happens":
 * every emitter routes onto the same queue and inherits identical validation,
 * gating, per-tier replay, and tick-boundary application.
 *
 * S0 adds NO new command-path behaviour or persistence — it is pure delegation
 * plus the registry projected to plain data. See
 * docs/superpowers/specs/2026-06-15-command-query-bus-s0-spec.md.
 */
import type { Command, CommandVerb, RejectionReason } from '@/sim/command/types';
import type { CommandQueue } from '@/sim/command/command-queue';
import type { GameState } from '@/core/state';
import type { AppendedEvent } from '@/core/events';
import { previewCommand } from '@/sim/command/command-system';
import { listCapabilities } from '@/sim/command/registry';
import type { GameQuery } from './game-query';

/** The capability registry projected to plain, serializable data. The MCP tool
 *  surface (S5) and the UI's action affordances (S3) are both generated from this
 *  — one source of truth for the verb vocabulary. */
export interface CapabilityView {
  verb: CommandVerb;
  tier: 'divine' | 'authoring' | 'editor';
  cost: number;
  targetKind: 'npc' | 'settlement' | 'none';
  implemented: boolean;
}

export interface GameBus {
  /** Enqueue a command (the queue stamps `seq`). Same queue the player and rivals
   *  use, so it inherits identical validation/gating/ordering/replay. */
  emit(cmd: Omit<Command, 'seq'>): void;
  /** Read-only gate: would this command apply? Returns the rejection reason or null. */
  preview(cmd: Command): RejectionReason | null;
  /** The full verb vocabulary as data. */
  capabilities(): CapabilityView[];
  /** The read side. */
  query: GameQuery;
  /** Push channel for appended sim events (Fate / reactive UI). Returns an unsubscribe. */
  subscribe(fn: (e: AppendedEvent) => void): () => void;
}

export interface GameBusDeps {
  queue: CommandQueue;
  state: GameState;
  query: GameQuery;
}

export function createGameBus(deps: GameBusDeps): GameBus {
  const { queue, state, query } = deps;
  return {
    emit(cmd) { queue.emit(cmd); },

    preview(cmd) {
      return previewCommand(cmd, { world: state.world!, spirits: state.spirits, log: state.eventLog });
    },

    capabilities() {
      return listCapabilities().map(c => ({
        verb: c.verb,
        tier: c.tier,
        cost: c.cost,
        targetKind: c.targetKind,
        implemented: c.implemented,
      }));
    },

    query,

    subscribe(fn) { return state.eventLog.subscribe(fn); },
  };
}
