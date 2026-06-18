/**
 * Director — the selection/presentation policy seam.
 *
 * The SAME content + SAME runner serve every tier; only the director swaps:
 *  - DumbDirector (no AI key): declines all enrichment (→ fallbacks render) and
 *    leaves storylet selection to the deterministic default. Fully playable.
 *  - (future) FateDirector (AI key): rewrites enrich slots from their exemplars
 *    and picks storylets for pacing/theme/player-model — drawing the reservoir
 *    "at will" — while never being *required* for the pack to run.
 *
 * Defining this interface now keeps the no-key path from ever becoming an
 * afterthought: the dumb director is the reference implementation.
 */
import type { Rng } from '@/core/rng';
import type { EnrichHint, Storylet } from './story-ir';
import type { ReadonlyScope } from './story-state';

export interface Director {
  /**
   * Optionally replace an AI-optional slot. Return `undefined` to use the
   * authored fallback. MUST be deterministic if it returns anything the runner
   * will replay (cache by `hint.slotId`).
   */
  enrich?(hint: EnrichHint, scope: ReadonlyScope): string | undefined;

  /**
   * Optionally pick the next storylet from the already-eligible pool. Return
   * `undefined` to defer to the deterministic default (highest priority, seeded
   * tiebreak). Never receives an empty array.
   */
  select?(eligible: Storylet[], scope: ReadonlyScope, rng: Rng): Storylet | undefined;
}

/** The no-key reference director: pure fallbacks + default selection. */
export class DumbDirector implements Director {}
