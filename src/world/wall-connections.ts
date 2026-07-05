import type { World } from '@/world/world';
import type { WorldSeed } from '@/core/types';
import { BARRIER_DEFAULTS, type BarrierRun } from '@/world/barrier';
import { placeBarrier } from '@/world/place-barrier';

/** The 8 canonical unit deltas (values in {-1,0,1}), indexed by 45° octant from +x. */
const CANONICAL_DIRS: [number, number][] = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
];
/** One diagonal tile-step (1,1) is √2 tiles; the canonical piece is 2 tiles / 2 steps (WP-W1). */
const CARDINAL_PIECE_TILES = 2;
const DIAG_PIECE_TILES = 2 * Math.SQRT2;

/**
 * Snap a 2-point wall endpoint onto the canonical piece grid (WP-W1): keep `from` exactly, run the
 * far end along the nearest of the 8 canonical bearings for a whole number of pieces (each piece = 2
 * along-axis tiles / 2 diagonal steps). Integer-in ⇒ integer-out; a cardinal edge is an even number
 * of tiles, a diagonal edge Δ = (±2k, ±2k).
 */
function snapWallEndpoint(from: { x: number; y: number }, to: { x: number; y: number }): [number, number] {
  const dx = to.x - from.x, dy = to.y - from.y;
  const oct = ((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8;
  const [ux, uy] = CANONICAL_DIRS[oct];
  const isDiag = ux !== 0 && uy !== 0;
  const pieceLen = isDiag ? DIAG_PIECE_TILES : CARDINAL_PIECE_TILES;
  const steps = Math.max(1, Math.round(Math.hypot(dx, dy) / pieceLen));
  // Each step advances one piece: (±2,0)/(0,±2) cardinal or (±2,±2) diagonal → integer, on-grid.
  return [from.x + ux * 2 * steps, from.y + uy * 2 * steps];
}

/** Turn every WorldSeed connection of type 'wall' into a straight wall-run barrier
 *  between the two POIs' positions. Returns the placed entity ids.
 *
 *  A 2-point polyline snapped to the canonical piece grid (WP-W1): the `from` POI anchors the run,
 *  the far end is quantized to the nearest of the 8 bearings + a whole number of pieces (so a
 *  connection wall shares the finite wall-piece vocabulary). Deterministic: ids are stable
 *  (`wall_conn_<from>_<to>`), no Math.random. */
export function placeWallConnections(world: World, worldSeed: WorldSeed): string[] {
  const positions = new Map<string, { x: number; y: number }>();
  for (const poi of worldSeed.pois ?? []) {
    if (poi.position) positions.set(poi.id, poi.position);
  }

  const ids: string[] = [];
  for (const conn of worldSeed.connections ?? []) {
    if (conn.type !== 'wall') continue;
    const from = positions.get(conn.from);
    const to = positions.get(conn.to);
    if (!from || !to) continue;

    const run: BarrierRun = {
      kind: 'wall',
      path: [[from.x, from.y], snapWallEndpoint(from, to)],
      ...BARRIER_DEFAULTS.wall,
      gates: [],
    };
    ids.push(placeBarrier(world, run, `wall_conn_${conn.from}_${conn.to}`));
  }
  return ids;
}
