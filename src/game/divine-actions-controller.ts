/**
 * DivineActionsController — single owner of all divine-action invocation.
 *
 * Replaces two previously-duplicated call paths in game.ts:
 *  1. The five `dispatcher.register(...)` handlers (constructor)
 *  2. The NPC info-panel button callbacks in render()
 *
 * Unification deltas:
 *  - whisper: both paths now set lastCastTime AND trigger the 'whisper' particle effect.
 *    Previously: dispatcher path set lastCastTime but no effect; info-panel triggered effect.
 *  - dream: both paths now trigger the 'dream' particle effect.
 *    Previously: dispatcher path did NOT trigger effect; info-panel did.
 *  - answer_prayer: no effect in either path (unchanged).
 *  - omen via dispatcher (poiId payload): no particle (unchanged dispatcher behavior).
 *  - omen via info-panel (omenForNpc): resolves NPC homePoiId, casts, triggers 'omen' effect at POI (unchanged info-panel behavior).
 *  - miracle via dispatcher (poiId payload): no particle (unchanged dispatcher behavior).
 *  - miracle via info-panel (miracleForNpc): resolves NPC homePoiId, casts, triggers 'miracle' effect at POI (unchanged info-panel behavior).
 */

import type { Entity } from '@/core/types';
import type { Spirit } from '@/core/spirit';
import type { DivineEffects } from '@/render/divine-effects';
import type { OverlayDispatcher } from '@/ui/overlay-dispatcher';
import { whisper, omen, dream, miracle, answerPrayer } from '@/sim/divine-actions';
import { getNpc, npcProps } from '@/world/npc-helpers';
import type { GameState } from '@/core/state';

export interface DivineActionsDeps {
  state: GameState;
  divineEffects: DivineEffects;
  /** Gold-flash clock; defaults to performance.now */
  now?: () => number;
}

export class DivineActionsController {
  /** Timestamp of the last successful divine cast (for gold-flash overlay). */
  lastCastTime = -Infinity;
  private now: () => number;

  constructor(private deps: DivineActionsDeps) {
    this.now = deps.now ?? (() => performance.now());
  }

  private player(): Spirit {
    return this.deps.state.spirits.get('player')!;
  }

  private log() {
    return this.deps.state.eventLog;
  }

  private flash(): void {
    this.lastCastTime = this.now();
  }

  // ─── Action methods ────────────────────────────────────────────────────────

  whisper(npc: Entity): boolean {
    if (whisper(this.player(), npc, this.log())) {
      this.flash();
      this.deps.divineEffects.trigger('whisper', npc.x, npc.y);
      return true;
    }
    return false;
  }

  dream(npc: Entity): void {
    if (dream(this.player(), npc, this.log())) {
      this.deps.divineEffects.trigger('dream', npc.x, npc.y);
    }
  }

  answerPrayer(npc: Entity): void {
    answerPrayer(this.player(), npc, this.log());
  }

  /** Cast omen at a specific POI id (dispatcher path — no particle effect). */
  omenAt(poiId: string): boolean {
    const world = this.deps.state.world;
    if (!world) return false;
    return omen(this.player(), poiId, world, this.log());
  }

  /** Cast miracle at a specific POI id (dispatcher path — no particle effect). */
  miracleAt(poiId: string): boolean {
    const world = this.deps.state.world;
    if (!world) return false;
    return miracle(this.player(), poiId, world, this.log());
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

  // ─── Dispatcher registration ───────────────────────────────────────────────

  /** Register all five divine-action handlers onto the given dispatcher. */
  register(dispatcher: OverlayDispatcher): void {
    const world = () => this.deps.state.world;

    dispatcher.register('whisper', (p) => {
      const w = world();
      if (!w) return false;
      const e = getNpc(w, (p as { npcId: string }).npcId);
      return !!e && this.whisper(e);
    });

    dispatcher.register('omen', (p) => {
      return this.omenAt((p as { poiId: string }).poiId);
    });

    dispatcher.register('dream', (p) => {
      const w = world();
      if (!w) return false;
      const e = getNpc(w, (p as { npcId: string }).npcId);
      if (e) { this.dream(e); return true; }
      return false;
    });

    dispatcher.register('miracle', (p) => {
      return this.miracleAt((p as { poiId: string }).poiId);
    });

    dispatcher.register('answer_prayer', (p) => {
      const w = world();
      if (!w) return false;
      const e = getNpc(w, (p as { npcId: string }).npcId);
      if (e) { this.answerPrayer(e); return true; }
      return false;
    });
  }
}
