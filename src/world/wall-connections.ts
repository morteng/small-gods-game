import type { World } from '@/world/world';
import type { WorldSeed } from '@/core/types';
import { BARRIER_DEFAULTS, type BarrierRun } from '@/world/barrier';
import { placeBarrier } from '@/world/place-barrier';

/** Turn every WorldSeed connection of type 'wall' into a straight wall-run barrier
 *  between the two POIs' positions. Returns the placed entity ids.
 *
 *  Straight 2-point polyline — terrain-following is a later track. Deterministic:
 *  ids are stable (`wall_conn_<from>_<to>`), no Math.random. */
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
      path: [[from.x, from.y], [to.x, to.y]],
      ...BARRIER_DEFAULTS.wall,
      gates: [],
    };
    ids.push(placeBarrier(world, run, `wall_conn_${conn.from}_${conn.to}`));
  }
  return ids;
}
