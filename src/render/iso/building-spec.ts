// src/render/iso/building-spec.ts
// Pure mapping: in-game BuildingDescriptor → assetgen StructureSpec, so the manifold
// parametric generator can render the SAME building the sim placed. Reference:
// building-massing-model.ts. Returns null for plans the rectilinear-wing generator
// can't express (round/stepped) so callers fall back to the legacy massing.
import type { BuildingDescriptor, Plan, Roof, WallMat, RoofMat, Vent } from '@/world/building-descriptor';
import type { Mat } from '@/assetgen/types';
import type { Wing, RoofKind, WallFace, BuildingFeatures } from '@/assetgen/geometry/building';
import type { StructureSpec } from '@/assetgen/compose';
import { ISO_TILE_W } from '@/render/iso/iso-constants';

const WALL_MAT: Record<WallMat, Mat> = {
  mud: 'plaster', wattle: 'plaster', hide: 'plaster',
  timber: 'timber', log: 'timber', brick: 'brick', stone: 'stone', marble: 'stone',
};
const ROOF_MAT: Record<RoofMat, Mat> = {
  thatch: 'thatch', hide: 'thatch', wood: 'timber', tile: 'tile', slate: 'stone', none: 'tile',
};
const ROOF_KIND: Record<Roof, RoofKind> = {
  gable: 'gable', gambrel: 'gable', mansard: 'gable', saltbox: 'gable',
  jerkinhead: 'gable', cross_gable: 'gable', lean_to: 'gable',
  hip: 'hip',
  pyramidal: 'pyramidal', conical: 'pyramidal', spire: 'pyramidal',
  tented: 'pyramidal', onion: 'pyramidal', domed: 'pyramidal',
  flat: 'flat', stepped: 'flat',
};

/** Wing layout per plan; null = not a rectilinear-wing plan (caller falls back). */
function planWings(plan: Plan, fp: { w: number; h: number }): Array<{ x: number; y: number; w: number; h: number }> | null {
  const { w, h } = fp;
  switch (plan) {
    case 'rect':
      return [{ x: 0, y: 0, w, h }];
    case 'cross': {
      const naveH = Math.max(1, Math.round(h / 2));
      const transW = Math.max(1, Math.round(w / 2));
      return [
        { x: 0, y: Math.floor((h - naveH) / 2), w, h: naveH },             // nave (long axis x)
        { x: Math.floor((w - transW) / 2), y: 0, w: transW, h },           // transept (long axis y)
      ];
    }
    case 'L': {
      const barH = Math.max(1, Math.round(h / 2));
      const armW = Math.max(1, Math.round(w / 2));
      return [
        { x: 0, y: 0, w, h: barH },        // bottom bar
        { x: 0, y: 0, w: armW, h },         // side arm
      ];
    }
    case 'round':
    case 'stepped':
      return null;
  }
}

function doorFace(cell: { x: number; y: number }, fp: { w: number; h: number }): WallFace {
  if (cell.y >= fp.h - 1) return 'south';
  if (cell.x >= fp.w - 1) return 'east';
  if (cell.y <= 0) return 'north';
  if (cell.x <= 0) return 'west';
  return 'south';
}

function ventFeatures(vents: Vent[] | undefined): BuildingFeatures['vents'] {
  if (!vents || vents.length === 0) return undefined;
  const n = vents.length;
  return vents.map((v, i) => ({ wing: 0, t: (i + 1) / (n + 1), kind: v.kind, placement: 'ridge' as const }));
}

/** Map a descriptor to a one-part building StructureSpec, or null to fall back to massing. */
export function descriptorToSpec(d: BuildingDescriptor): StructureSpec | null {
  const layout = planWings(d.plan, d.footprint);
  if (!layout) return null;

  const storeys = Math.max(1, d.levels);
  const roof = ROOF_KIND[d.roof] ?? 'gable';
  const wings: Wing[] = layout.map(r => ({ ...r, storeys, roof }));

  const features: BuildingFeatures = { doors: [{ face: doorFace(d.door, d.footprint), main: true }] };
  const vents = ventFeatures(d.vents);
  if (vents) features.vents = vents;

  const size = Math.min(640, Math.max(128, Math.round((d.footprint.w + d.footprint.h) * ISO_TILE_W * 0.65)));

  return {
    size,
    parts: [{
      prim: 'building',
      wings,
      wallMat: WALL_MAT[d.walls] ?? 'plaster',
      roofMat: ROOF_MAT[d.roofMat] ?? 'tile',
      roofStyle: 'gable',
      features,
      seed: 0,
    }],
  };
}
