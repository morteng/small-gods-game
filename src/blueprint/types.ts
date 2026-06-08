// The class-neutral structural authoring model. One Blueprint = the recipe for one
// object (a building today; a tree/wall/terrain feature later). Composable Parts +
// attached Features, assembled from the registry, authored as layered patches.
import type { Era } from '@/core/types';
import type { WallFace } from '@/assetgen/geometry/building';

export const BLUEPRINT_VERSION = 1;

export type EntityClass = 'building' | 'barrier' | 'plant' | 'terrain_feature';
export interface Palette { walls?: string; roof?: string; trim?: string }

/** An attached opening/fixture on a part: door / vent / window. Class-neutral. */
export interface Feature {
  type: string;                          // registry key
  face?: WallFace;
  params?: Record<string, unknown>;
}

/** A semantic component. `type` keys a PartType in the registry. */
export interface Part {
  type: string;
  at?: { x: number; y: number };         // structure-local tile origin (default 0,0)
  size?: { w: number; h: number };
  material?: string;                     // overrides blueprint material for this part
  params?: Record<string, unknown>;
  features?: Record<string, Feature>;
}

export interface Blueprint {
  version: number;
  class: EntityClass;
  preset?: string;                       // becomes entity.kind for presets
  era?: Era;
  category?: string;
  parts: Record<string, Part>;
  materials?: Record<string, string>;    // e.g. { walls:'timber', roof:'thatch' }
  palette?: Palette;
  footprint: { w: number; h: number };
  notes?: string;
}

/** A layer's contribution: a partial Blueprint. A part set to `null` is deleted. */
export type PartPatch = Part | null;
export interface BlueprintPatch {
  version?: number;
  class?: EntityClass;
  preset?: string;
  era?: Era;
  category?: string;
  parts?: Record<string, PartPatch>;
  materials?: Record<string, string>;
  palette?: Palette;
  footprint?: { w: number; h: number };
  notes?: string;
}

/** Every field concrete; semantic structure intact. Output of resolveBlueprint. */
export interface ResolvedFeature {
  id: string;
  type: string;
  face?: WallFace;
  params: Record<string, unknown>;       // every param filled
}
export interface ResolvedPart {
  id: string;
  type: string;
  at: { x: number; y: number };
  size: { w: number; h: number };
  material?: string;
  params: Record<string, unknown>;
  features: ResolvedFeature[];
}
export interface ResolvedBlueprint {
  version: number;
  class: EntityClass;
  preset?: string;
  era?: Era;
  category?: string;
  parts: ResolvedPart[];                 // ordered (stable by insertion)
  materials: Record<string, string>;
  palette: Palette;
  footprint: { w: number; h: number };
  notes?: string;
}

export type { WallFace, Era };
