// src/assetgen/compose.ts
import type { Vec3, Mat, WorldFacet } from '@/assetgen/types';
import {
  solidBox, solidCylinder, solidCone, solidPrism, solidEllipsoid, solidArch,
  manifoldToFacets, buildingFacets,
} from '@/assetgen/geometry/solids';
import type { Wing, RoofStyle, BuildingFeatures, BuildingAnchors } from '@/assetgen/geometry/building';
import { linearFacets } from '@/assetgen/geometry/linear';
import type { BarrierRun } from '@/world/barrier';
import { projectFacets, project } from '@/assetgen/render/projection';
import { rasterize } from '@/assetgen/render/rasterize';
import { computeFit, opaqueBounds, type BBox } from '@/assetgen/render/fit';

export type Part =
  | { prim: 'box'; at: Vec3; size: Vec3; material?: Mat }
  | { prim: 'cylinder'; center: [number, number]; baseZ: number; radius: number; height: number; material?: Mat }
  | { prim: 'cone'; center: [number, number]; baseZ: number; radius: number; height: number; material?: Mat }
  | { prim: 'prism'; center: [number, number]; baseZ: number; radius: number; height: number; sides: number; material?: Mat }
  | { prim: 'ellipsoid'; center: [number, number]; baseZ: number; radii: Vec3; material?: Mat }
  | { prim: 'arch'; at: Vec3; span: number; height: number; thickness: number; material?: Mat }
  | { prim: 'building'; wings: Wing[]; wallMat?: Mat; roofMat?: Mat; roofStyle?: RoofStyle; features?: BuildingFeatures; seed?: number }
  | { prim: 'linear'; run: BarrierRun };

/** World-space linear-structure anchors (wall ends + gate openings), pre-normalisation. */
export interface LinearWorldAnchors { wallEnds: Vec3[]; gates: Vec3[] }

export interface StructureSpec { id?: string; size?: number; parts: Part[] }
/** Feature anchors normalised (0..1) against the sprite's opaque bbox, so they survive a repaint + crop. */
export interface NormAnchor { x: number; y: number }
export interface DoorAnchorN extends NormAnchor { main: boolean }
export interface StructureAnchors { doors: DoorAnchorN[]; vents: NormAnchor[]; wallEnds?: NormAnchor[]; gates?: NormAnchor[] }
export interface StructureMeta { bbox: BBox; anchors: StructureAnchors }
export interface StructureResult { grey: Uint8ClampedArray; normal: Uint8ClampedArray; size: number; meta: StructureMeta; bbox: BBox; anchors: StructureAnchors }

/** Build one part's solid(s) → facets, plus any world-space anchors (buildings only). */
async function partFacets(p: Part): Promise<{ facets: WorldFacet[]; anchors?: BuildingAnchors; linearAnchors?: LinearWorldAnchors }> {
  switch (p.prim) {
    case 'box':       return { facets: manifoldToFacets((await solidBox(p.at, p.size)).getMesh(), p.material ?? 'stone') };
    case 'cylinder':  return { facets: manifoldToFacets((await solidCylinder(p.center, p.baseZ, p.radius, p.height)).getMesh(), p.material ?? 'stone') };
    case 'cone':      return { facets: manifoldToFacets((await solidCone(p.center, p.baseZ, 0, p.radius, p.height)).getMesh(), p.material ?? 'foliage') };
    case 'prism':     return { facets: manifoldToFacets((await solidPrism(p.center, p.baseZ, p.radius, p.height, p.sides)).getMesh(), p.material ?? 'stone') };
    case 'ellipsoid': return { facets: manifoldToFacets((await solidEllipsoid(p.center, p.baseZ, p.radii)).getMesh(), p.material ?? 'foliage') };
    case 'arch':      return { facets: manifoldToFacets((await solidArch(p.at, p.span, p.height, p.thickness)).getMesh(), p.material ?? 'stone') };
    case 'building':  return buildingFacets(p.wings, p.wallMat, p.roofMat, p.roofStyle, p.features, p.seed);
    case 'linear':    { const r = await linearFacets(p.run); return { facets: r.facets, linearAnchors: r.anchors }; }
  }
}

/** Compose a structure spec into aligned grey + normal RGBA buffers (+ bbox/anchors). Deterministic. */
export async function composeStructure(spec: StructureSpec): Promise<StructureResult> {
  const size = spec.size ?? 1024;
  const parts = await Promise.all(spec.parts.map(partFacets));
  const facets = parts.flatMap(p => p.facets);
  const fit = computeFit(facets, size);
  const screen = projectFacets(facets, fit);
  const grey = rasterize(screen, size, 'albedo');
  const normal = rasterize(screen, size, 'normal');
  const bbox = opaqueBounds(grey, size);

  // Project world-space anchors through the same fit, then normalise to the opaque bbox.
  const norm = (p: Vec3): NormAnchor => {
    const s = project(p, fit);
    return { x: (s.x - bbox.x) / (bbox.w || 1), y: (s.y - bbox.y) / (bbox.h || 1) };
  };
  const anchors: StructureAnchors = { doors: [], vents: [] };
  for (const part of parts) {
    if (part.anchors) {
      for (const d of part.anchors.doors) anchors.doors.push({ ...norm(d.pos), main: d.main });
      for (const v of part.anchors.vents) anchors.vents.push(norm(v));
    }
    if (part.linearAnchors) {
      (anchors.wallEnds ??= []).push(...part.linearAnchors.wallEnds.map(norm));
      (anchors.gates ??= []).push(...part.linearAnchors.gates.map(norm));
    }
  }

  return { grey, normal, size, meta: { bbox, anchors }, bbox, anchors };
}
