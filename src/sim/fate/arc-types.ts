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
 * it served (the weaving audit trail, F5). The verb is ALWAYS a capability-registry
 * verb: pressures are produced only by `advance_arc` (whose inner call re-runs the
 * existing tool parsers, which emit registry commands) and by arc-linked hard beats
 * (whose commands were built by the same parsers). Historical fact — trusted from
 * disk, like the portent ledger.
 */
export interface ArcPressure {
  tick: number;
  verb: string;                     // a CAPABILITY_REGISTRY verb (see arc-advance.ts guards)
  args: Record<string, unknown>;
  servedArcs: number[];
}

/** Bounded per-arc audit ring (spec §8.1: arcs must stay snapshot-cheap). */
export const MAX_APPLIED_PRESSURES = 12;

/**
 * One planted omen (F4). `kind` comes from the arc shape's library-owned
 * `portentKinds` — the model picks among them, never invents. A portent
 * materializes as a SOFT staged beat (discovered on player attention); `beatId`
 * links the ledger entry to that beat so firing flips `discovered` (a historical
 * fact — unlike `ArcGoal.met` it IS trusted from disk, same as a beat's status).
 */
export interface ArcPortent {
  tick: number;
  kind: string;
  discovered: boolean;
  /** The omen's wording (the soft beat's narration; feeds the chronicler). */
  text?: string;
  /** The staged beat that carries this omen into the world (discovery linkage). */
  beatId?: number;
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
