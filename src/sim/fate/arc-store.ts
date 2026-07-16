/**
 * arc-store.ts — the live set of Fate's arcs (Track 4, F1).
 *
 * Pure sim state, serialized INSIDE the snapshot (the *fact* an arc is open, its
 * goals, applied pressures, portent ledger, and cast all persist). Ids from a
 * serialized integer counter. A direct mirror of `StagingBuffer` — same
 * serialize/hydrate discipline, no SAVE_VERSION bump.
 *
 * `ArcGoal.met` is NEVER trusted from disk: `hydrate` forces every goal to false,
 * and `recomputeGoals` (called each pulse and on restore) is the only writer that
 * sets it true, from the pure predicate registry.
 */
import type { GameState } from '@/core/state';
import type { ArcPortent, FateArc } from './arc-types';
import { isArcLive } from './arc-types';
import { evalArcPredicate } from './arc-predicates';

export class FateArcStore {
  private arcs = new Map<number, FateArc>();
  private nextId = 1;

  /** Open a new arc; the store assigns the monotonic id. */
  open(arc: Omit<FateArc, 'id'>): FateArc {
    const full: FateArc = { ...structuredClone(arc), id: this.nextId++ };
    this.arcs.set(full.id, full);
    return full;
  }

  get(id: number): FateArc | undefined {
    return this.arcs.get(id);
  }

  all(): FateArc[] {
    return [...this.arcs.values()];
  }

  /** Arcs still in play — not folded, not finished. */
  live(): FateArc[] {
    return this.all().filter(isArcLive);
  }

  /**
   * Fold a live arc Fate can no longer reach (F3, `abandon_arc`). The reason is
   * REQUIRED — it feeds the chronicler. Returns false (no mutation) for an
   * unknown or already-finished arc, so a stale id can never resurrect one.
   */
  abandon(id: number, reason: string): boolean {
    const arc = this.arcs.get(id);
    if (!arc || !isArcLive(arc)) return false;
    arc.stage = 'abandoned';
    arc.abandonedReason = reason;
    return true;
  }

  /**
   * F4: add an omen to a LIVE arc's ledger. Returns false (no mutation) for an
   * unknown or finished arc — a stale id can never grow a dead arc's ledger.
   */
  plantPortent(arcId: number, portent: ArcPortent): boolean {
    const arc = this.arcs.get(arcId);
    if (!arc || !isArcLive(arc)) return false;
    arc.portents.push(structuredClone(portent));
    return true;
  }

  /**
   * F4: a staged beat fired — if it was carrying a portent, the omen is now
   * DISCOVERED. Matched by `beatId` across ALL arcs (marking a folded arc's
   * portent discovered is harmless truth). Called by the activation system.
   */
  markPortentDiscovered(beatId: number): void {
    for (const arc of this.arcs.values()) {
      for (const p of arc.portents) {
        if (p.beatId === beatId) p.discovered = true;
      }
    }
  }

  /**
   * Recompute every goal's `met` against the current world via the predicate
   * registry. The ONLY writer of `met`. Called each pulse and on snapshot restore.
   */
  recomputeGoals(state: GameState): void {
    for (const arc of this.arcs.values()) {
      for (const g of arc.goals) g.met = evalArcPredicate(g.predicate, state, g.args);
    }
  }

  serialize(): FateArc[] {
    return structuredClone(this.all());
  }

  /** Load arcs, forcing `goal.met = false` — the persisted value is never trusted. */
  hydrate(arcs: FateArc[]): void {
    this.arcs.clear();
    let max = 0;
    for (const a of arcs) {
      const copy = structuredClone(a);
      for (const g of copy.goals) g.met = false;   // never trust disk; recompute is the source of truth
      this.arcs.set(copy.id, copy);
      if (copy.id > max) max = copy.id;
    }
    this.nextId = max + 1;
  }
}
