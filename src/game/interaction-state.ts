export interface InteractionState {
  hoverTile: { x: number; y: number } | null;
  hoverScreen: { x: number; y: number } | null;
}

export function createInteractionState(): InteractionState {
  return { hoverTile: null, hoverScreen: null };
}
