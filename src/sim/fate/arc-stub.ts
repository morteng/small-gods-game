/**
 * arc-stub.ts — the deterministic offline seeder (Track 4, F1).
 *
 * When no capable LLM is configured (`llmClientCapable === null`), Fate still needs
 * to hold a coherent — if dull — intention so the whole arc/pulse/snapshot plumbing
 * is provable with no LLM. This is NOT throwaway scaffolding: spec §8.5 makes it the
 * PERMANENT offline fallback. It is a pure function of GameState (no rng), so it is
 * replay-safe and scrub-stable.
 */
import type { GameState } from '@/core/state';
import type { FateArc } from './arc-types';
import { MAX_LIVE_ARCS } from './arc-types';

/** The offline stub's shape key — dull on purpose. */
export const STUB_ARC_SHAPE = 'stub_vigil';

/**
 * Deterministic seed condition: a settled world with room for one more arc and none
 * of Fate's own already live. Pure function of GameState — the pulse's idle-skip and
 * the offline seeder both read it, so "idle" and "seedable" agree exactly.
 */
export function stubSeedCondition(state: GameState): boolean {
  const arcs = state.fateArcs;
  if (!arcs) return false;
  if (arcs.live().length >= MAX_LIVE_ARCS) return false;
  if (arcs.live().length > 0) return false;                 // one stub at a time
  return (state.worldSeed?.pois?.length ?? 0) > 0;          // needs a world to watch over
}

/** Seed the dull offline arc if the condition holds; returns it, or null if it doesn't. */
export function seedStubArc(state: GameState, now: number): FateArc | null {
  const arcs = state.fateArcs;
  if (!arcs || !stubSeedCondition(state)) return null;
  return arcs.open({
    shape: STUB_ARC_SHAPE,
    openedTick: now,
    goals: [{ predicate: 'has_settlements', met: false }],
    applied: [],
    portents: [],
    cast: { poiIds: [], npcIds: [] },
    stage: 'seeded',
    pressureBudget: 0,
  });
}
