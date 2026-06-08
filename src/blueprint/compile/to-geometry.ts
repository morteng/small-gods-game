// src/blueprint/compile/to-geometry.ts
// Fold a ResolvedBlueprint to an assetgen StructureSpec. Wing-bearing parts (body/wing)
// merge into ONE prim:'building' (so manifold computes correct hip/valley unions);
// other parts (round/stepped bodies, tower/porch/chimney/prim) append as standalone prims.
import type { ResolvedBlueprint, ResolvedPart } from '../types';
import { getPartType, type CompileCtx } from '../registry';
import type { Part as Prim, StructureSpec } from '@/assetgen/compose';
import type { BuildingFeatures, DoorFeature, VentFeature, WallFace } from '@/assetgen/geometry/building';
import { ISO_TILE_W } from '@/render/iso/iso-constants';

/** A door feature on a part → an assetgen DoorFeature (sizes already resolved from contract). */
function doorOf(f: ResolvedPart['features'][number]): DoorFeature {
  return {
    face: (f.face ?? 'south') as WallFace,
    main: f.params.main === true,
    width: f.params.halfW as number,
    height: f.params.height as number,
  };
}
/** A vent feature on a wing-part → an assetgen VentFeature on wing `wingIdx`. */
function ventOf(f: ResolvedPart['features'][number], wingIdx: number): VentFeature {
  return {
    wing: wingIdx, t: f.params.t as number,
    kind: f.params.kind as VentFeature['kind'],
    placement: f.params.placement as VentFeature['placement'],
  };
}

export function toGeometry(rb: ResolvedBlueprint): StructureSpec {
  const ctx: CompileCtx = { materials: rb.materials, footprint: rb.footprint };

  // structure bounding box (for sprite size), from every part's footprint claim
  let maxX = 0, maxY = 0;
  for (const p of rb.parts) { maxX = Math.max(maxX, p.at.x + p.size.w); maxY = Math.max(maxY, p.at.y + p.size.h); }
  const size = Math.min(640, Math.max(128, Math.round((maxX + maxY) * ISO_TILE_W * 0.65)));

  let building: Extract<Prim, { prim: 'building' }> | null = null;
  const others: Prim[] = [];
  const doors: DoorFeature[] = [];
  const vents: VentFeature[] = [];

  for (const part of rb.parts) {
    const pt = getPartType(part.type);
    const prims = pt.toPrims(part, ctx);
    for (const prim of prims) {
      if (prim.prim === 'building') {
        if (!building) {
          building = { ...prim, wings: [...prim.wings], features: {}, seed: 0 };
        } else {
          building.wings.push(...prim.wings);
        }
        const wingIdx = building.wings.length - prim.wings.length;   // index of this part's first wing
        for (const f of part.features) {
          if (f.type === 'door') doors.push(doorOf(f));
          else if (f.type === 'vent') vents.push(ventOf(f, wingIdx));
        }
      } else {
        others.push(prim);
      }
    }
  }

  const parts: Prim[] = [];
  if (building) {
    const features: BuildingFeatures = {};
    if (doors.length) features.doors = doors;
    if (vents.length) features.vents = vents;
    building.features = features;
    parts.push(building);
  } else {
    // Round/stepped bodies carry no building prim; their door/vent are not rendered as
    // wall openings (the silhouette is a solid mass) — matches today's behaviour.
  }
  parts.push(...others);

  return { size, parts };
}
