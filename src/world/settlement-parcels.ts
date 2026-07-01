/**
 * Settlement land parcels — the water-partitioned developable area a settlement
 * occupies. See docs/superpowers/specs/2026-07-01-settlement-water-parcels-design.md.
 *
 * The missing primitive the design calls for: a shared model of *which land the
 * settlement occupies*, partitioned by water, that every downstream stage READS
 * instead of each re-deriving bank geometry from raw tiles.
 *
 *   - Slice 1 shipped `computeHomeParcel`: the connected land component containing
 *     the centre, so building placement (and thus the wall) stays on ONE bank.
 *   - Slice 2 (here) adds `computeSettlementParcels`: the full graph — home parcel,
 *     the adjacent banks in reach, and the short water gaps between them (candidate
 *     bridge/ford sites). It is persisted on the settlement plan and consumed by the
 *     enclosure (the wall gaps wherever it leaves the home bank), so "walls never
 *     span open water" is a guarantee from the model, not a coincidence of heuristics.
 *   - Slice 3 grows this into bridge-gated annexation (a far-bank ward joined by a
 *     crossing) — the crossings computed here are its input.
 *
 * Pure + deterministic: a function of `(tiles, cx, cy, reach)` only, no rng, no
 * Math.random. It only *filters/labels* candidates, never reorders rng draws, so
 * snapshot/replay stays identical for water-free sites and byte-identical for any
 * site with no reachable water.
 */
import type { Tile } from '@/core/types';
import { WATER_TYPES } from '@/core/constants';

const cellKey = (x: number, y: number): string => `${x},${y}`;

/** One connected component of non-water, in-reach land. `id` 0 is always the home parcel. */
export interface LandParcel {
  id: number;
  cells: Set<string>;
  centroid: { x: number; y: number };
}

/** A short water gap where two parcels come within a hop — a candidate bridge/ford. */
export interface ParcelCrossing {
  /** parcel ids (0 = home). */
  from: number;
  to: number;
  /** the home-side land cell the crossing springs from. */
  at: { x: number; y: number };
  /** the far-side land cell the crossing lands on. */
  to_at: { x: number; y: number };
  /** number of water tiles the crossing spans. */
  span: number;
}

/** The settlement's developable area, partitioned by water. */
export interface SettlementParcels {
  home: LandParcel;
  adjacent: LandParcel[];
  crossings: ParcelCrossing[];
}

/** Max water tiles a single perpendicular crossing may span (a plausible bridge/ford). */
const MAX_CROSSING_SPAN = 6;
/** Ignore adjacent slivers smaller than this — noise, not a bank worth annexing. */
const MIN_ADJACENT_CELLS = 4;

/** Shared 4-connected flood-fill of the non-water land component containing `(sx,sy)`. */
function fillComponent(
  sx: number, sy: number,
  isWater: (x: number, y: number) => boolean,
  inReach: (x: number, y: number) => boolean,
  visited: Set<string>,
): { cells: Set<string>; sawWater: boolean } {
  const cells = new Set<string>([cellKey(sx, sy)]);
  visited.add(cellKey(sx, sy));
  const stack: [number, number][] = [[sx, sy]];
  let sawWater = false;
  while (stack.length) {
    const [x, y] = stack.pop()!;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
      if (!inReach(nx, ny)) continue;
      if (isWater(nx, ny)) { sawWater = true; continue; }
      const k = cellKey(nx, ny);
      if (visited.has(k)) continue;
      visited.add(k);
      cells.add(k);
      stack.push([nx, ny]);
    }
  }
  return { cells, sawWater };
}

function centroidOf(cells: Set<string>): { x: number; y: number } {
  let sx = 0, sy = 0;
  for (const k of cells) { const c = k.indexOf(','); sx += +k.slice(0, c); sy += +k.slice(c + 1); }
  return { x: sx / cells.size, y: sy / cells.size };
}

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
  const parcels = computeSettlementParcels(cx, cy, tiles, reach);
  return parcels?.home.cells ?? null;
}

/**
 * The full settlement parcel graph: the home bank, the other land banks within
 * reach (across water), and the short perpendicular water gaps between the home
 * bank and each of them (candidate crossings). Same `null` contract as
 * `computeHomeParcel` — degenerate (centre off-map / on water / no water in reach)
 * ⇒ nothing to partition ⇒ `null`, so dry inland sites stay byte-identical.
 */
export function computeSettlementParcels(
  cx: number,
  cy: number,
  tiles: Tile[][],
  reach: number,
): SettlementParcels | null {
  const h = tiles.length;
  const w = tiles[0]?.length ?? 0;
  if (w === 0 || h === 0) return null;
  const icx = Math.round(cx), icy = Math.round(cy);
  const isWater = (x: number, y: number): boolean => WATER_TYPES.has(tiles[y]?.[x]?.type ?? '');
  const inReach = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < w && y < h && Math.abs(x - icx) <= reach && Math.abs(y - icy) <= reach;

  if (!inReach(icx, icy) || isWater(icx, icy)) return null;  // centre off-map or on water

  const visited = new Set<string>();
  const home = fillComponent(icx, icy, isWater, inReach, visited);
  // No water anywhere in reach ⇒ nothing to partition; skip the whole model so a
  // dry inland site stays byte-identical to the pre-parcels placer.
  if (!home.sawWater) return null;

  const homeParcel: LandParcel = { id: 0, cells: home.cells, centroid: centroidOf(home.cells) };

  // Label the OTHER land components in reach — the adjacent banks across the water.
  const adjacent: LandParcel[] = [];
  let nextId = 1;
  const x0 = Math.max(0, icx - reach), x1 = Math.min(w - 1, icx + reach);
  const y0 = Math.max(0, icy - reach), y1 = Math.min(h - 1, icy + reach);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (isWater(x, y) || visited.has(cellKey(x, y))) continue;
      const comp = fillComponent(x, y, isWater, inReach, visited);
      if (comp.cells.size >= MIN_ADJACENT_CELLS) {
        adjacent.push({ id: nextId++, cells: comp.cells, centroid: centroidOf(comp.cells) });
      }
    }
  }

  return { home: homeParcel, adjacent, crossings: findCrossings(homeParcel, adjacent, isWater, inReach) };
}

/**
 * Candidate crossings: from each home-bank cell that fronts water, cast a ray in the
 * four cardinal directions across water (up to `MAX_CROSSING_SPAN` tiles); if it lands
 * on an adjacent parcel, that's a perpendicular bridge/ford site. Keep only the
 * shortest span to each adjacent parcel (its natural crossing point). Cardinal-only,
 * so a crossing reads as a real span across the channel, not a diagonal shortcut.
 */
function findCrossings(
  home: LandParcel,
  adjacent: LandParcel[],
  isWater: (x: number, y: number) => boolean,
  inReach: (x: number, y: number) => boolean,
): ParcelCrossing[] {
  if (adjacent.length === 0) return [];
  const cellToParcel = new Map<string, number>();
  for (const p of adjacent) for (const k of p.cells) cellToParcel.set(k, p.id);

  const best = new Map<number, ParcelCrossing>();  // adjacent id → shortest crossing
  for (const k of home.cells) {
    const c = k.indexOf(',');
    const hx = +k.slice(0, c), hy = +k.slice(c + 1);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      // Step across water; the first non-water landing decides the ray.
      let span = 0;
      let landed = false, lx = hx, ly = hy;
      for (let d = 1; d <= MAX_CROSSING_SPAN + 1; d++) {
        const nx = hx + dx * d, ny = hy + dy * d;
        if (!inReach(nx, ny)) break;
        if (isWater(nx, ny)) { span = d; continue; }
        lx = nx; ly = ny; landed = true; break;   // hit land — the far bank
      }
      if (!landed || span === 0 || span > MAX_CROSSING_SPAN) continue;
      const toId = cellToParcel.get(cellKey(lx, ly));
      if (toId === undefined) continue;            // landed on home bank or a sliver — not a crossing
      const prev = best.get(toId);
      if (!prev || span < prev.span) {
        best.set(toId, { from: 0, to: toId, at: { x: hx, y: hy }, to_at: { x: lx, y: ly }, span });
      }
    }
  }
  return [...best.values()].sort((a, b) => a.to - b.to);
}
