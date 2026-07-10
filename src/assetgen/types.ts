// src/assetgen/types.ts
export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type RGB = [number, number, number];
export interface Pt { x: number; y: number }

export type Mat =
  | 'stone' | 'timber' | 'plaster' | 'thatch' | 'tile'
  | 'foliage' | 'bark' | 'earth' | 'metal' | 'door' | 'brick' | 'glass';

/** Base grey-reference albedo per material (the generative palette overrides later).
 *  v24 warmed the palette: villages were near-monochrome (grey-brown tile, blue-cast
 *  stone, muddy thatch). Values stay mutually DISTINCT — the img2img prompt legend
 *  keys materials off these colours. */
export const MATERIAL_RGB: Record<Mat, RGB> = {
  stone:   [148, 147, 143], // warm limestone grey (was blue-cast [150,150,158])
  timber:  [120, 96, 64],
  plaster: [196, 188, 174],
  thatch:  [166, 138, 80],  // golden straw (was muddy [150,128,82])
  tile:    [162, 96, 58],   // fired-clay TERRACOTTA (was grey-brown [120,108,96])
  foliage: [86, 124, 70],
  bark:    [92, 72, 52],
  earth:   [120, 100, 78],
  metal:   [140, 144, 150],
  door:    [92, 62, 40],   // dark door wood — distinct albedo so the model paints a door
  brick:   [138, 70, 54],  // chimney brick — deeper red than the terracotta tile roofs
  glass:   [44, 52, 64],   // dark cool glazing by day; the warm glow is its emissive (night)
};

/** An authored surface (u,v) frame for a facet (KU). `planar` = a tangent basis in the facet
 *  plane (axes in world metres); `cylindrical` = an angular unwrap about a vertical axis at
 *  (cx,cy) with `radius` (tiles), so masonry wraps a round tower/column seamlessly (u = θ·r
 *  arc-length, v = world-z); `polar` = an unwrap in a VERTICAL plane about a centre
 *  (cx,cy,cz), so masonry on an arch ring lays as radial voussoir wedges (u = θ·meanR
 *  tangential, v = radius). `spanAxis` says which horizontal world axis the arch spans (the
 *  other horizontal axis is the ring depth). Absent ⇒ the texturer derives a tangent frame
 *  from the normal. */
export type SurfaceFrame =
  | { kind: 'planar'; uAxis: Vec3; vAxis: Vec3 }
  | { kind: 'cylindrical'; cx: number; cy: number; radius: number }
  | { kind: 'polar'; cx: number; cy: number; cz: number; meanR: number; spanAxis: 'x' | 'y';
      /** Voussoir ring band (radii in cube-units, from the springing centre). Inside it the
       *  texturer lays RADIAL wedges; OUTSIDE (the spandrel corners) it falls back to upright
       *  horizontal coursing, so the arch ring reads distinct from the wall it sits in. */
      ringInner: number; ringOuter: number };

/** A flat-shaded polygon in WORLD space (tile-local x,y; z up), pre-projection. `work`
 *  (bond/coursing — a `SurfaceWork`), `finish` (paint layer) and `tint` are the resolved
 *  surface descriptor (KC); loosely-typed strings here to avoid a render→types import cycle.
 *  `frame` is the authored UV mapping (KU); absent ⇒ tangent-from-normal. */
export interface WorldFacet {
  pts: Vec3[]; normal: Vec3; albedo: RGB; mat: Mat;
  work?: string; finish?: string; tint?: RGB; frame?: SurfaceFrame;
  /** OPT-IN pick provenance (studio click-to-select): a stable blueprint id, format
   *  `<partId>` (a whole part — walls/roof/a standalone prim) or `<partId>/<featureId>`
   *  (a specific opening / vent). Absent on every default render — it is stamped only when
   *  a caller threads it through compose, and it is read ONLY into the opt-in pick buffer,
   *  never into albedo/normal/material/emissive, so the golden hashes stay byte-identical. */
  src?: string;
}

/** A projected, depth-keyed polygon ready to rasterise. `worldPts` (the pre-projection
 *  world positions, vertex-aligned with `pts`) lets the rasterizer interpolate world xyz
 *  per pixel for analytic surface texturing (K0b). `work`/`finish`/`tint` carry the resolved
 *  surface descriptor (KC); absent ⇒ family default / bare. */
export interface ScreenFacet {
  pts: Pt[]; normal: Vec3; albedo: RGB; depth: number; depths?: number[]; mat: Mat;
  worldPts?: Vec3[]; work?: string; finish?: string; tint?: RGB; frame?: SurfaceFrame;
  /** Opt-in pick provenance carried through from {@link WorldFacet.src} (see there). */
  src?: string;
}
