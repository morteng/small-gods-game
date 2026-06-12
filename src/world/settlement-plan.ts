/**
 * Settlement plan — the road graph + frontage slots a settlement is built
 * around (growth slice S1).
 *
 * `planSettlement` turns a zone rule into an explicit, deterministic plan:
 * road edges as tile runs between typed nodes, and frontage slots (road tile
 * + perpendicular side) that buildings claim so their DOORS FACE THE ROAD.
 * The executor lives in `building-placer.ts`; this module is pure data over
 * tiles + seeded rng, so future slices (live growth, constraint catalogue)
 * can extend the same plan during play.
 */

import type { Tile } from '@/core/types';
import type { ZoneRule } from '@/map/poi-zones';
import { Random } from '@/core/noise';

/** Water tile types — roads and footprints must avoid these. */
export const WATER_TYPES = new Set(['deep_water', 'shallow_water', 'river', 'ocean', 'water']);

export interface RoadNode {
  id: string;
  x: number;
  y: number;
  kind: 'founding' | 'junction' | 'end';
}

export interface RoadEdge {
  a: string;                       // node ids
  b: string;
  tiles: { x: number; y: number }[];
  kind: 'through' | 'lane';
}

/** A buildable candidate beside one road tile. The building goes on `side`;
 *  its door must face back (−side) onto the road. */
export interface FrontageSlot {
  roadX: number;
  roadY: number;
  side: [number, number];          // unit vector road → building side
  edge: number;                    // index into plan.edges
  dist: number;                    // Manhattan distance from the founding node
}

export interface SettlementPlan {
  center: { x: number; y: number };
  nodes: RoadNode[];
  edges: RoadEdge[];
  slots: FrontageSlot[];
}

/** Per-preset siting preferences (grows into the S4 constraint catalogue). */
export interface SiteRule {
  /** Hard requirement: water within this many tiles of the footprint. */
  nearWater?: number;
  /** Soft preference for frontage near the founding node or the edge of town. */
  affinity?: 'center' | 'edge';
}

export const SITE_RULES: Record<string, SiteRule> = {
  dock:         { nearWater: 2 },
  tavern:       { affinity: 'center' },
  temple_small: { affinity: 'center' },
  shrine:       { affinity: 'center' },
  market_stall: { affinity: 'center' },
  farm_barn:    { affinity: 'edge' },
  longhouse:    { affinity: 'edge' },
};

/**
 * Register/override a siting rule at runtime — the same open-registry pattern
 * as blueprint part/feature types. This is the seam agents (Fate, the Create
 * panel, era content packs) use to direct placement for new or existing
 * building types without touching this table.
 */
export function registerSiteRule(preset: string, rule: SiteRule): void {
  SITE_RULES[preset] = rule;
}

/** Walk `len` tiles from (x0,y0) along dir, keeping in-bounds non-water tiles. */
function walkTiles(
  x0: number, y0: number, dir: { dx: number; dy: number }, len: number, tiles: Tile[][],
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i <= len; i++) {
    const x = x0 + dir.dx * i, y = y0 + dir.dy * i;
    const t = tiles[y]?.[x];
    if (!t || WATER_TYPES.has(t.type)) continue;
    out.push({ x, y });
  }
  return out;
}

/**
 * Build the road graph + frontage slots for a settlement.
 *
 * The main street snaps to the dominant axis of the first connected-POI
 * direction (inter-POI connector roads stay organic — they're carved
 * separately). Layouts: `linear` = one through street; `branching` = through
 * street + two short perpendicular lanes at the founding node; `grid` =
 * through street + a parallel lane each side + two cross connectors.
 */
export function planSettlement(
  center: { x: number; y: number },
  rule: ZoneRule,
  tiles: Tile[][],
  connectedDirections: { dx: number; dy: number }[],
  rng: Random,
): SettlementPlan {
  const nodes: RoadNode[] = [{ id: 'n0', x: center.x, y: center.y, kind: 'founding' }];
  const edges: RoadEdge[] = [];
  const plan: SettlementPlan = { center, nodes, edges, slots: [] };
  if (!rule.internalRoads || rule.roadLayout === 'none' || rule.roadLayout === undefined) {
    return plan;
  }

  const main = connectedDirections[0] ?? { dx: 1, dy: 0 };
  const axis = Math.abs(main.dx) >= Math.abs(main.dy)
    ? { dx: Math.sign(main.dx) || 1, dy: 0 }
    : { dx: 0, dy: Math.sign(main.dy) || 1 };
  const perp = { dx: -axis.dy, dy: axis.dx };
  const radius = rng.int(rule.radius.min, rule.radius.max);

  let nid = 1;
  const addNode = (x: number, y: number, kind: RoadNode['kind']): string => {
    const id = `n${nid++}`;
    nodes.push({ id, x, y, kind });
    return id;
  };
  const addEdge = (
    a: string, b: string, x0: number, y0: number,
    dir: { dx: number; dy: number }, len: number, kind: RoadEdge['kind'],
  ): void => {
    const run = walkTiles(x0, y0, dir, len, tiles);
    if (run.length > 0) edges.push({ a, b, tiles: run, kind });
  };

  // Through street: founding node at the centre, an end node either way.
  const w = addNode(center.x - axis.dx * radius, center.y - axis.dy * radius, 'end');
  const e = addNode(center.x + axis.dx * radius, center.y + axis.dy * radius, 'end');
  addEdge(w, 'n0', center.x - axis.dx * radius, center.y - axis.dy * radius, axis, radius, 'through');
  addEdge('n0', e, center.x, center.y, axis, radius, 'through');

  if (rule.roadLayout === 'branching') {
    const blen = Math.min(3, radius);
    for (const s of [1, -1]) {
      const end = addNode(center.x + perp.dx * blen * s, center.y + perp.dy * blen * s, 'end');
      addEdge('n0', end, center.x + perp.dx * s, center.y + perp.dy * s,
        { dx: perp.dx * s, dy: perp.dy * s }, blen - 1, 'lane');
    }
  } else if (rule.roadLayout === 'grid') {
    const off = 3;
    const lanes: string[] = [];
    for (const s of [1, -1]) {
      const ox = center.x + perp.dx * off * s, oy = center.y + perp.dy * off * s;
      const a = addNode(ox - axis.dx * (radius - 1), oy - axis.dy * (radius - 1), 'end');
      const b = addNode(ox + axis.dx * (radius - 1), oy + axis.dy * (radius - 1), 'end');
      addEdge(a, b, ox - axis.dx * (radius - 1), oy - axis.dy * (radius - 1), axis, (radius - 1) * 2, 'lane');
      lanes.push(a, b);
    }
    // Two cross connectors joining the three parallel streets.
    const half = Math.max(1, Math.floor(radius / 2));
    for (const s of [1, -1]) {
      const cx = center.x + axis.dx * half * s, cy = center.y + axis.dy * half * s;
      const j = addNode(cx, cy, 'junction');
      addEdge(j, lanes[0], cx - perp.dx * off, cy - perp.dy * off, perp, off * 2, 'lane');
    }
  }

  // Frontage slots: each road tile offers its two perpendicular neighbours.
  // Cross streets front along the MAIN axis; everything is centre-out sorted
  // by the executor, so order here just needs to be deterministic.
  edges.forEach((edge, ei) => {
    const dir = edge.tiles.length > 1
      ? {
          dx: Math.sign(edge.tiles[1].x - edge.tiles[0].x),
          dy: Math.sign(edge.tiles[1].y - edge.tiles[0].y),
        }
      : axis;
    const sides: [number, number][] = [[-dir.dy, dir.dx], [dir.dy, -dir.dx]];
    for (const t of edge.tiles) {
      for (const side of sides) {
        plan.slots.push({
          roadX: t.x, roadY: t.y, side, edge: ei,
          dist: Math.abs(t.x - center.x) + Math.abs(t.y - center.y),
        });
      }
    }
  });

  return plan;
}

/**
 * Deterministic candidate ordering for one preset: slots whose side opposes
 * the door facing, sorted by site affinity (centre-affine in, edge-affine
 * out) with a small seeded jitter for variety.
 */
export function orderedSlotsFor(
  plan: SettlementPlan,
  doorFacing: [number, number],
  rule: SiteRule | undefined,
  rng: Random,
): FrontageSlot[] {
  const want: [number, number] = [-doorFacing[0], -doorFacing[1]];
  const sign = rule?.affinity === 'edge' ? -1 : 1;
  return plan.slots
    .filter(s => s.side[0] === want[0] && s.side[1] === want[1])
    .map(s => ({ s, k: sign * s.dist + rng.next() * 1.5 }))
    .sort((a, b) => a.k - b.k)
    .map(({ s }) => s);
}
