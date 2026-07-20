// Swamp / wet-lowland ground cover. Swamp biomes used to map to the dense_forest
// brush, whose tileType ('dense_forest') never occurs in swamp's tile mix (swamp .4
// / shallow_water .3 / grass .2 / dirt .1) — so the brush never fired and swamp read
// barren. This brush dresses the swamp/grass/dirt tiles with a sparse alder/willow/
// birch canopy, and packs common-reed / bulrush / sedge DENSELY along the standing-
// water edges (the reedbed fringe) where the swamp meets shallow water.
import { placeVegetation, slopeBandAll, dustBandAll, TREE_SLOPE, COVER_SLOPE, type VegetationParams } from './vegetation-placer';
import { defaultEntity } from '@/world/brush-helpers';
import { registerBrush } from '@/world/brushes';
import { canopyOf, undergrowthOf } from '@/flora/biome-flora';
import type { Entity, Region, BrushContext, GameMap } from '@/core/types';

const BRUSH = 'swamp';
const WATER = new Set(['shallow_water', 'deep_water', 'ocean', 'river']);
const GROUND = new Set(['swamp', 'grass', 'meadow', 'dirt']);
/** The reedbed fringe species, weighted, placed extra-densely at the water's edge. */
const REEDS: [string, number][] = [['common-reed', 0.5], ['bulrush', 0.28], ['carex-sedge', 0.22]];
const EDGE_REED_DENSITY = 0.55;   // dense stands right at the waterline

const SWAMP_PARAMS: VegetationParams = {
  brush: BRUSH,
  tileType: ['swamp', 'grass', 'meadow', 'dirt'],
  kinds: canopyOf('swamp'),
  density: 0.16,            // sparse wet-woodland canopy — the reeds carry the density
  maxPerTile: 1,
  clumpScale: 5,            // alder/willow gather into carr thickets, leaving open fen
  scaleRange: [0.8, 1.2],
  rotationRange: 0,
  offsetRange: [0.5, 0.5],
  undergrowth: undergrowthOf('swamp'),   // reed/bulrush/sedge across the fen
  openUndergrowth: 1,
  // STEEPNESS: fens are flat by nature, but swamp regions can lap against rising
  // ground — the carr canopy and fen cover both fade off any painted-rock face.
  slope: {
    ...slopeBandAll(canopyOf('swamp'), TREE_SLOPE),
    ...slopeBandAll(undergrowthOf('swamp'), COVER_SLOPE),
  },
  // BARE GROUND: uniform rule; fen ground is wet so the gate almost never fires here —
  // it exists so a swamp region lapping onto a dry rise obeys the same paint.
  dust: dustBandAll([...canopyOf('swamp'), ...undergrowthOf('swamp')]),
};

/** Decorrelated [0,1) hash — the mix the vegetation placer uses (no Math.random). */
function hash01(x: number, y: number, key: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(key | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function pickWeighted(rng: number, kinds: [string, number][]): string {
  let total = 0;
  for (const [, w] of kinds) total += w;
  let acc = rng * total;
  for (const [k, w] of kinds) { acc -= w; if (acc <= 0) return k; }
  return kinds[kinds.length - 1][0];
}

function nearWater(tiles: GameMap, x: number, y: number): boolean {
  const offsets: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const [dx, dy] of offsets) {
    const t = tiles.tiles[y + dy]?.[x + dx];
    if (t && WATER.has(t.type)) return true;
  }
  return false;
}

export function swampBrush(region: Region, seed: number, ctx: BrushContext): Entity[] {
  const out = placeVegetation(region, seed, ctx, SWAMP_PARAMS);
  // Reedbed fringe: extra dense reed/bulrush/sedge on the ground cells that touch
  // standing water — the visible edge where the fen becomes reedbed.
  for (let y = region.y; y < region.y + region.h; y++) {
    for (let x = region.x; x < region.x + region.w; x++) {
      const tile = ctx.tiles.tiles[y]?.[x];
      if (!tile || !GROUND.has(tile.type)) continue;
      if (!nearWater(ctx.tiles, x, y)) continue;
      const s = (seed ^ 0x5eed) + (y * ctx.tiles.width + x) * 3;
      if (hash01(x, y, s) >= EDGE_REED_DENSITY) continue;
      const kind = pickWeighted(hash01(x, y, s + 1), REEDS);
      const fx = 0.5 + (hash01(x, y, s + 2) - 0.5) * 0.9;
      const fy = 0.5 + (hash01(x, y, s + 3) - 0.5) * 0.9;
      out.push(defaultEntity(BRUSH, kind, x + fx, y + fy, {
        offsetX: fx, offsetY: fy, scale: 0.7 + hash01(x, y, s + 4) * 0.5,
      }));
    }
  }
  return out;
}

registerBrush(BRUSH, swampBrush);
