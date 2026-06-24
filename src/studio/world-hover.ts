// src/studio/world-hover.ts
//
// Per-pixel hover INSPECTION for the world studio (DIR-C). Given a tile the
// cursor is over, resolve everything the world knows about it — terrain type,
// elevation in metres, the hydrology class (ocean / lake / river + Strahler
// order), and any standing flood water — into a flat label/value list the
// studio's floating readout draws.
//
// Pure + testable: the only inputs are the (already-derived) map + the live
// flood field. The water-network node / POI / building hits live in the studio
// itself (they need the camera + pick helpers); this is the terrain substrate
// every hover falls back to.

import type { GameMap } from '@/core/types';
import { WaterType } from '@/core/types';
import { heightMetresAt } from '@/world/heightfield';
import { getHydrologyResult } from '@/world/hydrology-store';

const WATER_LABEL: Record<number, string> = {
  [WaterType.Dry]: 'dry',
  [WaterType.Ocean]: 'ocean',
  [WaterType.Lake]: 'lake',
  [WaterType.River]: 'river',
};

export interface TileReadoutOpts {
  /** Per-cell standing water depth in metres (W-E flood field), if any. */
  floodM?: Float32Array;
  /** The RENDER water classification (`buildRenderWaterType`) — rivers re-stamped along
   *  the smooth connectome centreline, i.e. EXACTLY what the terrain pass paints damp.
   *  When supplied, the readout's water class reads from this so "looks like a river"
   *  and "says river" always agree; the raster `hydrology.waterType` (the D8 sim truth,
   *  which staircases off the visible channel) is the fallback. */
  renderWaterType?: Uint8Array;
}

/**
 * The terrain/water readout rows for tile (tx,ty). Always leads with the tile
 * coordinate; off-map cursors get a single "off-map" row. Hydrology is read from
 * the memoised store, so this is cheap to call per mouse-move.
 */
export function tileReadout(map: GameMap, tx: number, ty: number, opts: TileReadoutOpts = {}): [string, string][] {
  const rows: [string, string][] = [['tile', `${tx}, ${ty}`]];
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) {
    rows.push(['', 'off-map']);
    return rows;
  }
  const tile = map.tiles[ty]?.[tx];
  if (tile?.type) rows.push(['terrain', tile.type]);
  rows.push(['elevation', `${heightMetresAt(map, tx, ty).toFixed(1)} m`]);

  const hydro = getHydrologyResult(map);
  const i = ty * map.width + tx;
  // Classify from what's PAINTED (render mask) when available, so the readout matches
  // the pixels under the cursor; fall back to the raster sim classification otherwise.
  const wt = opts.renderWaterType?.[i] ?? hydro.waterType[i] ?? WaterType.Dry;
  if (wt !== WaterType.Dry) {
    const order = hydro.strahler[i];
    const suffix = wt === WaterType.River && order ? ` · order ${order}` : '';
    rows.push(['water', `${WATER_LABEL[wt] ?? 'water'}${suffix}`]);
  }
  const flood = opts.floodM?.[i] ?? 0;
  if (flood > 0.01) rows.push(['flood', `${flood.toFixed(1)} m standing`]);
  return rows;
}
