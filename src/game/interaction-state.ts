import type { CommandTargetKind } from '@/sim/command/types';

/** Verb-first targeting (reticle) in progress: a power was chosen, awaiting a target. */
export interface TargetingMode {
  /** The CommandVerb being aimed. */
  verb: string;
  /** Human hint for the reticle bar, e.g. "call lightning down". */
  label: string;
  /** The target shapes this verb accepts, read off the registry (`acceptedTargetKinds`)
   *  at arm time — drives both target resolution and the hint bar's honesty (A5). */
  targetKinds: readonly CommandTargetKind[];
  /** Reticle shape, read off the registry (`capFootprint`) at arm time. 'point'
   *  resolves one tile/entity on click; 'area' (Phase B) brushes a disc. */
  footprint: 'point' | 'area';
  /** Phase B drag anchor (click+drag area casts) — reserved, unused until B4. */
  anchor?: { x: number; y: number };
}

export interface InteractionState {
  hoverTile: { x: number; y: number } | null;
  hoverScreen: { x: number; y: number } | null;
  /** Non-null while the player is aiming a verb-first cast at the world. */
  targeting: TargetingMode | null;
}

export function createInteractionState(): InteractionState {
  return { hoverTile: null, hoverScreen: null, targeting: null };
}
