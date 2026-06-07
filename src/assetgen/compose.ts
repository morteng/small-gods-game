// src/assetgen/compose.ts
import type { Vec3, Mat, WorldFacet } from '@/assetgen/types';
import {
  solidBox, solidCylinder, solidCone, solidPrism, solidEllipsoid, solidArch,
  manifoldToFacets, buildingFacets,
} from '@/assetgen/geometry/solids';
import type { Wing, RoofStyle } from '@/assetgen/geometry/building';
import { projectFacets } from '@/assetgen/render/projection';
import { rasterize } from '@/assetgen/render/rasterize';
import { computeFit, opaqueBounds, type BBox } from '@/assetgen/render/fit';

export type Part =
  | { prim: 'box'; at: Vec3; size: Vec3; material?: Mat }
  | { prim: 'cylinder'; center: [number, number]; baseZ: number; radius: number; height: number; material?: Mat }
  | { prim: 'cone'; center: [number, number]; baseZ: number; radius: number; height: number; material?: Mat }
  | { prim: 'prism'; center: [number, number]; baseZ: number; radius: number; height: number; sides: number; material?: Mat }
  | { prim: 'ellipsoid'; center: [number, number]; baseZ: number; radii: Vec3; material?: Mat }
  | { prim: 'arch'; at: Vec3; span: number; height: number; thickness: number; material?: Mat }
  | { prim: 'building'; wings: Wing[]; wallMat?: Mat; roofMat?: Mat; roofStyle?: RoofStyle };

export interface StructureSpec { id?: string; size?: number; parts: Part[] }
export interface StructureMeta { bbox: BBox }
export interface StructureResult { grey: Uint8ClampedArray; normal: Uint8ClampedArray; size: number; meta: StructureMeta; bbox: BBox }

/** Build one part's solid and return its facets. */
async function partFacets(p: Part): Promise<WorldFacet[]> {
  switch (p.prim) {
    case 'box':       return manifoldToFacets((await solidBox(p.at, p.size)).getMesh(), p.material ?? 'stone');
    case 'cylinder':  return manifoldToFacets((await solidCylinder(p.center, p.baseZ, p.radius, p.height)).getMesh(), p.material ?? 'stone');
    case 'cone':      return manifoldToFacets((await solidCone(p.center, p.baseZ, 0, p.radius, p.height)).getMesh(), p.material ?? 'foliage');
    case 'prism':     return manifoldToFacets((await solidPrism(p.center, p.baseZ, p.radius, p.height, p.sides)).getMesh(), p.material ?? 'stone');
    case 'ellipsoid': return manifoldToFacets((await solidEllipsoid(p.center, p.baseZ, p.radii)).getMesh(), p.material ?? 'foliage');
    case 'arch':      return manifoldToFacets((await solidArch(p.at, p.span, p.height, p.thickness)).getMesh(), p.material ?? 'stone');
    case 'building':  return buildingFacets(p.wings, p.wallMat, p.roofMat, p.roofStyle);
  }
}

/** Compose a structure spec into aligned grey + normal RGBA buffers (+ bbox/meta). Deterministic. */
export async function composeStructure(spec: StructureSpec): Promise<StructureResult> {
  const size = spec.size ?? 1024;
  const facetGroups = await Promise.all(spec.parts.map(partFacets));
  const facets = facetGroups.flat();
  const fit = computeFit(facets, size);
  const screen = projectFacets(facets, fit);
  const grey = rasterize(screen, size, 'albedo');
  const normal = rasterize(screen, size, 'normal');
  const bbox = opaqueBounds(grey, size);
  return { grey, normal, size, meta: { bbox }, bbox };
}
