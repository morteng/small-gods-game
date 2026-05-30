import type { OverlayHitAreas } from '@/render/sim-overlay';

export interface InteractionState {
  overlayHitAreas: OverlayHitAreas;
  poiOverlay: { poiId: string; tileX: number; tileY: number } | null;
  hoverTile: { x: number; y: number } | null;
  hoverScreen: { x: number; y: number } | null;
}

export function createInteractionState(): InteractionState {
  return { overlayHitAreas: [], poiOverlay: null, hoverTile: null, hoverScreen: null };
}
