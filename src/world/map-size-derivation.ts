import type { WorldSeed } from '@/core/types';

/**
 * W0 — World-layout seam (connectome-driven world layout epic).
 *
 * Make `mapSize` *derivable* from the world connectome (POIs + their regions +
 * connection waypoints) instead of being a purely authored value, so the map is
 * always large enough to contain the specified content.
 *
 * Two regimes, by design:
 *
 *  - **Authored size present** → the function is a SAFETY FLOOR only. It never
 *    shrinks below the authored size and never adds margin; it only *grows* the
 *    map if authored content would otherwise fall outside the grid. For a
 *    well-authored world (e.g. `default.json`, where every POI sits inside the
 *    authored 128×96) this is a no-op — authored worlds stay byte-identical.
 *
 *  - **No authored size** (content-defined world) → the size is derived from the
 *    content bounding box plus a margin, snapped up. This is the "new worlds can
 *    be content-defined and larger" path.
 *
 * POIs are authored in grid coordinates anchored at origin (0,0), so we only
 * need to fit the upper bound — W0 does not translate/reposition content. A full
 * POI auto-layout solver is a later slice (see the epic's open questions).
 */
export interface DeriveMapSizeOptions {
  /** Tiles added around content when size is auto-derived (no authored size). */
  margin?: number;
  /** Round derived dimensions up to a multiple of this (tidiness). */
  snap?: number;
  /** Hard floor per axis (matches the schema minimum of 16). */
  minDim?: number;
  /** Hard ceiling per axis (matches the schema maximum of 512). */
  maxDim?: number;
}

const DEFAULTS: Required<DeriveMapSizeOptions> = {
  margin: 16,
  snap: 8,
  minDim: 16,
  maxDim: 512,
};

export interface MapSize {
  width: number;
  height: number;
}

/** Upper extent (max x, max y) of all authored content, or null if empty. */
function contentExtent(seed: WorldSeed): { maxX: number; maxY: number } | null {
  let maxX = -Infinity;
  let maxY = -Infinity;
  let found = false;

  for (const poi of seed.pois ?? []) {
    if (poi.position) {
      maxX = Math.max(maxX, poi.position.x);
      maxY = Math.max(maxY, poi.position.y);
      found = true;
    }
    if (poi.region) {
      maxX = Math.max(maxX, poi.region.x_max);
      maxY = Math.max(maxY, poi.region.y_max);
      found = true;
    }
  }

  for (const conn of seed.connections ?? []) {
    for (const wp of conn.waypoints ?? []) {
      maxX = Math.max(maxX, wp.x);
      maxY = Math.max(maxY, wp.y);
      found = true;
    }
  }

  return found ? { maxX, maxY } : null;
}

/**
 * Derive the effective map size for a world seed.
 *
 * @returns the size to generate the grid at — guaranteed to contain all authored
 *   content, never smaller than the authored size, and clamped to [minDim, maxDim].
 */
export function deriveMapSize(seed: WorldSeed, opts: DeriveMapSizeOptions = {}): MapSize {
  const { margin, snap, minDim, maxDim } = { ...DEFAULTS, ...opts };

  const authoredW = seed.size?.width ?? 0;
  const authoredH = seed.size?.height ?? 0;
  const hasAuthored = authoredW >= minDim && authoredH >= minDim;

  const extent = contentExtent(seed);
  // Grid bounds are exclusive (a tile at coord N needs width > N), so +1.
  const contentW = extent ? Math.ceil(extent.maxX) + 1 : 0;
  const contentH = extent ? Math.ceil(extent.maxY) + 1 : 0;

  const clamp = (n: number): number => Math.max(minDim, Math.min(maxDim, n));

  if (hasAuthored) {
    // Safety floor: grow only to contain content, no margin → no-op when content fits.
    return {
      width: clamp(Math.max(authoredW, contentW)),
      height: clamp(Math.max(authoredH, contentH)),
    };
  }

  // Content-defined world: content bbox + margin, snapped up.
  const snapUp = (n: number): number => clamp(Math.ceil((n + margin) / snap) * snap);
  return {
    width: snapUp(contentW),
    height: snapUp(contentH),
  };
}
