/**
 * BuildingDescriptor — the single, parametric source of truth for every
 * building. Stored in `entity.properties.descriptor` (rides snapshot/save with
 * no version bump). Drives a topdown silhouette today; carries full 3D massing
 * intent (plan/levels/levelInset/heightPerLevel/roof) for the future renderer.
 *
 * Every taxonomy axis is open/extensible: unions extend by adding a member,
 * colour lookups fall back to a neutral grey for unknown materials (never throw).
 */
import type { Entity, Era, ReligiousSignificance } from '@/core/types';

export type BuildingCategory =
  | 'residential' | 'religious' | 'commercial' | 'military' | 'farm' | 'special';

/** Ground-outline shape. Extend by adding a member + a case in building-massing. */
export type Plan = 'rect' | 'round' | 'L' | 'cross' | 'stepped';
/** Roof silhouette. Extend by adding a member + a case in building-massing. */
export type Roof =
  | 'flat' | 'gable' | 'hip' | 'conical' | 'domed' | 'stepped' | 'lean_to'
  | 'gambrel' | 'mansard' | 'pyramidal' | 'saltbox' | 'onion' | 'spire'
  | 'tented' | 'jerkinhead' | 'cross_gable';
export type WallMat = 'mud' | 'wattle' | 'timber' | 'log' | 'brick' | 'stone' | 'marble' | 'hide';
export type RoofMat = 'thatch' | 'wood' | 'tile' | 'slate' | 'hide' | 'none';
export type GroundMat = 'flagstone' | 'dirt' | 'packed_dirt' | 'wood' | 'tile' | 'gravel';

export interface BuildingPalette { walls: string; roof: string; trim: string }

/** A smoke/steam emission point. Drawn as a stack in the guide render; reserved as
 *  the anchor for future particle smoke. Position is tile-relative like `door`. */
export interface Vent {
  x: number;
  y: number;
  /** mouth/emitter height in tile-height units above the roof base */
  height: number;
  kind: 'chimney' | 'smokehole' | 'pipe';
  emit?: 'smoke' | 'steam';
}

export interface BuildingDescriptor {
  /** Name of the seed preset, if any. Becomes the entity `kind`. */
  preset?: string;
  category: BuildingCategory;
  era: Era;

  // massing (silhouette now; 3D extrusion later)
  footprint: { w: number; h: number };
  plan: Plan;
  levels: number;
  levelInset: number;
  heightPerLevel: number;

  roof: Roof;

  walls: WallMat;
  roofMat: RoofMat;
  palette?: Partial<BuildingPalette>;

  // terrain ordering (derived at render time — see render/ground-material.ts)
  groundMaterial?: GroundMat;
  apron?: { radius: number; material: GroundMat };

  /** The one passable footprint cell, relative to the footprint top-left. */
  door: { x: number; y: number };
  /** Optional smoke vents (chimneys/smokeholes/pipes), for buildings that have them. */
  vents?: Vent[];
}

export const NEUTRAL = '#8a8a8a';

/** Open registry — add a material by adding a line. */
export const WALL_COLORS: Record<WallMat, string> = {
  mud: '#9c7a4f', wattle: '#b29162', timber: '#8B5A2B', log: '#7a5230',
  brick: '#9e4b34', stone: '#8a8a8a', marble: '#e8e6df', hide: '#b9a07a',
};
export const ROOF_COLORS: Record<RoofMat, string> = {
  thatch: '#c9a227', wood: '#6b4a2b', tile: '#8B2E2E', slate: '#4b5563',
  hide: '#a98c63', none: '#00000000',
};
export const GROUND_COLORS: Record<GroundMat, string> = {
  flagstone: '#9aa0a6', dirt: '#8a6a45', packed_dirt: '#7a5d3c',
  wood: '#7a5230', tile: '#b06a4a', gravel: '#9b9690',
};

function colour<K extends string>(table: Record<K, string>, key: K): string {
  return table[key] ?? NEUTRAL;
}

/** Derive wall/roof/trim colours from materials; `palette` overrides win. */
export function buildingPalette(d: BuildingDescriptor): BuildingPalette {
  const walls = colour(WALL_COLORS, d.walls);
  const roof = colour(ROOF_COLORS, d.roofMat);
  return {
    walls: d.palette?.walls ?? walls,
    roof: d.palette?.roof ?? roof,
    trim: d.palette?.trim ?? NEUTRAL,
  };
}

/**
 * Build a building Entity from a descriptor. `kind` is the preset name (so the
 * existing entity-kind defs resolve) or the generic `'building'` kind. The
 * footprint is mirrored to `properties.footprint` so EntityRegistry indexes
 * every covered cell.
 */
export function buildingEntity(
  id: string, d: BuildingDescriptor, x: number, y: number,
  extra: { poiId?: string; religiousSignificance?: ReligiousSignificance; state?: string } = {},
): Entity {
  return {
    id,
    kind: d.preset ?? 'building',
    x, y,
    tags: ['building', d.category],
    properties: {
      category: 'building',
      descriptor: d,
      footprint: { ...d.footprint },
      door: { ...d.door },
      vents: d.vents ? d.vents.map(v => ({ ...v })) : [],
      sortYOffset: d.footprint.h,
      era: d.era,
      poiId: extra.poiId,
      religiousSignificance:
        extra.religiousSignificance ?? (d.category === 'religious' ? 'sacred' : 'neutral'),
      state: extra.state ?? 'intact',
    },
  };
}
