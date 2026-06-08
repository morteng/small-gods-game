// src/blueprint/materials.ts
// Material → colour lookup tables, relocated verbatim from the retired flat
// descriptor model. Open registries — add a material by adding a line; unknown
// keys fall back to a neutral grey (never throw) via `colour()`.

export type WallMat = 'mud' | 'wattle' | 'timber' | 'log' | 'brick' | 'stone' | 'marble' | 'hide';
export type RoofMat = 'thatch' | 'wood' | 'tile' | 'slate' | 'hide' | 'none';
export type GroundMat = 'flagstone' | 'dirt' | 'packed_dirt' | 'wood' | 'tile' | 'gravel';

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

export function colour<K extends string>(table: Record<K, string>, key: K): string {
  return table[key] ?? NEUTRAL;
}
