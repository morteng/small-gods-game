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

/** An authored surface (u,v) frame for a facet (KU). `planar` = a tangent basis in the facet
 *  plane (axes in world metres); `cylindrical` = an angular unwrap about a vertical axis at
 *  (cx,cy) with `radius` (tiles), so masonry wraps a round tower/column seamlessly (u = θ·r
 *  arc-length, v = world-z). Absent ⇒ the texturer derives a tangent frame from the normal. */
export type SurfaceFrame =
  | { kind: 'planar'; uAxis: Vec3; vAxis: Vec3 }
  | { kind: 'cylindrical'; cx: number; cy: number; radius: number };

/** A flat-shaded polygon in WORLD space (tile-local x,y; z up), pre-projection. `work`
 *  (bond/coursing — a `SurfaceWork`), `finish` (paint layer) and `tint` are the resolved
 *  surface descriptor (KC); loosely-typed strings here to avoid a render→types import cycle.
 *  `frame` is the authored UV mapping (KU); absent ⇒ tangent-from-normal. */
export interface WorldFacet {
  pts: Vec3[]; normal: Vec3; albedo: RGB; mat: Mat;
  work?: string; finish?: string; tint?: RGB; frame?: SurfaceFrame;
}

/** A projected, depth-keyed polygon ready to rasterise. `worldPts` (the pre-projection
 *  world positions, vertex-aligned with `pts`) lets the rasterizer interpolate world xyz
 *  per pixel for analytic surface texturing (K0b). `work`/`finish`/`tint` carry the resolved
 *  surface descriptor (KC); absent ⇒ family default / bare. */
export interface ScreenFacet {
  pts: Pt[]; normal: Vec3; albedo: RGB; depth: number; depths?: number[]; mat: Mat;
  worldPts?: Vec3[]; work?: string; finish?: string; tint?: RGB; frame?: SurfaceFrame;
}
