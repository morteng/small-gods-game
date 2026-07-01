/** Verb-first targeting (reticle) in progress: a power was chosen, awaiting a target. */
export interface TargetingMode {
  /** The CommandVerb being aimed. */
  verb: string;
  /** Human hint for the reticle bar, e.g. "call lightning down". */
  label: string;
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
