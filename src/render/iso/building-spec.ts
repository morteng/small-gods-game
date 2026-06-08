// src/render/iso/building-spec.ts
// Pure mapping: in-game BuildingDescriptor → assetgen StructureSpec, so the manifold
// parametric generator can render the SAME building the sim placed. Reference:
// building-massing-model.ts. Round/stepped plans now emit solid prims (cylinder/cone/
// ellipsoid/box) rather than returning null.
import type { BuildingDescriptor, Plan, Roof, WallMat, RoofMat, Vent } from '@/world/building-descriptor';
import { structureRect, type StructureRect } from '@/world/building-descriptor';
import type { Mat } from '@/assetgen/types';
import type { Wing, RoofKind, WallFace, BuildingFeatures } from '@/assetgen/geometry/building';
import { STOREY } from '@/assetgen/geometry/building';
import type { Part, StructureSpec } from '@/assetgen/compose';
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

// planWings now operates on the STRUCTURE dims (the building body), local origin (0,0).
function planWings(plan: Plan, s: StructureRect): Array<{ x: number; y: number; w: number; h: number }> {
  const { w, h } = s;
  switch (plan) {
    case 'rect':
      return [{ x: 0, y: 0, w, h }];
    case 'cross': {
      const naveH = Math.max(1, Math.round(h / 2));
      const transW = Math.max(1, Math.round(w / 2));
      return [
        { x: 0, y: Math.floor((h - naveH) / 2), w, h: naveH },
        { x: Math.floor((w - transW) / 2), y: 0, w: transW, h },
      ];
    }
    case 'L': {
      const barH = Math.max(1, Math.round(h / 2));
      const armW = Math.max(1, Math.round(w / 2));
      return [
        { x: 0, y: 0, w, h: barH },
        { x: 0, y: 0, w: armW, h },
      ];
    }
    default:
      return [{ x: 0, y: 0, w, h }];   // round/stepped handled separately; never reached
  }
}

// door face in STRUCTURE-local coordinates.
function doorFace(localDoor: { x: number; y: number }, s: StructureRect): WallFace {
  if (localDoor.y >= s.h - 1) return 'south';
  if (localDoor.x >= s.w - 1) return 'east';
  if (localDoor.y <= 0) return 'north';
  if (localDoor.x <= 0) return 'west';
  return 'south';
}

function ventFeatures(vents: Vent[] | undefined): BuildingFeatures['vents'] {
  if (!vents || vents.length === 0) return undefined;
  const n = vents.length;
  return vents.map((v, i) => ({ wing: 0, t: (i + 1) / (n + 1), kind: v.kind, placement: 'ridge' as const }));
}

// Round: a cylinder wall + a cone (spire/conical) or ellipsoid (dome/onion) cap.
function roundParts(d: BuildingDescriptor, s: StructureRect): Part[] {
  const r = Math.min(s.w, s.h) / 2;
  const cx = s.w / 2, cy = s.h / 2;
  const wallH = Math.max(1, d.levels) * STOREY;
  const wallMat = WALL_MAT[d.walls] ?? 'plaster';
  const roofMat = ROOF_MAT[d.roofMat] ?? 'tile';
  const parts: Part[] = [
    { prim: 'cylinder', center: [cx, cy], baseZ: 0, radius: r, height: wallH, material: wallMat },
  ];
  if (d.roof === 'flat') return parts;
  if (d.roof === 'domed' || d.roof === 'onion') {
    parts.push({ prim: 'ellipsoid', center: [cx, cy], baseZ: wallH, radii: [r, r, r * 0.8], material: roofMat });
  } else {
    parts.push({ prim: 'cone', center: [cx, cy], baseZ: wallH, radius: r, height: r * 1.2, material: roofMat });
  }
  return parts;
}

// Stepped: `levels` stacked boxes, each inset `levelInset` per side per level.
function steppedParts(d: BuildingDescriptor, s: StructureRect): Part[] {
  const levels = Math.max(1, d.levels);
  const inset = Math.max(0, d.levelInset);
  const wallMat = WALL_MAT[d.walls] ?? 'plaster';
  const parts: Part[] = [];
  for (let lvl = 0; lvl < levels; lvl++) {
    const off = inset * lvl;
    const w = s.w - 2 * off, h = s.h - 2 * off;
    if (w <= 0 || h <= 0) break;
    parts.push({ prim: 'box', at: [off, off, lvl * STOREY], size: [w, h, STOREY], material: wallMat });
  }
  return parts;
}

/** Map a descriptor to a StructureSpec. Never null for known plans (round/stepped use solids). */
export function descriptorToSpec(d: BuildingDescriptor): StructureSpec | null {
  const s = structureRect(d);
  const size = Math.min(640, Math.max(128, Math.round((s.w + s.h) * ISO_TILE_W * 0.65)));

  if (d.plan === 'round')   return { size, parts: roundParts(d, s) };
  if (d.plan === 'stepped') return { size, parts: steppedParts(d, s) };

  const layout = planWings(d.plan, s);
  const storeys = Math.max(1, d.levels);
  const roof = ROOF_KIND[d.roof] ?? 'gable';
  const wings: Wing[] = layout.map(r => ({ ...r, storeys, roof }));

  const localDoor = { x: d.door.x - s.dx, y: d.door.y - s.dy };
  const features: BuildingFeatures = { doors: [{ face: doorFace(localDoor, s), main: true }] };
  const vents = ventFeatures(d.vents);
  if (vents) features.vents = vents;

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
