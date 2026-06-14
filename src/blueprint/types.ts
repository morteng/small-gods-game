// The class-neutral structural authoring model. One Blueprint = the recipe for one
// object (a building today; a tree/wall/terrain feature later). Composable Parts +
// attached Features, assembled from the registry, authored as layered patches.
import type { Era } from '@/core/types';
import type { WallFace } from '@/assetgen/geometry/building';

export const BLUEPRINT_VERSION = 1;

export type EntityClass = 'building' | 'prop' | 'barrier' | 'plant' | 'terrain_feature';
export interface Palette { walls?: string; roof?: string; trim?: string }

/** Qualitative "kind" axes an agent/UI can specify when authoring an asset (rich vs
 *  poor, fine vs crude, …). They BIAS the resolve (material tier, glazing, storeys,
 *  apron) and feed the img2img prompt — see src/blueprint/descriptors.ts. Closed
 *  axes for precise querying, plus an open `tags` set. All optional; absent ⇒ the
 *  preset's baseline (and the resolved blueprint omits the field entirely, so a
 *  descriptor-less asset keeps its existing art-cache key). */
export type Wealth = 'destitute' | 'poor' | 'modest' | 'comfortable' | 'rich' | 'opulent';
export type Quality = 'crude' | 'plain' | 'fine' | 'ornate';
export type Condition = 'pristine' | 'lived_in' | 'worn' | 'dilapidated';
export interface Descriptors {
  wealth?: Wealth;
  quality?: Quality;
  style?: string;        // open vocabulary, per-class suggestions in the catalogue
  condition?: Condition; // condition WHEN BUILT (lifecycle stage is separate)
  tags?: string[];       // free-form, e.g. ['riverside','guild','painted']
}

/** An attached opening/fixture on a part: door / vent / window. Class-neutral.
 *  `tags` are open semantic anchors (e.g. 'entrance', 'chimney') an agent / a
 *  lifecycle transform / the future separable-parts pass can target by role. */
export interface Feature {
  type: string;                          // registry key
  face?: WallFace;
  params?: Record<string, unknown>;
  tags?: string[];                       // semantic anchors (role labels)
}

/** A semantic component. `type` keys a PartType in the registry. */
export interface Part {
  type: string;
  at?: { x: number; y: number };         // structure-local tile origin (default 0,0)
  size?: { w: number; h: number };
  material?: string;                     // overrides blueprint material for this part
  params?: Record<string, unknown>;
  features?: Record<string, Feature>;
  tags?: string[];                       // semantic anchors (role labels)
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
  descriptors?: Descriptors;             // qualitative kind (wealth/quality/style/…)
  stage?: string;                        // lifecycle stage (sapling/ruin/…) — see lifecycle.ts
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
  descriptors?: Descriptors;
  stage?: string;
  footprint?: { w: number; h: number };
  notes?: string;
}

/** Every field concrete; semantic structure intact. Output of resolveBlueprint. */
export interface ResolvedFeature {
  id: string;
  type: string;
  face?: WallFace;
  params: Record<string, unknown>;       // every param filled
  tags?: string[];                       // present ONLY when set (keeps cache key stable)
}
export interface ResolvedPart {
  id: string;
  type: string;
  at: { x: number; y: number };
  size: { w: number; h: number };
  material?: string;
  params: Record<string, unknown>;
  features: ResolvedFeature[];
  tags?: string[];                       // present ONLY when set (keeps cache key stable)
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
  descriptors?: Descriptors;             // present ONLY when set (keeps cache key stable)
  stage?: string;                        // present ONLY when non-default (keeps cache key stable)
  footprint: { w: number; h: number };
  notes?: string;
}

export type { WallFace, Era };
