/**
 * Settlement land parcels — the water-partitioned developable area a settlement
 * occupies. See docs/superpowers/specs/2026-07-01-settlement-water-parcels-design.md.
 *
 * Slice 1 ships `computeHomeParcel`: the connected land component containing the
 * settlement centre, so building placement (and thus the wall) stays on ONE bank
 * instead of straddling a river. Later slices grow this into a full parcel graph
 * (adjacent banks + crossings) persisted on the settlement plan.
 */
import type { Tile } from '@/core/types';
import { WATER_TYPES } from '@/core/constants';

const cellKey = (x: number, y: number): string => `${x},${y}`;

/**
 * The set of land cells reachable from `(cx,cy)` without crossing water — the
 * settlement's "home bank". A 4-connected flood-fill over non-water tiles, bounded
 * to a Chebyshev `reach` box around the centre (and the map bounds). Returns `null`
 * when there is nothing to confine to — the centre is off-map or on water, or the
 * whole reach is dry (no water to partition) — so callers fall back to no
 * restriction (behaviour-preserving). 4-connectivity (not 8) so a thin diagonal
 * river cannot leak the mask onto the far bank.
 */
export function computeHomeParcel(
  cx: number,
  cy: number,
  tiles: Tile[][],
  reach: number,
): Set<string> | null {
  const h = tiles.length;
  const w = tiles[0]?.length ?? 0;
  if (w === 0 || h === 0) return null;
  const icx = Math.round(cx), icy = Math.round(cy);
  const isWater = (x: number, y: number): boolean => WATER_TYPES.has(tiles[y]?.[x]?.type ?? '');
  const inReach = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < w && y < h && Math.abs(x - icx) <= reach && Math.abs(y - icy) <= reach;

  if (!inReach(icx, icy) || isWater(icx, icy)) return null;  // centre off-map or on water

  const mask = new Set<string>([cellKey(icx, icy)]);
  const stack: [number, number][] = [[icx, icy]];
  let sawWater = false;
  while (stack.length) {
    const [x, y] = stack.pop()!;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
      if (!inReach(nx, ny)) continue;
      if (isWater(nx, ny)) { sawWater = true; continue; }
      const k = cellKey(nx, ny);
      if (mask.has(k)) continue;
      mask.add(k);
      stack.push([nx, ny]);
    }
  }
  // No water anywhere in reach ⇒ nothing to partition; skip the restriction so a
  // dry inland site stays byte-identical to the pre-parcels placer.
  return sawWater ? mask : null;
}
