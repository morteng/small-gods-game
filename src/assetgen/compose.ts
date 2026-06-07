// src/assetgen/compose.ts
import type { Vec3, Mat, WorldFacet } from '@/assetgen/types';
import { box, cylinder, prism, cone, ellipsoid, arch } from '@/assetgen/geometry/primitives';
import { buildingFacets, type Wing } from '@/assetgen/geometry/building';
import { projectFacets } from '@/assetgen/render/projection';
import { rasterize } from '@/assetgen/render/rasterize';
import { computeFit, opaqueBounds, type BBox } from '@/assetgen/render/fit';

/** v1 primitive parts only — extrusion+roof, macros and scatter arrive in later slices. */
export type Part =
  | { prim: 'box'; at: Vec3; size: Vec3; material?: Mat }
  | { prim: 'cylinder'; center: [number, number]; baseZ: number; radius: number; height: number; material?: Mat; sides?: number }
  | { prim: 'cone'; center: [number, number]; baseZ: number; radius: number; height: number; material?: Mat; sides?: number }
  | { prim: 'prism'; center: [number, number]; baseZ: number; radius: number; height: number; sides: number; material?: Mat; rot?: number }
  | { prim: 'ellipsoid'; center: [number, number]; baseZ: number; radii: Vec3; material?: Mat }
  | { prim: 'arch'; at: Vec3; span: number; height: number; thickness: number; material?: Mat }
  | { prim: 'building'; wings: Wing[]; wallMat?: Mat; roofMat?: Mat };

export interface StructureSpec { id?: string; size?: number; parts: Part[] }
export interface StructureMeta { bbox: BBox }
export interface StructureResult { grey: Uint8ClampedArray; normal: Uint8ClampedArray; size: number; meta: StructureMeta; bbox: BBox }

function partFacets(p: Part): WorldFacet[] {
  switch (p.prim) {
    case 'box':       return box(p.at, p.size, p.material);
    case 'cylinder':  return cylinder(p.center, p.baseZ, p.radius, p.height, p.material, p.sides);
    case 'cone':      return cone(p.center, p.baseZ, p.radius, p.height, p.material, p.sides);
    case 'prism':     return prism(p.center, p.baseZ, p.radius, p.height, p.sides, p.material, p.rot);
    case 'ellipsoid': return ellipsoid(p.center, p.baseZ, p.radii, p.material);
    case 'arch':      return arch(p.at, p.span, p.height, p.thickness, p.material);
    case 'building':  return buildingFacets(p.wings, p.wallMat, p.roofMat);
  }
}

/** Compose a structure spec into aligned grey + normal RGBA buffers (+ bbox/meta). Pure & deterministic. */
export function composeStructure(spec: StructureSpec): StructureResult {
  const size = spec.size ?? 1024;
  const facets = spec.parts.flatMap(partFacets);
  const fit = computeFit(facets, size);
  const screen = projectFacets(facets, fit);
  const grey = rasterize(screen, size, 'albedo');
  const normal = rasterize(screen, size, 'normal');
  const bbox = opaqueBounds(grey, size);
  return { grey, normal, size, meta: { bbox }, bbox };
}
