// src/world/mill-site-store.ts
//
// WATERMILL SITES — a hydrology-derived affordance layer. The water system, during worldgen,
// TAGS the cells that make good watermill locations: a dry, buildable bank cell sitting right
// against a flowing river reach of wheel-scale (a real stream, not a headwater trickle nor a
// trunk river). Settlement siting then just picks the nearest tag, so a mill lands FLUSH against
// water that already renders — the wheel dips into a genuine river cell instead of a carved
// channel the engine won't paint (the GPU water surface is re-derived from the seed heightfield,
// never from tile edits). This is the declare-affordance / resolve-to-real-terrain pattern the
// coastline anchoring already uses, lifted onto the hydrology raster.
//
// A pure VIEW of the hydrology raster (like `getWaterNetwork`): re-derives identically on load,
// keyed only by (seed, dims), never travels in the save.

import type { GameMap } from '@/core/types';
import { WaterType } from '@/core/types';
import { getHydrologyResult } from '@/world/hydrology-store';
import { buildRenderWaterTypeMemo } from '@/render/gpu/render-water-mask';

export type MillFace = 'north' | 'south' | 'east' | 'west';

export interface MillSite {
  /** The dry BANK cell (footprint anchor) orthogonally adjacent to the river reach. */
  x: number;
  y: number;
  /** Cardinal from the bank toward the river — the flank the wheel should face. */
  waterFace: MillFace;
  /** Unit flow of the river cell (downstream sense — for a future spin direction). */
  flowDir: [number, number];
  /** Flow-accumulation of the river cell — a wheel-power proxy; higher = stronger site. */
  strength: number;
}

// Strahler band for a wheel-scale stream: above a headwater trickle (1), below a trunk river.
const MIN_ORDER = 2;
const MAX_ORDER = 6;

const NEIGH: ReadonlyArray<readonly [number, number, MillFace]> = [
  [0, -1, 'north'], [0, 1, 'south'], [-1, 0, 'west'], [1, 0, 'east'],
];

const cache = new Map<string, MillSite[]>();
const CACHE_CAP = 4;
const keyOf = (m: GameMap): string => `${m.seed}:${m.width}x${m.height}`;

/** Every good watermill site on the map, strongest flow first. Memoised by (seed, dims). */
export function getMillSites(map: GameMap): MillSite[] {
  const k = keyOf(map);
  const hit = cache.get(k);
  if (hit) { cache.delete(k); cache.set(k, hit); return hit; }   // LRU touch
  const sites = computeMillSites(map);
  cache.set(k, sites);
  if (cache.size > CACHE_CAP) cache.delete(cache.keys().next().value as string);
  return sites;
}

function computeMillSites(map: GameMap): MillSite[] {
  const hydro = getHydrologyResult(map);
  const { strahler, flowField, flowDirX, flowDirY } = hydro;
  const W = map.width, H = map.height;
  // Tag against the RENDER water — the smoothed connectome ribbon the shader actually paints —
  // not the hydrology raster / tile 'river', which can sit a cell off the visible channel at
  // meanders (so a mill tagged on the raster could dip into dry-looking ground). The wheel-scale
  // filter still comes from the hydrology Strahler/flow, sampled over a 3×3 around the ribbon
  // cell to bridge that raster↔ribbon offset.
  const renderWT = buildRenderWaterTypeMemo(map);
  const idx = (x: number, y: number): number => y * W + x;
  // Strongest (max-order) hydrology channel cell within a 3×3 of (cx,cy) — the raster reach that
  // feeds this rendered river cell — with its flow for scoring.
  const channelAround = (cx: number, cy: number): { ord: number; k: number } => {
    let ord = -1, k = -1;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const kk = idx(x, y);
        if (strahler[kk] > ord) { ord = strahler[kk]; k = kk; }
      }
    }
    return { ord, k };
  };
  const out: MillSite[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (renderWT[idx(x, y)] !== WaterType.Dry) continue;   // the bank must be dry (rendered) land
      let bestS = -1, bestFace: MillFace | null = null, bestK = -1;
      for (const [dx, dy, face] of NEIGH) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        if (renderWT[idx(nx, ny)] !== WaterType.River) continue;   // a RENDERED flowing reach
        const { ord, k } = channelAround(nx, ny);
        if (ord < MIN_ORDER || ord > MAX_ORDER || k < 0) continue;  // wheel-scale, not trunk/trickle
        const s = flowField[k];
        if (s > bestS) { bestS = s; bestFace = face; bestK = k; }
      }
      if (bestFace) {
        out.push({ x, y, waterFace: bestFace, flowDir: [flowDirX[bestK], flowDirY[bestK]], strength: bestS });
      }
    }
  }
  out.sort((a, b) => b.strength - a.strength);
  return out;
}

/** The good mill sites within `maxDist` tiles of (cx,cy), NEAREST first (flow breaks ties, since
 *  the input is flow-sorted). The caller tries them in order until a clean footprint seats. */
export function millSitesNear(sites: MillSite[], cx: number, cy: number, maxDist: number): MillSite[] {
  return sites
    .filter(s => Math.abs(s.x - cx) + Math.abs(s.y - cy) <= maxDist)
    .sort((a, b) => (Math.abs(a.x - cx) + Math.abs(a.y - cy)) - (Math.abs(b.x - cx) + Math.abs(b.y - cy)));
}
