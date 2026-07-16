/**
 * arc-predicates.ts — the predicate registry for arc goals (Track 4, F1).
 *
 * A predicate is a PURE function of GameState (no rng, no Math.random — this lives
 * under src/sim/ and the no-random guard covers it). Goals name a predicate as a
 * string so they round-trip through the snapshot; `recomputeGoals` evaluates them
 * each pulse and on restore. The full library is F3 — F1 ships only the trivial,
 * world-derivable ones needed to prove the seam.
 */
import type { GameState } from '@/core/state';

export type ArcPredicate = (state: GameState, args?: Record<string, string | number>) => boolean;

export const ARC_PREDICATES: Record<string, ArcPredicate> = {
  /** Always true — the dullest goal; useful as a stub / smoke predicate. */
  always: () => true,
  /** Always false. */
  never: () => false,
  /** True once the world has at least one settlement (POI). Derivable from worldSeed. */
  has_settlements: (state) => (state.worldSeed?.pois?.length ?? 0) > 0,
};

/** Evaluate a named predicate. An UNKNOWN predicate is honestly `false` (never throws). */
export function evalArcPredicate(
  name: string,
  state: GameState,
  args?: Record<string, string | number>,
): boolean {
  const fn = ARC_PREDICATES[name];
  return fn ? fn(state, args) : false;
}
