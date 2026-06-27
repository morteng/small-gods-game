// src/assetgen/types.ts
export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type RGB = [number, number, number];
export interface Pt { x: number; y: number }

export type Mat =
  | 'stone' | 'timber' | 'plaster' | 'thatch' | 'tile'
  | 'foliage' | 'bark' | 'earth' | 'metal' | 'door' | 'brick' | 'glass';

/** Base grey-reference albedo per material (the generative palette overrides later). */
export const MATERIAL_RGB: Record<Mat, RGB> = {
  stone:   [150, 150, 158],
  timber:  [120, 96, 64],
  plaster: [196, 188, 174],
  thatch:  [150, 128, 82],
  tile:    [120, 108, 96],
  foliage: [86, 124, 70],
  bark:    [92, 72, 52],
  earth:   [120, 100, 78],
  metal:   [140, 144, 150],
  door:    [92, 62, 40],   // dark door wood — distinct albedo so the model paints a door
  brick:   [150, 78, 58],  // chimney brick — distinct from wall + roof
  glass:   [44, 52, 64],   // dark cool glazing by day; the warm glow is its emissive (night)
};

/** A flat-shaded polygon in WORLD space (tile-local x,y; z up), pre-projection. */
export interface WorldFacet { pts: Vec3[]; normal: Vec3; albedo: RGB; mat: Mat }

/** A projected, depth-keyed polygon ready to rasterise. `worldPts` (the pre-projection
 *  world positions, vertex-aligned with `pts`) lets the rasterizer interpolate world xyz
 *  per pixel for analytic surface texturing (K0b). `finish` carries the resolved paint
 *  layer (K0c); absent ⇒ bare. */
export interface ScreenFacet {
  pts: Pt[]; normal: Vec3; albedo: RGB; depth: number; depths?: number[]; mat: Mat;
  worldPts?: Vec3[]; finish?: string;
}
