/**
 * DivineActionsController — the player's emitter onto the command channel.
 *
 * The player no longer mutates sim state directly. Each action builds a
 * Command{source:'player'} and enqueues it; the CommandExecutorSystem applies it
 * (delegating to divine-actions.ts) at the next tick — the SAME gate rivals and
 * Fate use. The controller keeps its COSMETIC responsibilities (gold flash,
 * particle effects), fired optimistically on emit. To match the old guard logic
 * exactly, emit is gated by `previewCommand` (the registry's read-only check), so
 * an unaffordable / cooled-down / non-worship action neither flashes nor enqueues
 * — identical observable behavior to the old direct calls, only ≤1 tick later.
 */

import type { Entity, MemoryKind } from '@/core/types';
import type { DivineEffects } from '@/render/divine-effects';
import type { CommandQueue } from '@/sim/command/command-queue';
import { previewCommand } from '@/sim/command/command-system';
import type { Command, CommandTarget, CommandVerb, CommandCtx } from '@/sim/command/types';
import { npcProps } from '@/world/npc-helpers';
import type { GameState } from '@/core/state';
import { recordMemory, summarizeDivineAct, computeSalience } from '@/llm/interaction-memory';

export interface DivineActionsDeps {
  state: GameState;
  queue: CommandQueue;
  divineEffects: DivineEffects;
  /** Gold-flash clock; defaults to performance.now */
  now?: () => number;
}

export class DivineActionsController {
  /** Timestamp of the last successful whisper (drives the gold-flash overlay).
   *  Only whisper sets this — matching the pre-refactor `lastWhisperTime`; dream/
   *  omen/miracle trigger particles but no flash. */
  lastCastTime = -Infinity;
  private now: () => number;

  constructor(private deps: DivineActionsDeps) {
    this.now = deps.now ?? (() => performance.now());
  }

  private flash(): void {
    this.lastCastTime = this.now();
  }

  /**
   * Optimistically emit a player command if it passes the registry's read-only
   * preview. Returns true if enqueued (so callers can fire cosmetics).
   */
  private tryEmit(verb: CommandVerb, target: CommandTarget): boolean {
    const world = this.deps.state.world;
    if (!world) return false;
    const cmd: Command = { verb, source: 'player', target, seq: 0 };
    const ctx: CommandCtx = { world, spirits: this.deps.state.spirits, log: this.deps.state.eventLog, state: this.deps.state };
    if (previewCommand(cmd, ctx) !== null) return false;
    this.deps.queue.emit({ verb, source: 'player', target });
    return true;
  }

  /** Record a salience-tagged memory of an NPC-targeted divine act. Called only
   *  after the command actually emitted (passed the registry preview). */
  private recordAct(npc: Entity, kind: MemoryKind): void {
    const props = npcProps(npc);
    const spiritName = this.deps.state.spirits.get('player')?.name ?? 'your god';
    recordMemory(props, {
      tick: this.deps.state.clock.now(),
      kind,
      summary: summarizeDivineAct(kind, props.name, spiritName),
      salience: computeSalience(kind),
    });
  }

  // ─── Action methods ────────────────────────────────────────────────────────

  whisper(npc: Entity): boolean {
    if (this.tryEmit('whisper', { kind: 'npc', npcId: npc.id })) {
      this.flash();
      this.deps.divineEffects.trigger('whisper', npc.x, npc.y);
      return true;
    }
    return false;
  }

  dream(npc: Entity): boolean {
    if (this.tryEmit('dream', { kind: 'npc', npcId: npc.id })) {
      this.deps.divineEffects.trigger('dream', npc.x, npc.y);
      this.recordAct(npc, 'dream');
      return true;
    }
    return false;
  }

  answerPrayer(npc: Entity): boolean {
    if (this.tryEmit('answer_prayer', { kind: 'npc', npcId: npc.id })) {
      this.recordAct(npc, 'answer');
      return true;
    }
    return false;
  }

  /** Cast omen at a specific POI id (dispatcher path — no particle effect). */
  omenAt(poiId: string): boolean {
    return this.tryEmit('omen', { kind: 'settlement', poiId });
  }

  /** Cast miracle at a specific POI id (dispatcher path — no particle effect). */
  miracleAt(poiId: string): boolean {
    return this.tryEmit('miracle', { kind: 'settlement', poiId });
  }

  /** Cast omen for an NPC's home POI + trigger particle at POI position (info-panel path). */
  omenForNpc(npc: Entity): void {
    const poiId = npcProps(npc).homePoiId;
    if (poiId && this.omenAt(poiId)) {
      this.triggerAtPoi('omen', poiId);
    }
  }

  /** Cast miracle for an NPC's home POI + trigger particle at POI position (info-panel path). */
  miracleForNpc(npc: Entity): void {
    const poiId = npcProps(npc).homePoiId;
    if (poiId && this.miracleAt(poiId)) {
      this.triggerAtPoi('miracle', poiId);
    }
  }

  private triggerAtPoi(kind: 'omen' | 'miracle', poiId: string): void {
    const poi = this.deps.state.worldSeed?.pois.find(p => p.id === poiId);
    if (poi?.position) {
      this.deps.divineEffects.trigger(kind, poi.position.x, poi.position.y);
    }
  }
}
