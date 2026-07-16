/**
 * arc-types.ts — Fate's long-range intentions (Track 4, Proactive Fate F1).
 *
 * A `FateArc` is SIM state: it rides the snapshot (NO SAVE_VERSION bump — the same
 * seam StagingBuffer uses) so an intention survives save/load AND a timeline scrub.
 * Everything here is plain data; the store (`arc-store.ts`) owns the monotonic id
 * counter + serialize/hydrate, mirroring `StagingBuffer` exactly.
 *
 * Constraint (VISION §2.1.1): an arc never names an effect the sim cannot already
 * produce — `ArcPressure` is a REFERENCE to an existing verb/tool call, not a new
 * effect type. Predicate names round-trip as strings; the pure functions behind
 * them live in `arc-predicates.ts` and are re-evaluated each pulse — the persisted
 * `ArcGoal.met` is never trusted from disk.
 */

import type { NpcId } from '@/core/types';

export type ArcStage = 'seeded' | 'building' | 'imminent' | 'landed' | 'abandoned';

/** Subject bindings: the settlements/mortals an arc is ABOUT. NPC ids are entity
 *  ids (strings — `EntityId`), NOT numbers: the spec sketch wrote `number[]`, but
 *  the shipped entity system keys NPCs by string id, and the seed_arc cast
 *  drift-guard must validate against real live ids (F3). */
export interface ArcCast {
  poiIds: string[];
  npcIds: NpcId[];
}

export interface ArcGoal {
  /** A pure predicate over GameState. Named, so it round-trips through the snapshot. */
  predicate: string;
  args?: Record<string, string | number>;
  /** Recomputed each pulse (and on restore) — NEVER trusted from disk. */
  met: boolean;
}

/**
 * Not a new effect type — a *reference* to an existing tool/verb call plus the arcs
 * it served (the weaving audit trail). The verb allowlist + `servedArcs` validation
 * are F5; F1 only needs the shape to persist.
 */
export interface ArcPressure {
  tick: number;
  verb: string;                     // MUST be in CAPABILITY_REGISTRY (or a FATE_TOOLS name) — enforced in F5
  args: Record<string, unknown>;
  servedArcs: number[];
}

/**
 * Minimal F1 shape — enough to persist a ledger entry and gate a heavy beat on a
 * non-empty, discovered ledger (F4 fleshes out kind flavours + the discovery →
 * materialize path).
 */
export interface ArcPortent {
  tick: number;
  kind: string;
  discovered: boolean;
}

export interface FateArc {
  id: number;                       // monotonic, from the store
  shape: string;                    // arc-library key (F3), e.g. 'strongman_dies_abroad'; 'stub_vigil' offline
  openedTick: number;
  /** What Fate WANTS to become true. Evaluated against the world each pulse. */
  goals: ArcGoal[];
  /** Pressures already applied — the audit trail and the re-plan input. */
  applied: ArcPressure[];
  /** Omens planted for this arc. A heavy beat may not land on an empty ledger (F4). */
  portents: ArcPortent[];
  /** Subject bindings: the mortals/settlements this arc is ABOUT. */
  cast: ArcCast;
  stage: ArcStage;
  abandonedReason?: string;
  /** Soft budget: how much more pressure this arc may spend before it must land or fold. */
  pressureBudget: number;
}

/** Max concurrent LIVE arcs (spec §4 / §5). */
export const MAX_LIVE_ARCS = 4;

/** Live = still in play: not folded, not finished. */
export function isArcLive(arc: FateArc): boolean {
  return arc.stage !== 'abandoned' && arc.stage !== 'landed';
}
