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
   *  the smooth connectome centreline. A fallback for the painted oracle below; the
   *  raster `hydrology.waterType` (D8 sim truth, which staircases off the visible
   *  channel) is the last resort. */
  renderWaterType?: Uint8Array;
  /** The authoritative "is this cell painted blue" oracle (`paintedWaterAt`), injected
   *  by the studio (it needs the render water-surface field). The PAINTED water reaches
   *  ~1 cell past the classified channel via the shader's bilinear surface sample, so a
   *  bank cell the cursor lands on reads water even where the classification says dry.
   *  When supplied it wins, so "looks wet" and "says wet" agree. */
  paintedWaterAt?: (tx: number, ty: number) => { wet: boolean; type: number };
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
  // Classify from what's PAINTED under the cursor. The injected oracle mirrors the
  // shader's bilinear surface clip (so the bank fringe reads water) and is authoritative
  // when present; otherwise fall back to the render mask, then the raster sim truth.
  const painted = opts.paintedWaterAt?.(tx, ty);
  const wt = painted
    ? (painted.wet ? painted.type : WaterType.Dry)
    : (opts.renderWaterType?.[i] ?? hydro.waterType[i] ?? WaterType.Dry);
  if (wt !== WaterType.Dry) {
    const order = hydro.strahler[i];
    const suffix = wt === WaterType.River && order ? ` · order ${order}` : '';
    rows.push(['water', `${WATER_LABEL[wt] ?? 'water'}${suffix}`]);
  }
  const flood = opts.floodM?.[i] ?? 0;
  if (flood > 0.01) rows.push(['flood', `${flood.toFixed(1)} m standing`]);
  return rows;
}
