import type { WorldSeed, POI, Connection } from '@/core/types';
import { deriveMapSize, type MapSize } from '@/world/map-size-derivation';
import { resolveIslandSpec, DEFAULT_ISLAND } from '@/terrain/island-mask';

/**
 * World layout solver (connectome-driven world layout epic, slice W3).
 *
 * W0 derived map *size* from content; W1 added the island ocean frame. But an
 * authored world (default.json) pins its POIs/regions to all four map edges, so
 * turning the island mask on would drown them. This solver closes the gap with a
 * **rigid recenter + ocean-margin transform**: when a world is an island, it
 * grows the map and translates the whole authored layout so the content sits
 * centred inside the island's safe interior, with the coast falling in the
 * margin around it. Relative positions, connections and the connectome are
 * preserved exactly — it is a translation, not a re-layout (the force-directed
 * placement of *position-less* POIs is a later slice; see the epic's Open Q1).
 *
 * Non-island worlds are untouched: the layout is the W0 size with the original
 * positions (byte-identical generation), so existing worlds keep working.
 */

export interface WorldLayout {
  size: MapSize;
  pois: POI[];
  connections: Connection[];
}

export interface LayoutOptions {
  /**
   * Normalised euclidean distance (over the [-1,1]² grid) at which the content
   * bounding-box corner should land. Lower → more ocean margin / safer from the
   * mask. The default keeps the bbox corner just inside the taper so the interior
   * stays land and only the bbox fringe meets the coast.
   */
  targetCornerD?: number;
  /** Round derived dims up to a multiple of this. */
  snap?: number;
  /** Hard ceiling per axis (schema max). */
  maxDim?: number;
}

const DEFAULTS = { targetCornerD: 0.7, snap: 8, maxDim: 512 };

interface Bounds { minX: number; minY: number; maxX: number; maxY: number; }

/** Tight bounding box over all authored content, or null when empty. */
function contentBounds(seed: WorldSeed): Bounds | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let found = false;
  const grow = (x: number, y: number) => {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    found = true;
  };
  for (const poi of seed.pois ?? []) {
    if (poi.position) grow(poi.position.x, poi.position.y);
    if (poi.region) { grow(poi.region.x_min, poi.region.y_min); grow(poi.region.x_max, poi.region.y_max); }
  }
  for (const conn of seed.connections ?? []) {
    for (const wp of conn.waypoints ?? []) grow(wp.x, wp.y);
  }
  return found ? { minX, minY, maxX, maxY } : null;
}

/** Translate a POI by (dx, dy), returning a new POI (originals untouched). */
function shiftPoi(poi: POI, dx: number, dy: number): POI {
  const next: POI = { ...poi };
  if (poi.position) next.position = { x: poi.position.x + dx, y: poi.position.y + dy };
  if (poi.region) {
    next.region = {
      x_min: poi.region.x_min + dx, x_max: poi.region.x_max + dx,
      y_min: poi.region.y_min + dy, y_max: poi.region.y_max + dy,
    };
  }
  return next;
}

function shiftConnection(conn: Connection, dx: number, dy: number): Connection {
  if (!conn.waypoints) return conn;
  return { ...conn, waypoints: conn.waypoints.map(w => ({ x: w.x + dx, y: w.y + dy })) };
}

/**
 * Plan the world's final size and POI positions.
 *
 * - Non-island worlds → W0 size, original content (no translation).
 * - Island worlds → map grown + content recentred so the bbox sits inside the
 *   island's safe interior, with an ocean margin all around.
 */
export function planWorldLayout(seed: WorldSeed, opts: LayoutOptions = {}): WorldLayout {
  const { targetCornerD, snap, maxDim } = { ...DEFAULTS, ...opts };

  if (!seed.island) {
    return { size: deriveMapSize(seed), pois: seed.pois ?? [], connections: seed.connections ?? [] };
  }

  const b = contentBounds(seed);
  if (!b) {
    // Island world with no content: keep the derived (authored/min) size, no shift.
    return { size: deriveMapSize(seed), pois: seed.pois ?? [], connections: seed.connections ?? [] };
  }

  const contentW = b.maxX - b.minX;
  const contentH = b.maxY - b.minY;

  // Size the map so the content half-extent maps to the target normalised radius
  // on each axis (split across the two axes → /√2), giving a centred ocean ring.
  const spec = resolveIslandSpec(seed.island) ?? DEFAULT_ISLAND;
  // For a square mask the safe interior is a band on each axis (use the target
  // directly); for euclidean the corner combines both axes (split by √2).
  const perAxis = spec.shape === 'square' ? targetCornerD : targetCornerD / Math.SQRT2;
  const want = (span: number, authored: number): number => {
    const need = perAxis > 0 ? span / perAxis : span;
    return Math.min(maxDim, Math.max(authored, Math.ceil(need / snap) * snap));
  };
  const width = want(contentW, seed.size?.width ?? 0);
  const height = want(contentH, seed.size?.height ?? 0);

  // Centre the content bbox in the new map and translate everything to match.
  // Offsets MUST be integers: POI/waypoint coords are tile indices, and downstream
  // settlement placement (bresenham door→centre walks) loops forever on fractional
  // endpoints.
  const dx = Math.round((width - contentW) / 2 - b.minX);
  const dy = Math.round((height - contentH) / 2 - b.minY);

  return {
    size: { width, height },
    pois: (seed.pois ?? []).map(p => shiftPoi(p, dx, dy)),
    connections: (seed.connections ?? []).map(c => shiftConnection(c, dx, dy)),
  };
}
